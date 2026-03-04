const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();


// ======================================================
// TRUST PROXY
// ======================================================

app.set("trust proxy", 1);


// ======================================================
// SECURITY
// ======================================================

app.use(helmet());


// ======================================================
// CORS CONFIGURATION
// ======================================================

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


// ======================================================
// BODY PARSERS
// ======================================================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));


// ======================================================
// ROUTES
// ======================================================

const routes = require("./routes/index");

app.use("/api", routes);


// ======================================================
// HEALTH ROUTES
// ======================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "SAMA-SUITE Backend",
    company: "Sama Technologies",
    status: "running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString()
  });
});


// ======================================================
// EXPORT APP
// ======================================================

module.exports = app;