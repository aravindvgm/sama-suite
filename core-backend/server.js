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

const allowedOrigins = [
  "http://localhost:4200",
  "https://sama-suite-dev.netlify.app"
];

const corsOptions = {
  origin: function (origin, callback) {

    // allow non-browser tools (Postman, curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS not allowed"));
  },
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
// FALLBACK ROUTE
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found"
  });
});


// ======================================================
// EXPORT APP
// ======================================================

module.exports = app;