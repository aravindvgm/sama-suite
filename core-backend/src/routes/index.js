// ======================================================
// SAMA-SUITE BACKEND START FILE
// ======================================================

const app = require("./server");

const PORT = process.env.PORT || 3000;


// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, () => {
  console.log("=====================================");
  console.log("SAMA-SUITE Backend Started");
  console.log(`Server running on port ${PORT}`);
  console.log("Company: Sama Technologies");
  console.log("=====================================");
});