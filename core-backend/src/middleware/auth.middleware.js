const jwt = require("jsonwebtoken");

module.exports = function verifyToken(
req,
res,
next
){

try{

// ================= ENV =================

const JWT_SECRET =
process.env.JWT_SECRET?.trim();

if(!JWT_SECRET){

console.error("JWT_SECRET missing");

return res.status(500).json({

success:false,
message:"Server configuration error"

});

}


// ================= HEADER =================

const authHeader =
req.headers.authorization;

if(!authHeader ||

!authHeader.startsWith("Bearer ")){

return res.status(401).json({

success:false,
message:"Unauthorized"

});

}

const token =
authHeader.split(" ")[1];


// ================= VERIFY =================

// issuer and audience use the exact same fallback as jwt.sign in auth.service.js:
//   issuer:   process.env.JWT_ISS || "SamaTechnologies"
//   audience: process.env.JWT_AUD || "SamaSuiteUsers"
// Passing them here makes validation unconditional — the library rejects any
// token whose iss/aud does not match, regardless of whether env vars are set.

const decoded =

jwt.verify(

token,

JWT_SECRET,

{

algorithms:["HS256"],

issuer:
process.env.JWT_ISS || "SamaTechnologies",

audience:
process.env.JWT_AUD || "SamaSuiteUsers",

// allow clock skew up to 10 minutes

clockTolerance:600

}

);


// ================= CLAIM CHECK =================

if(

!decoded.sub ||

!decoded.organizationId ||

!decoded.role

){

console.error(

"Invalid JWT Claims",

decoded

);

return res.status(401).json({

success:false,
message:"Invalid token claims"

});

}


// ================= MAP USER =================

req.user={

userId:
decoded.sub,

organizationId:
decoded.organizationId,

role:
decoded.role

};


next();

}
catch(err){

console.error(

"TOKEN ERROR >>>",

err.name,

err.message

);

return res.status(401).json({

success:false,

message:

err.name==="TokenExpiredError"

? "Token expired"
: "Invalid token"

});

}

};