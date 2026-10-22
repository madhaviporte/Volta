// Task history: access control and recorded events.
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
let manager;
let employeeA;
let employeeB;
let managerToken;
let tokenA;
let tokenB;
let taskAId;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "History Manager", role: "manager" });
  employeeA = await createUser({ name: "History Employee A" });
  employeeB = await createUser({ name: "History Employee B" });

  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });
  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });

  const created = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title: "History flow task",
      assignedTo: employeeA._id.toString(),
      dueDate: inDays(6),
    },
  });
  taskAId = created.body.data._id;

  // Generate more events through the real API
  await api.put(`/api/tasks/${taskAId}`, {
    token: managerToken,
    body: { priority: "Urgent" },
  });
  await api.put(`/api/tasks/${taskAId}`, {
    token: managerToken,
    body: { assignedTo: employeeB._id.toString() },
  });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

test("the assigned employee can read their task's history, oldest entry first", async () => {
  // After the reassignment above the task belongs to B
  const res = await api.get(`/api/tasks/${taskAId}/history`, { token: tokenB });
  assert.equal(res.status, 200);

  const actions = res.body.data.map((h) => h.action);
  assert.deepEqual(
    actions.slice(0, 2),
    ["TASK_CREATED", "ASSIGNED"],
    "creation and first assignment come first, in order"
  );
  assert.ok(actions.includes("UPDATED"));
  assert.ok(actions.includes("REASSIGNED"));

  // Timestamps and actors are present on every entry
  for (const entry of res.body.data) {
    assert.ok(entry.createdAt, "each entry carries a timestamp");
    assert.ok(entry.performedBy && entry.performedBy.name, "each entry carries its actor");
  }
});

test("the previous assignee loses access to the history after reassignment", async () => {
  const res = await api.get(`/api/tasks/${taskAId}/history`, { token: tokenA });
  assert.equal(res.status, 403);
});

test("a manager can read any task's history", async () => {
  const res = await api.get(`/api/tasks/${taskAId}/history`, { token: managerToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.count >= 4);
});

test("status changes are recorded with old and new values", async () => {
  const res = await api.put(`/api/tasks/${taskAId}/status`, {
    token: tokenB,
    body: { status: "In Progress" },
  });
  assert.equal(res.status, 200);

  const history = await models.TaskHistory.find({ task: taskAId, action: "STATUS_CHANGED" });
  assert.equal(history.length, 1);
  assert.equal(history[0].oldValue, "Pending");
  assert.equal(history[0].newValue, "In Progress");
});

test("invalid and missing ids answer 400/404; anonymous gets 401", async () => {
  const malformed = await api.get("/api/tasks/nope/history", { token: managerToken });
  assert.equal(malformed.status, 400);

  const missing = await api.get("/api/tasks/000000000000000000000000/history", { token: managerToken });
  assert.equal(missing.status, 404);

  const anonymous = await api.get(`/api/tasks/${taskAId}/history`);
  assert.equal(anonymous.status, 401);
});
