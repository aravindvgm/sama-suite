'use strict';

const pool = require('../../config/db');

/**
 * Attempts to insert a new gateway event record for idempotency.
 *
 * Returns:
 *   true  — row inserted (first time this event has been seen)
 *   false — conflict (duplicate; event already processed)
 *
 * The UNIQUE(gateway, gateway_event_id) constraint is the authoritative
 * at-most-once guard — enforced at DB level, immune to application races.
 *
 * @param {object} params
 * @param {string} params.gateway          - Gateway identifier (e.g. 'razorpay')
 * @param {string} params.gatewayEventId   - Gateway-assigned event ID
 * @param {string} params.organizationId   - Derived from DB payment record
 * @param {object} params.payload          - Full raw webhook payload (for audit)
 * @returns {Promise<boolean>}
 */
async function insertGatewayEvent({ gateway, gatewayEventId, organizationId, payload }) {
  const { rowCount } = await pool.query(
    `INSERT INTO gateway_events (gateway, gateway_event_id, organization_id, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (gateway, gateway_event_id) DO NOTHING`,
    [gateway, gatewayEventId, organizationId, JSON.stringify(payload)]
  );
  // rowCount === 1 → new event inserted
  // rowCount === 0 → conflict suppressed (duplicate)
  return rowCount > 0;
}

module.exports = { insertGatewayEvent };
