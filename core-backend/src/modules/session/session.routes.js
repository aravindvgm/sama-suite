const router=require("express").Router();

const authMiddleware=

require("../../middleware/auth.middleware");

const sessionService=

require("./session.service");


// ============================
// GET /me/organizations
// ============================
router.get(

"/me/organizations",

authMiddleware,

async(req,res)=>{

 try{

 const orgs=

 await sessionService

 .getUserOrganizations(

 req.user.sub

 );

 res.json(orgs);

 }catch(e){

 console.error(e);

 res.status(500)

 .json({

 message:"Server Error"

 });

 }

});

module.exports=router;