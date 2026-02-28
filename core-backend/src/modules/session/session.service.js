const pool = require("../../config/db");


// ===============================
// GET USER ORGANIZATIONS
// ===============================
exports.getUserOrganizations =
async(userId)=>{

 const result=

 await pool.query(

 `
 SELECT

 o.id AS org_id,

 o.name,

 o.code,

 o.status,

 r.key AS role_key,

 r.name AS role_name

 FROM memberships m

 JOIN organizations o

 ON o.id=m.organization_id

 JOIN roles r

 ON r.id=m.role_id

 WHERE

 m.user_id=$1

 AND m.status='active'

 ORDER BY o.name

 `,

 [userId]

 );

 return result.rows;

};