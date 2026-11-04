// Multiple manager accounts, post-creation user editing and role changes.
// Covers: creating several managers, editing name/email/department/role,
// promoting/demoting a user, and who is allowed to do any of it.
// Runs against the dedicated isolated test database only.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const {
  startServer,
  connectTestDb,
  resetTestDb,
  disconnectTestDb,
  makeApi,
  createUser,
  login,
  inDays,
  PASSWORD,
  forgeToken,
  models,
} = require("./helpers");

// Meeting is not exported by the shared helpers; required directly so the
// deletion test can assert on meeting participants.
const Meeting = require("../src/models/Meeting");

let server;
let api;
let manager; // acting manager
let employee; // promoted and demoted during the run
let untouched; // must keep its role no matter what employees try

const unique = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

before(async () => {
  server = await startServer();
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  manager = await createUser({ name: "UM Manager", role: "manager" });
  employee = await createUser({ name: "UM Employee" });
  untouched = await createUser({ name: "UM Untouched" });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

const managerToken = () =>
  forgeToken({ userId: manager._id.toString() }, { expiresIn: "1h" });

const employeeToken = () =>
  forgeToken({ userId: employee._id.toString() }, { expiresIn: "1h" });

test("a manager can create several additional manager accounts", async () => {
  const created = [];

  for (const name of ["UM Manager Two", "UM Manager Three"]) {
    const email = `mgr-${unique()}@volta.test`;

    const res = await api.post("/api/users", {
      token: managerToken(),
      body: {
        name,
        email,
        password: PASSWORD,
        role: "manager",
        department: "Operations",
        designation: "Team Lead",
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.role, "manager");
    created.push(email);
  }

  // Every new manager really logs in and reaches manager-only endpoints
  for (const email of created) {
    const token = await login(api, email);

    const dash = await api.get("/api/dashboard/manager", { token });
    assert.equal(dash.status, 200, `manager dashboard for ${email}`);

    const users = await api.get("/api/users", { token });
    assert.equal(users.status, 200, `user list for ${email}`);
  }

  const managers = await api.get("/api/users?role=manager", {
    token: managerToken(),
  });
  assert.equal(managers.status, 200);
  assert.ok(
    managers.body.data.length >= 3,
    `expected at least 3 managers, got ${managers.body.data.length}`
  );
});

test("the role defaults to employee and invalid roles are rejected", async () => {
  const body = (extra = {}) => ({
    name: `Role Check ${unique()}`,
    email: `role-${unique()}@volta.test`,
    password: PASSWORD,
    ...extra,
  });

  // No role field -> the old employee-creation behaviour is unchanged
  const created = await api.post("/api/users", {
    token: managerToken(),
    body: body(),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.role, "employee");

  // Anything that is not "manager" or "employee" answers 400, never 500
  const invalidRoles = ["admin", "superuser", "", null, 7, true, ["manager"]];

  for (const role of invalidRoles) {
    const res = await api.post("/api/users", {
      token: managerToken(),
      body: body({ role }),
    });

    assert.equal(
      res.status,
      400,
      `role ${JSON.stringify(role)} should be 400, got ${res.status}`
    );
  }
});

test("a manager can edit a user's details after creation", async () => {
  const target = await createUser({ name: "Edit Target" });
  const id = target._id.toString();
  const newEmail = `edited-${unique()}@volta.test`;

  const res = await api.put(`/api/users/${id}`, {
    token: managerToken(),
    body: {
      name: "Edited Name",
      email: newEmail,
      department: "Finance",
      designation: "Analyst",
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, "User updated successfully");
  assert.equal(res.body.data.name, "Edited Name");
  assert.equal(res.body.data.email, newEmail);
  assert.equal(res.body.data.department, "Finance");
  assert.equal(res.body.data.designation, "Analyst");

  // Fields that were not sent stay untouched
  assert.equal(res.body.data.role, "employee");
  assert.equal(res.body.data.isActive, true);

  const stored = await models.User.findById(target._id);
  assert.equal(stored.name, "Edited Name");
  assert.equal(stored.email, newEmail);
  assert.equal(stored.password, target.password, "password must not change");

  // A duplicate login email answers 409 (not a 500 from the unique index)
  const duplicate = await api.put(`/api/users/${id}`, {
    token: managerToken(),
    body: { email: manager.email },
  });
  assert.equal(duplicate.status, 409);

  const stillOwn = await models.User.findById(target._id);
  assert.equal(stillOwn.email, newEmail, "rejected email must not be saved");
  assert.equal(stillOwn.role, "employee");
});

test("legacy free-text department and designation values are still accepted", async () => {
  // Accounts created before the dropdown lists existed hold free-text
  // values (or none at all). The API must keep storing and returning
  // them unchanged, so old users are never rewritten or rejected.
  const legacy = await createUser({ name: "Legacy User" });
  const legacyDepartment = `Legacy Dept ${unique()}`;

  const res = await api.put(`/api/users/${legacy._id}`, {
    token: managerToken(),
    body: { department: legacyDepartment, designation: "Interim Lead" },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.department, legacyDepartment);
  assert.equal(res.body.data.designation, "Interim Lead");

  // The department filter still matches a stored free-text value
  const filtered = await api.get(
    `/api/users?department=${encodeURIComponent(legacyDepartment)}`,
    { token: managerToken() }
  );
  assert.equal(filtered.status, 200);
  assert.ok(
    filtered.body.data.some((u) => u._id.toString() === legacy._id.toString()),
    "the stored free-text department should still be filterable"
  );

  // Sending an empty value is allowed and stays empty (an untouched
  // field is simply not part of the body and remains as it was)
  const cleared = await api.put(`/api/users/${legacy._id}`, {
    token: managerToken(),
    body: { department: "" },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.department, "");

  const untouched = await api.put(`/api/users/${legacy._id}`, {
    token: managerToken(),
    body: { name: "Legacy User Renamed" },
  });
  assert.equal(untouched.status, 200);
  assert.equal(
    untouched.body.data.designation,
    "Interim Lead",
    "omitted fields must keep their stored value"
  );
});

test("a role change applies immediately to the affected user's session", async () => {
  // The same token is used before and after each change: JWTs carry only
  // { userId } and the backend reloads the user (and its role) per request.
  const token = employeeToken();

  assert.equal((await api.get("/api/dashboard/manager", { token })).status, 403);
  assert.equal((await api.get("/api/users", { token })).status, 403);
  assert.equal((await api.get("/api/dashboard/employee", { token })).status, 200);

  const promote = await api.put(`/api/users/${employee._id}`, {
    token: managerToken(),
    body: { role: "manager" },
  });
  assert.equal(promote.status, 200);
  assert.equal(promote.body.data.role, "manager");

  // Same token, very next request: manager access is granted
  assert.equal((await api.get("/api/dashboard/manager", { token })).status, 200);
  assert.equal((await api.get("/api/users", { token })).status, 200);

  const demote = await api.put(`/api/users/${employee._id}`, {
    token: managerToken(),
    body: { role: "employee" },
  });
  assert.equal(demote.status, 200);
  assert.equal(demote.body.data.role, "employee");

  // ...and manager access is taken away again
  assert.equal((await api.get("/api/dashboard/manager", { token })).status, 403);
  assert.equal((await api.get("/api/users", { token })).status, 403);
  assert.equal((await api.get("/api/dashboard/employee", { token })).status, 200);

  const stored = await models.User.findById(employee._id);
  assert.equal(stored.role, "employee");
});

test("a manager cannot change their own role", async () => {
  const res = await api.put(`/api/users/${manager._id}`, {
    token: managerToken(),
    body: { role: "employee" },
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.message, "You cannot change your own role");

  const stored = await models.User.findById(manager._id);
  assert.equal(stored.role, "manager", "self-demotion must not be saved");

  // Re-sending the unchanged role (what the edit form does when only the
  // name/email changed) is accepted as a no-op
  const noop = await api.put(`/api/users/${manager._id}`, {
    token: managerToken(),
    body: { role: "manager", department: "Management" },
  });
  assert.equal(noop.status, 200);
  assert.equal(noop.body.data.role, "manager");
  assert.equal(noop.body.data.department, "Management");
});

test("employees cannot create users or grant anyone manager access", async () => {
  const attempts = [
    [
      "post",
      "/api/users",
      {
        name: "Sneaky",
        email: `sneaky-${unique()}@volta.test`,
        password: PASSWORD,
        role: "manager",
      },
    ],
    ["put", `/api/users/${untouched._id}`, { role: "manager" }],
    ["put", `/api/users/${employee._id}`, { role: "manager" }],
    ["put", `/api/users/${manager._id}`, { role: "manager", name: "Mine now" }],
  ];

  for (const [method, path, body] of attempts) {
    const res = await api[method](path, { token: employeeToken(), body });
    assert.equal(
      res.status,
      403,
      `${method.toUpperCase()} ${path} should be 403 for an employee, got ${res.status}`
    );
  }

  // Nothing changed on any account
  assert.equal((await models.User.findById(untouched._id)).role, "employee");
  assert.equal((await models.User.findById(employee._id)).role, "employee");
  assert.equal((await models.User.findById(manager._id)).role, "manager");
});

test("anonymous role attempts are rejected with 401", async () => {
  const target = untouched._id.toString();

  const create = await api.post("/api/users", {
    body: {
      name: "Anon",
      email: `anon-${unique()}@volta.test`,
      password: PASSWORD,
      role: "manager",
    },
  });
  assert.equal(create.status, 401);

  const update = await api.put(`/api/users/${target}`, {
    body: { role: "manager" },
  });
  assert.equal(update.status, 401);

  assert.equal((await models.User.findById(target)).role, "employee");
});

// ---------- Employee deletion ----------

test("a manager can delete an employee and related records are handled safely", async () => {
  const target = await createUser({ name: "Del Target" });
  const colleague = await createUser({ name: "Del Colleague" });

  // Task where the employee is the ONLY assignee: assignedTo is required
  // by the schema, so it must be handed over instead of nulled out.
  const soleTask = await models.Task.create({
    title: "Sole assignee task",
    assignedTo: target._id,
    assignees: [target._id],
    progress: [{ user: target._id, status: "In Progress" }],
    createdBy: manager._id,
    dueDate: inDays(3),
  });

  // Task where the employee is only a secondary assignee: the primary
  // assignee and the task itself must not be affected.
  const sharedTask = await models.Task.create({
    title: "Shared task",
    assignedTo: colleague._id,
    assignees: [colleague._id, target._id],
    progress: [
      { user: colleague._id, status: "Pending" },
      { user: target._id, status: "Completed" },
    ],
    createdBy: manager._id,
    dueDate: inDays(5),
  });

  await models.Comment.create({
    task: sharedTask._id,
    user: target._id,
    message: "Comment by the employee who is about to be deleted",
  });

  // The employee's own inbox goes with the account...
  const ownNotification = await models.Notification.create({
    user: target._id,
    type: "task_assigned",
    message: "You were assigned a task",
    dedupeKey: `del-${target._id}-own`,
  });

  // ...but a notification that belongs to SOMEONE ELSE about shared work
  // must survive the deletion.
  const colleagueNotification = await models.Notification.create({
    user: colleague._id,
    type: "task_status_changed",
    message: "Status changed on a shared task",
    dedupeKey: `del-${target._id}-colleague`,
  });

  const meeting = await Meeting.create({
    title: "Del Meeting",
    date: new Date(Date.now() + 2 * 86400000),
    time: "10:00",
    participants: [target._id, colleague._id],
    createdBy: manager._id,
  });

  // Task history by the employee is KEPT (the UI renders a missing user
  // as "User"), so the audit trail must still exist afterwards.
  const historyEntry = await models.TaskHistory.create({
    task: sharedTask._id,
    action: "STATUS_CHANGED",
    performedBy: target._id,
    oldValue: "Pending",
    newValue: "Completed",
  });

  const res = await api.delete(`/api/users/${target._id}`, {
    token: managerToken(),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, "Employee deleted successfully");

  // Account is gone
  assert.equal(await models.User.findById(target._id), null);

  // Their own comments and notifications are gone too
  assert.equal(
    await models.Comment.countDocuments({ user: target._id }),
    0
  );
  assert.equal(await models.Notification.findById(ownNotification._id), null);
  assert.notEqual(
    await models.Notification.findById(colleagueNotification._id),
    null,
    "another user's notification must survive"
  );

  // Sole-assignee task: handed to the deleting manager, employee removed
  // from assignees and progress, task itself untouched otherwise.
  const soleAfter = await models.Task.findById(soleTask._id);
  assert.ok(soleAfter, "tasks are never deleted with the employee");
  assert.equal(soleAfter.assignedTo.toString(), manager._id.toString());
  assert.deepEqual(soleAfter.assignees, []);
  assert.equal(soleAfter.progress.length, 0);
  assert.equal(soleAfter.title, "Sole assignee task");

  // Shared task: primary assignee and task state untouched, employee
  // removed from the assignee list and from progress.
  const sharedAfter = await models.Task.findById(sharedTask._id);
  assert.equal(sharedAfter.assignedTo.toString(), colleague._id.toString());
  assert.deepEqual(
    sharedAfter.assignees.map((id) => id.toString()),
    [colleague._id.toString()]
  );
  assert.equal(sharedAfter.progress.length, 1);
  assert.equal(
    sharedAfter.progress[0].user.toString(),
    colleague._id.toString()
  );
  // Overall roll-up recomputed from the remaining entries (the deleted
  // "Completed" entry must not keep the task looking finished).
  assert.equal(sharedAfter.status, "Pending");

  // Meeting: employee removed, colleague still attending
  const meetingAfter = await Meeting.findById(meeting._id);
  assert.deepEqual(
    meetingAfter.participants.map((id) => id.toString()),
    [colleague._id.toString()]
  );

  // History entry survives (dangling reference is rendered as "User")
  assert.notEqual(await models.TaskHistory.findById(historyEntry._id), null);
});

test("employee deletion is refused for managers, self, bad ids and non-managers", async () => {
  // A manager account can never be deleted through this endpoint
  const managerTarget = await createUser({
    name: "Del Manager Target",
    role: "manager",
  });
  const byManager = await api.delete(`/api/users/${managerTarget._id}`, {
    token: managerToken(),
  });
  assert.equal(byManager.status, 400);
  assert.notEqual(await models.User.findById(managerTarget._id), null);

  // Nobody can delete their own account
  const self = await api.delete(`/api/users/${manager._id}`, {
    token: managerToken(),
  });
  assert.equal(self.status, 400);
  assert.equal(self.body.message, "You cannot delete your own account");
  assert.notEqual(await models.User.findById(manager._id), null);

  // Invalid and nonexistent ids answer 400 / 404, never 500
  const invalid = await api.delete("/api/users/not-an-id", {
    token: managerToken(),
  });
  assert.equal(invalid.status, 400);

  const missing = await api.delete(
    "/api/users/000000000000000000000000",
    { token: managerToken() }
  );
  assert.equal(missing.status, 404);

  // Employees and anonymous callers are stopped by the middleware itself
  const victim = await createUser({ name: "Del Victim" });
  const byEmployee = await api.delete(`/api/users/${victim._id}`, {
    token: employeeToken(),
  });
  assert.equal(byEmployee.status, 403);
  assert.notEqual(await models.User.findById(victim._id), null);

  const byAnon = await api.delete(`/api/users/${victim._id}`);
  assert.equal(byAnon.status, 401);
  assert.notEqual(await models.User.findById(victim._id), null);
});

// ---------- Password changes from the Edit Employee form ----------
// Password management now lives in the same PUT used to edit details, so
// these tests cover both together (the separate reset-password endpoint
// no longer exists).

test("a manager can change a password while editing employee details", async () => {
  const target = await createUser({ name: "Edit Password Target" });
  const originalHash = target.password;
  const newPassword = `newpass-${unique()}`;

  const res = await api.put(`/api/users/${target._id}`, {
    token: managerToken(),
    body: {
      name: "Edited Name",
      email: target.email,
      department: "Operations",
      designation: "Associate",
      role: "employee",
      password: newPassword,
      confirmPassword: newPassword,
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, "User updated successfully");

  // Details and password are saved by the same request.
  assert.equal(res.body.data.name, "Edited Name");
  assert.equal(res.body.data.department, "Operations");
  assert.equal(
    res.body.data.password,
    undefined,
    "the response must never expose the password"
  );

  const stored = await models.User.findById(target._id);
  assert.equal(stored.name, "Edited Name");
  assert.notEqual(stored.password, originalHash, "the hash must change");
  assert.notEqual(stored.password, newPassword, "never store plaintext");
  assert.ok(
    await bcrypt.compare(newPassword, stored.password),
    "the stored hash must match the new password"
  );

  // The employee signs in with the new password...
  const token = await login(api, target.email, newPassword);
  const dash = await api.get("/api/dashboard/employee", { token });
  assert.equal(dash.status, 200);

  // ...and the old password no longer works.
  const oldPassword = await api.post("/api/auth/login", {
    body: { email: target.email, password: PASSWORD },
  });
  assert.equal(oldPassword.status, 401);
});

test("editing details without a password keeps the stored password", async () => {
  const target = await createUser({ name: "No Password Edit" });
  const originalHash = target.password;

  // The form always sends both password keys; blank means "no change".
  const res = await api.put(`/api/users/${target._id}`, {
    token: managerToken(),
    body: {
      name: "Renamed Only",
      email: target.email,
      department: "Finance",
      designation: "Associate",
      role: "employee",
      password: "",
      confirmPassword: "",
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, "Renamed Only");

  const stored = await models.User.findById(target._id);
  assert.equal(stored.password, originalHash, "the hash must be untouched");
  assert.equal(stored.name, "Renamed Only");

  // The existing password still logs in.
  const token = await login(api, target.email, PASSWORD);
  assert.ok(token);
});

test("edit-endpoint password changes are validated and manager-only", async () => {
  const target = await createUser({ name: "Edit Password Victim" });
  const originalHash = target.password;

  // Too short
  const short = await api.put(`/api/users/${target._id}`, {
    token: managerToken(),
    body: { password: "12345", confirmPassword: "12345" },
  });
  assert.equal(short.status, 400);
  assert.equal(short.body.message, "Password must be at least 6 characters");

  // Not text
  const notText = await api.put(`/api/users/${target._id}`, {
    token: managerToken(),
    body: { password: 12345678, confirmPassword: 12345678 },
  });
  assert.equal(notText.status, 400);

  // Mismatched confirmation is refused even if the password itself is fine
  const mismatch = await api.put(`/api/users/${target._id}`, {
    token: managerToken(),
    body: { password: "longenough1", confirmPassword: "longenough2" },
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.message, "Passwords do not match");

  // Invalid / unknown employee ids
  const invalid = await api.put("/api/users/not-an-id", {
    token: managerToken(),
    body: { password: "longenough1", confirmPassword: "longenough1" },
  });
  assert.equal(invalid.status, 400);

  const missing = await api.put("/api/users/000000000000000000000000", {
    token: managerToken(),
    body: { password: "longenough1", confirmPassword: "longenough1" },
  });
  assert.equal(missing.status, 404);

  // Employees cannot reach the endpoint at all (managerOnly middleware),
  // so an employee can never change their own or anyone else's password.
  const byEmployee = await api.put(`/api/users/${target._id}`, {
    token: employeeToken(),
    body: { password: "longenough1", confirmPassword: "longenough1" },
  });
  assert.equal(byEmployee.status, 403);

  const byAnon = await api.put(`/api/users/${target._id}`, {
    body: { password: "longenough1", confirmPassword: "longenough1" },
  });
  assert.equal(byAnon.status, 401);

  // Every refused attempt left the stored hash untouched.
  const stored = await models.User.findById(target._id);
  assert.equal(stored.password, originalHash);
  assert.ok(await bcrypt.compare(PASSWORD, stored.password));
});
