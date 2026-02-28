const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");


// ================= REGISTER =================

async function register(
organizationId,
body
){

const { email,password,full_name } = body;

if(!email || !password){

throw new Error("INVALID_DATA");

}


// ORG VERIFY

const org =
await pool.query(

`
SELECT id
FROM organizations
WHERE id=$1::uuid
`,
[organizationId]

);

if(!org.rowCount){

throw new Error(
"INVALID_ORGANIZATION_ID"
);

}


// EMAIL EXISTS

const exists =
await pool.query(

`
SELECT id
FROM users
WHERE LOWER(email)=LOWER($1)
`,
[email]

);

if(exists.rowCount){

throw new Error(
"EMAIL_ALREADY_EXISTS"
);

}


// PASSWORD HASH

const hash =
await bcrypt.hash(password,10);


// USER INSERT

const userInsert =
await pool.query(

`
INSERT INTO users(

email,
password_hash,
full_name,
organization_id,
is_active

)

VALUES(

$1,$2,$3,$4::uuid,true

)

RETURNING id,email,full_name
`,
[
email.toLowerCase().trim(),
hash,
full_name || null,
organizationId
]

);

const user =
userInsert.rows[0];


// ROLE FETCH

const role =
await pool.query(

`
SELECT id
FROM roles
WHERE key='org_admin'
LIMIT 1
`

);

const roleId =
role.rows[0]?.id;

if(!roleId){

throw new Error("ROLE_NOT_FOUND");

}


// MEMBERSHIP

await pool.query(

`
INSERT INTO memberships(

user_id,
organization_id,
role_id,
status

)

VALUES(

$1,$2::uuid,$3,'active'

)
`,
[
user.id,
organizationId,
roleId

]

);


return{

success:true,
message:"User registered successfully",
user

};

}



// ================= LOGIN =================

async function loginUser(

email,
password,
organizationId

){

email =
email.toLowerCase().trim();


// ENV VALIDATION

if(!process.env.JWT_SECRET){

throw new Error("JWT_SECRET missing");

}


const JWT_SECRET =
process.env.JWT_SECRET.trim();


// VERIFY ORG AGAIN

const org =
await pool.query(

`
SELECT id
FROM organizations
WHERE id=$1::uuid
`,
[organizationId]

);

if(!org.rowCount){

throw new Error(
"INVALID_ORGANIZATION_ID"
);

}


// USER FETCH

const result =
await pool.query(

`
SELECT

u.id,
u.full_name,
u.email,
u.password_hash,
u.is_active,

m.organization_id,

r.key AS role_key

FROM users u

JOIN memberships m
ON m.user_id=u.id

JOIN roles r
ON r.id=m.role_id

WHERE

LOWER(u.email)=LOWER($1)

AND m.organization_id=$2::uuid

AND m.status='active'

LIMIT 1
`,
[
email,
organizationId

]

);

if(!result.rowCount){

throw new Error("INVALID_CREDENTIALS");

}

const user =
result.rows[0];

if(!user.is_active){

throw new Error("ACCOUNT_INACTIVE");

}


// PASSWORD CHECK

const match =
await bcrypt.compare(

password,
user.password_hash

);

if(!match){

throw new Error("INVALID_CREDENTIALS");

}


// ================= JWT SIGN =================

const token =
jwt.sign(

{

sub:user.id,

organizationId:
user.organization_id,

role:
user.role_key

},

JWT_SECRET,

{

algorithm:"HS256",

issuer:
process.env.JWT_ISS
|| "SamaTechnologies",

audience:
process.env.JWT_AUD
|| "SamaSuiteUsers",

expiresIn:
process.env.JWT_EXPIRES
? process.env.JWT_EXPIRES.trim()
: "30m"

}

);


// ⭐ DEBUG TOKEN

// const decoded =
// jwt.decode(token);

// console.log(
// "NEW LOGIN TOKEN >>>",
// decoded
// );


return{

success:true,

token,

user:{

id:user.id,
email:user.email,
full_name:user.full_name,
organizationId:
user.organization_id,
role:user.role_key

}

};

}


module.exports={

register,
loginUser

};