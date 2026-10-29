// Who assigned a task is always the authenticated manager:
// - Task.createdBy holds their user id, returned as a populated profile
//   (name, designation, department) - never a raw id in the UI's hands
// - TaskHistory.performedBy records who assigned/reassigned each event
// - assignment notifications name the assigner in the message text
// Old tasks whose assigner record is gone must keep loading gracefully.
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

let managerA; // creates tasks - designation "COO", department "Operations"
let managerB; // reassigns - designation "CTO"
let plainManager; // manager without designation/department (legacy-style)
let employeeA;
let employeeB;

let tokenManagerA;
let tokenManagerB;
let tokenPlainManager;
let tokenA;
let tokenB;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  managerA = await createUser({
    name: "ASG Manager A",
    role: "manager",
    designation: "COO",
    department: "Operations",
  });
  managerB = await createUser({
    name: "ASG Manager B",
    role: "manager",
    designation: "CTO",
    department: "Engineering",
  });
  plainManager = await createUser({ name: "ASG Plain Manager", role: "manager" });
  employeeA = await createUser({ name: "ASG Employee A", designation: "Associate" });
  employeeB = await createUser({ name: "ASG Employee B", designation: "Trainee" });

  tokenManagerA = forgeToken({ userId: managerA._id.toString() }, { expiresIn: "1h" });
  tokenManagerB = forgeToken({ userId: managerB._id.toString() }, { expiresIn: "1h" });
  tokenPlainManager = forgeToken({ userId: plainManager._id.toString() }, { expiresIn: "1h" });
  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

const id = (user) => user._id.toString();

// Creates a task as the given manager and returns the API response body
const createTask = async (body, token = tokenManagerA) => {
  const res = await api.post("/api/tasks", {
    token,
    body: { title: "Assigner fixture", dueDate: inDays(5), ...body },
  });

  return { status: res.status, body: res.body, task: res.body && res.body.data };
};

// The assignment notifications of one user for one task
const assignmentNotifications = async (token, taskId) => {
  const res = await api.get("/api/notifications", { token });
  assert.equal(res.status, 200);

  return res.body.data.filter(
    (n) => n.type === "task_assigned" && n.task && n.task._id === taskId
  );
};

test("creation records the authenticated manager; every assignee sees name, designation and department", async () => {
  const created = await createTask({
    title: "Multi-assigner fixture",
    assignees: [id(employeeA), id(employeeB)],
  });

  assert.equal(created.status, 201);

  // The create response itself carries the populated assigner profile
  assert.equal(typeof created.task.createdBy, "object", "createdBy is an object, not an id string");
  assert.equal(created.task.createdBy.name, "ASG Manager A");
  assert.equal(created.task.createdBy.designation, "COO");
  assert.equal(created.task.createdBy.department, "Operations");

  // Both assignees get the same assigner details from the task API
  for (const token of [tokenA, tokenB]) {
    const view = await api.get(`/api/tasks/${created.task._id}`, { token });
    assert.equal(view.status, 200);
    assert.equal(view.body.data.createdBy.name, "ASG Manager A");
    assert.equal(view.body.data.createdBy.designation, "COO");
  }

  // The list endpoint (manager + employee lists) carries them too
  const listA = await api.get("/api/tasks", { token: tokenA });
  assert.equal(listA.status, 200);
  const listed = listA.body.data.find((task) => task._id === created.task._id);
  assert.equal(listed.createdBy.name, "ASG Manager A");
});

test("every assignee is notified once and the message names the assigner with their designation", async () => {
  const created = await createTask({
    title: "Notify assigner fixture",
    assignees: [id(employeeA), id(employeeB)],
  });

  assert.equal(created.status, 201);

  for (const token of [tokenA, tokenB]) {
    const rows = await assignmentNotifications(token, created.task._id);
    assert.equal(rows.length, 1, "exactly one assignment notification per assignee");
    assert.match(rows[0].message, /ASG Manager A/);
    assert.match(rows[0].message, /COO/);
    assert.ok(!rows[0].message.includes("undefined"), "no undefined parts in the message");
  }
});

test("reassignment history and notification identify the manager who reassigned", async () => {
  const created = await createTask({ title: "Reassign fixture", assignees: [id(employeeA)] });
  assert.equal(created.status, 201);

  // Manager B swaps employee A out for employee B (single-swap reassignment)
  const res = await api.put(`/api/tasks/${created.task._id}`, {
    token: tokenManagerB,
    body: { assignees: [id(employeeB)] },
  });
  assert.equal(res.status, 200);

  const history = await api.get(`/api/tasks/${created.task._id}/history`, { token: tokenManagerB });
  assert.equal(history.status, 200);

  const swap = history.body.data.find((entry) => entry.action === "REASSIGNED");
  assert.ok(swap, "a REASSIGNED entry was recorded");
  assert.equal(typeof swap.performedBy, "object");
  assert.equal(swap.performedBy.name, "ASG Manager B", "the reassigner, not the creator");
  assert.equal(swap.performedBy.designation, "CTO");

  // The new assignee's notification names Manager B, with his designation
  const notes = await api.get("/api/notifications", { token: tokenB });
  assert.equal(notes.status, 200);
  const reassignNote = notes.body.data.find(
    (n) => n.type === "task_reassigned" && n.task && n.task._id === created.task._id
  );
  assert.ok(reassignNote, "the new assignee was notified");
  assert.match(reassignNote.message, /ASG Manager B/);
  assert.match(reassignNote.message, /CTO/);
});

test("the employee dashboard returns the assigner profile, never a raw id", async () => {
  const created = await createTask({ title: "Dashboard assigner fixture", assignees: [id(employeeA)] });
  assert.equal(created.status, 201);

  const res = await api.get("/api/dashboard/employee", { token: tokenA });
  assert.equal(res.status, 200);

  const task = res.body.data.tasks.find((row) => row._id === created.task._id);
  assert.ok(task, "the task appears on the employee dashboard");
  assert.equal(typeof task.createdBy, "object", "createdBy is populated, not an id string");
  assert.equal(task.createdBy.name, "ASG Manager A");
  assert.equal(task.createdBy.designation, "COO");
  assert.equal(task.createdBy.department, "Operations");
});

test("a manager without a designation still shows their name and never 'undefined' in messages", async () => {
  const created = await createTask(
    { title: "Plain manager fixture", assignees: [id(employeeA)] },
    tokenPlainManager
  );
  assert.equal(created.status, 201);
  assert.equal(created.task.createdBy.name, "ASG Plain Manager");
  assert.equal(created.task.createdBy.designation, undefined);

  const rows = await assignmentNotifications(tokenA, created.task._id);
  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /ASG Plain Manager/);
  assert.ok(!rows[0].message.includes("undefined"));
  assert.ok(!rows[0].message.includes("()"), "no empty parentheses");
});

test("old tasks whose assigner record is gone still load for every assignee", async () => {
  const created = await createTask({ title: "Vanished assigner fixture", assignees: [id(employeeA)] });
  assert.equal(created.status, 201);

  // Simulate an old task whose user record no longer exists
  await models.User.deleteOne({ _id: managerA._id });

  const view = await api.get(`/api/tasks/${created.task._id}`, { token: tokenA });
  assert.equal(view.status, 200, "the task still loads");
  assert.equal(view.body.data.createdBy, null, "no id is invented for a missing assigner");

  const history = await api.get(`/api/tasks/${created.task._id}/history`, { token: tokenA });
  assert.equal(history.status, 200, "history still loads with a missing actor");
  assert.ok(history.body.data.length > 0);

  const dashboard = await api.get("/api/dashboard/employee", { token: tokenA });
  assert.equal(dashboard.status, 200, "the dashboard still loads");
});
