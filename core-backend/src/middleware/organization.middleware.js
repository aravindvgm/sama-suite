const pool = require("../config/db");
const redis = require("../config/redis");

module.exports = async function organizationMiddleware(
req,
res,
next
){

try{

// ⭐ FIX PARAM NAME

const orgId = req.params.organizationId;

if(!orgId){

return res.status(400).json({

success:false,
message:"Organization ID required"

});

}


// UUID CHECK

const uuidRegex =
/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if(!uuidRegex.test(orgId)){

return res.status(400).json({

success:false,
message:"Invalid Organization ID"

});

}


// JWT MATCH

if(

req.user &&
req.user.organizationId &&
req.user.organizationId !== orgId

){

return res.status(403).json({

success:false,
message:"Tenant access denied"

});

}


// REDIS CACHE

const cacheKey = `org:${orgId}`;

const cachedOrg =
redis && await redis.get(cacheKey);

if(cachedOrg){

req.organization =
JSON.parse(cachedOrg);

return next();

}


// DB VERIFY

const result =
await pool.query(

`
SELECT id,name,code
FROM organizations
WHERE id=$1
`,
[orgId]

);

if(!result.rows.length){

return res.status(404).json({

success:false,
message:"Organization not found"

});

}

const org = result.rows[0];


// CACHE

if(redis){

await redis.setEx(

cacheKey,
600,
JSON.stringify(org)

);

}

req.organization = org;

next();

}
catch(error){

next(error);

}

};