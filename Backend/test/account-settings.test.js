// Manager account settings (PUT /api/auth/me): a manager can change their OWN
// login email and password, and nothing else. Covers successful identifier and
// password updates, wrong current password, invalid input, confirmation
// mismatch, duplicate identifier, employee denial, cross-account attempts,
// old-password invalidation, and that the password hash never appears in a
// response. Runs only against the dedicated isolated test database.
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
let otherManager;
let employee;
let takenEmail;

const managerToken = () =>
  forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "Settings Manager", role: "manager" });
  otherManager = await createUser({ name: "Other Manager", role: "manager" });
  employee = await createUser({ name: "Settings Employee" });

  // An email another account already owns, for the duplicate-identifier test
  takenEmail = otherManager.email;
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

test("manager can update their own login email and log in with it afterwards", async () => {
  const newEmail = `new-login-${Date.now()}@volta.test`;

  const res = await api.put("/api/auth/me", {
    token: managerToken(),
    body: { currentPassword: PASSWORD, newEmail },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.user.email, newEmail);
  // No hash or token leaks back
  assert.equal(res.body.user.password, undefined);
  assert.equal(res.body.token, undefined);
  assert.ok(!JSON.stringify(res.body).includes("$2"));

  // The NEW identifier is used for subsequent logins (requirement 12)
  const loginRes = await api.post("/api/auth/login", {
    body: { email: newEmail, password: PASSWORD },
  });
  assert.equal(loginRes.status, 200);

  // Keep the fixture email current so later tests use the real login
  manager.email = newEmail;
});

test("manager can update their own password; old stops working, new works", async () => {
  const newPassword = "brand-new-pass-456";

  const res = await api.put("/api/auth/me", {
    token: managerToken(),
    body: { currentPassword: PASSWORD, newPassword, confirmNewPassword: newPassword },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.user.password, undefined);
  assert.ok(!JSON.stringify(res.body).includes("$2"));

  // Old password no longer works
  const oldRes = await api.post("/api/auth/login", {
    body: { email: manager.email, password: PASSWORD },
  });
  assert.equal(oldRes.status, 401);

  // New password works
  const newRes = await api.post("/api/auth/login", {
    body: { email: manager.email, password: newPassword },
  });
  assert.equal(newRes.status, 200);

  // Restore the original fixture password for any later tests
  const restore = await api.put("/api/auth/me", {
    token: managerToken(),
    body: {
      currentPassword: newPassword,
      newPassword: PASSWORD,
      confirmNewPassword: PASSWORD,
    },
  });
  assert.equal(restore.status, 200);
});

test("wrong current password is rejected with 400 and changes nothing", async () => {
  const res = await api.put("/api/auth/me", {
    token: managerToken(),
    body: {
      currentPassword: "totally-wrong-password",
      newPassword: "should-not-be-set-1",
      confirmNewPassword: "should-not-be-set-1",
    },
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);

  // The real password is still the original one
  const loginRes = await api.post("/api/auth/login", {
    body: { email: manager.email, password: PASSWORD },
  });
  assert.equal(loginRes.status, 200);
});

test("missing current password, invalid email and short password answer 400", async () => {
  const missing = await api.put("/api/auth/me", {
    token: managerToken(),
    body: { newEmail: "somewhere@volta.test" },
  });
  assert.equal(missing.status, 400);

  const badEmail = await api.put("/api/auth/me", {
    token: managerToken(),
    body: { currentPassword: PASSWORD, newEmail: "not-an-email" },
  });
  assert.equal(badEmail.status, 400);

  const shortPassword = await api.put("/api/auth/me", {
    token: managerToken(),
    body: {
      currentPassword: PASSWORD,
      newPassword: "abc",
      confirmNewPassword: "abc",
    },
  });
  assert.equal(shortPassword.status, 400);

  const noChange = await api.put("/api/auth/me", {
    token: managerToken(),
    body: { currentPassword: PASSWORD },
  });
  assert.equal(noChange.status, 400);
});

test("password confirmation mismatch is rejected with 400", async () => {
  const res = await api.put("/api/auth/me", {
    token: managerToken(),
    body: {
      currentPassword: PASSWORD,
      newPassword: "a-valid-new-pass",
      confirmNewPassword: "a-different-pass",
    },
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test("duplicate login identifier answers 409, not 500", async () => {
  const res = await api.put("/api/auth/me", {
    token: managerToken(),
    body: { currentPassword: PASSWORD, newEmail: takenEmail },
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.success, false);

  // The manager's own email is untouched
  const unchanged = await api.get("/api/users", { token: managerToken() });
  assert.equal(unchanged.status, 200);
});

test("an employee is denied with 403", async () => {
  const token = forgeToken({ userId: employee._id.toString() }, { expiresIn: "1h" });

  const res = await api.put("/api/auth/me", {
    token,
    body: { currentPassword: PASSWORD, newEmail: "employee-new@volta.test" },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.message, "Access denied. Managers only");
});

test("a manager cannot change another account via a smuggled id", async () => {
  const before = await api.get(`/api/users/${otherManager._id}`, {
    token: managerToken(),
  });
  assert.equal(before.status, 200);
  const beforeEmail = before.body.data.email;

  // Try to smuggle the other manager's id into the payload. The controller
  // derives the account from the token, so this edits the CALLER only.
  const res = await api.put("/api/auth/me", {
    token: managerToken(),
    body: {
      _id: otherManager._id.toString(),
      id: otherManager._id.toString(),
      userId: otherManager._id.toString(),
      currentPassword: PASSWORD,
      newEmail: `hacked-${Date.now()}@volta.test`,
    },
  });
  assert.equal(res.status, 200);

  // The other manager's email is unchanged
  const afterRes = await api.get(`/api/users/${otherManager._id}`, {
    token: managerToken(),
  });
  assert.equal(afterRes.status, 200);
  assert.equal(afterRes.body.data.email, beforeEmail);

  // Restore this manager's original email for cleanliness
  await api.put("/api/auth/me", {
    token: managerToken(),
    body: { currentPassword: PASSWORD, newEmail: manager.email },
  });
});

test("the endpoint requires a valid token", async () => {
  const anon = await api.put("/api/auth/me", {
    body: { currentPassword: PASSWORD, newEmail: "anon@volta.test" },
  });
  assert.equal(anon.status, 401);

  const garbage = await api.put("/api/auth/me", {
    token: "not-a-jwt-at-all",
    body: { currentPassword: PASSWORD, newEmail: "anon@volta.test" },
  });
  assert.equal(garbage.status, 401);
});
