// Gmail email notifications: every newly created in-app notification also
// goes out as EXACTLY ONE email, through the existing emailService, with:
//   - recipients identical to the in-app recipient selection,
//   - atomic claim -> sent/failed/skipped state on the notification row,
//   - SMTP stubbed by a tiny in-process server, so this suite NEVER sends
//     real mail (and, thanks to the helpers' EMAIL_ENABLED=false default,
//     neither does any other test file).
// Covers: single/multi assignee, self-action silence, dedupe, reassignment,
// status/completion/comment, meetings, deadline/overdue, inactive and
// invalid recipients, SMTP failure resilience, concurrency and HTML escaping.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");

const {
  startServer,
  connectTestDb,
  resetTestDb,
  disconnectTestDb,
  makeApi,
  createUser,
  login,
  inDays,
  models,
} = require("./helpers");

// ---------- Minimal SMTP stub: captures messages instead of delivering ----

const startSmtpStub = () =>
  new Promise((resolve, reject) => {
    const messages = [];

    const server = net.createServer((socket) => {
      let buffer = "";
      let inData = false;
      let recipients = [];
      // AUTH LOGIN handshake: 1 = waiting for username, 2 = for password
      let authStage = 0;

      socket.on("error", () => {
        // a test client disconnecting must never crash the suite
      });

      socket.write("220 localhost ESMTP volta test stub\r\n");

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");

        for (;;) {
          if (inData) {
            const end = buffer.indexOf("\r\n.\r\n");

            if (end === -1) {
              return;
            }

            messages.push({
              recipients: recipients.slice(),
              data: buffer.slice(0, end),
            });
            buffer = buffer.slice(end + 5);
            inData = false;
            recipients = [];
            socket.write("250 2.0.0 Ok: queued\r\n");
            continue;
          }

          const newline = buffer.indexOf("\r\n");

          if (newline === -1) {
            return;
          }

          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 2);
          const command = line.toUpperCase();

          if (authStage === 1) {
            authStage = 2;
            socket.write("334 UGFzc3dvcmQ6\r\n"); // "Password:"
            continue;
          }

          if (authStage === 2) {
            authStage = 0;
            socket.write("235 2.7.0 Authentication successful\r\n");
            continue;
          }

          if (command.startsWith("EHLO")) {
            socket.write(
              "250-localhost\r\n250-8BITMIME\r\n250-AUTH LOGIN\r\n250 HELP\r\n"
            );
          } else if (command.startsWith("HELO")) {
            socket.write("250 localhost\r\n");
          } else if (command.startsWith("AUTH LOGIN")) {
            authStage = 1;
            socket.write("334 VXNlcm5hbWU6\r\n"); // "Username:"
          } else if (command.startsWith("MAIL FROM")) {
            socket.write("250 2.1.0 Ok\r\n");
          } else if (command.startsWith("RCPT TO")) {
            const match = line.match(/<([^>]*)>/);

            if (match) {
              recipients.push(match[1].toLowerCase());
            }

            socket.write("250 2.1.5 Ok\r\n");
          } else if (command.startsWith("DATA")) {
            inData = true;
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (command.startsWith("QUIT")) {
            socket.write("221 2.0.0 Bye\r\n");
            socket.end();
          } else {
            socket.write("250 2.0.0 Ok\r\n");
          }
        }
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        messages,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });

// ---------- Captured-message helpers (MIME aware) -------------------------

const decodeTransfer = (encoding, body) => {
  if (encoding === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
  }

  if (encoding === "base64") {
    return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString(
      "utf8"
    );
  }

  return body;
};

const cteOf = (headers) => {
  const match = headers.match(/content-transfer-encoding:\s*([^\r\n;]+)/i);
  return match ? match[1].trim().toLowerCase() : "7bit";
};

// Splits a captured message into its decoded MIME parts, so assertions can
// target the HTML part specifically (the text/plain part legitimately
// contains raw user input).
const mimeParts = (raw) => {
  const headerEnd = raw.indexOf("\r\n\r\n");
  const topHeaders = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const boundary = topHeaders.match(/boundary="?([^";\r\n]+)"?/i);

  if (!boundary) {
    return [
      {
        headers: topHeaders,
        content: decodeTransfer(
          cteOf(topHeaders),
          headerEnd === -1 ? "" : raw.slice(headerEnd + 4)
        ),
      },
    ];
  }

  const body = headerEnd === -1 ? "" : raw.slice(headerEnd + 4);

  return body.split(`--${boundary[1]}`).flatMap((segment) => {
    const split = segment.indexOf("\r\n\r\n");

    if (split === -1) {
      return [];
    }

    const headers = segment.slice(0, split);
    return [
      { headers, content: decodeTransfer(cteOf(headers), segment.slice(split + 4)) },
    ];
  });
};

const htmlOf = (message) => {
  const part = mimeParts(message.data).find((entry) =>
    /content-type:\s*text\/html/i.test(entry.headers)
  );
  return part ? part.content : "";
};

const subjectOf = (message) => {
  const match = message.data.match(/^Subject:[^\r\n]*/im);
  return match ? match[0].replace(/^Subject:\s*/i, "") : "";
};

const messagesTo = (address) =>
  smtp.messages.filter((m) => m.recipients.includes(String(address).toLowerCase()));

const matching = (list, needle) =>
  list.filter(
    (m) => m.data.includes(needle) || subjectOf(m).includes(needle)
  );

const withSubjectPrefix = (list, prefix) =>
  list.filter((m) => subjectOf(m).startsWith(prefix));

const waitFor = async (check, description, timeout = 15000) => {
  const started = Date.now();

  for (;;) {
    const result = await check();

    if (result) {
      return result;
    }

    if (Date.now() - started > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

// Gives the serial send queue time to drain, so "exactly N" counts are real
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

let counter = 0;
const unique = (label) =>
  `${label} ${Date.now().toString(36)}-${(counter += 1)}`;

// ---------- Fixtures ------------------------------------------------------

let smtp;
let server;
let api;
let manager;
let managerToken;
let solo;
let groupMember2;
let groupMember3;
let groupMember4;
let groupMember5;
let deadlineUser;
let deadlineToken;
let reassignOut;
let reassignIn;
let statusUser;
let statusToken;
let meetA;
let meetB;
let inactiveUser;
let invalidEmailUser;
let smtpFailUser;
let concurrentUser;
let escapeUser;

before(async () => {
  smtp = await startSmtpStub();

  // The template/claim unit checks require the email modules inside THIS
  // process, so point the test process at the stub too. It must happen
  // before the first require of emailService (its transporter is built
  // from these values) and before any server is spawned.
  process.env.EMAIL_ENABLED = "true";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(smtp.port);
  process.env.SMTP_USER = "volta-test-user";
  process.env.SMTP_PASS = "volta-test-pass";
  process.env.SMTP_FROM = "volta@notifications.test";
  process.env.FRONTEND_BASE_URL = "https://volta.example";

  // Reset the dedicated test database BEFORE booting the server, so the
  // server's startup jobs (deadline scan, email retry) start on a clean
  // database and cannot emit emails for leftovers of other test files.
  await connectTestDb();
  await resetTestDb();

  server = await startServer({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.port),
    SMTP_USER: "volta-test-user",
    SMTP_PASS: "volta-test-pass",
    SMTP_FROM: "volta@notifications.test",
    FRONTEND_BASE_URL: "https://volta.example",
    EMAIL_ENABLED: "true",
  });
  api = makeApi(server.baseUrl);

  manager = await createUser({ name: "Email Manager", role: "manager" });
  solo = await createUser({ name: "Solo Assignee" });
  groupMember2 = await createUser({ name: "Group Member 2" });
  groupMember3 = await createUser({ name: "Group Member 3" });
  groupMember4 = await createUser({ name: "Group Member 4" });
  groupMember5 = await createUser({ name: "Group Member 5" });
  deadlineUser = await createUser({ name: "Deadline Watcher" });
  reassignOut = await createUser({ name: "Reassign Out" });
  reassignIn = await createUser({ name: "Reassign In" });
  statusUser = await createUser({ name: "Status Worker" });
  meetA = await createUser({ name: "Meeting A" });
  meetB = await createUser({ name: "Meeting B" });
  inactiveUser = await createUser({ name: "Inactive Participant", isActive: false });
  invalidEmailUser = await createUser({ name: "Bad Address", email: "not-an-email-address" });
  smtpFailUser = await createUser({ name: "SMTP Failure Probe" });
  concurrentUser = await createUser({ name: "Concurrency Probe" });
  escapeUser = await createUser({ name: "Escaping Probe" });

  managerToken = await login(api, manager.email);
  deadlineToken = await login(api, deadlineUser.email);
  statusToken = await login(api, statusUser.email);
});

after(async () => {
  await server.stop();
  await smtp.close();
  await disconnectTestDb();
});

// ---------- The suite -----------------------------------------------------

test("one assignee receives exactly one email, the acting manager none", async () => {
  const title = unique("Solo task");

  const res = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title,
      description: "single assignee probe",
      assignees: [String(solo._id)],
      priority: "High",
      dueDate: inDays(10),
    },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const taskId = res.body.data._id;

  await waitFor(
    () => matching(messagesTo(solo.email), title).length >= 1,
    "the assignee's task email"
  );
  await settle();

  const delivered = matching(messagesTo(solo.email), title);
  assert.equal(delivered.length, 1, "exactly one email per assignee");
  assert.deepEqual(delivered[0].recipients, [solo.email.toLowerCase()]);
  assert.ok(
    subjectOf(delivered[0]).startsWith("Task assigned"),
    `unexpected subject: ${subjectOf(delivered[0])}`
  );
  assert.ok(
    htmlOf(delivered[0]).includes(`https://volta.example/tasks/${taskId}`),
    "the email links to the real /tasks/:taskId route"
  );
  assert.equal(
    matching(messagesTo(manager.email), title).length,
    0,
    "a manager is never emailed about their own action"
  );

  // The row records delivery only after SMTP accepted the message
  const row = await models.Notification.findOne({
    user: solo._id,
    type: "task_assigned",
    task: taskId,
  });
  assert.ok(row, "the in-app notification exists");
  assert.equal(row.emailStatus, "sent");
  assert.equal(row.emailAttempts, 1);
  assert.ok(row.emailSentAt instanceof Date, "sent timestamp set after delivery");
});

test("five assignees receive five emails, one each, and nobody else", async () => {
  const title = unique("Shared task");
  const group = [solo, groupMember2, groupMember3, groupMember4, groupMember5];

  const res = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title,
      description: "multi-assignee probe",
      assignees: group.map((member) => String(member._id)),
      dueDate: inDays(10),
    },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));

  for (const member of group) {
    await waitFor(
      () => matching(messagesTo(member.email), title).length >= 1,
      `an email for ${member.name}`
    );
  }

  await settle();

  for (const member of group) {
    assert.equal(
      matching(messagesTo(member.email), title).length,
      1,
      `${member.name} must receive exactly one email`
    );
  }

  const aboutTitle = smtp.messages.filter((m) => m.data.includes(title));
  assert.equal(aboutTitle.length, 5, "exactly five emails for the whole task");
  assert.equal(
    matching(messagesTo(manager.email), title).length,
    0,
    "the assigning manager is excluded"
  );
});

test("deadline and overdue emails fire only when the reminder row is newly created", async () => {
  const dueSoonTitle = unique("Due soon task");
  const overdueTitle = unique("Overdue task");

  const dueSoon = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title: dueSoonTitle,
      assignees: [String(deadlineUser._id)],
      dueDate: inDays(2),
    },
  });
  assert.equal(dueSoon.status, 201, JSON.stringify(dueSoon.body));

  const overdue = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title: overdueTitle,
      assignees: [String(deadlineUser._id)],
      dueDate: inDays(-1),
    },
  });
  assert.equal(overdue.status, 201, JSON.stringify(overdue.body));

  // Fetching notifications refreshes the reminder scheduler
  const first = await api.get("/api/notifications", { token: deadlineToken });
  assert.equal(first.status, 200);

  await waitFor(
    () =>
      withSubjectPrefix(
        matching(messagesTo(deadlineUser.email), dueSoonTitle),
        "Deadline approaching"
      ).length >= 1,
    "the deadline_soon email"
  );
  await waitFor(
    () =>
      withSubjectPrefix(
        matching(messagesTo(deadlineUser.email), overdueTitle),
        "Task overdue"
      ).length >= 1,
    "the overdue email"
  );

  // Repeated generation must not resend the same reminders
  for (let i = 0; i < 3; i++) {
    const again = await api.get("/api/notifications", { token: deadlineToken });
    assert.equal(again.status, 200);
  }

  await settle(900);

  assert.equal(
    withSubjectPrefix(
      matching(messagesTo(deadlineUser.email), dueSoonTitle),
      "Deadline approaching"
    ).length,
    1,
    "deadline reminder is emailed exactly once"
  );
  assert.equal(
    withSubjectPrefix(
      matching(messagesTo(deadlineUser.email), overdueTitle),
      "Task overdue"
    ).length,
    1,
    "overdue reminder is emailed exactly once"
  );

  const deadlineRow = await models.Notification.findOne({
    user: deadlineUser._id,
    type: "deadline_soon",
  });
  assert.equal(deadlineRow.emailStatus, "sent");
});

test("reassignment emails only the newly assigned person", async () => {
  const title = unique("Reassignment task");

  const created = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title,
      assignees: [String(reassignOut._id)],
      dueDate: inDays(10),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const taskId = created.body.data._id;

  await waitFor(
    () => matching(messagesTo(reassignOut.email), title).length >= 1,
    "the original assignee's email"
  );

  const updated = await api.put(`/api/tasks/${taskId}`, {
    token: managerToken,
    body: { assignees: [String(reassignIn._id)] },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));

  await waitFor(
    () =>
      withSubjectPrefix(
        matching(messagesTo(reassignIn.email), title),
        "Task reassigned"
      ).length >= 1,
    "the new assignee's email"
  );
  await settle();

  assert.equal(
    withSubjectPrefix(
      matching(messagesTo(reassignIn.email), title),
      "Task reassigned"
    ).length,
    1
  );
  assert.equal(
    withSubjectPrefix(
      matching(messagesTo(reassignOut.email), title),
      "Task reassigned"
    ).length,
    0,
    "the removed person gets no reassignment mail"
  );
  assert.equal(
    matching(messagesTo(reassignOut.email), title).length,
    1,
    "the removed person keeps only the original assignment mail"
  );
  assert.equal(
    matching(messagesTo(manager.email), title).length,
    0,
    "the manager who performed the reassignment is not emailed"
  );
});

test("status change, completion and comment emails reach the task owner", async () => {
  const title = unique("Progress task");

  const created = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title,
      assignees: [String(statusUser._id)],
      dueDate: inDays(10),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const taskId = created.body.data._id;

  await waitFor(
    () => matching(messagesTo(statusUser.email), title).length >= 1,
    "the assignment email"
  );

  const inProgress = await api.put(`/api/tasks/${taskId}/status`, {
    token: statusToken,
    body: { status: "In Progress" },
  });
  assert.equal(inProgress.status, 200, JSON.stringify(inProgress.body));

  await waitFor(
    () =>
      withSubjectPrefix(matching(messagesTo(manager.email), title), "Status changed")
        .length >= 1,
    "the status-change email"
  );

  const completed = await api.put(`/api/tasks/${taskId}/status`, {
    token: statusToken,
    body: { status: "Completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));

  await waitFor(
    () =>
      withSubjectPrefix(matching(messagesTo(manager.email), title), "Task completed")
        .length >= 1,
    "the completion email"
  );

  const commented = await api.post(`/api/tasks/${taskId}/comments`, {
    token: statusToken,
    body: { message: "Working through the checklist now" },
  });
  assert.equal(commented.status, 201, JSON.stringify(commented.body));

  await waitFor(
    () =>
      withSubjectPrefix(matching(messagesTo(manager.email), title), "New comment")
        .length >= 1,
    "the comment email"
  );

  await settle();

  assert.equal(
    withSubjectPrefix(matching(messagesTo(manager.email), title), "Status changed")
      .length,
    1
  );
  assert.equal(
    withSubjectPrefix(matching(messagesTo(manager.email), title), "Task completed")
      .length,
    1
  );
  assert.equal(
    withSubjectPrefix(matching(messagesTo(manager.email), title), "New comment")
      .length,
    1
  );
  assert.equal(
    withSubjectPrefix(matching(messagesTo(statusUser.email), title), "Status changed")
      .length +
      withSubjectPrefix(matching(messagesTo(statusUser.email), title), "New comment")
        .length,
    0,
    "the acting employee is never emailed about their own actions"
  );
});

test("meeting creation and update emails reach the participants with the /meetings link", async () => {
  const title = unique("Weekly sync");

  const created = await api.post("/api/meetings", {
    token: managerToken,
    body: {
      title,
      date: inDays(1),
      time: "10:00",
      agenda: "Sprint coordination",
      participants: [String(meetA._id), String(meetB._id)],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const meetingId = created.body.data._id;

  for (const participant of [meetA, meetB]) {
    await waitFor(
      () =>
        withSubjectPrefix(
          matching(messagesTo(participant.email), title),
          "Meeting scheduled"
        ).length >= 1,
      `the meeting email for ${participant.name}`
    );
  }

  await settle();

  for (const participant of [meetA, meetB]) {
    assert.equal(
      withSubjectPrefix(
        matching(messagesTo(participant.email), title),
        "Meeting scheduled"
      ).length,
      1
    );
  }

  const sample = matching(messagesTo(meetA.email), title)[0];
  assert.ok(
    htmlOf(sample).includes("https://volta.example/meetings"),
    "meeting emails link to the real /meetings route"
  );
  assert.equal(
    matching(messagesTo(manager.email), title).length,
    0,
    "the scheduling manager is not emailed about their own meeting"
  );

  const updated = await api.put(`/api/meetings/${meetingId}`, {
    token: managerToken,
    body: { time: "11:30" },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));

  for (const participant of [meetA, meetB]) {
    await waitFor(
      () =>
        withSubjectPrefix(
          matching(messagesTo(participant.email), title),
          "Meeting updated"
        ).length >= 1,
      `the meeting update email for ${participant.name}`
    );
  }

  await settle();

  for (const participant of [meetA, meetB]) {
    assert.equal(
      withSubjectPrefix(
        matching(messagesTo(participant.email), title),
        "Meeting updated"
      ).length,
      1,
      "the update is emailed exactly once"
    );
  }
});

test("inactive recipients and unusable addresses are skipped, never emailed", async () => {
  const meetingTitle = unique("Quiet meeting");
  const taskTitle = unique("Bad address task");

  // Existing backend rule: participants only need to be employees
  const meeting = await api.post("/api/meetings", {
    token: managerToken,
    body: {
      title: meetingTitle,
      date: inDays(3),
      time: "09:00",
      participants: [String(inactiveUser._id)],
    },
  });
  assert.equal(meeting.status, 201, JSON.stringify(meeting.body));

  // Existing backend rule: assignees only need to exist and be active
  const task = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title: taskTitle,
      assignees: [String(invalidEmailUser._id)],
      dueDate: inDays(10),
    },
  });
  assert.equal(task.status, 201, JSON.stringify(task.body));

  const meetingRow = await waitFor(
    async () =>
      await models.Notification.findOne({
        user: inactiveUser._id,
        type: "meeting_created",
      }),
    "the inactive participant's in-app notification"
  );
  const taskRow = await waitFor(
    async () =>
      await models.Notification.findOne({
        user: invalidEmailUser._id,
        type: "task_assigned",
      }),
    "the invalid-address user's in-app notification"
  );

  await waitFor(
    async () => {
      const freshMeeting = await models.Notification.findById(meetingRow._id);
      const freshTask = await models.Notification.findById(taskRow._id);
      return (
        freshMeeting.emailStatus === "skipped" && freshTask.emailStatus === "skipped"
      );
    },
    "both rows to be marked skipped"
  );

  await settle();

  assert.equal(
    messagesTo(inactiveUser.email).filter((m) => m.data.includes(meetingTitle))
      .length,
    0,
    "no email for an inactive recipient"
  );
  assert.equal(
    messagesTo(invalidEmailUser.email).length,
    0,
    "no email to an unusable address"
  );
});

test("user-controlled content is escaped and subjects cannot be injected", async () => {
  // Unit checks on the template helpers
  const { escapeHtml, sanitizeSubject, buildNotificationEmail } = require(
    "../src/utils/notificationEmail"
  );

  assert.equal(escapeHtml(`<b>&"'`), "&lt;b&gt;&amp;&quot;&#39;");
  assert.equal(
    sanitizeSubject("First line\r\nBcc: victim@example.com"),
    "First line Bcc: victim@example.com"
  );
  assert.ok(sanitizeSubject("x".repeat(400)).length <= 120);

  const probe = buildNotificationEmail(
    { type: "task_assigned", message: "Hello\r\nBcc: evil@example.com" },
    { name: "Ada", email: "ada@example.com" },
    null
  );
  assert.ok(!/[\r\n]/.test(probe.subject), "subject stays on a single line");

  // End to end: a hostile task title must never reach the HTML unescaped
  const title = `Evil <script>alert("x")</script> ${Date.now().toString(36)}`;
  const res = await api.post("/api/tasks", {
    token: managerToken,
    body: {
      title,
      assignees: [String(escapeUser._id)],
      dueDate: inDays(10),
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  await waitFor(
    () => matching(messagesTo(escapeUser.email), title).length >= 1,
    "the escaping probe email"
  );
  const html = htmlOf(matching(messagesTo(escapeUser.email), title)[0]);

  assert.ok(html.includes("&lt;script&gt;"), "angle brackets are escaped");
  assert.ok(
    !html.includes("<script>alert"),
    "no raw script tag may appear in the HTML part"
  );
  assert.ok(html.includes("alert(&quot;x&quot;)"), "quotes are escaped");
});

test("concurrent delivery attempts send exactly one email", async () => {
  const { dispatchNotificationEmail } = require(
    "../src/utils/notificationEmail"
  );

  const probe = unique("Concurrency probe");
  const row = await models.Notification.create({
    user: concurrentUser._id,
    type: "task_assigned",
    message: probe,
    dedupeKey: `probe:${Date.now()}`,
    emailStatus: "pending",
    emailAttempts: 0,
  });

  // Three simultaneous claims of the same row: only one may win
  await Promise.all([
    dispatchNotificationEmail(row._id),
    dispatchNotificationEmail(row._id),
    dispatchNotificationEmail(row._id),
  ]);

  await waitFor(
    () => matching(messagesTo(concurrentUser.email), probe).length >= 1,
    "the probe email"
  );
  await settle();

  assert.equal(
    matching(messagesTo(concurrentUser.email), probe).length,
    1,
    "exactly one email despite concurrent attempts"
  );

  const fresh = await models.Notification.findById(row._id);
  assert.equal(fresh.emailStatus, "sent");
  assert.equal(fresh.emailAttempts, 1, "only one claim may ever be counted");
});

test("SMTP failure never breaks the API or the in-app notification", async () => {
  // A second server whose SMTP port refuses connections
  const brokenServer = await startServer({
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1",
    SMTP_USER: "volta-test-user",
    SMTP_PASS: "volta-test-pass",
    SMTP_FROM: "volta@notifications.test",
    FRONTEND_BASE_URL: "https://volta.example",
    EMAIL_ENABLED: "true",
  });

  try {
    const brokenApi = makeApi(brokenServer.baseUrl);
    const title = unique("Blackholed SMTP task");

    const res = await brokenApi.post("/api/tasks", {
      token: managerToken,
      body: {
        title,
        assignees: [String(smtpFailUser._id)],
        dueDate: inDays(10),
      },
    });
    assert.equal(
      res.status,
      201,
      `task creation must succeed even when SMTP is down: ${JSON.stringify(res.body)}`
    );

    const row = await waitFor(
      async () =>
        await models.Notification.findOne({
          user: smtpFailUser._id,
          type: "task_assigned",
          message: { $regex: title },
        }),
      "the in-app notification created while SMTP was down"
    );

    const failedRow = await waitFor(
      async () => {
        const fresh = await models.Notification.findById(row._id);
        return fresh && fresh.emailStatus === "failed" ? fresh : null;
      },
      "the row to be recorded as a failed email"
    );

    assert.equal(failedRow.emailAttempts, 1);
    assert.ok(
      failedRow.emailLastError && failedRow.emailLastError.length > 0,
      "the failure is recorded for the bounded retry"
    );
    assert.ok(!failedRow.emailSentAt, "a failed email is never marked as sent");

    // The in-app API is completely unaffected
    const failToken = await login(brokenApi, smtpFailUser.email);
    const list = await brokenApi.get("/api/notifications", { token: failToken });
    assert.equal(list.status, 200);
    assert.ok(list.body.unreadCount >= 1, "the in-app notification is readable");

    const serverOutput = brokenServer.output();
    assert.ok(
      serverOutput.includes("Notification email failed:"),
      "the failure is logged server-side"
    );
    assert.ok(
      !serverOutput.includes("volta-test-pass"),
      "credentials must never appear in logs"
    );
  } finally {
    await brokenServer.stop();
  }
});
