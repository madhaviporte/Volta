// Login rate limiting: the limiter counts failed attempts only.
// This file spawns its own server with a deliberately tiny budget
// (LOGIN_RATE_LIMIT=3) to prove the 429 path without waiting out a window.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  startServer,
  connectTestDb,
  resetTestDb,
  disconnectTestDb,
  makeApi,
  createUser,
  PASSWORD,
} = require("./helpers");

let server;
let api;
let user;

before(async () => {
  server = await startServer({ LOGIN_RATE_LIMIT: "3" });
  api = makeApi(server.baseUrl);

  await connectTestDb();
  await resetTestDb();

  user = await createUser({ name: "RateLimit User" });
});

after(async () => {
  await server.stop();
  await disconnectTestDb();
});

test("successful logins do not consume the failed-attempt budget", async () => {
  for (let i = 0; i < 3; i++) {
    const ok = await api.post("/api/auth/login", {
      body: { email: user.email, password: PASSWORD },
    });
    assert.equal(ok.status, 200, `successful login #${i + 1} must not be rate limited`);
  }
});

test("repeated FAILED logins are answered with 429 once the budget is spent", async () => {
  const attempts = [];

  for (let i = 0; i < 5; i++) {
    const res = await api.post("/api/auth/login", {
      body: { email: user.email, password: `wrong-${i}` },
    });
    attempts.push(res.status);
  }

  // Budget is 3: the first three failures are 401, the rest are 429
  assert.deepEqual(attempts.slice(0, 3), [401, 401, 401]);
  assert.equal(attempts[3], 429, `fourth failed attempt should be 429, got ${attempts[3]}`);
  assert.equal(attempts[4], 429);

  const blocked = await api.post("/api/auth/login", {
    body: { email: user.email, password: `wrong-again` },
  });
  assert.equal(blocked.status, 429);
  assert.ok(
    blocked.body.message.toLowerCase().includes("too many"),
    "429 carries the friendly rate-limit message"
  );
});
