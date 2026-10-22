// Comments: access control and validation.
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
let taskA;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "Comments Manager", role: "manager" });
  employeeA = await createUser({ name: "Comments Employee A" });
  employeeB = await createUser({ name: "Comments Employee B" });

  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });
  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });

  const task = await models.Task.create({
    title: "Comments fixture task",
    assignedTo: employeeA._id,
    createdBy: manager._id,
    dueDate: new Date(Date.now() + 4 * 86400000),
  });
  taskA = task._id.toString();
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

test("the assigned employee can comment on their own task", async () => {
  const res = await api.post(`/api/tasks/${taskA}/comments`, {
    token: tokenA,
    body: { message: "Working on it" },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.message, "Working on it");
  assert.equal(res.body.data.user.name, "Comments Employee A");
  // The stored author is always the token's user, never a client-supplied id
  assert.equal(res.body.data.user._id, employeeA._id.toString());
});

test("another employee cannot comment on or read someone else's task comments", async () => {
  const write = await api.post(`/api/tasks/${taskA}/comments`, {
    token: tokenB,
    body: { message: "Sneaky comment" },
  });
  assert.equal(write.status, 403);

  const read = await api.get(`/api/tasks/${taskA}/comments`, { token: tokenB });
  assert.equal(read.status, 403);
});

test("the manager can comment on and read any task's comments", async () => {
  const write = await api.post(`/api/tasks/${taskA}/comments`, {
    token: managerToken,
    body: { message: "Manager note" },
  });
  assert.equal(write.status, 201);

  const read = await api.get(`/api/tasks/${taskA}/comments`, { token: managerToken });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.length, 2);
});

test("invalid comment payloads answer 400 and invalid/missing tasks 400/404", async () => {
  const empty = await api.post(`/api/tasks/${taskA}/comments`, { token: tokenA, body: { message: "" } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.message, "Comment message is required");

  const whitespace = await api.post(`/api/tasks/${taskA}/comments`, { token: tokenA, body: { message: "   " } });
  assert.equal(whitespace.status, 400);

  const nonString = await api.post(`/api/tasks/${taskA}/comments`, { token: tokenA, body: { message: { $ne: null } } });
  assert.equal(nonString.status, 400);

  const malformedId = await api.post(`/api/tasks/not-an-id/comments`, { token: tokenA, body: { message: "hi" } });
  assert.equal(malformedId.status, 400);

  const missingTask = await api.post(`/api/tasks/000000000000000000000000/comments`, { token: tokenA, body: { message: "hi" } });
  assert.equal(missingTask.status, 404);
});
