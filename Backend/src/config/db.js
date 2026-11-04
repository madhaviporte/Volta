const mongoose = require("mongoose");

const { installDnsFallback } = require("./dnsFallback");

// Bounded per attempt so a blackholed network fails fast instead of hanging
// for the driver's 30s default. These also cap how long any server
// selection waits while the connection is temporarily down at runtime;
// the driver itself keeps reconnecting in the background between attempts.
const CONNECT_OPTIONS = {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
};

const MAX_CONNECT_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000; // 1s, 2s, 4s, 8s (capped) backoff
const RETRY_MAX_DELAY_MS = 8000;

// Error names that mean "the configuration itself is wrong" - retrying
// would only waste time, so these still fail fast (and exit, as before).
// Exact-name matches only: subclasses such as MongooseServerSelectionError
// stay retryable.
const PERMANENT_ERROR_NAMES = new Set([
  "MongoParseError",
  "MongoAuthenticationError",
  "MongooseError",
]);

// Codes that mean "the network said try again later" (or the peer refused
// us right now, which usually means the database is still starting up).
const TRANSIENT_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "EAI_NONAME",
  "EAI_ADDRFAMILY",
  "ESERVFAIL",
  "ETIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

// Mongoose often wraps transient failures (e.g. a MongooseServerSelectionError
// with no code, message "getaddrinfo ENOTFOUND ..."), so the message is the
// reliable signal for the network-dependent cases.
const TRANSIENT_ERROR_MESSAGE =
  /getaddrinfo ENOTFOUND|EAI_AGAIN|querySrv|ETIMEOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/;

// Whether a connect failure is worth retrying. Unknown errors default to
// retryable: the loop is bounded (MAX_CONNECT_ATTEMPTS) and a wrong-credential
// or bad-URI error is caught by the permanent-name check above.
const isRetryableConnectError = (error) => {
  if (!error) {
    return false;
  }

  if (error.code && TRANSIENT_ERROR_CODES.has(error.code)) {
    return true;
  }

  if (
    typeof error.message === "string" &&
    TRANSIENT_ERROR_MESSAGE.test(error.message)
  ) {
    return true;
  }

  return !PERMANENT_ERROR_NAMES.has(error.name);
};

// Connection errors can echo the connection string (mongoose does this for
// invalid URIs), so strip any credentials before the message is logged.
const safeErrorMessage = (error) =>
  String((error && error.message) || error).replace(
    /\/\/[^@\s/]+@/g,
    "//***:***@"
  );

// Bounded retry loop with exponential backoff, shared with the tests via
// module.exports below. Calls connectFn up to maxAttempts times; retries
// only transient failures; always throws the last error on exhaustion.
const attemptConnect = async (
  connectFn,
  {
    maxAttempts = MAX_CONNECT_ATTEMPTS,
    baseDelayMs = RETRY_BASE_DELAY_MS,
    maxDelayMs = RETRY_MAX_DELAY_MS,
    onError = undefined,
  } = {}
) => {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await connectFn(attempt);
    } catch (error) {
      lastError = error;

      const retryable = isRetryableConnectError(error);
      const willRetry = retryable && attempt < maxAttempts;

      if (onError) {
        onError(error, attempt, { maxAttempts, retryable, willRetry });
      }

      if (!willRetry) {
        break;
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

// The driver reconnects on its own after the initial connection succeeds
// (SDAM heartbeats), so no manual reconnect loop is needed. These two
// listeners only make a mid-run drop visible in the logs; they are
// registered once, and only from connectDB() so merely requiring this
// module (tests) never attaches them.
let stateListenersInstalled = false;

const installConnectionStateListeners = () => {
  if (stateListenersInstalled) {
    return;
  }

  stateListenersInstalled = true;

  // Only log a drop when a connection actually existed, so a failed
  // initial connect does not print a misleading "disconnected" line
  // right before the retry loop reports the real error.
  let wasConnected = false;

  mongoose.connection.on("connected", () => {
    wasConnected = true;
  });

  mongoose.connection.on("disconnected", () => {
    if (wasConnected) {
      console.error(
        "MongoDB disconnected; the driver keeps trying to reconnect"
      );
    }
  });

  mongoose.connection.on("reconnected", () => {
    console.log("MongoDB reconnected");
  });
};

const connectDB = async () => {
  // Make Atlas SRV and hostname resolution resilient BEFORE connecting:
  // system DNS first (unchanged behavior where it works), public resolvers
  // (8.8.8.8 / 1.1.1.1 by default) only when the system resolver fails.
  installDnsFallback();
  installConnectionStateListeners();

  try {
    await attemptConnect(
      async (attempt) => {
        try {
          await mongoose.connect(process.env.MONGO_URI, CONNECT_OPTIONS);
        } catch (error) {
          // One line per attempt (names and messages only, credentials
          // redacted) so a flaky network is visible in the Render logs.
          console.error(
            `MongoDB connection attempt ${attempt}/${MAX_CONNECT_ATTEMPTS} failed:`,
            safeErrorMessage(error)
          );
          throw error;
        }
      },
      {
        onError: (error, attempt, { maxAttempts, willRetry }) => {
          if (willRetry) {
            const delay = Math.min(
              RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
              RETRY_MAX_DELAY_MS
            );
            console.error(
              `Retrying MongoDB connection in ${Math.round(delay / 1000)}s (${attempt}/${maxAttempts} attempts used)...`
            );
          }
        },
      }
    );

    console.log("MongoDB connected");
  } catch (error) {
    // Same contract as before: exits non-zero so no half-started server is
    // left behind (Render restarts the service on a non-zero exit).
    console.error("MongoDB connection failed:", safeErrorMessage(error));
    process.exit(1);
  }
};

module.exports = connectDB;

// Exported for the test suite only (attempt classification / retry loop).
module.exports.attemptConnect = attemptConnect;
module.exports.isRetryableConnectError = isRetryableConnectError;
