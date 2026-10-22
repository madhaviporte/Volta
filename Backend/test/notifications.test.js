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
