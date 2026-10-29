// Shared harness for the API regression suite (node:test, no extra deps).
//
// Every test file gets its own server process pointing at a DEDICATED test
// database. The suite deletes only data inside that database and refuses to
// run when the test database would equal the real one in MONGO_URI.
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

require("dotenv").config();

const SERVER_PATH = path.join(__dirname, "..", "server.js");

const User = require("../src/models/User");
const Task = require("../src/models/Task");
const Comment = require("../src/models/Comment");
const TaskHistory = require("../src/models/TaskHistory");
const Notification = require("../src/models/Notification");

// A secret used only by spawned test servers. It is a placeholder, never a
// production credential; tests that need tokens sign them with this value.
const TEST_JWT_SECRET = "test-only-jwt-secret-placeholder";

// ---------- Test database resolution (safety first) ----------

// TEST_MONGO_URI wins; otherwise the database NAME of MONGO_URI is replaced
// with "/volta_test". In both cases we refuse to continue when the effective
// test database matches the real one, so destructive tests can never touch
// real data.
const resolveTestMongoUri = () => {
  const realUri = process.env.MONGO_URI;

  if (!realUri) {
    throw new Error(
      "MONGO_URI must be set in the environment; the suite derives a dedicated test database from it (see Backend/.env.example)"
    );
  }

  const realPath = new URL(realUri).pathname;

  let testUri;
  if (process.env.TEST_MONGO_URI) {
    testUri = process.env.TEST_MONGO_URI;
  } else {
    const derived = new URL(realUri);
    derived.pathname = "/volta_test";
    testUri = derived.toString();
  }

  const testPath = new URL(testUri).pathname;

  if (testPath === realPath) {
    throw new Error(
      `Refusing to run: the test database '${testPath}' equals the real database. Set TEST_MONGO_URI to a dedicated test database (see Backend/.env.example)`
    );
  }

  return testUri;
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// ---------- Server lifecycle ----------

// Spawns the real Backend/server.js (same entrypoint as production) with a
// test database, a placeholder JWT secret and a raised login rate limit so
// the suite's negative login tests never trip the limiter.
const startServer = async (extraEnv = {}) => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      MONGO_URI: resolveTestMongoUri(),
      PORT: String(port),
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_EXPIRES_IN: "1h",
      LOGIN_RATE_LIMIT: "1000",
      NODE_ENV: "test",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const deadline = Date.now() + 30000;
  let ready = false;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited early (code ${child.exitCode}):\n${output}`);
    }

    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // not listening yet
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!ready) {
    child.kill();
    throw new Error(`Test server did not become ready in time:\n${output}`);
  }

  return {
    baseUrl,
    output: () => output,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => {
          child.once("exit", resolve);
          setTimeout(resolve, 3000);
        });
      }
    },
  };
};

// ---------- Database helpers (test database only) ----------

const connectTestDb = async () => {
  await mongoose.connect(resolveTestMongoUri());
};

// Removes every document from the test database's collections. This can
// only ever affect records inside the dedicated test database.
const resetTestDb = async () => {
  const collections = [
    "users",
    "tasks",
    "comments",
    "taskhistories",
    "notifications",
    "meetings",
  ];

  for (const name of collections) {
    await mongoose.connection.db.collection(name).deleteMany({});
  }
};

const disconnectTestDb = async () => {
  await mongoose.disconnect();
};

// ---------- API helper ----------

const makeApi = (baseUrl) => {
  const request = async (method, apiPath, { token, body, headers } = {}) => {
    const res = await fetch(baseUrl + apiPath, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let json = null;
    try {
      json = await res.json();
    } catch {
      // endpoints under test always answer JSON; keep null if not
    }

    return { status: res.status, body: json };
  };

  return {
    get: (p, opts) => request("GET", p, opts),
    post: (p, opts) => request("POST", p, opts),
    put: (p, opts) => request("PUT", p, opts),
    delete: (p, opts) => request("DELETE", p, opts),
    // raw request for probes that must not carry the JSON content type
    raw: request,
  };
};

// ---------- Fixtures ----------

const PASSWORD = "test-password-123";

// Creates a user directly in the test database (bypasses the API so fixtures
// never consume the login rate limit). `designation` and `department` are
// the existing organizational-hierarchy fields on User.
const createUser = async ({
  name,
  email,
  role = "employee",
  isActive = true,
  designation,
  department,
} = {}) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return User.create({
    name: name || `Test ${role}`,
    email: email || `${role}-${unique}@volta.test`,
    password: await bcrypt.hash(PASSWORD, 10),
    role,
    isActive,
    ...(designation ? { designation } : {}),
    ...(department ? { department } : {}),
  });
};

// Logs in through the real API and returns the token.
const login = async (api, email, password = PASSWORD) => {
  const res = await api.post("/api/auth/login", {
    body: { email, password },
  });

  if (res.status !== 200 || !res.body.token) {
    throw new Error(`Fixture login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.token;
};

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// Signs a token with the test secret (for expired/tampered/nonexistent-user
// probes). Never uses the real JWT_SECRET.
const forgeToken = (payload, options = {}) =>
  jwt.sign(payload, TEST_JWT_SECRET, options);

module.exports = {
  TEST_JWT_SECRET,
  PASSWORD,
  startServer,
  connectTestDb,
  resetTestDb,
  disconnectTestDb,
  makeApi,
  createUser,
  login,
  inDays,
  forgeToken,
  models: { User, Task, Comment, TaskHistory, Notification },
};
