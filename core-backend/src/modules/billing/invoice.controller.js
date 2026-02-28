const invoiceService = require("./invoice.service");
const upiService = require("../../utils/upi.service");

// ===============================
// ADMIN INVOICE OPERATIONS
// ===============================

/**
 * Create monthly maintenance for all flats in apartment
 */
async function createMonthlyMaintenance(req, res) {
  try {
    const { organizationId } = req.params;
    const { month, year, standardAmount, flatSpecificAmounts } = req.body;
    const { userId: adminId } = req.user;

    const result = await invoiceService.createMonthlyMaintenance({
      organizationId,
      month,
      year,
      standardAmount,
      flatSpecificAmounts,
      createdBy: adminId
    });

    res.status(201).json({
      success: true,
      message: `Monthly maintenance created for ${result.invoiceCount} flats`,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Create single invoice for specific flat
 */
async function createInvoice(req, res) {
  try {
    const { organizationId } = req.params;
    const invoiceData = {
      ...req.body,
      organizationId,
      createdBy: req.user.userId
    };

    const result = await invoiceService.createInvoice(invoiceData);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get all invoices for admin (with filters)
 */
async function getAllInvoices(req, res) {
  try {
    const { organizationId } = req.params;
    const { status, month, flatNumber, page = 1, limit = 50 } = req.query;

    const result = await invoiceService.getAllInvoices({
      organizationId,
      filters: { status, month, flatNumber },
      pagination: { page, limit }
    });

    res.json({
      success: true,
      data: result.invoices,
      pagination: result.pagination
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get specific invoice by ID
 */
async function getInvoice(req, res) {
  try {
    const { organizationId, invoiceId } = req.params;

    const invoice = await invoiceService.getInvoiceById({
      invoiceId,
      organizationId
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

// ===============================
// RESIDENT INVOICE OPERATIONS
// ===============================

/**
 * Get pending invoices for a resident
 */
async function getResidentInvoices(req, res) {
  try {
    const { organizationId } = req.params;
    const { userId: residentId } = req.user;
    const { status = 'pending,partial,overdue' } = req.query;

    const invoices = await invoiceService.getResidentInvoices({
      organizationId,
      residentId,
      status: status.split(',')
    });

    // Add UPI payment links to each invoice
    const invoicesWithUPI = await Promise.all(
      invoices.map(async (invoice) => {
        if (['pending', 'partial', 'overdue'].includes(invoice.status)) {
          const upiLink = await upiService.generatePaymentLink({
            organizationId,
            invoice
          });
          return { ...invoice, upiPaymentLink: upiLink };
        }
        return invoice;
      })
    );

    res.json({
      success: true,
      data: invoicesWithUPI
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get invoice details for resident
 */
async function getResidentInvoice(req, res) {
  try {
    const { organizationId, invoiceId } = req.params;
    const { userId: residentId } = req.user;

    const invoice = await invoiceService.getResidentInvoice({
      invoiceId,
      organizationId,
      residentId
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found or you don't have access"
      });
    }

    // Add UPI payment link if payable
    if (['pending', 'partial', 'overdue'].includes(invoice.status)) {
      const upiLink = await upiService.generatePaymentLink({
        organizationId,
        invoice
      });
      invoice.upiPaymentLink = upiLink;
    }

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

// ===============================
// INVOICE STATUS OPERATIONS
// ===============================

/**
 * Recalculate invoice status based on payments
 */
async function updateInvoiceStatus(req, res) {
  try {
    const { organizationId, invoiceId } = req.params;

    const updatedInvoice = await invoiceService.updateInvoiceStatus({
      invoiceId,
      organizationId
    });

    res.json({
      success: true,
      data: updatedInvoice
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Cancel invoice (only if no payments)
 */
async function cancelInvoice(req, res) {
  try {
    const { organizationId, invoiceId } = req.params;
    const { reason } = req.body;

    const result = await invoiceService.cancelInvoice({
      invoiceId,
      organizationId,
      reason,
      cancelledBy: req.user.userId
    });

    res.json({
      success: true,
      message: "Invoice cancelled successfully"
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

// ===============================
// REPORTING & ANALYTICS
// ===============================

/**
 * Get payment summary for apartment
 */
async function getPaymentSummary(req, res) {
  try {
    const { organizationId } = req.params;
    const { month, year } = req.query;

    const summary = await invoiceService.getPaymentSummary({
      organizationId,
      month,
      year
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

module.exports = {
  // Admin operations
  createMonthlyMaintenance,
  createInvoice,
  getAllInvoices,
  getInvoice,
  updateInvoiceStatus,
  cancelInvoice,
  getPaymentSummary,
  
  // Resident operations
  getResidentInvoices,
  getResidentInvoice
};