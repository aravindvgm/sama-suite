const authService =
require("./auth.service");


// =======================
// REGISTER
// =======================

exports.register =
async(req,res)=>{

try{

const { organizationId } =
req.params;

const result =
await authService.register(

organizationId,
req.body

);

res.status(201).json(result);

}
catch(error){

console.error(
"REGISTER ERROR:",
error.message
);

res.status(400).json({

success:false,
message:error.message

});

}

};



// =======================
// LOGIN
// =======================

exports.login =
async(req,res)=>{

try{

const { organizationId } =
req.params;

const {

email,
password

}=req.body;

const result =
await authService.loginUser(

email,
password,
organizationId

);

res.json(result);

}
catch(error){

console.error(

"LOGIN ERROR:",
error.message

);

res.status(401).json({

success:false,
message:error.message

});

}

};