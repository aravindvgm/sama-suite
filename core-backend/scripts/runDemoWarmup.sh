#!/usr/bin/env bash
# =============================================================================
# runDemoWarmup.sh — systemd-compatible wrapper around demoWarmup.ts
#
# Called by sama-suite-warmup.service.
# Handles:
#   • Timestamped log header/footer in /var/log/sama-suite/warmup.log
#   • Real-time output tee to log file
#   • Fatal keyword detection — exits 1 if "fatal" appears in output
#   • Non-zero exit propagation from demoWarmup.ts
#
# Never call demoWarmup.ts from systemd directly — fatal detection requires
# this wrapper to intercept the output stream.
# =============================================================================

LOG_FILE="/var/log/sama-suite/warmup.log"
APP_DIR="/opt/sama-suite/core-backend"   # adjust if repo path differs

mkdir -p "$(dirname "$LOG_FILE")"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }

echo "[$(ts)] ════════════════════ warmup start ════════════════════" >> "$LOG_FILE"

# ── Validate working directory ─────────────────────────────────────────────────

if [ ! -d "$APP_DIR" ]; then
  echo "[$(ts)] FAIL: APP_DIR not found: $APP_DIR" >> "$LOG_FILE"
  exit 1
fi

cd "$APP_DIR" || exit 1

# ── Run warmup, stream to log, capture for fatal scan ─────────────────────────
# tee writes to the log file in real-time AND to a temp file for post-scan.
# PIPESTATUS captures the exit code of npx (not tee).

TMP=$(mktemp /tmp/sama-warmup-XXXXXX.log)

npx tsx scripts/demoWarmup.ts 2>&1 | tee -a "$TMP" >> "$LOG_FILE"
WARMUP_RC=${PIPESTATUS[0]}

# ── Fatal keyword check ────────────────────────────────────────────────────────

if grep -qi "fatal" "$TMP"; then
  echo "[$(ts)] FAIL: 'fatal' detected in warmup output — marking service failed" >> "$LOG_FILE"
  rm -f "$TMP"
  exit 1
fi

rm -f "$TMP"

# ── Exit propagation ───────────────────────────────────────────────────────────

if [ "$WARMUP_RC" -ne 0 ]; then
  echo "[$(ts)] FAIL: demoWarmup.ts exited with code $WARMUP_RC" >> "$LOG_FILE"
else
  echo "[$(ts)] OK: warmup completed successfully" >> "$LOG_FILE"
fi

echo "[$(ts)] ════════════════════ warmup end   ════════════════════" >> "$LOG_FILE"
exit "$WARMUP_RC"
