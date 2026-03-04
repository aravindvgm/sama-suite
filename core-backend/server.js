// ======================================================
// CORS CONFIGURATION
// ======================================================

const allowedOrigins = [
  "http://localhost:4200",
  "https://sama-suite-dev.netlify.app"
];

const corsOptions = {
  origin: function (origin, callback) {

    // Allow non-browser requests (Postman, curl, internal)
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

// VERY IMPORTANT: handle preflight requests
app.options("*", cors(corsOptions));