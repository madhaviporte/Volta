// Authentication: login success/failure, account state, token handling and
// password exposure. Run with `npm test` (spawns the real server against the
// dedicated test database).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  startServer,
  connectTestDb,
  resetTestDb,
  disconnectTestDb,
  makeApi,
  createUser,
  forgeToken,
  PASSWORD,
} = require("./helpers");

let server;
let api;
let manager;
let employee;
let inactiveUser;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "Auth Manager", role: "manager" });
  employee = await createUser({ name: "Auth Employee", role: "employee" });
  inactiveUser = await createUser({ name: "Auth Inactive", role: "employee", isActive: false });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

test("manager can log in and receives a token plus role, never a password field", async () => {
  const res = await api.post("/api/auth/login", {
    body: { email: manager.email, password: PASSWORD },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(typeof res.body.token === "string" && res.body.token.length > 0);
  assert.equal(res.body.user.role, "manager");
  assert.equal(res.body.user.email, manager.email);
  assert.equal(res.body.password, undefined);
  assert.equal(res.body.user.password, undefined);
});

test("employee can log in", async () => {
  const res = await api.post("/api/auth/login", {
    body: { email: employee.email, password: PASSWORD },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, "employee");
});

test("wrong password and unknown email answer the identical generic 401", async () => {
  const wrongPassword = await api.post("/api/auth/login", {
    body: { email: employee.email, password: "definitely-not-the-password" },
  });

  const unknownEmail = await api.post("/api/auth/login", {
    body: { email: "nobody-here@volta.test", password: PASSWORD },
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  // Same message for both -> no user enumeration through the body
  assert.equal(wrongPassword.body.message, unknownEmail.body.message);
  assert.equal(wrongPassword.body.message, "Invalid email or password");
});

test("inactive account with a WRONG password answers the generic 401 (existence not disclosed)", async () => {
  const res = await api.post("/api/auth/login", {
    body: { email: inactiveUser.email, password: "wrong-password-here" },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, "Invalid email or password");
});

test("inactive account with the CORRECT password is told the account is inactive", async () => {
  const res = await api.post("/api/auth/login", {
    body: { email: inactiveUser.email, password: PASSWORD },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.message, "Your account is inactive");
});

test("missing body fields answer 400, malformed JSON answers a clean 400", async () => {
  const missing = await api.post("/api/auth/login", { body: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.message, "Email and password are required");

  const malformed = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.equal(malformedBody.message, "Invalid JSON body");
});

test("requests without a token are rejected with 401", async () => {
  const res = await api.get("/api/tasks");
  assert.equal(res.status, 401);
});

test("garbage, tampered and malformed tokens are rejected with 401", async () => {
  const garbage = await api.get("/api/tasks", { token: "not-a-jwt-at-all" });
  assert.equal(garbage.status, 401);

  // Signed with a DIFFERENT secret than the server uses
  const wrongSecret = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const tampered = `${header}.${wrongSecret.split(".")[1]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const forged = await api.get("/api/tasks", { token: tampered });
  assert.equal(forged.status, 401);
});

test("an expired token is rejected with 401", async () => {
  const expired = forgeToken({ userId: manager._id.toString() }, { expiresIn: "-10s" });
  const res = await api.get("/api/tasks", { token: expired });
  assert.equal(res.status, 401);
});

test("a valid token whose user no longer exists is rejected with 401", async () => {
  const ghost = await createUser({ name: "Ghost" });
  const token = forgeToken({ userId: ghost._id.toString() }, { expiresIn: "1h" });

  await ghost.deleteOne();

  const res = await api.get("/api/tasks", { token });
  assert.equal(res.status, 401);
  assert.equal(res.body.message, "Not authorized, user no longer exists");
});

test("a token issued before deactivation stops working immediately (checked per request)", async () => {
  const user = await createUser({ name: "To Deactivate" });
  const token = forgeToken({ userId: user._id.toString() }, { expiresIn: "1h" });

  const before = await api.get("/api/tasks", { token });
  assert.equal(before.status, 200);

  user.isActive = false;
  await user.save();

  const after = await api.get("/api/tasks", { token });
  assert.equal(after.status, 401);
});

test("password hashes never appear in API responses", async () => {
  // Login response
  const loginRes = await api.post("/api/auth/login", {
    body: { email: employee.email, password: PASSWORD },
  });
  assert.equal(loginRes.status, 200);
  assert.ok(!JSON.stringify(loginRes.body).includes("$2"));

  // Manager user listings
  const token = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });

  const list = await api.get("/api/users", { token });
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.body).includes("\"password\""));
  assert.ok(!JSON.stringify(list.body).includes("$2"));

  const single = await api.get(`/api/users/${employee._id}`, { token });
  assert.equal(single.status, 200);
  assert.ok(!JSON.stringify(single.body).includes("\"password\""));
});
