const pool = require("../../config/db");


// ================= CREATE PERSON =================

const createPerson = async (req,res)=>{

try{

const organizationId =
req.user?.organizationId;

if(!organizationId){

 return res.status(401).json({

 success:false,
 message:"Unauthorized"

 });

}

const {name,phone,email,address}=req.body;

if(!name || !phone){

 return res.status(400).json({

 success:false,
 message:"Name and phone required"

 });

}

const result =
await pool.query(

`
INSERT INTO persons
(organization_id,name,phone,email,address)

VALUES($1::uuid,$2,$3,$4,$5)

RETURNING *
`,

[
organizationId,
name,
phone,
email||null,
address||null
]

);

res.status(201).json({

success:true,
data:result.rows[0],
message:"Person created successfully"

});

}
catch(error){

console.error("CREATE PERSON ERROR",error);

res.status(500).json({

success:false,
message:"Failed to create person"

});

}

};



// ================= GET ALL =================

const getAllPersons=async(req,res)=>{

try{

const organizationId =
req.user.organizationId;

const result =
await pool.query(

`
SELECT *
FROM persons
WHERE organization_id=$1::uuid
ORDER BY created_at DESC
`,

[organizationId]

);

res.json({

success:true,
data:result.rows,
message:"Persons fetched successfully"

});

}
catch(error){

console.error("GET PERSONS ERROR",error);

res.status(500).json({

success:false,
message:"Failed"

});

}

};



// ================= GET BY ID =================

const getPersonById=async(req,res)=>{

try{

const organizationId =
req.user.organizationId;

const {id}=req.params;

const result=
await pool.query(

`
SELECT *
FROM persons

WHERE id=$1::uuid

AND organization_id=$2::uuid
`,

[id,organizationId]

);

if(result.rowCount===0){

return res.status(404).json({

success:false,
message:"Person not found"

});

}

res.json({

success:true,
data:result.rows[0]

});

}
catch(error){

console.error("GET PERSON ERROR",error);

res.status(500).json({

success:false,
message:"Failed"

});

}

};



// ================= UPDATE =================

const updatePerson=async(req,res)=>{

try{

const organizationId =
req.user.organizationId;

const {id}=req.params;

const {name,phone,email,address}=req.body;

if(!name || !phone){

return res.status(400).json({

success:false,
message:"Name and phone required"

});

}

const result=
await pool.query(

`
UPDATE persons

SET

name=$1,
phone=$2,
email=$3,
address=$4,
updated_at=NOW()

WHERE

id=$5::uuid

AND organization_id=$6::uuid

RETURNING *
`,

[
name,
phone,
email||null,
address||null,
id,
organizationId

]

);

if(result.rowCount===0){

return res.status(404).json({

success:false,
message:"Person not found"

});

}

res.json({

success:true,
data:result.rows[0],
message:"Person updated"

});

}
catch(error){

console.error("UPDATE PERSON ERROR",error);

res.status(500).json({

success:false,
message:"Failed"

});

}

};



// ================= DELETE =================

const deletePerson=async(req,res)=>{

try{

const organizationId =
req.user.organizationId;

const {id}=req.params;

const result=
await pool.query(

`
DELETE FROM persons

WHERE

id=$1::uuid

AND organization_id=$2::uuid

RETURNING *
`,

[id,organizationId]

);

if(result.rowCount===0){

return res.status(404).json({

success:false,
message:"Person not found"

});

}

res.json({

success:true,
data:result.rows[0],
message:"Deleted successfully"

});

}
catch(error){

console.error("DELETE PERSON ERROR",error);

res.status(500).json({

success:false,
message:"Failed"

});

}

};



module.exports={

createPerson,
getAllPersons,
getPersonById,
updatePerson,
deletePerson

};