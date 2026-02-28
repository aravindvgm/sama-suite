const pool = require("../config/db");

module.exports = async function requireActiveSubscription(
  req,
  res,
  next
) {

  try {

    // ======================
    // GET ORG ID
    // ======================
    const orgId = req.params.organizationId;

    if (!orgId) {

      return res.status(400).json({

        success:false,
        message:"Organization ID is required."

      });

    }

    // ======================
    // CHECK SUBSCRIPTION
    // ======================
    const result = await pool.query(

      `
      SELECT id
      FROM organizations
      WHERE id=$1
      `,

      [orgId]

    );

    if(result.rows.length === 0){

      return res.status(404).json({

        success:false,
        message:"Organization not found"

      });

    }

    next();

  }
  catch(error){

    next(error);

  }

};
