const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();


// ======================================================
// TRUST PROXY
// ======================================================

app.set("trust proxy", 1);


// ======================================================
// CORS CONFIGURATION (before helmet and routes)
// ======================================================

const allowedOrigins = [
  "http://localhost:4200",
  "https://sama-suite-dev.netlify.app"
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


// ======================================================
// SECURITY
// ======================================================

app.use(helmet());


// ======================================================
// BODY PARSERS
// ======================================================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/test", (_req, res) => {
  res.send("Server working");
});


// ======================================================
// ROUTES
// ======================================================

const authRoutes = require("./src/modules/auth/auth.routes");
const routes = require("./routes/index");

app.use("/api/auth", authRoutes);
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

app.get("/health", (_req, res) => {
  return res.json({
    success: true,
    message: "Server is running"
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