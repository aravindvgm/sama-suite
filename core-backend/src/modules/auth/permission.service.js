"use strict";

const pool = require("../../config/db");

// ─── Cache Configuration ──────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * In-memory permission cache.
 *
 * Key:   `${organizationId}:${userId}`
 * Value: { permissions: Set<string>, expiresAt: number }
 *
 * Redis-ready: replace Map operations with cache.get/set/del calls
 * and serialize the Set to a string array when migrating.
 */
const permissionCache = new Map();

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Loads all permission keys for a user within an organization from the database.
 *
 * @param {string} userId
 * @param {string} organizationId
 * @returns {Promise<Set<string>>}  Set of "module:action" strings
 */
async function loadPermissionsFromDB(userId, organizationId) {
  const { rows } = await pool.query(
    `SELECT p.module, p.action
     FROM   user_memberships  um
     JOIN   roles             r   ON r.id             = um.role_id
                                 AND r.organization_id = um.organization_id
     JOIN   role_permissions  rp  ON rp.role_id        = r.id
                                 AND rp.organization_id = um.organization_id
     JOIN   permissions       p   ON p.id              = rp.permission_id
     WHERE  um.user_id        = $1
       AND  um.organization_id = $2`,
    [userId, organizationId]
  );

  return new Set(rows.map(row => `${row.module}:${row.action}`));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the user holds the given permission within the organization.
 * Caches the full permission Set per user/org pair for CACHE_TTL_MS milliseconds.
 *
 * @param {string} userId
 * @param {string} organizationId
 * @param {string} permissionKey  - "module:action" e.g. "students:create"
 * @returns {Promise<boolean>}
 */
async function userHasPermission(userId, organizationId, permissionKey) {
  const cacheKey = `${organizationId}:${userId}`;

  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions.has(permissionKey);
  }

  const permissions = await loadPermissionsFromDB(userId, organizationId);

  permissionCache.set(cacheKey, {
    permissions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return permissions.has(permissionKey);
}

/**
 * Invalidates the cached permission set for a single user/org pair.
 * Call after role or membership changes to force a fresh DB load on next check.
 * No-ops silently if the entry is not present.
 *
 * @param {string} userId
 * @param {string} organizationId
 */
function invalidateUserPermissionCache(userId, organizationId) {
  permissionCache.delete(`${organizationId}:${userId}`);
}

/**
 * Invalidates the cached permission sets for every active member who holds
 * the given role within the organization.
 *
 * Use after any change to role_permissions (permission granted or revoked on
 * a role) so that all affected users see the updated permission set on their
 * next request rather than serving stale cache entries.
 *
 * @param {string} roleId
 * @param {string} organizationId
 * @returns {Promise<void>}
 */
async function invalidateRolePermissionCache(roleId, organizationId) {
  const { rows } = await pool.query(
    `SELECT user_id
     FROM   user_memberships
     WHERE  role_id         = $1
       AND  organization_id = $2
       AND  status          = 'active'`,
    [roleId, organizationId]
  );

  for (const row of rows) {
    permissionCache.delete(`${organizationId}:${row.user_id}`);
  }
}

module.exports = {
  userHasPermission,
  invalidateUserPermissionCache,
  invalidateRolePermissionCache,
};
