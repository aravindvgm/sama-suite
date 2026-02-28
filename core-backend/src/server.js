require("dotenv").config(); // MUST FIRST


// ================= ENV VALIDATION =================

if(!process.env.JWT_SECRET){

console.error("❌ JWT_SECRET missing");

process.exit(1);

}


// ================= LOAD SERVICES FIRST =================

require("./config/db");

require("./config/redis");


// ================= LOAD EXPRESS =================

const app = require("./app");


const PORT =
process.env.PORT || 5000;


// ================= START SERVER =================

const server =
app.listen(PORT,()=>{

console.log(

`🚀 Sama Technologies Core Backend running on port ${PORT}`

);

});


// ================= SHUTDOWN =================

function shutdown(signal){

console.log(`${signal} received`);

server.close(()=>{

console.log("Server closed");

process.exit(0);

});

}

process.on("SIGTERM",shutdown);

process.on("SIGINT",shutdown);