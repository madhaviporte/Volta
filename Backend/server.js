require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const userRoutes = require("./src/routes/userRoutes");
const taskRoutes = require("./src/routes/taskRoutes");
const dashboardRoutes = require("./src/routes/dashboardRoutes");
const notificationRoutes = require("./src/routes/notificationRoutes");
const meetingRoutes = require("./src/routes/meetingRoutes");
const {
  generateDeadlineNotifications,
} = require("./src/controllers/notificationController");
const Notification = require("./src/models/Notification");
const {
  verifyEmailConnection,
  isEmailEnabled,
} = require("./src/utils/emailService");
const {
  retryFailedNotificationEmails,
} = require("./src/utils/notificationEmail");
// Required configuration must be present or the server refuses to start.
// Only variable NAMES are printed, never their values.
const REQUIRED_ENV = ["MONGO_URI", "JWT_SECRET"];
const missingEnv = REQUIRED_ENV.filter(
  (name) => !process.env[name] || !String(process.env[name]).trim()
);

if (missingEnv.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnv.join(", ")}`
  );
  console.error(
    "Set them in the process environment (or in Backend/.env for local development) and start the server again."
  );
  process.exit(1);
}

const app = express();

// TRUST_PROXY=1 behind a single reverse proxy, so the rate limiter keys on real client IPs.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

// CORS_ALLOWED_ORIGINS = comma separated frontend origins; local dev/preview
// origins are added automatically outside production.
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV !== "production") {
  for (const origin of DEV_ORIGINS) {
    if (!allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin);
    }
  }
}

const corsOptions = {
  // Requests without an Origin header (curl, health checks) are allowed.
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    callback(null, allowedOrigins.includes(origin));
  },
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());

// Requests without a JSON content type (or without any body) never reach the
// body parser, which leaves req.body undefined in Express 5. Normalize it so
// controllers destructure safely and answer 400 through their existing field
// validation instead of crashing with a 500. Malformed JSON still fails
// inside express.json() and is answered by the error middleware as a clean 400.
app.use((req, res, next) => {
  if (req.body === undefined) {
    req.body = {};
  }

  next();
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Volta API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/meetings", meetingRoutes);

// Anything that fails before a controller answers (a malformed JSON body,
// or a rejected handler in Express 5) gets the same { success, message }
// shape as the rest of the API. Bad request bodies answer with their client
// status; everything else answers a generic 500. Stack traces and database
// details are logged on the server only, never sent to the client.
app.use((err, req, res, next) => {
  if (err.type && err.type.startsWith("entity.")) {
    return res.status(err.status || 400).json({
      success: false,
      message:
        err.type === "entity.parse.failed"
          ? "Invalid JSON body"
          : "Invalid request body",
    });
  }

  console.error("Unhandled request error:", err);

  return res.status(500).json({
    success: false,
    message: "Something went wrong",
  });
});

// Port must be a usable TCP port. Treat 0/blank/invalid as unset so a
// stray PORT=0 in the environment can't push the server onto a random port
// (the frontend expects http://localhost:3000).
const parsedPort = parseInt(process.env.PORT, 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000;

// Connect to MongoDB first, then accept requests: connectDB() exits non-zero
// on failure, so no half-started server is ever left behind.
const start = async () => {
  await connectDB();

  // Bring the notifications collection's indexes in line with the
  // schema: creates the per-action dedupeKey uniqueness index and
  // retires the old compound unique index (duplicate protection now
  // lives on dedupeKey, which allows repeated activity notifications on
  // the same task). This only touches index metadata, never documents.
  // A failure here (e.g. limited database privileges) must not stop the
  // server: the controllers still check for duplicates before inserting.
  try {
    await Notification.syncIndexes();
  } catch (error) {
    console.error("Notification index sync failed:", error.message);
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Verify the SMTP connection once at startup (informational only -
  // skipped entirely when email is disabled or unconfigured, so an
  // environment without SMTP behaves exactly as before).
  if (isEmailEnabled()) {
    verifyEmailConnection();
  }

  // Deadline/overdue reminders run once at startup, then every 6 hours.
  // The same cadence retries any notification email whose SMTP delivery
  // failed (bounded: capped attempts, capped batch - no extra timers).
  const runScheduledJobs = () => {
    generateDeadlineNotifications();
    retryFailedNotificationEmails();
  };

  runScheduledJobs();
  setInterval(runScheduledJobs, 6 * 60 * 60 * 1000);
};

start();
