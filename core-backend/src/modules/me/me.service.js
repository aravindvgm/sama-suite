const pool = require("../../config/db"); 
// ⚠️ adjust path if your pool file different
// example: ../../db/pool

exports.getUser = async (userId) => {

  const query = `

    SELECT

      id,
      email,
      full_name,
      created_at,
      updated_at

    FROM users

    WHERE id = $1
    AND is_active = true

  `;

  const result = await pool.query(

    query,
    [userId]

  );

  return result.rows[0] || null;

};