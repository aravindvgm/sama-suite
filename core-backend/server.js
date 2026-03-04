const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();


// ======================================================
// TRUST PROXY (required for Render / reverse proxies)
// ======================================================

app.set("trust proxy", 1);


// ======================================================
// SECURITY
// ======================================================

app.use(helmet());


// ======================================================
// CORS CONFIGURATION (DEMO SAFE)
// ======================================================

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));

// handle preflight requests
app.options("*", cors(corsOptions));


// ======================================================
// BODY PARSERS
// ======================================================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));


// ======================================================
// HEALTH ROUTES
// ======================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "SAMA-SUITE Backend",
    status: "running"
  });
});

app.get("/api", (req, res) => {
  res.json({
    success: true,
    service: "SAMA API",
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
```
