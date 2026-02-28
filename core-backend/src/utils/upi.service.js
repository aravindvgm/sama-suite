const pool = require("../config/db");

/**
 * Generate UPI payment link for invoice
 */
async function generatePaymentLink({ organizationId, invoice }) {
  try {
    // Get organization's UPI ID from database
    const orgQuery = `
      SELECT upi_id, organization_name 
      FROM organizations 
      WHERE id = $1
    `;
    const orgResult = await pool.query(orgQuery, [organizationId]);
    
    if (orgResult.rows.length === 0) {
      throw new Error("Organization not found");
    }
    
    const { upi_id: organizationUPI, organization_name } = orgResult.rows[0];
    
    if (!organizationUPI) {
      throw new Error("Organization UPI ID not configured");
    }

    // Calculate remaining amount
    const remainingAmount = invoice.total_amount;
    
    // Generate UPI URL
    const upiParams = {
      pa: organizationUPI,
      am: remainingAmount,
      cu: 'INR',
      tn: `Maintenance ${invoice.flat_number}`,
      tr: invoice.invoice_number,
    };
    
    const upiUrl = `upi://pay?pa=${upiParams.pa}&am=${upiParams.am}&cu=${upiParams.cu}&tn=${upiParams.tn}&tr=${upiParams.tr}`;
    
    return {
      upiUrl,
      amount: remainingAmount,
      organizationName: organization_name,
      organizationUPI,
      invoiceNumber: invoice.invoice_number
    };
    
  } catch (error) {
    console.error('Error generating UPI link:', error);
    throw error;
  }
}

module.exports = {
  generatePaymentLink
};