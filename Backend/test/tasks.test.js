// Task CRUD validation, employee task isolation, status updates and the
// transactional delete cascade (Task 3) plus notification cleanup (Task 4).
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

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "Tasks Manager", role: "manager" });
  employeeA = await createUser({ name: "Tasks Employee A" });
  employeeB = await createUser({ name: "Tasks Employee B" });

  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });
  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

const createTaskViaApi = async (overrides = {}) => {
  const res = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title: "Fixture task",
      assignedTo: employeeA._id.toString(),
      dueDate: inDays(4),
      ...overrides,
    },
  });

  assert.equal(res.status, 201);
  return res.body.data;
};

test("create task: every invalid input answers 400 with a clear message", async () => {
  const cases = [
    [{ title: "", assignedTo: employeeA._id.toString(), dueDate: inDays(2) }, "Title is required"],
    [{ title: "   ", assignedTo: employeeA._id.toString(), dueDate: inDays(2) }, "Title is required"],
    [{ title: "T", dueDate: inDays(2) }, "assignedTo (employee id) is required"],
    [{ title: "T", assignedTo: "not-an-id", dueDate: inDays(2) }, "assignedTo must be an existing employee"],
    [{ title: "T", assignedTo: employeeA._id.toString() }, "dueDate is required"],
    [{ title: "T", assignedTo: employeeA._id.toString(), dueDate: "not-a-date" }, "dueDate must be a valid date"],
    [{ title: "T", assignedTo: employeeA._id.toString(), dueDate: inDays(2), priority: "Glacial" }, "Priority must be one of: Low, Medium, High, Urgent"],
    [{ title: "T", assignedTo: employeeA._id.toString(), dueDate: inDays(2), status: "Done-ish" }, "Status must be one of: Pending, In Progress, Completed, On Hold"],
    [{ title: "T", assignedTo: manager._id.toString(), dueDate: inDays(2) }, "assignedTo must be an existing employee"],
  ];

  for (const [body, expectedMessage] of cases) {
    const res = await api.post("/api/tasks", { token: managerToken, body });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(res.body.message, expectedMessage);
  }
});

test("create task records TASK_CREATED and ASSIGNED history", async () => {
  const task = await createTaskViaApi({ title: "History fixture" });

  const history = await models.TaskHistory.find({ task: task._id }).sort({ createdAt: 1 });
  const actions = history.map((h) => h.action);

  assert.ok(actions.includes("TASK_CREATED"));
  assert.ok(actions.includes("ASSIGNED"));
});

test("employee task isolation: listings and lookups only ever expose their own tasks", async () => {
  const taskA = await createTaskViaApi({ title: "Belongs to A" });
  await createTaskViaApi({ title: "Belongs to B", assignedTo: employeeB._id.toString() });

  const listA = await api.get("/api/tasks", { token: tokenA });
  assert.equal(listA.status, 200);
  // Every returned task must belong to A (earlier tests in this file may
  // have created more), and B's task must never appear.
  const idsA = listA.body.data.map((t) => t._id);
  assert.ok(idsA.includes(taskA._id.toString()), "A sees their own task");
  const bTask = await models.Task.findOne({ title: "Belongs to B" });
  assert.ok(!idsA.includes(bTask._id.toString()), "A must not see B's task");

  // Direct id probes against the other employee's task are refused
  const foreignId = (await models.Task.findOne({ title: "Belongs to B" }))._id.toString();

  const view = await api.get(`/api/tasks/${foreignId}`, { token: tokenA });
  assert.equal(view.status, 403);

  const history = await api.get(`/api/tasks/${foreignId}/history`, { token: tokenA });
  assert.equal(history.status, 403);

  const comments = await api.get(`/api/tasks/${foreignId}/comments`, { token: tokenA });
  assert.equal(comments.status, 403);

  const status = await api.put(`/api/tasks/${foreignId}/status`, { token: tokenA, body: { status: "Completed" } });
  assert.equal(status.status, 403);
});

test("malformed and unknown task ids answer 400/404, never 500", async () => {
  const malformed = await api.get("/api/tasks/not-an-id", { token: tokenA });
  assert.equal(malformed.status, 400);

  const missing = await api.get("/api/tasks/000000000000000000000000", { token: managerToken });
  assert.equal(missing.status, 404);
});

test("manager can edit and reassign a task; the previous assignee's reminders are cleaned up", async () => {
  const task = await createTaskViaApi({ title: "Reassign me" });

  // Simulate an existing reminder for the current assignee (what the
  // scheduler would have created)
  await models.Notification.create({
    user: employeeA._id,
    task: task._id,
    type: "deadline_soon",
    message: "Fixture reminder",
  });

  const res = await api.put(`/api/tasks/${task._id}`, {
    token: managerToken,
    body: { assignedTo: employeeB._id.toString(), priority: "High" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.assignedTo._id, employeeB._id.toString());

  // Old assignee no longer has reminders for this task
  const remaining = await models.Notification.find({ task: task._id });
  assert.equal(remaining.length, 0);

  const history = await models.TaskHistory.find({ task: task._id });
  const actions = history.map((h) => h.action);
  assert.ok(actions.includes("REASSIGNED"));
  assert.ok(actions.includes("UPDATED"));
});

test("employee status update works on their own task and completion clears reminders", async () => {
  const task = await createTaskViaApi({ title: "Status flow" });

  await models.Notification.create({
    user: employeeA._id,
    task: task._id,
    type: "overdue",
    message: "Fixture overdue reminder",
  });

  const inProgress = await api.put(`/api/tasks/${task._id}/status`, {
    token: tokenA,
    body: { status: "In Progress" },
  });
  assert.equal(inProgress.status, 200);
  assert.equal(inProgress.body.data.status, "In Progress");

  const completed = await api.put(`/api/tasks/${task._id}/status`, {
    token: tokenA,
    body: { status: "Completed" },
  });
  assert.equal(completed.status, 200);
  assert.ok(completed.body.data.completedAt);

  // Completing removed the reminders (Task 4)
  const remaining = await models.Notification.find({ task: task._id });
  assert.equal(remaining.length, 0);

  // Each transition recorded its own STATUS_CHANGED history entry
  const history = await models.TaskHistory.find({ task: task._id, action: "STATUS_CHANGED" }).sort({ createdAt: 1 });
  assert.equal(history.length, 2);
  assert.equal(history[0].oldValue, "Pending");
  assert.equal(history[0].newValue, "In Progress");
  assert.equal(history[1].oldValue, "In Progress");
  assert.equal(history[1].newValue, "Completed");

  const invalid = await api.put(`/api/tasks/${task._id}/status`, {
    token: tokenA,
    body: { status: "Weird" },
  });
  assert.equal(invalid.status, 400);
});

test("task deletion is manager-only and takes history, comments and reminders with it (Task 3)", async () => {
  const task = await createTaskViaApi({ title: "Delete me" });

  await models.Comment.create({ task: task._id, user: employeeA._id, message: "Fixture comment" });
  await models.Notification.create({ user: employeeA._id, task: task._id, type: "deadline_soon", message: "Fixture reminder" });

  const asEmployee = await api.delete(`/api/tasks/${task._id}`, { token: tokenA });
  assert.equal(asEmployee.status, 403);

  const res = await api.delete(`/api/tasks/${task._id}`, { token: managerToken });
  assert.equal(res.status, 200);

  assert.equal(await models.Task.countDocuments({ _id: task._id }), 0);
  assert.equal(await models.TaskHistory.countDocuments({ task: task._id }), 0);
  assert.equal(await models.Comment.countDocuments({ task: task._id }), 0);
  assert.equal(await models.Notification.countDocuments({ task: task._id }), 0);
});
