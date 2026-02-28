/**
 * Adjustments Controller
 * API endpoints for refund and write-off approval workflow
 */

const adjustmentsService = require("./adjustments.service");

/**
 * Request an adjustment (refund, write-off, credit note)
 * Creates PENDING adjustment for admin review
 */
async function requestAdjustment(req, res) {
  try {
    const { organizationId } = req.params;
    const { invoiceId, type, amount, reason, paymentId, metadata } = req.body;

    // Validate required fields
    if (!invoiceId || !type || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: "invoiceId, type, amount, and reason are required"
      });
    }

    const result = await adjustmentsService.requestAdjustment(
      organizationId,
      invoiceId,
      type,
      amount,
      reason,
      { id: req.user.userId, orgRole: req.user.orgRole },
      {
        paymentId,
        metadata,
        ipAddress: req.ip,
        requestId: req.id
      }
    );

    res.status(201).json({
      success: true,
      message: result.message,
      data: result.adjustment
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Approve adjustment (admin only)
 * Applies changes and recalculates invoice status
 */
async function approveAdjustment(req, res) {
  try {
    const { organizationId, adjustmentId } = req.params;
    const { notes } = req.body;

    const result = await adjustmentsService.approveAdjustment(
      organizationId,
      adjustmentId,
      { id: req.user.userId, orgRole: req.user.orgRole },
      notes,
      {
        ipAddress: req.ip,
        requestId: req.id
      }
    );

    res.json({
      success: true,
      message: result.message,
      data: {
        adjustment: result.adjustment,
        invoice: result.invoice
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Reject adjustment (admin only)
 * Reason is mandatory for audit trail
 */
async function rejectAdjustment(req, res) {
  try {
    const { organizationId, adjustmentId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required"
      });
    }

    const adjustment = await adjustmentsService.rejectAdjustment(
      organizationId,
      adjustmentId,
      { id: req.user.userId, orgRole: req.user.orgRole },
      reason,
      {
        ipAddress: req.ip,
        requestId: req.id
      }
    );

    res.json({
      success: true,
      message: "Adjustment rejected",
      data: adjustment
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Reverse an approved adjustment
 * Reason is mandatory; reverses payment refund status if applicable
 */
async function reverseAdjustment(req, res) {
  try {
    const { organizationId, adjustmentId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Reversal reason is required"
      });
    }

    const adjustment = await adjustmentsService.reverseAdjustment(
      organizationId,
      adjustmentId,
      { id: req.user.userId, orgRole: req.user.orgRole },
      reason,
      {
        ipAddress: req.ip,
        requestId: req.id
      }
    );

    res.json({
      success: true,
      message: "Adjustment reversed",
      data: adjustment
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get all adjustments for an invoice
 * Includes history of refunds, write-offs, and reversals
 */
async function getInvoiceAdjustments(req, res) {
  try {
    const { organizationId, invoiceId } = req.params;

    const adjustments = await adjustmentsService.getInvoiceAdjustments(
      organizationId,
      invoiceId
    );

    res.json({
      success: true,
      data: adjustments,
      count: adjustments.length
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get pending adjustments (admin dashboard)
 * Shows all adjustments awaiting approval
 */
async function getPendingAdjustments(req, res) {
  try {
    const { organizationId } = req.params;

    const adjustments = await adjustmentsService.getPendingAdjustments(
      organizationId
    );

    res.json({
      success: true,
      message: `${adjustments.length} adjustments pending approval`,
      data: adjustments,
      count: adjustments.length
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

module.exports = {
  requestAdjustment,
  approveAdjustment,
  rejectAdjustment,
  reverseAdjustment,
  getInvoiceAdjustments,
  getPendingAdjustments
};
