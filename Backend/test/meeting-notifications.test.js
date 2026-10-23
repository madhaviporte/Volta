// Meeting notifications: creating or updating a meeting notifies every
// participating employee through the existing notification pipeline
// (same model, API, auth and dedupeKey conventions as the task rows).
// Also covers refresh stability, read/mark-all behaviour and per-user
// isolation for these new notification types.
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
} = require("./helpers");

let server;
let api;
let manager;
let employeeA;
let employeeB;
let outsider;
let managerToken;
let tokenA;
let tokenB;
let tokenOutsider;
let firstMeetingId;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "Meeting Manager", role: "manager" });
  employeeA = await createUser({ name: "Meeting Alice" });
  employeeB = await createUser({ name: "Meeting Bob" });
  outsider = await createUser({ name: "Meeting Outsider" });

  managerToken = forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });
  tokenA = forgeToken({ userId: employeeA._id.toString() }, { expiresIn: "1h" });
  tokenB = forgeToken({ userId: employeeB._id.toString() }, { expiresIn: "1h" });
  tokenOutsider = forgeToken({ userId: outsider._id.toString() }, { expiresIn: "1h" });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

const createMeeting = async (overrides = {}) => {
  const res = await api.post("/api/meetings", {
    token: managerToken,
    body: {
      title: "Roadmap sync",
      date: inDays(3),
      time: "10:00",
      agenda: "Plan the next quarter",
      meetingLink: "https://meet.example.com/roadmap-1",
      participants: [employeeA._id.toString(), employeeB._id.toString()],
      ...overrides,
    },
  });

  assert.equal(res.status, 201);
  return res.body.data;
};

const meetingRows = (list, type) =>
  list.body.data.filter((n) => n.type === type);

test("creating a meeting notifies every participant exactly once, with title and details", async () => {
  const meeting = await createMeeting({ title: "Roadmap sync" });
  firstMeetingId = meeting._id;

  const listA = await api.get("/api/notifications", { token: tokenA });
  assert.equal(listA.status, 200);

  const createdA = meetingRows(listA, "meeting_created");
  assert.equal(createdA.length, 1, "participant A gets one meeting_created row");
  assert.match(createdA[0].message, /Roadmap sync/);
  assert.match(createdA[0].message, new RegExp(inDays(3)));
  assert.match(createdA[0].message, /10:00/);
  assert.match(createdA[0].message, /meet\.example\.com\/roadmap-1/);
  assert.equal(createdA[0].task, null, "meeting notifications are not task rows");
  assert.equal(createdA[0].isRead, false, "new notifications start unread");
  assert.equal(listA.body.unreadCount, 1, "the badge counts the new unread row");

  const listB = await api.get("/api/notifications", { token: tokenB });
  assert.equal(meetingRows(listB, "meeting_created").length, 1, "participant B is notified too");

  // The acting manager never notifies themselves...
  const managerList = await api.get("/api/notifications", { token: managerToken });
  assert.equal(managerList.body.data.length, 0, "no self-notification for the scheduling manager");

  // ...and an employee who is not part of the meeting gets nothing
  const outsiderList = await api.get("/api/notifications", { token: tokenOutsider });
  assert.equal(outsiderList.body.data.length, 0, "non-participants are never notified");
  assert.equal(outsiderList.body.unreadCount, 0);
});

test("loading meetings or refreshing the notification list never duplicates rows", async () => {
  const meetingsBefore = (await api.get("/api/notifications", { token: tokenA })).body.count;

  await api.get("/api/meetings", { token: tokenA });
  await api.get("/api/meetings", { token: managerToken });

  const first = await api.get("/api/notifications", { token: tokenA });
  const second = await api.get("/api/notifications", { token: tokenA });
  const third = await api.get("/api/notifications", { token: tokenA });

  assert.equal(first.body.count, meetingsBefore, "loading the meetings page creates nothing");
  assert.equal(second.body.count, first.body.count);
  assert.equal(third.body.count, first.body.count);
  assert.equal(third.body.unreadCount, third.body.data.filter((n) => !n.isRead).length);
  assert.equal(meetingRows(third, "meeting_created").length, 1, "still exactly one row per action");
});

test("updating date, time and link notifies participants; replaying the same edit does not", async () => {
  const newDate = inDays(5);

  const updated = await api.put(`/api/meetings/${firstMeetingId}`, {
    token: managerToken,
    body: {
      date: newDate,
      time: "14:30",
      meetingLink: "https://meet.example.com/roadmap-2",
    },
  });
  assert.equal(updated.status, 200);

  const listA = await api.get("/api/notifications", { token: tokenA });
  const updatedRows = meetingRows(listA, "meeting_updated");
  assert.equal(updatedRows.length, 1, "the real edit notifies the participant once");
  assert.match(updatedRows[0].message, /Roadmap sync/);
  assert.match(updatedRows[0].message, new RegExp(newDate));
  assert.match(updatedRows[0].message, /14:30/);
  assert.match(updatedRows[0].message, /roadmap-2/);
  assert.equal(listA.body.unreadCount, 2, "created + updated are both unread");

  // A retried request with the identical payload changes nothing,
  // so it must not notify again.
  const replay = await api.put(`/api/meetings/${firstMeetingId}`, {
    token: managerToken,
    body: {
      date: newDate,
      time: "14:30",
      meetingLink: "https://meet.example.com/roadmap-2",
    },
  });
  assert.equal(replay.status, 200);

  const afterReplay = await api.get("/api/notifications", { token: tokenA });
  assert.equal(meetingRows(afterReplay, "meeting_updated").length, 1, "the replay adds nothing");

  // A genuinely different edit (agenda) notifies again
  const agendaEdit = await api.put(`/api/meetings/${firstMeetingId}`, {
    token: managerToken,
    body: { agenda: "Revised roadmap discussion" },
  });
  assert.equal(agendaEdit.status, 200);

  const afterAgenda = await api.get("/api/notifications", { token: tokenA });
  assert.equal(
    meetingRows(afterAgenda, "meeting_updated").length,
    2,
    "each distinct edit produces its own notification"
  );

  // The manager and the non-participant stay untouched by the edit
  const managerList = await api.get("/api/notifications", { token: managerToken });
  assert.equal(managerList.body.data.length, 0);
  const outsiderList = await api.get("/api/notifications", { token: tokenOutsider });
  assert.equal(outsiderList.body.data.length, 0);
});

test("opening a meeting notification marks it read, persists it and decrements the count", async () => {
  const listA = await api.get("/api/notifications", { token: tokenA });
  const target = listA.body.data.find((n) => n.type === "meeting_created");
  const beforeCount = listA.body.unreadCount;

  // Another user cannot touch it
  const foreign = await api.put(`/api/notifications/${target._id}/read`, { token: tokenB });
  assert.equal(foreign.status, 403);
  const stillUnread = await api.get("/api/notifications", { token: tokenA });
  assert.equal(
    stillUnread.body.data.find((n) => n._id === target._id).isRead,
    false,
    "a rejected attempt never flips the row"
  );

  // The owner's own mark-read succeeds and survives a re-fetch
  const res = await api.put(`/api/notifications/${target._id}/read`, { token: tokenA });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.isRead, true);

  const after = await api.get("/api/notifications", { token: tokenA });
  assert.equal(after.body.data.find((n) => n._id === target._id).isRead, true);
  assert.equal(after.body.unreadCount, beforeCount - 1, "the badge drops by exactly one");
});

test("mark-all-read clears the caller's unread count without touching other users", async () => {
  const listB = await api.get("/api/notifications", { token: tokenB });
  assert.ok(listB.body.unreadCount >= 1, "B still has unread rows");

  const res = await api.put("/api/notifications/read-all", { token: tokenA });
  assert.equal(res.status, 200);

  const afterA = await api.get("/api/notifications", { token: tokenA });
  assert.equal(afterA.body.unreadCount, 0, "no unread badge left for A");
  assert.ok(
    afterA.body.data.every((n) => n.isRead === true),
    "every row A can see is read"
  );

  const afterB = await api.get("/api/notifications", { token: tokenB });
  assert.equal(afterB.body.unreadCount, listB.body.unreadCount, "B's rows are untouched");
});
