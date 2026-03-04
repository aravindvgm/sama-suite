#!/usr/bin/env bash
# =============================================================================
# demoWatchdog.sh — SAMA-SUITE demo environment health watchdog
#
# Invoked every 30 seconds by sama-suite-watchdog.timer (systemd).
# Each run is stateless and short-lived (oneshot). The timer drives frequency.
#
# Checks:
#   GET http://localhost:3000/health/demo
#   → HTTP status must be 200
#   → .database.status must be "ok"
#   → .redis.status    must be "ok"
#
# On any failure:
#   → Logs timestamped details to /var/log/sama-suite/watchdog.log
#   → Restarts the pm2 process "sama-suite"
#   → Enforces a 60-second restart cooldown (max 1 restart/min)
#   → Pauses after 5 restarts within 10 minutes (failure window protection)
#
# Dependencies: curl, jq, pm2
# No Node.js required.
# =============================================================================

# ── Configuration ─────────────────────────────────────────────────────────────

HEALTH_URL="http://localhost:3000/health/demo"
PM2_PROCESS="sama-suite"
LOG_FILE="/var/log/sama-suite/watchdog.log"
COOLDOWN_FILE="/tmp/sama-suite-watchdog-last-restart"
COOLDOWN_SECONDS=60
RESTART_HISTORY_FILE="/tmp/sama-suite-watchdog-restart-history"
WINDOW_SECONDS=600   # 10-minute rolling window
WINDOW_MAX=5         # max restarts before pause
CURL_TIMEOUT=10      # seconds before curl gives up
PM2_BIN="$(command -v pm2 2>/dev/null || echo '/usr/local/bin/pm2')"

# ── Bootstrap ─────────────────────────────────────────────────────────────────

mkdir -p "$(dirname "$LOG_FILE")"

# ── Logging helpers ───────────────────────────────────────────────────────────

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }

log()      { echo "[$(ts)] INFO  $*" >> "$LOG_FILE"; }
log_fail() { echo "[$(ts)] FAIL  $*" >> "$LOG_FILE"; }
log_warn() { echo "[$(ts)] WARN  $*" >> "$LOG_FILE"; }
log_ok()   { echo "[$(ts)] OK    $*" >> "$LOG_FILE"; }

# ── PM2_HOME detection ────────────────────────────────────────────────────────
# pm2 stores its daemon socket and process list under PM2_HOME (~/.pm2 by
# default). When this script runs as root via systemd but pm2 was started by
# a non-root user (e.g. ubuntu), the env-inherited PM2_HOME will be absent
# or wrong, causing "pm2 restart" to target a different (or non-existent)
# daemon. We resolve the correct PM2_HOME before any pm2 invocation.

resolve_pm2_home() {
  # 1. Honour an explicit override set in the systemd unit's Environment=.
  if [ -n "${PM2_HOME:-}" ] && [ -d "$PM2_HOME" ]; then
    echo "$PM2_HOME"
    return 0
  fi

  # 2. Scan candidate directories: known system users' home dirs + /root.
  local candidates=()
  candidates+=("/root/.pm2")
  # Pick up any normal user home dirs that contain a .pm2 directory.
  while IFS= read -r -d '' dir; do
    candidates+=("$dir")
  done < <(find /home -maxdepth 2 -name ".pm2" -type d -print0 2>/dev/null)

  local found=()
  for dir in "${candidates[@]}"; do
    # A valid PM2_HOME must contain the daemon socket file.
    if [ -S "${dir}/rpc.sock" ] || [ -S "${dir}/pub.sock" ]; then
      found+=("$dir")
    fi
  done

  case ${#found[@]} in
    0)
      return 1   # no live pm2 daemon found
      ;;
    1)
      echo "${found[0]}"
      return 0
      ;;
    *)
      # Multiple live daemons — ambiguous; cannot safely pick one.
      log_fail "PM2_HOME: multiple live pm2 daemons found: ${found[*]}"
      log_fail "PM2_HOME: set PM2_HOME explicitly in the systemd unit's Environment= to resolve ambiguity"
      return 2
      ;;
  esac
}

RESOLVED_PM2_HOME=$(resolve_pm2_home)
PM2_HOME_RC=$?

if [ $PM2_HOME_RC -ne 0 ]; then
  if [ $PM2_HOME_RC -eq 1 ]; then
    log_fail "PM2_HOME: no live pm2 daemon found (checked /root/.pm2 and /home/*/.pm2)"
    log_fail "PM2_HOME: ensure pm2 is running — start with: pm2 start sama-suite"
  fi
  # RC 2 already logged inside resolve_pm2_home.
  exit 1
fi

export PM2_HOME="$RESOLVED_PM2_HOME"
log "PM2_HOME resolved: $PM2_HOME"

# ── Dependency guard ──────────────────────────────────────────────────────────

if ! command -v jq > /dev/null 2>&1; then
  log_fail "jq not found — install with: apt-get install -y jq"
  exit 1
fi

if [ ! -x "$PM2_BIN" ]; then
  log_fail "pm2 not found at '$PM2_BIN' — install with: npm install -g pm2"
  exit 1
fi

# ── Health check ──────────────────────────────────────────────────────────────

NEEDS_RESTART=0
FAIL_REASONS=()

RESPONSE=$(
  curl --silent --fail --max-time "$CURL_TIMEOUT" \
    --write-out '\n{"_http_status":%{http_code}}' \
    "$HEALTH_URL" 2>/dev/null
) || RESPONSE=""

if [ -z "$RESPONSE" ]; then
  log_fail "curl: no response from $HEALTH_URL (timeout or connection refused)"
  FAIL_REASONS+=("backend_unreachable")
  NEEDS_RESTART=1
else
  # Extract the JSON body (first line) and the HTTP status (second line)
  BODY=$(echo "$RESPONSE" | head -n 1)
  HTTP_STATUS=$(echo "$RESPONSE" | tail -n 1 | jq -r '._http_status' 2>/dev/null || echo "0")

  if [ "$HTTP_STATUS" != "200" ]; then
    log_fail "HTTP status $HTTP_STATUS (expected 200)"
    FAIL_REASONS+=("http_${HTTP_STATUS}")
    NEEDS_RESTART=1
  fi

  DB_STATUS=$(echo "$BODY" | jq -r '.database.status // "missing"' 2>/dev/null || echo "parse_error")
  REDIS_STATUS=$(echo "$BODY" | jq -r '.redis.status // "missing"' 2>/dev/null || echo "parse_error")

  if [ "$DB_STATUS" != "ok" ]; then
    log_fail "database.status = \"$DB_STATUS\" (expected \"ok\")"
    FAIL_REASONS+=("db_${DB_STATUS}")
    NEEDS_RESTART=1
  fi

  if [ "$REDIS_STATUS" != "ok" ]; then
    log_fail "redis.status = \"$REDIS_STATUS\" (expected \"ok\")"
    FAIL_REASONS+=("redis_${REDIS_STATUS}")
    NEEDS_RESTART=1
  fi

  if [ "$NEEDS_RESTART" -eq 0 ]; then
    DB_LATENCY=$(echo "$BODY" | jq -r '.database.latencyMs // "?"' 2>/dev/null || echo "?")
    UPTIME=$(echo "$BODY" | jq -r '.uptime // "?"' 2>/dev/null || echo "?")
    log_ok "http=200 db=ok(${DB_LATENCY}ms) redis=ok uptime=${UPTIME}s"
  fi
fi

# ── Restart with cooldown ─────────────────────────────────────────────────────

if [ "$NEEDS_RESTART" -eq 1 ]; then
  NOW=$(date +%s)
  LAST_RESTART=0

  if [ -f "$COOLDOWN_FILE" ]; then
    LAST_RESTART=$(cat "$COOLDOWN_FILE" 2>/dev/null | tr -d '[:space:]' || echo 0)
    # Validate it's a number; reset if corrupted
    [[ "$LAST_RESTART" =~ ^[0-9]+$ ]] || LAST_RESTART=0
  fi

  ELAPSED=$(( NOW - LAST_RESTART ))
  REASONS_STR=$(IFS=','; echo "${FAIL_REASONS[*]}")

  if [ "$ELAPSED" -lt "$COOLDOWN_SECONDS" ]; then
    REMAINING=$(( COOLDOWN_SECONDS - ELAPSED ))
    log_warn "restart suppressed by cooldown — reasons=[$REASONS_STR] elapsed=${ELAPSED}s remaining=${REMAINING}s"
  else
    # ── Failure window check ────────────────────────────────────────────────
    # Count successful restarts within the last WINDOW_SECONDS seconds.
    # Each successful restart appends a Unix epoch line to RESTART_HISTORY_FILE.
    # Entries older than the window are discarded before the count.

    touch "$RESTART_HISTORY_FILE" 2>/dev/null
    CUTOFF=$(( NOW - WINDOW_SECONDS ))

    # Rewrite the history file keeping only entries within the window.
    RECENT_RESTARTS=()
    while IFS= read -r line; do
      [[ "$line" =~ ^[0-9]+$ ]] || continue
      (( line > CUTOFF )) && RECENT_RESTARTS+=("$line")
    done < "$RESTART_HISTORY_FILE"

    printf '%s\n' "${RECENT_RESTARTS[@]}" > "$RESTART_HISTORY_FILE"
    RESTART_COUNT=${#RECENT_RESTARTS[@]}

    if [ "$RESTART_COUNT" -ge "$WINDOW_MAX" ]; then
      log_warn "Watchdog paused — repeated failures. (${RESTART_COUNT} restarts in ${WINDOW_SECONDS}s — manual intervention required)"
      exit 0
    fi

    log "restart triggered — reasons=[$REASONS_STR] pm2_process=$PM2_PROCESS"
    echo "$NOW" > "$COOLDOWN_FILE"

    if "$PM2_BIN" restart "$PM2_PROCESS" --update-env >> "$LOG_FILE" 2>&1; then
      log "restart completed — pm2 process '$PM2_PROCESS' restarted"
      # Record this restart in the rolling history window.
      echo "$NOW" >> "$RESTART_HISTORY_FILE"
      # Trigger warmup to re-warm buffers after backend recovery.
      # Non-fatal: watchdog success is independent of warmup outcome.
      log "warmup: starting sama-suite-warmup.service"
      systemctl start sama-suite-warmup.service >> "$LOG_FILE" 2>&1 \
        && log "warmup: service started" \
        || log_warn "warmup: sama-suite-warmup.service failed to start (check: systemctl status sama-suite-warmup)"
    else
      log_fail "pm2 restart FAILED for '$PM2_PROCESS' — manual intervention required"
      # Do not update cooldown file on pm2 failure:
      # the next run should attempt the restart again.
      echo "0" > "$COOLDOWN_FILE"
    fi
  fi
fi

exit 0
