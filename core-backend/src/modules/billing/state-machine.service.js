/**
 * State Machine Service
 * Enforces strict invoice state transitions and business rules
 * Prevents invalid operations on invoices in certain states
 */

/**
 * Valid state transitions for invoices
 * Each state maps to the states it can transition to
 */
const VALID_TRANSITIONS = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['PENDING', 'CANCELLED'],
  PENDING: ['PARTIAL', 'OVERDUE', 'PAID', 'CANCELLED'],
  PARTIAL: ['OVERDUE', 'PAID', 'CANCELLED'],
  OVERDUE: ['PAID', 'PARTIAL', 'CANCELLED'],
  PAID: [], // Terminal state - no transitions allowed
  CANCELLED: [] // Terminal state - no transitions allowed
};

/**
 * States that allow editing invoices
 * Typically only DRAFT invoices can be edited
 */
const EDITABLE_STATES = ['DRAFT'];

/**
 * States that can accept payments
 */
const PAYABLE_STATES = ['PENDING', 'PARTIAL', 'OVERDUE'];

/**
 * Validate if a state transition is allowed
 * @param {string} currentStatus - Current invoice status
 * @param {string} targetStatus - Desired invoice status
 * @returns {boolean} - True if transition is allowed
 * @throws {Error} - If transition is invalid
 */
function validateTransition(currentStatus, targetStatus) {
  // Validate both statuses exist
  if (!VALID_TRANSITIONS.hasOwnProperty(currentStatus)) {
    throw new Error(`Invalid current status: ${currentStatus}`);
  }

  if (!VALID_TRANSITIONS.hasOwnProperty(targetStatus)) {
    throw new Error(`Invalid target status: ${targetStatus}`);
  }

  // Check if transition is allowed
  const allowedTransitions = VALID_TRANSITIONS[currentStatus];
  if (!allowedTransitions.includes(targetStatus)) {
    throw new Error(
      `Cannot transition from ${currentStatus} to ${targetStatus}. ` +
      `Allowed transitions from ${currentStatus}: ${allowedTransitions.join(', ')}`
    );
  }

  return true;
}

/**
 * Check if an invoice can be edited
 * Only DRAFT invoices can be edited
 * @param {string} status - Invoice status
 * @returns {boolean} - True if invoice can be edited
 */
function canEditInvoice(status) {
  return EDITABLE_STATES.includes(status);
}

/**
 * Check if an invoice can accept payments
 * Only PENDING, PARTIAL, or OVERDUE invoices can accept payments
 * @param {string} status - Invoice status
 * @returns {boolean} - True if invoice can accept payments
 */
function canAcceptPayment(status) {
  return PAYABLE_STATES.includes(status);
}

/**
 * Calculate invoice status based on payment amounts and due date
 * This determines automatic status transitions
 * @param {Object} invoice - Invoice object with total_amount and due_date
 * @param {number} collectedAmount - Total verified payments received
 * @returns {string} - Calculated invoice status
 */
function calculateStatusFromPayments(invoice, collectedAmount) {
  const { total_amount: invoiceTotal, due_date: dueDate } = invoice;

  // Check if payment equals or exceeds invoice amount
  if (collectedAmount >= invoiceTotal) {
    return 'PAID';
  }

  // Check if it's overdue
  const now = new Date();
  const due = new Date(dueDate);
  const isOverdue = now > due && collectedAmount < invoiceTotal;

  if (isOverdue) {
    return collectedAmount > 0 ? 'PARTIAL' : 'OVERDUE';
  }

  // If some payment received but not all
  if (collectedAmount > 0) {
    return 'PARTIAL';
  }

  // No payment received
  return 'PENDING';
}

/**
 * Check if an invoice is in a terminal state (cannot be modified)
 * Terminal states: PAID, CANCELLED
 * @param {string} status - Invoice status
 * @returns {boolean} - True if invoice is in terminal state
 */
function isTerminalState(status) {
  return ['PAID', 'CANCELLED'].includes(status);
}

/**
 * Check if an invoice can be cancelled
 * Cannot cancel PAID invoices (already finalized)
 * @param {string} status - Invoice status
 * @returns {boolean} - True if invoice can be cancelled
 */
function canBeCancelled(status) {
  return status !== 'PAID';
}

/**
 * Check if payment was already made
 * Used to validate if invoice should accept more payments
 * @param {string} status - Invoice status
 * @returns {boolean} - True if invoice has no payments yet
 */
function hasNeverBeenPaid(status) {
  return !['PAID', 'PARTIAL'].includes(status);
}

/**
 * Get all valid states an invoice can transition to
 * @param {string} currentStatus - Current invoice status
 * @returns {Array<string>} - List of allowed target states
 */
function getAllowedTransitions(currentStatus) {
  if (!VALID_TRANSITIONS.hasOwnProperty(currentStatus)) {
    return [];
  }
  return VALID_TRANSITIONS[currentStatus];
}

/**
 * Get a human-readable description of why a transition failed
 * @param {string} currentStatus - Current invoice status
 * @param {string} targetStatus - Desired invoice status
 * @param {string} reason - Optional specific reason for check
 * @returns {string} - Error message
 */
function getTransitionErrorMessage(currentStatus, targetStatus, reason = null) {
  if (reason) {
    return reason;
  }

  const allowed = VALID_TRANSITIONS[currentStatus] || [];
  return `Invoice in ${currentStatus} state cannot transition to ${targetStatus}. ` +
    `Valid transitions: ${allowed.length > 0 ? allowed.join(', ') : 'None (terminal state)'}`;
}

module.exports = {
  // Validation functions
  validateTransition,
  canEditInvoice,
  canAcceptPayment,
  canBeCancelled,
  canBeCancelled,

  // Status calculation
  calculateStatusFromPayments,

  // State checking
  isTerminalState,
  hasNeverBeenPaid,

  // Utility functions
  getAllowedTransitions,
  getTransitionErrorMessage,

  // Constants (for reference)
  VALID_TRANSITIONS,
  EDITABLE_STATES,
  PAYABLE_STATES
};
