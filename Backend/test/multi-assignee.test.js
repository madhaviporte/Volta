// Hierarchy-based assignment and multi-assignee tasks:
// - one task can be assigned to several people (employees AND managers)
// - every assignee keeps their own status, comments, history and notifications
// - receiving a task never changes anyone's application role
// - single-assignee tasks behave exactly as they did before
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

let manager; // owns the tasks (application role: manager)
let employeeA;
let employeeB;
let employeeC;
let outsider; // never assigned to anything
let cto; // application role: manager, designation "CTO" (level 6 - C-Suite)
let exec; // application role: employee, designation "C-Suite Executive"
let inactiveUser;

let managerToken;
let tokenA;
let tokenB;
let tokenC;
let tokenOutsider;
let tokenCto;
let tokenExec;
let tokenInactive;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({
    name: "MA Manager",
    role: "manager",
    designation: "Director",
    department: "Executive Leadership",
  });
  employeeA = await createUser({ name: "MA Employee A", designation: "Associate" });
  employeeB = await createUser({ name: "MA Employee B", designation: "Trainee" });
  employeeC = await createUser({ name: "MA Employee C", designation: "Senior Associate" });
  outsider = await createUser({ name: "MA Outsider" });
  cto = await createUser({
    name: "MA CTO",
    role: "manager",
    designation: "CTO",
    department: "Engineering / Technology",
  });
  exec = await createUser({
    name: "MA C-Suite Executive",
    designation: "C-Suite Executive",
    department: "Operations",
  });
  inactiveUser = await createUser({ name: "MA Inactive", isActive: false });

  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });
  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });
  tokenC = forgeToken({ userId: employeeC._id.toString() }, { expiresIn: "1h" });
  tokenOutsider = forgeToken({ userId: outsider._id.toString() }, { expiresIn: "1h" });
  tokenCto = forgeToken({ userId: cto._id.toString() }, { expiresIn: "1h" });
  tokenExec = forgeToken({ userId: exec._id.toString() }, { expiresIn: "1h" });
  tokenInactive = forgeToken({ userId: inactiveUser._id.toString() }, { expiresIn: "1h" });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

const id = (user) => user._id.toString();

// Creates a task as the manager and returns the API response body
const createTask = async (body, token = managerToken) => {
  const res = await api.post("/api/tasks", {
    token,
    body: { title: "Shared task", dueDate: inDays(5), ...body },
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

test("one task can be assigned to several people and every assignee sees it", async () => {
  const created = await createTask({
    title: "Launch checklist",
    assignees: [id(employeeA), id(employeeB), id(employeeC)],
  });

  assert.equal(created.status, 201);
  assert.equal(created.task.assignees.length, 3, "all three assignees are stored");
  assert.equal(created.task.assignedTo._id, id(employeeA), "the first pick is the primary");
  assert.equal(created.task.progress.length, 3, "everyone gets their own progress entry");
  assert.ok(
    created.task.progress.every((entry) => entry.status === "Pending"),
    "each entry starts at the task's starting status"
  );

  // The same people are returned for each of them, and nobody else
  for (const token of [tokenA, tokenB, tokenC]) {
    const list = await api.get("/api/tasks", { token });
    assert.equal(list.status, 200);
    assert.ok(
      list.body.data.some((task) => task._id === created.task._id),
      "the shared task appears in this assignee's own list"
    );

    const single = await api.get(`/api/tasks/${created.task._id}`, { token });
    assert.equal(single.status, 200);
    assert.equal(single.body.data.assignees.length, 3);
    assert.ok(single.body.data.myStatus, "the viewer's own status is returned");
  }

  // Someone who was never selected cannot reach it
  const denied = await api.get(`/api/tasks/${created.task._id}`, { token: tokenOutsider });
  assert.equal(denied.status, 403);

  const outsiderList = await api.get("/api/tasks", { token: tokenOutsider });
  assert.ok(
    !outsiderList.body.data.some((task) => task._id === created.task._id),
    "the task never appears in an unrelated user's list"
  );

  // Every assignee also sees it on their own employee dashboard
  for (const token of [tokenA, tokenB, tokenC]) {
    const dash = await api.get("/api/dashboard/employee", { token });
    assert.equal(dash.status, 200);
    assert.ok(
      dash.body.data.tasks.some((task) => task._id === created.task._id),
      "the shared task is on this person's own dashboard"
    );
  }

  // The C-Suite Executive (employee role) still gets a working dashboard
  assert.equal((await api.get("/api/dashboard/employee", { token: tokenExec })).status, 200);
});

test("every assignee gets exactly one assignment notification, the creator none", async () => {
  const created = await createTask({
    title: "Notify everyone",
    assignees: [id(employeeA), id(employeeB), id(exec)],
  });

  assert.equal(created.status, 201);

  // One notification each, with the task title in the message
  for (const [token, person] of [
    [tokenA, employeeA],
    [tokenB, employeeB],
    [tokenExec, exec],
  ]) {
    const rows = await assignmentNotifications(token, created.task._id);
    assert.equal(rows.length, 1, `${person.name} is notified exactly once`);
    assert.match(rows[0].message, /Notify everyone/);
  }

  // The manager who assigned it already knows: no self-notification
  const managerRows = await assignmentNotifications(managerToken, created.task._id);
  assert.equal(managerRows.length, 0);

  // Reading the list again never creates duplicates
  const before = (await api.get("/api/notifications", { token: tokenA })).body.count;
  const again = await api.get("/api/notifications", { token: tokenA });
  const after = again.body.count;
  assert.equal(before, after, "refreshing the list adds nothing");
  assert.equal((await assignmentNotifications(tokenA, created.task._id)).length, 1);
});

test("assigning to C-Suite and C-Suite Executive users never changes their role", async () => {
  const created = await createTask({
    title: "Executive task",
    assignees: [id(cto), id(exec), id(employeeA)],
  });

  assert.equal(created.status, 201);

  // Roles in the database are untouched by receiving a task
  const ctoInDb = await models.User.findById(cto._id);
  const execInDb = await models.User.findById(exec._id);
  assert.equal(ctoInDb.role, "manager", "the CTO is still a manager");
  assert.equal(execInDb.role, "employee", "the C-Suite Executive is still an employee");

  // The manager assignee keeps using the manager pages and endpoints
  const managerUsers = await api.get("/api/users", { token: tokenCto });
  assert.equal(managerUsers.status, 200, "an assigned manager still has manager access");

  const managerDash = await api.get("/api/dashboard/manager", { token: tokenCto });
  assert.equal(managerDash.status, 200);

  // The employee assignee gains nothing: no manager endpoints, no way to
  // promote anyone
  assert.equal((await api.get("/api/users", { token: tokenExec })).status, 403);
  assert.equal(
    (
      await api.post("/api/users", {
        token: tokenExec,
        body: { name: "Nope", email: "nope@volta.test", password: "12345678", role: "manager" },
      })
    ).status,
    403
  );

  // The CTO's own task list carries the shared task
  const ctoList = await api.get("/api/tasks", { token: tokenCto });
  assert.ok(
    ctoList.body.data.some((task) => task._id === created.task._id),
    "the assigned manager sees the task like any other assignee"
  );
});

test("only authorized users can create, edit, reassign or delete tasks", async () => {
  const created = await createTask({ title: "Guarded", assignees: [id(employeeA)] });
  assert.equal(created.status, 201);

  assert.equal(
    (await api.post("/api/tasks", { token: tokenA, body: { title: "X", assignees: [id(employeeB)], dueDate: inDays(2) } })).status,
    403,
    "an employee cannot create tasks"
  );
  assert.equal(
    (await api.put(`/api/tasks/${created.task._id}`, { token: tokenA, body: { assignees: [id(employeeB)] } })).status,
    403,
    "an employee cannot reassign a task"
  );
  assert.equal(
    (await api.put(`/api/tasks/${created.task._id}`, { token: tokenA, body: { title: "Renamed" } })).status,
    403,
    "an employee cannot edit a task"
  );
  assert.equal(
    (await api.delete(`/api/tasks/${created.task._id}`, { token: tokenA })).status,
    403,
    "an employee cannot delete a task"
  );
});

test("each assignee's status is tracked independently", async () => {
  const created = await createTask({
    title: "Independent statuses",
    assignees: [id(employeeA), id(employeeB), id(employeeC)],
  });
  assert.equal(created.status, 201);
  const taskId = created.task._id;

  // A starts, B finishes, C stays untouched
  const aStart = await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenA,
    body: { status: "In Progress" },
  });
  assert.equal(aStart.status, 200);

  const bDone = await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenB,
    body: { status: "Completed" },
  });
  assert.equal(bDone.status, 200);

  // The stored task: B finished, A is working, C has not started, so the
  // overall status is still In Progress (part delivered) - B's completion
  // did NOT complete the task for the other four/other people.
  const stored = await models.Task.findById(taskId);
  assert.equal(stored.status, "In Progress", "the roll-up reflects partial completion");
  assert.equal(
    stored.progress.find((entry) => entry.user.toString() === id(employeeB)).status,
    "Completed"
  );
  assert.equal(
    stored.progress.find((entry) => entry.user.toString() === id(employeeA)).status,
    "In Progress"
  );
  assert.equal(
    stored.progress.find((entry) => entry.user.toString() === id(employeeC)).status,
    "Pending",
    "C's status was not overwritten by anybody else"
  );

  // Each of them reads back their own status in their own list
  const viewA = await api.get(`/api/tasks/${taskId}`, { token: tokenA });
  const viewB = await api.get(`/api/tasks/${taskId}`, { token: tokenB });
  const viewC = await api.get(`/api/tasks/${taskId}`, { token: tokenC });
  assert.equal(viewA.body.data.myStatus, "In Progress");
  assert.equal(viewB.body.data.myStatus, "Completed");
  assert.equal(viewC.body.data.myStatus, "Pending");
  assert.equal(viewA.body.data.status, "In Progress", "overall status is shared with everyone");

  // When the last person finishes, the whole task completes
  await api.put(`/api/tasks/${taskId}/status`, { token: tokenA, body: { status: "Completed" } });
  await api.put(`/api/tasks/${taskId}/status`, { token: tokenC, body: { status: "Completed" } });

  const finished = await models.Task.findById(taskId);
  assert.equal(finished.status, "Completed");
  assert.ok(finished.completedAt, "completion time is recorded");
  assert.ok(
    finished.progress.every((entry) => entry.status === "Completed"),
    "everyone's own entry shows Completed"
  );
});

test("comments and status history are recorded per assignee", async () => {
  const created = await createTask({
    title: "Parallel work",
    assignees: [id(employeeA), id(employeeB)],
  });
  assert.equal(created.status, 201);
  const taskId = created.task._id;

  const commentA = await api.post(`/api/tasks/${taskId}/comments`, {
    token: tokenA,
    body: { message: "A is on it" },
  });
  const commentB = await api.post(`/api/tasks/${taskId}/comments`, {
    token: tokenB,
    body: { message: "B is on it too" },
  });
  assert.equal(commentA.status, 201);
  assert.equal(commentB.status, 201);
  assert.equal(commentA.body.data.user._id, id(employeeA));
  assert.equal(commentB.body.data.user._id, id(employeeB), "comments keep their own author");

  // The other assignee hears about a comment, exactly once
  const aNotes = (await api.get("/api/notifications", { token: tokenA })).body.data.filter(
    (n) => n.type === "task_commented" && n.task && n.task._id === taskId
  );
  assert.equal(aNotes.length, 1, "A is told once about B's comment");
  assert.match(aNotes[0].message, /B is on it too/);

  // Two different people move their own status
  await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenA,
    body: { status: "In Progress" },
  });
  await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenB,
    body: { status: "On Hold" },
  });

  const history = await api.get(`/api/tasks/${taskId}/history`, { token: tokenA });
  assert.equal(history.status, 200);

  const statusEntries = history.body.data.filter((entry) => entry.action === "STATUS_CHANGED");
  assert.equal(statusEntries.length, 2, "one status entry per person");

  const fromA = statusEntries.find((entry) => entry.assignee && entry.assignee._id === id(employeeA));
  const fromB = statusEntries.find((entry) => entry.assignee && entry.assignee._id === id(employeeB));
  assert.ok(fromA, "A's status change is recorded as A's");
  assert.ok(fromB, "B's status change is recorded as B's");
  assert.equal(fromA.oldValue, "Pending");
  assert.equal(fromA.newValue, "In Progress");
  assert.equal(fromB.newValue, "On Hold");

  // Assignment history shows one entry per assignee
  const assignedEntries = history.body.data.filter((entry) => entry.action === "ASSIGNED");
  assert.equal(assignedEntries.length, 2);
  assert.ok(assignedEntries.some((entry) => entry.newValue === "MA Employee A"));
  assert.ok(assignedEntries.some((entry) => entry.newValue === "MA Employee B"));
});

test("adding and removing assignees keeps everyone else's work intact", async () => {
  const created = await createTask({
    title: "Reassign list",
    assignees: [id(employeeA), id(employeeB), id(employeeC)],
  });
  assert.equal(created.status, 201);
  const taskId = created.task._id;

  // A has already made progress before the list changes
  await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenA,
    body: { status: "In Progress" },
  });

  // The manager swaps B for the outsider in a single operation
  const updated = await api.put(`/api/tasks/${taskId}`, {
    token: managerToken,
    body: { assignees: [id(employeeA), id(employeeC), id(outsider)] },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.assignees.length, 3);
  assert.deepEqual(
    updated.body.data.assignees.map((person) => person._id).sort(),
    [id(employeeA), id(employeeC), id(outsider)].sort()
  );

  // The person who left loses access and keeps nothing for that task
  assert.equal((await api.get(`/api/tasks/${taskId}`, { token: tokenB })).status, 403);
  const bRows = (await api.get("/api/notifications", { token: tokenB })).body.data.filter(
    (n) => n.task && n.task._id === taskId
  );
  assert.equal(bRows.length, 0, "the removed assignee's rows leave with them");

  // The newcomer is notified once and can open the task
  const outsiderRows = (await api.get("/api/notifications", { token: tokenOutsider })).body.data.filter(
    (n) => n.task && n.task._id === taskId
  );
  assert.equal(outsiderRows.length, 1);
  assert.equal(outsiderRows[0].type, "task_reassigned");
  assert.equal((await api.get(`/api/tasks/${taskId}`, { token: tokenOutsider })).status, 200);

  // Progress of the people who stayed is untouched
  const stored = await models.Task.findById(taskId);
  assert.equal(
    stored.progress.find((entry) => entry.user.toString() === id(employeeA)).status,
    "In Progress",
    "A's own status survived the reassignment"
  );
  assert.equal(stored.progress.length, 3);
  assert.ok(
    !stored.progress.some((entry) => entry.user.toString() === id(employeeB)),
    "the removed person's entry is gone"
  );

  // The history records who joined and who left
  const history = await api.get(`/api/tasks/${taskId}/history`, { token: managerToken });
  const actions = history.body.data.map((entry) => entry.action);
  assert.ok(actions.includes("ASSIGNED"), "the newcomer's assignment is recorded");
  assert.ok(actions.includes("UNASSIGNED"), "the removal is recorded");
});

test("a one-person reassignment still behaves exactly as before", async () => {
  const created = await createTask({ title: "Classic reassign", assignedTo: id(employeeA) });
  assert.equal(created.status, 201);
  const taskId = created.task._id;

  const reassigned = await api.put(`/api/tasks/${taskId}`, {
    token: managerToken,
    body: { assignedTo: id(employeeB) },
  });
  assert.equal(reassigned.status, 200);
  assert.equal(reassigned.body.data.assignedTo._id, id(employeeB));
  assert.equal(reassigned.body.data.assignees.length, 1);

  // The history keeps the familiar REASSIGNED entry
  const history = await models.TaskHistory.find({ task: taskId });
  assert.ok(history.some((entry) => entry.action === "REASSIGNED"));

  // The new assignee is told, the previous one keeps nothing
  const bRows = (await api.get("/api/notifications", { token: tokenB })).body.data.filter(
    (n) => n.task && n.task._id === taskId
  );
  assert.ok(bRows.some((row) => row.type === "task_reassigned" || row.type === "task_assigned"));

  const aRows = (await api.get("/api/notifications", { token: tokenA })).body.data.filter(
    (n) => n.task && n.task._id === taskId
  );
  assert.equal(aRows.length, 0);
  assert.equal((await api.get(`/api/tasks/${taskId}`, { token: tokenA })).status, 403);
});

test("invalid, inactive and duplicate assignees are rejected or de-duplicated", async () => {
  // Nothing selected
  const empty = await createTask({ assignees: [] });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.message, "assignees must include at least one user");

  // Malformed id
  const malformed = await createTask({ assignees: ["not-an-id"] });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.message, "assignees must be existing, active users");

  // Existing user, but deactivated
  const inactive = await createTask({ assignees: [id(inactiveUser)] });
  assert.equal(inactive.status, 400);
  assert.equal(inactive.body.message, "assignees must be existing, active users");

  // Unknown id
  const unknown = await createTask({ assignees: ["000000000000000000000000"] });
  assert.equal(unknown.status, 400);

  // The same person twice collapses to one assignee and one notification
  const duplicated = await createTask({
    title: "No duplicates",
    assignees: [id(employeeA), id(employeeA), id(employeeA)],
  });
  assert.equal(duplicated.status, 201);
  assert.equal(duplicated.task.assignees.length, 1);
  assert.equal(duplicated.task.progress.length, 1);
  assert.equal((await assignmentNotifications(tokenA, duplicated.task._id)).length, 1);

  // A deactivated user cannot be added through the legacy field either
  const legacyInactive = await createTask({ assignedTo: id(inactiveUser) });
  assert.equal(legacyInactive.status, 400);
  assert.equal(legacyInactive.body.message, "assignedTo must be an existing employee");

  // ...nor through an edit of an existing task
  const existing = await createTask({ title: "Edit guard", assignees: [id(employeeA)] });
  const edit = await api.put(`/api/tasks/${existing.task._id}`, {
    token: managerToken,
    body: { assignees: [id(employeeA), id(inactiveUser)] },
  });
  assert.equal(edit.status, 400);
});

test("a shared task's overall status cannot be overwritten from outside", async () => {
  const shared = await createTask({
    title: "Shared status",
    assignees: [id(employeeA), id(employeeB)],
  });
  assert.equal(shared.status, 201);

  // The manager is not an assignee: they cannot flip two people's work
  const statusEndpoint = await api.put(`/api/tasks/${shared.task._id}/status`, {
    token: managerToken,
    body: { status: "Completed" },
  });
  assert.equal(statusEndpoint.status, 400);

  const editEndpoint = await api.put(`/api/tasks/${shared.task._id}`, {
    token: managerToken,
    body: { status: "Completed" },
  });
  assert.equal(editEndpoint.status, 400);

  // A single-assignee task still takes a direct status set (old behaviour)
  const single = await createTask({ title: "Single status", assignedTo: id(employeeA) });
  const direct = await api.put(`/api/tasks/${single.task._id}`, {
    token: managerToken,
    body: { status: "Completed" },
  });
  assert.equal(direct.status, 200);
  assert.equal(direct.body.data.status, "Completed");
  assert.equal(direct.body.data.progress[0].status, "Completed", "the assignee stays in step");

  // A manager who IS an assignee records their own work like anyone else
  const managerTask = await createTask({
    title: "Manager's own work",
    assignees: [id(manager), id(employeeA)],
  });
  const own = await api.put(`/api/tasks/${managerTask.task._id}/status`, {
    token: managerToken,
    body: { status: "In Progress" },
  });
  assert.equal(own.status, 200);
  assert.equal(own.body.data.myStatus, "In Progress", "the manager's own status is tracked");
  assert.equal(own.body.data.status, "In Progress");
});

test("existing single-assignee tasks keep working unchanged", async () => {
  const created = await createTask({ title: "Legacy shape", assignedTo: id(employeeA) });
  assert.equal(created.status, 201);
  assert.equal(created.task.assignees.length, 1, "the list mirrors the single assignee");
  assert.equal(created.task.progress.length, 1);
  assert.equal(created.task.myStatus, "Pending");

  // The status flow, history and completion notification all as before
  const started = await api.put(`/api/tasks/${created.task._id}/status`, {
    token: tokenA,
    body: { status: "In Progress" },
  });
  assert.equal(started.body.data.status, "In Progress");

  const done = await api.put(`/api/tasks/${created.task._id}/status`, {
    token: tokenA,
    body: { status: "Completed" },
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.status, "Completed");
  assert.ok(done.body.data.completedAt);

  const managerNotes = (await api.get("/api/notifications", { token: managerToken })).body.data.filter(
    (n) => n.type === "task_completed" && n.task && n.task._id === created.task._id
  );
  assert.equal(managerNotes.length, 1, "the manager hears about completion exactly once");

  // The employee dashboard counts it by the person's own status
  const dash = await api.get("/api/dashboard/employee", { token: tokenA });
  assert.equal(dash.status, 200);
  const taskRow = dash.body.data.tasks.find((task) => task._id === created.task._id);
  assert.ok(taskRow);
  assert.equal(taskRow.myStatus, "Completed");
});

test("deleting a shared task takes its notifications, comments and history with it", async () => {
  const created = await createTask({
    title: "Delete shared",
    assignees: [id(employeeA), id(employeeB)],
  });
  assert.equal(created.status, 201);
  const taskId = created.task._id;

  await api.post(`/api/tasks/${taskId}/comments`, {
    token: tokenA,
    body: { message: "Before it goes" },
  });

  const removed = await api.delete(`/api/tasks/${taskId}`, { token: managerToken });
  assert.equal(removed.status, 200);

  assert.equal(await models.Comment.countDocuments({ task: taskId }), 0);
  assert.equal(await models.TaskHistory.countDocuments({ task: taskId }), 0);
  assert.equal(await models.Notification.countDocuments({ task: taskId }), 0);
  assert.equal(await models.Task.countDocuments({ _id: taskId }), 0);

  assert.equal((await api.get(`/api/tasks/${taskId}`, { token: tokenA })).status, 404);
  assert.equal((await api.get(`/api/tasks/${taskId}`, { token: tokenB })).status, 404);

  // Both assignees lost the task from their lists
  for (const token of [tokenA, tokenB]) {
    const list = await api.get("/api/tasks", { token });
    assert.ok(!list.body.data.some((task) => task._id === taskId));
  }
});
