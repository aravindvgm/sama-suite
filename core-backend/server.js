// ======================================================
// CORS CONFIGURATION (DEMO SAFE VERSION)
// ======================================================

const cors = require("cors");

app.use(cors({
  origin: true,              // allow all origins for demo
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

// IMPORTANT: handle preflight requests
app.options("*", cors());