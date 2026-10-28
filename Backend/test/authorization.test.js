// Role authorization: every manager-only operation must be enforced on the
// BACKEND, and employees must not be able to escalate their role.
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
  inDays,
  models,
} = require("./helpers");

let server;
let api;
let managerToken;
let manager;
let employee;
let otherEmployee;
let someTaskId;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "Authz Manager", role: "manager" });
  employee = await createUser({ name: "Authz Employee A" });
  otherEmployee = await createUser({ name: "Authz Employee B" });

  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });

  const task = await models.Task.create({
    title: "Authz fixture task",
    assignedTo: otherEmployee._id,
    createdBy: manager._id,
    dueDate: new Date(Date.now() + 5 * 86400000),
  });
  someTaskId = task._id.toString();
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

const employeeToken = () =>
  forgeToken({ userId: employee._id.toString() }, { expiresIn: "1h" });

test("all manager-only endpoints reject an employee with 403", async () => {
  const token = employeeToken();

  const probes = [
    ["post", "/api/users", { token, body: { name: "X", email: "x@volta.test", password: "secret123" } }],
    ["post", "/api/users", { token, body: { name: "Y", email: "y@volta.test", password: "secret123", role: "manager" } }],
    ["get", "/api/users", { token }],
    ["get", `/api/users/${manager._id}`, { token }],
    ["put", `/api/users/${otherEmployee._id}`, { token, body: { name: "Hacked" } }],
    ["put", `/api/users/${otherEmployee._id}`, { token, body: { role: "manager" } }],
    ["put", `/api/users/${manager._id}`, { token, body: { role: "manager" } }],
    ["put", `/api/users/${otherEmployee._id}/status`, { token, body: { isActive: false } }],
    ["post", "/api/tasks", { token, body: { title: "Nope", assignedTo: otherEmployee._id.toString(), dueDate: inDays(3) } }],
    ["put", `/api/tasks/${someTaskId}`, { token, body: { title: "Hacked" } }],
    ["delete", `/api/tasks/${someTaskId}`, { token }],
    ["get", "/api/dashboard/manager", { token }],
  ];

  for (const [method, path, opts] of probes) {
    const res = await api[method](path, opts);
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path} should be 403 for an employee, got ${res.status}`);
  }
});

test("manager-only endpoints reject anonymous requests with 401", async () => {
  const probes = [
    ["get", "/api/users"],
    ["post", "/api/users"],
    ["get", "/api/dashboard/manager"],
    ["delete", `/api/tasks/${someTaskId}`],
  ];

  for (const [method, path] of probes) {
    // fetch forbids a body on GET/HEAD, so probes pass no body at all
    const res = await api[method](path);
    assert.equal(res.status, 401, `${method.toUpperCase()} ${path} should be 401 without a token`);
  }
});

test("the manager can use the manager-only endpoints", async () => {
  const list = await api.get("/api/users", { token: managerToken });
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length >= 3);

  const dash = await api.get("/api/dashboard/manager", { token: managerToken });
  assert.equal(dash.status, 200);
  assert.ok(dash.body.data.overall);
});

test("the employee dashboard only ever uses the token's own user", async () => {
  const res = await api.get("/api/dashboard/employee", { token: employeeToken() });
  assert.equal(res.status, 200);
  // The fixture task belongs to otherEmployee, so employee sees zero tasks
  assert.equal(res.body.data.stats.totalTasks, 0);
});

test("an employee cannot smuggle a manager role through create/update payloads", async () => {
  // POST /api/users is manager-only, so the role field never even runs
  const created = await api.post("/api/users", {
    token: employeeToken(),
    body: {
      name: "Role Smuggle",
      email: `smuggle-${Date.now()}@volta.test`,
      password: "secret123",
      role: "manager",
      isActive: true,
    },
  });
  assert.equal(created.status, 403);

  // PUT /api/users/:id is manager-only too: an employee cannot promote
  // themselves or anybody else (creating managers is covered by
  // test/user-management.test.js and is a manager-only operation)
  const updated = await api.put(`/api/users/${otherEmployee._id}`, {
    token: employeeToken(),
    body: { role: "manager", name: "Role Smuggle Renamed" },
  });
  assert.equal(updated.status, 403);

  const reloaded = await models.User.findById(otherEmployee._id);
  assert.equal(reloaded.role, "employee");
});

test("a manager cannot deactivate their own account", async () => {
  const res = await api.put(`/api/users/${manager._id}/status`, {
    token: managerToken,
    body: { isActive: false },
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.message, "You cannot change your own status");
});
