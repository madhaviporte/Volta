// Meeting Updates API: manager permissions, employee restrictions,
// validation, participant scoping, cancellation and summary visibility.
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
  models,
} = require("./helpers");

let server;
let api;
let manager;
let employeeA;
let employeeB;
let employeeC;
let managerToken;
let tokenA;
let tokenB;
let tokenC;
let meeting1; // participants: A + B
let meeting2; // participants: B only

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "Meet Manager", role: "manager" });
  employeeA = await createUser({ name: "Meet Employee A" });
  employeeB = await createUser({ name: "Meet Employee B" });
  employeeC = await createUser({ name: "Meet Employee C" });

  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });
  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });
  tokenC = forgeToken({ userId: employeeC._id.toString() }, { expiresIn: "1h" });

  const m1 = await api.post("/api/meetings", {
    token: managerToken,
    body: {
      title: "Sprint planning",
      date: inDays(2),
      time: "10:00",
      agenda: "Plan the next sprint",
      participants: [employeeA._id.toString(), employeeB._id.toString()],
    },
  });
  assert.equal(m1.status, 201);
  meeting1 = m1.body.data;

  const m2 = await api.post("/api/meetings", {
    token: managerToken,
    body: {
      title: "B-only sync",
      date: inDays(3),
      time: "11:30",
      agenda: "Only B is relevant here",
      participants: [employeeB._id.toString()],
    },
  });
  assert.equal(m2.status, 201);
  meeting2 = m2.body.data;
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

test("creating a meeting validates every field", async () => {
  const valid = {
    title: "Standup",
    date: inDays(1),
    time: "09:15",
    agenda: "Daily sync",
    participants: [employeeA._id.toString()],
  };

  const cases = [
    [{ ...valid, title: "" }, "Title is required"],
    [{ ...valid, title: "   " }, "Title is required"],
    [{ ...valid, date: undefined }, "date must be a valid date"],
    [{ ...valid, date: "not-a-date" }, "date must be a valid date"],
    [{ ...valid, time: undefined }, "time must be in 24-hour HH:MM format"],
    [{ ...valid, time: "25:00" }, "time must be in 24-hour HH:MM format"],
    [{ ...valid, time: "9am" }, "time must be in 24-hour HH:MM format"],
    [{ ...valid, agenda: { $ne: null } }, "agenda must be text"],
    [{ ...valid, participants: undefined }, "At least one participant is required"],
    [{ ...valid, participants: [] }, "At least one participant is required"],
    [{ ...valid, participants: "not-an-array" }, "At least one participant is required"],
    [{ ...valid, participants: ["not-an-id"] }, "participants must reference existing employees"],
    [{ ...valid, participants: ["000000000000000000000000"] }, "participants must reference existing employees"],
    // A manager cannot be used as a participant
    [{ ...valid, participants: [manager._id.toString()] }, "participants must reference existing employees"],
  ];

  for (const [body, expected] of cases) {
    const res = await api.post("/api/meetings", { token: managerToken, body });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(res.body.message, expected);
  }
});

test("a scheduled meeting returns its fields with populated participants", async () => {
  assert.equal(meeting1.title, "Sprint planning");
  assert.equal(meeting1.time, "10:00");
  assert.equal(meeting1.agenda, "Plan the next sprint");
  assert.equal(meeting1.status, "Scheduled");
  assert.equal(meeting1.summary, "");
  assert.equal(meeting1.participants.length, 2);
  assert.ok(meeting1.participants.every((p) => p.name), "participants carry names");
  assert.equal(meeting1.createdBy.name, "Meet Manager");
});

test("every mutation endpoint rejects employees with 403", async () => {
  const probes = [
    ["post", "/api/meetings", { title: "Nope", date: inDays(1), time: "10:00", participants: [employeeA._id.toString()] }],
    ["put", `/api/meetings/${meeting1._id}`, { title: "Hijacked" }],
    ["put", `/api/meetings/${meeting1._id}/cancel`, {}],
    ["put", `/api/meetings/${meeting1._id}/summary`, { summary: "Hijacked summary" }],
  ];

  for (const [method, path, body] of probes) {
    const res = await api[method](path, { token: tokenA, body });
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path} should be 403 for an employee, got ${res.status}`);
  }

  // The meeting was not modified by any of the rejected calls
  const list = await api.get("/api/meetings", { token: managerToken });
  const m1 = list.body.data.find((m) => m._id === meeting1._id);
  assert.equal(m1.title, "Sprint planning");
  assert.equal(m1.status, "Scheduled");
  assert.equal(m1.summary, "");
});

test("all meeting endpoints reject anonymous requests with 401", async () => {
  const list = await api.get("/api/meetings");
  assert.equal(list.status, 401);

  const create = await api.post("/api/meetings", { body: {} });
  assert.equal(create.status, 401);
});

test("employees only see meetings they participate in", async () => {
  const listA = await api.get("/api/meetings", { token: tokenA });
  assert.equal(listA.status, 200);
  const idsA = listA.body.data.map((m) => m._id);
  assert.ok(idsA.includes(meeting1._id), "A sees the meeting they attend");
  assert.ok(!idsA.includes(meeting2._id), "A must not see B-only meeting");

  const listB = await api.get("/api/meetings", { token: tokenB });
  assert.equal(listB.status, 200);
  const idsB = listB.body.data.map((m) => m._id);
  assert.ok(idsB.includes(meeting1._id) && idsB.includes(meeting2._id), "B attends both");

  const listC = await api.get("/api/meetings", { token: tokenC });
  assert.equal(listC.status, 200);
  assert.equal(listC.body.data.length, 0, "C participates in nothing");

  const listManager = await api.get("/api/meetings", { token: managerToken });
  assert.equal(listManager.status, 200);
  assert.ok(listManager.body.data.length >= 2, "the manager sees every meeting");
});

test("the manager can edit details; restricted fields in the body are ignored", async () => {
  // Publish a summary first so we can prove edits cannot erase it
  const summaryRes = await api.put(`/api/meetings/${meeting1._id}/summary`, {
    token: managerToken,
    body: { summary: "Agreed on the scope.", actionItems: ["Draft the plan", "Book the room"] },
  });
  assert.equal(summaryRes.status, 200);

  const res = await api.put(`/api/meetings/${meeting1._id}`, {
    token: managerToken,
    body: {
      title: "Sprint planning (moved)",
      date: inDays(4),
      time: "14:00",
      agenda: "Updated agenda",
      participants: [employeeA._id.toString(), employeeC._id.toString()],
      // These must be ignored by a plain edit:
      summary: "HACKED",
      status: "Cancelled",
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, "Sprint planning (moved)");
  assert.equal(res.body.data.time, "14:00");
  assert.equal(res.body.data.status, "Scheduled", "an edit cannot cancel a meeting");
  assert.equal(res.body.data.summary, "Agreed on the scope.", "an edit cannot overwrite the summary");

  const names = res.body.data.participants.map((p) => p.name).sort();
  assert.deepEqual(names, ["Meet Employee A", "Meet Employee C"], "participants replaced");

  // B was removed as a participant -> B loses access to this meeting
  const listB = await api.get("/api/meetings", { token: tokenB });
  assert.ok(!listB.body.data.some((m) => m._id === meeting1._id), "B no longer sees the edited meeting");
});

test("editing validates ids and field values", async () => {
  const malformed = await api.put("/api/meetings/not-an-id", { token: managerToken, body: { title: "X" } });
  assert.equal(malformed.status, 400);

  const missing = await api.put("/api/meetings/000000000000000000000000", { token: managerToken, body: { title: "X" } });
  assert.equal(missing.status, 404);

  const badTime = await api.put(`/api/meetings/${meeting2._id}`, { token: managerToken, body: { time: "99:99" } });
  assert.equal(badTime.status, 400);
  assert.equal(badTime.body.message, "time must be in 24-hour HH:MM format");

  const badDate = await api.put(`/api/meetings/${meeting2._id}`, { token: managerToken, body: { date: "yesterday-ish" } });
  assert.equal(badDate.status, 400);

  const noParticipants = await api.put(`/api/meetings/${meeting2._id}`, { token: managerToken, body: { participants: [] } });
  assert.equal(noParticipants.status, 400);
  assert.equal(noParticipants.body.message, "At least one participant is required");
});

test("cancelling keeps the meeting visible to participants with a clear status", async () => {
  const malformed = await api.put("/api/meetings/not-an-id/cancel", { token: managerToken, body: {} });
  assert.equal(malformed.status, 400);

  const missing = await api.put("/api/meetings/000000000000000000000000/cancel", { token: managerToken, body: {} });
  assert.equal(missing.status, 404);

  const res = await api.put(`/api/meetings/${meeting2._id}/cancel`, { token: managerToken, body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, "Cancelled");

  // B (a participant) still sees the cancelled meeting, clearly marked
  const listB = await api.get("/api/meetings", { token: tokenB });
  const cancelled = listB.body.data.find((m) => m._id === meeting2._id);
  assert.ok(cancelled, "cancelled meetings stay visible in the history");
  assert.equal(cancelled.status, "Cancelled");
});

test("summaries and action items become visible to participants once published", async () => {
  // Participant A sees the summary that was published earlier in this suite
  const before = await api.get("/api/meetings", { token: tokenA });
  const target = before.body.data.find((m) => m._id === meeting1._id);
  assert.equal(target.summary, "Agreed on the scope.", "summary published earlier in this suite");
  assert.deepEqual(target.actionItems, ["Draft the plan", "Book the room"]);

  // Validation
  const empty = await api.put(`/api/meetings/${meeting1._id}/summary`, {
    token: managerToken,
    body: { summary: "   " },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.message, "Summary is required");

  const badItems = await api.put(`/api/meetings/${meeting1._id}/summary`, {
    token: managerToken,
    body: { summary: "Valid", actionItems: "not-a-list" },
  });
  assert.equal(badItems.status, 400);
  assert.equal(badItems.body.message, "actionItems must be a list of text items");

  const badItemEntry = await api.put(`/api/meetings/${meeting1._id}/summary`, {
    token: managerToken,
    body: { summary: "Valid", actionItems: [{ not: "text" }] },
  });
  assert.equal(badItemEntry.status, 400);

  // Participants read the published summary
  const after = await api.get("/api/meetings", { token: tokenA });
  const visible = after.body.data.find((m) => m._id === meeting1._id);
  assert.equal(visible.summary, "Agreed on the scope.");
  assert.deepEqual(visible.actionItems, ["Draft the plan", "Book the room"]);
});
