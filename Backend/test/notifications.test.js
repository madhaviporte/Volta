// Notifications: per-user isolation, read/unread behaviour and dedupe.
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
let employeeA;
let employeeB;
let manager;
let tokenA;
let tokenB;
let managerToken;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  employeeA = await createUser({ name: "Notif Employee A" });
  employeeB = await createUser({ name: "Notif Employee B" });
  manager = await createUser({ name: "Notif Manager", role: "manager" });

  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });
  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });

  // One due-soon task for A, one overdue task for B
  await models.Task.create({
    title: "A due soon",
    assignedTo: employeeA._id,
    createdBy: manager._id,
    dueDate: new Date(Date.now() + 2 * 86400000),
  });
  await models.Task.create({
    title: "B overdue",
    assignedTo: employeeB._id,
    createdBy: manager._id,
    dueDate: new Date(Date.now() - 2 * 86400000),
  });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

test("each employee only ever receives their own notifications", async () => {
  const listA = await api.get("/api/notifications", { token: tokenA });
  assert.equal(listA.status, 200);
  assert.ok(listA.body.data.length >= 1);
  for (const n of listA.body.data) {
    assert.equal(n.user, employeeA._id.toString());
    assert.equal(n.task.title, "A due soon");
  }

  const listB = await api.get("/api/notifications", { token: tokenB });
  assert.equal(listB.status, 200);
  for (const n of listB.body.data) {
    assert.equal(n.user, employeeB._id.toString());
    assert.equal(n.task.title, "B overdue");
  }
});

test("repeated scheduler runs do not duplicate notifications", async () => {
  const first = await api.get("/api/notifications", { token: tokenA });
  const second = await api.get("/api/notifications", { token: tokenA });
  const third = await api.get("/api/notifications", { token: tokenA });

  assert.equal(first.body.data.length, second.body.data.length);
  assert.equal(second.body.data.length, third.body.data.length);
  assert.equal(third.body.unreadCount, third.body.data.filter((n) => !n.isRead).length);
});

test("marking one notification read affects only that row and updates unreadCount", async () => {
  const list = await api.get("/api/notifications", { token: tokenA });
  const target = list.body.data[0];
  const beforeCount = list.body.unreadCount;

  const res = await api.put(`/api/notifications/${target._id}/read`, { token: tokenA });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.isRead, true);

  const after = await api.get("/api/notifications", { token: tokenA });
  assert.equal(after.body.unreadCount, beforeCount - 1);
});

test("a user cannot mark someone else's notification read", async () => {
  const listB = await api.get("/api/notifications", { token: tokenB });
  const foreign = listB.body.data[0];
  assert.ok(foreign, "employee B should have at least one notification");

  const res = await api.put(`/api/notifications/${foreign._id}/read`, { token: tokenA });
  assert.equal(res.status, 403);

  const stillUnread = await models.Notification.findById(foreign._id);
  assert.equal(stillUnread.isRead, false);
});

test("invalid ids answer 400 and unknown ids 404", async () => {
  const malformed = await api.put("/api/notifications/not-an-id/read", { token: tokenA });
  assert.equal(malformed.status, 400);

  const missing = await api.put("/api/notifications/000000000000000000000000/read", { token: tokenA });
  assert.equal(missing.status, 404);
});

test("mark-all-read only touches the caller's own rows", async () => {
  const listB = await api.get("/api/notifications", { token: tokenB });
  assert.ok(listB.body.unreadCount >= 1);

  const res = await api.put("/api/notifications/read-all", { token: tokenA });
  assert.equal(res.status, 200);

  const afterA = await api.get("/api/notifications", { token: tokenA });
  assert.equal(afterA.body.unreadCount, 0);

  const afterB = await api.get("/api/notifications", { token: tokenB });
  assert.equal(afterB.body.unreadCount, listB.body.unreadCount, "B's unread rows must be untouched");
});

test("notification routes require authentication", async () => {
  const res = await api.get("/api/notifications");
  assert.equal(res.status, 401);
});

// ---------- Task activity notifications (manager + employee routing) ----------

test("task activity notifications reach the correct recipient with actor, title and timestamp", async () => {
  // The manager assigns a task to A through the real API
  const created = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title: "Notify flow",
      assignedTo: employeeA._id.toString(),
      dueDate: inDays(2),
    },
  });
  assert.equal(created.status, 201);
  const taskId = created.body.data._id;

  // The assignee learns about the new task; the message carries the title
  const listA = await api.get("/api/notifications", { token: tokenA });
  const assigned = listA.body.data.find(
    (n) => n.type === "task_assigned" && n.task && n.task._id === taskId
  );
  assert.ok(assigned, "the assignee is notified about the new task");
  assert.match(assigned.message, /Notify flow/);
  assert.ok(assigned.createdAt, "notifications carry a timestamp");

  // The manager is NOT notified about their own action
  const managerList = await api.get("/api/notifications", { token: managerToken });
  assert.ok(
    !managerList.body.data.some((n) => n.task && n.task._id === taskId),
    "no self-notification for the assigning manager"
  );

  // An employee changes the status -> the owning manager is notified
  const statusRes = await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenA,
    body: { status: "In Progress" },
  });
  assert.equal(statusRes.status, 200);

  const managerList2 = await api.get("/api/notifications", { token: managerToken });
  assert.ok(
    managerList2.body.data.every((n) => n.user === manager._id.toString()),
    "a manager never receives another user's notifications"
  );
  const statusNote = managerList2.body.data.find(
    (n) => n.type === "task_status_changed" && n.task._id === taskId
  );
  assert.ok(statusNote, "the manager hears about the employee's status change");
  assert.match(statusNote.message, /Notify flow/);
  assert.match(statusNote.message, /Notif Employee A/); // actor

  // The employee does NOT get the manager-only status notification
  const listA2 = await api.get("/api/notifications", { token: tokenA });
  assert.ok(
    !listA2.body.data.some((n) => n.type === "task_status_changed" && n.task._id === taskId),
    "employees do not receive manager-only notifications"
  );

  // An employee comment goes to the manager with a preview of the comment
  const commentRes = await api.post(`/api/tasks/${taskId}/comments`, {
    token: tokenA,
    body: { message: "Started working on it" },
  });
  assert.equal(commentRes.status, 201);

  const managerList3 = await api.get("/api/notifications", { token: managerToken });
  const commentNote = managerList3.body.data.find(
    (n) => n.type === "task_commented" && n.task._id === taskId
  );
  assert.ok(commentNote, "the manager hears about the employee's comment");
  assert.match(commentNote.message, /Started working on it/);
  assert.match(commentNote.message, /Notif Employee A/);

  // A no-op status update (status unchanged) creates no new notification
  const beforeCount = (await api.get("/api/notifications", { token: managerToken })).body.count;
  const repeat = await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenA,
    body: { status: "In Progress" },
  });
  assert.equal(repeat.status, 200);
  const afterCount = (await api.get("/api/notifications", { token: managerToken })).body.count;
  assert.equal(afterCount, beforeCount, "processing the same status again adds nothing");

  // Completing the task notifies the manager exactly once
  const completed = await api.put(`/api/tasks/${taskId}/status`, {
    token: tokenA,
    body: { status: "Completed" },
  });
  assert.equal(completed.status, 200);

  const managerList4 = await api.get("/api/notifications", { token: managerToken });
  const completedNotes = managerList4.body.data.filter(
    (n) => n.type === "task_completed" && n.task._id === taskId
  );
  assert.equal(completedNotes.length, 1, "exactly one completion notification");
  assert.match(completedNotes[0].message, /completed the task/);
  assert.equal(managerList4.body.data.filter((n) => n.type === "task_assigned").length, 0,
    "the manager never receives assignee-only notifications");

  // Manager notifications use the same read/unread conventions
  const target = completedNotes[0];
  assert.equal(target.isRead, false);
  const readRes = await api.put(`/api/notifications/${target._id}/read`, { token: managerToken });
  assert.equal(readRes.status, 200);

  const managerList5 = await api.get("/api/notifications", { token: managerToken });
  const readBack = managerList5.body.data.find((n) => n._id === target._id);
  assert.equal(readBack.isRead, true);

  // An employee cannot touch the manager's notification
  const foreign = await api.put(`/api/notifications/${target._id}/read`, { token: tokenA });
  assert.equal(foreign.status, 403);
});

test("reassignment notifies the new assignee and clears the previous assignee's rows", async () => {
  const created = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title: "Reassign notify",
      assignedTo: employeeA._id.toString(),
      dueDate: inDays(4),
    },
  });
  assert.equal(created.status, 201);
  const taskId = created.body.data._id;

  // Simulate a scheduler reminder for A on this task
  await models.Notification.create({
    user: employeeA._id,
    task: taskId,
    type: "deadline_soon",
    message: "Fixture reminder",
    dedupeKey: `deadline:${taskId}:${employeeA._id}:deadline_soon`,
  });

  // The manager reassigns the task to B
  const reassigned = await api.put(`/api/tasks/${taskId}`, {
    token: managerToken,
    body: { assignedTo: employeeB._id.toString() },
  });
  assert.equal(reassigned.status, 200);

  // A keeps nothing for this task: reminders and activity rows leave with
  // the reassignment
  const rowsForA = await models.Notification.find({ task: taskId, user: employeeA._id });
  assert.equal(rowsForA.length, 0, "the previous assignee keeps nothing");

  // B is told the task is now theirs
  const listB = await api.get("/api/notifications", { token: tokenB });
  const reassignedNote = listB.body.data.find(
    (n) => n.type === "task_reassigned" && n.task && n.task._id === taskId
  );
  assert.ok(reassignedNote, "the new assignee is notified");
  assert.match(reassignedNote.message, /Reassign notify/);
});

test("refreshing the notification list never generates new notifications", async () => {
  const first = await api.get("/api/notifications", { token: managerToken });
  const second = await api.get("/api/notifications", { token: managerToken });
  const third = await api.get("/api/notifications", { token: managerToken });

  assert.equal(first.body.count, second.body.count);
  assert.equal(second.body.count, third.body.count);
});
