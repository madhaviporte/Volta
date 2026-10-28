// Multiple manager accounts, post-creation user editing and role changes.
// Covers: creating several managers, editing name/email/department/role,
// promoting/demoting a user, and who is allowed to do any of it.
// Runs against the dedicated isolated test database only.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  startServer,
  connectTestDb,
  resetTestDb,
  disconnectTestDb,
  makeApi,
  createUser,
  login,
  PASSWORD,
  forgeToken,
  models,
} = require("./helpers");

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
