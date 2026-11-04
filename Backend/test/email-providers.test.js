// Email provider selection (EMAIL_PROVIDER=smtp | resend | gmail) and
// delivery.
//
// Everything is mocked: nodemailer's transport factory is replaced before
// it is ever used, and global fetch is replaced for Resend and the Gmail
// API - so no real email and no network traffic can happen from this file.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const nodemailer = require("nodemailer");
const emailService = require("../src/utils/emailService");

const ENV_KEYS = [
  "EMAIL_ENABLED",
  "EMAIL_PROVIDER",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
];

// Observed mock activity
const smtpCalls = [];
const fetchCalls = [];
const queuedResponses = [];
let transporterCreations = 0;

const originalCreateTransport = nodemailer.createTransport;
const originalFetch = global.fetch;
let savedEnv;

// Replaces every relevant variable so each test starts from a known state.
const setEnv = (values) => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  Object.assign(process.env, values);
};

const useSmtpConfig = () =>
  setEnv({
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-pass",
    SMTP_FROM: "smtp@example.com",
  });

const useResendConfig = () =>
  setEnv({
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_secret_key_123",
    EMAIL_FROM: "Volta <notify@example.com>",
  });

const queueResendResponse = (response) => queuedResponses.push(response);

const useGmailConfig = () => {
  setEnv({
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "gmail",
    EMAIL_FROM: "doreply.volta@gmail.com",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GOOGLE_REFRESH_TOKEN: "test-refresh-token",
  });

  // Start each gmail test with a cold token cache so the number of
  // token-endpoint calls is deterministic.
  emailService.clearGmailAccessToken();
};

// Queues the responses for one gmail send: the token exchange first,
// then the message send.
const queueGmailSendResponses = (
  sendResponse = { ok: true, status: 200, json: { id: "gmail-msg-1" } }
) => {
  queueResendResponse({
    ok: true,
    status: 200,
    json: { access_token: "ya29.test-access-token", expires_in: 3600, token_type: "Bearer" },
  });
  queueResendResponse(sendResponse);
};

const message = (overrides) => ({
  to: "recipient@example.com",
  subject: "Task assigned: Prepare report",
  text: "Plain body",
  html: "<p>Html body</p>",
  ...overrides,
});

// Captures console.log / console.error while fn runs, so the tests can
// assert that healthy paths are silent and that error messages are safe.
const captureConsole = async (fn) => {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return { logs, errors };
};

before(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  // Mock nodemailer: record calls instead of opening any socket.
  nodemailer.createTransport = (options) => {
    transporterCreations += 1;

    return {
      options,
      verify: async () => true,
      sendMail: async (mail) => {
        smtpCalls.push(mail);
        return { messageId: `smtp-${smtpCalls.length}` };
      },
    };
  };

  // Mock fetch: record the request and replay the queued canned response.
  global.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });

    const next = queuedResponses.shift();

    if (!next) {
      throw new Error("test did not queue a fetch response");
    }

    if (next.networkError) {
      throw new Error(next.networkError);
    }

    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json,
    };
  };

  useSmtpConfig();
});

after(() => {
  nodemailer.createTransport = originalCreateTransport;
  global.fetch = originalFetch;

  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

test("without EMAIL_PROVIDER the existing SMTP transport is used, silently", async () => {
  useSmtpConfig();
  delete process.env.EMAIL_PROVIDER;

  const beforeSmt = smtpCalls.length;
  const beforeFetch = fetchCalls.length;

  assert.equal(emailService.emailProvider(), "smtp", "defaults to smtp");
  assert.equal(emailService.isEmailEnabled(), true);

  const { logs, errors } = await captureConsole(async () => {
    const result = await emailService.sendEmail(message());
    assert.ok(
      String(result.messageId).startsWith("smtp-"),
      "returns the transport's result"
    );
  });

  assert.equal(smtpCalls.length, beforeSmt + 1, "sendMail was called once");
  assert.equal(fetchCalls.length, beforeFetch, "fetch was never called");
  assert.equal(smtpCalls[beforeSmt].from, "smtp@example.com");
  assert.equal(smtpCalls[beforeSmt].to, "recipient@example.com");
  assert.equal(logs.length, 0, "a successful send prints nothing");
  assert.equal(errors.length, 0, "a successful send prints nothing");
});

test("EMAIL_PROVIDER=smtp selects the SMTP transport and never fetch", async () => {
  useSmtpConfig();

  const beforeSmt = smtpCalls.length;
  const beforeFetch = fetchCalls.length;
  const beforeTransporters = transporterCreations;

  await emailService.sendEmail(message());

  assert.equal(smtpCalls.length, beforeSmt + 1);
  assert.equal(fetchCalls.length, beforeFetch, "no HTTPS call for smtp");
  assert.ok(
    transporterCreations <= beforeTransporters + 1,
    "at most one transporter exists for the whole process"
  );
});

test("successful SMTP startup verification prints nothing", async () => {
  useSmtpConfig();

  const { logs, errors } = await captureConsole(async () => {
    const ok = await emailService.verifyEmailConnection();
    assert.equal(ok, true);
  });

  assert.equal(logs.length, 0, "'Gmail SMTP connection successful' is gone");
  assert.equal(errors.length, 0);
});

test("EMAIL_PROVIDER=resend sends through the HTTPS API and never touches SMTP", async () => {
  useResendConfig();
  queueResendResponse({ ok: true, status: 201, json: { id: "resend-id-1" } });

  const beforeSmt = smtpCalls.length;
  const beforeTransporters = transporterCreations;

  const result = await emailService.sendEmail(message());

  assert.equal(fetchCalls.length, 1, "one HTTPS call");
  assert.equal(smtpCalls.length, beforeSmt, "the SMTP transport was not used");
  assert.equal(
    transporterCreations,
    beforeTransporters,
    "no SMTP transporter is even built when Resend is selected"
  );

  const call = fetchCalls[0];
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.options.method, "POST");
  assert.equal(
    call.options.headers.Authorization,
    "Bearer re_secret_key_123"
  );

  const body = JSON.parse(call.options.body);
  assert.equal(body.from, "Volta <notify@example.com>");
  assert.deepEqual(body.to, ["recipient@example.com"]);
  assert.equal(body.subject, "Task assigned: Prepare report");
  assert.equal(body.text, "Plain body");
  assert.equal(body.html, "<p>Html body</p>");

  assert.equal(result.messageId, "resend-id-1");
  assert.equal(result.provider, "resend");
  assert.equal(emailService.isEmailEnabled(), true);
});

test("verifyEmailConnection is a no-op for Resend (no SMTP contact)", async () => {
  useResendConfig();

  const beforeTransporters = transporterCreations;

  const { logs, errors } = await captureConsole(async () => {
    const ok = await emailService.verifyEmailConnection();
    assert.equal(ok, true);
  });

  assert.equal(
    transporterCreations,
    beforeTransporters,
    "no transporter is built to verify"
  );
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 0);
});

test("a Resend API rejection is surfaced as a clear, credential-safe error", async () => {
  useResendConfig();
  queueResendResponse({
    ok: false,
    status: 401,
    json: { message: "API key is invalid" },
  });

  const beforeSmt = smtpCalls.length;

  await assert.rejects(
    () => emailService.sendEmail(message()),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /API key is invalid/);
      assert.ok(
        !error.message.includes("re_secret_key_123"),
        "the API key never appears in an error"
      );
      return true;
    }
  );

  assert.equal(smtpCalls.length, beforeSmt, "no silent SMTP fallback");
  assert.equal(emailService.isEmailEnabled(), true, "still configured");
});

test("Resend without RESEND_API_KEY fails loudly instead of pretending to send", async () => {
  setEnv({
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "resend",
    EMAIL_FROM: "Volta <notify@example.com>",
  });

  const beforeFetch = fetchCalls.length;
  const beforeSmt = smtpCalls.length;

  await assert.rejects(
    () => emailService.sendEmail(message()),
    /RESEND_API_KEY is not set/
  );

  assert.equal(fetchCalls.length, beforeFetch, "no API call was made");
  assert.equal(smtpCalls.length, beforeSmt, "no SMTP fallback");
});

test("Resend without EMAIL_FROM fails with a message naming the variable", async () => {
  setEnv({
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_secret_key_123",
  });

  const beforeFetch = fetchCalls.length;

  await assert.rejects(
    () => emailService.sendEmail(message()),
    /EMAIL_FROM is not set/
  );
  assert.equal(fetchCalls.length, beforeFetch, "no API call was made");
});

test("an unknown EMAIL_PROVIDER is rejected instead of silently falling back", async () => {
  setEnv({ EMAIL_ENABLED: "true", EMAIL_PROVIDER: "sendgrid" });

  const beforeFetch = fetchCalls.length;
  const beforeSmt = smtpCalls.length;

  assert.equal(emailService.isEmailEnabled(), false, "never enabled");

  await assert.rejects(
    () => emailService.sendEmail(message()),
    /Unknown EMAIL_PROVIDER/
  );
  assert.equal(fetchCalls.length, beforeFetch, "no fetch fallback");
  assert.equal(smtpCalls.length, beforeSmt, "no SMTP fallback");

  const { errors } = await captureConsole(() =>
    emailService.logEmailSetupProblem()
  );
  assert.equal(errors.length, 1, "one startup error is printed");
  assert.match(errors[0], /EMAIL_PROVIDER/);
  assert.match(errors[0], /expected smtp, resend or gmail/);
});

test("isEmailEnabled follows EMAIL_ENABLED and the selected provider", () => {
  useSmtpConfig();
  assert.equal(emailService.isEmailEnabled(), true);

  delete process.env.SMTP_PASS;
  assert.equal(emailService.isEmailEnabled(), false, "incomplete smtp config");
  useSmtpConfig();

  useResendConfig();
  assert.equal(emailService.isEmailEnabled(), true);

  setEnv({ EMAIL_ENABLED: "false", EMAIL_PROVIDER: "resend" });
  assert.equal(emailService.isEmailEnabled(), false, "explicit off wins");

  setEnv({ EMAIL_ENABLED: "true", EMAIL_PROVIDER: "resend" });
  assert.equal(
    emailService.isEmailEnabled(),
    false,
    "resend needs its own settings, not smtp's"
  );
});

test("setup logging is silent when healthy and names missing variables otherwise", async () => {
  // Healthy local SMTP setup: nothing on the terminal
  useSmtpConfig();
  let { logs, errors } = await captureConsole(() =>
    emailService.logEmailSetupProblem()
  );
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 0, "healthy smtp setup is silent");

  // Healthy Resend setup: nothing on the terminal
  useResendConfig();
  ({ logs, errors } = await captureConsole(() =>
    emailService.logEmailSetupProblem()
  ));
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 0, "healthy resend setup is silent");

  // Email explicitly disabled: intentional, not a problem
  setEnv({ EMAIL_ENABLED: "false", EMAIL_PROVIDER: "resend" });
  ({ errors } = await captureConsole(() => emailService.logEmailSetupProblem()));
  assert.equal(errors.length, 0, "an explicit off is silent");

  // Resend selected without credentials: one clear error, names only
  setEnv({ EMAIL_ENABLED: "true", EMAIL_PROVIDER: "resend" });
  ({ errors } = await captureConsole(() => emailService.logEmailSetupProblem()));
  assert.equal(errors.length, 1, "exactly one error line");
  assert.match(errors[0], /RESEND_API_KEY/);
  assert.match(errors[0], /EMAIL_FROM/);
  assert.ok(!errors[0].includes("Bearer"), "no credentials are printed");
});

// ---------- Gmail API (OAuth2) ----------

test("EMAIL_PROVIDER=gmail is configured by exactly its four OAuth settings", async () => {
  useGmailConfig();

  assert.equal(emailService.emailProvider(), "gmail");
  assert.equal(emailService.isEmailEnabled(), true);

  // Healthy setup: nothing on the terminal
  let { logs, errors } = await captureConsole(() =>
    emailService.logEmailSetupProblem()
  );
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 0, "healthy gmail setup is silent");

  // Each missing variable disables email and is named (names only)
  delete process.env.GOOGLE_REFRESH_TOKEN;
  assert.equal(emailService.isEmailEnabled(), false, "missing refresh token");

  ({ errors } = await captureConsole(() => emailService.logEmailSetupProblem()));
  assert.equal(errors.length, 1, "exactly one error line");
  assert.match(errors[0], /GOOGLE_REFRESH_TOKEN/);
  assert.ok(
    !errors[0].includes("test-client-secret"),
    "no credential values are printed"
  );
});

test("buildGmailRawMessage builds a valid multipart RFC 2822 message", () => {
  const raw = emailService.buildGmailRawMessage({
    from: "doreply.volta@gmail.com",
    to: "recipient@example.com",
    subject: "Task assigned: Prepare report",
    text: "Plain body",
    html: "<p>Html body</p>",
  });

  const decoded = Buffer.from(raw, "base64url").toString("utf8");

  assert.ok(decoded.includes("From: doreply.volta@gmail.com"));
  assert.ok(decoded.includes("To: recipient@example.com"));
  assert.ok(decoded.includes("Subject: Task assigned: Prepare report"));
  assert.ok(decoded.includes("MIME-Version: 1.0"));
  assert.ok(decoded.includes("multipart/alternative"));
  assert.ok(decoded.includes("Content-Transfer-Encoding: base64"));

  // Both parts decode back to the original content
  assert.ok(
    decoded.includes(Buffer.from("Plain body", "utf8").toString("base64"))
  );
  assert.ok(
    decoded.includes(Buffer.from("<p>Html body</p>", "utf8").toString("base64"))
  );

  // RFC-compliant CRLF line endings only
  assert.ok(!/[^\r]\n/.test(decoded), "every LF is part of a CRLF");
});

test("buildGmailRawMessage encodes non-ASCII subjects and handles a single part", () => {
  const unicode = emailService.buildGmailRawMessage({
    from: "a@example.com",
    to: "b@example.com",
    subject: "Ünïcode ✔ subject",
    text: "hi",
  });
  const decoded = Buffer.from(unicode, "base64url").toString("utf8");
  const match = decoded.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);

  assert.ok(match, "non-ASCII subject is RFC 2047 encoded");
  assert.equal(
    Buffer.from(match[1], "base64").toString("utf8"),
    "Ünïcode ✔ subject"
  );

  const plainOnly = emailService.buildGmailRawMessage({
    from: "a@example.com",
    to: "b@example.com",
    subject: "Plain",
    text: "only text",
  });
  const plainDecoded = Buffer.from(plainOnly, "base64url").toString("utf8");
  assert.ok(plainDecoded.includes("Content-Type: text/plain"));
  assert.ok(!plainDecoded.includes("multipart"), "single part when only text");
});

test("EMAIL_PROVIDER=gmail sends through the Gmail API and never touches SMTP", async () => {
  useGmailConfig();
  queueGmailSendResponses();

  const beforeFetch = fetchCalls.length;
  const beforeSmt = smtpCalls.length;
  const beforeTransporters = transporterCreations;

  const { logs, errors } = await captureConsole(async () => {
    const result = await emailService.sendEmail(message());
    assert.equal(result.messageId, "gmail-msg-1");
    assert.equal(result.provider, "gmail");
  });

  assert.equal(fetchCalls.length, beforeFetch + 2, "token exchange + send");
  assert.equal(smtpCalls.length, beforeSmt, "the SMTP transport was not used");
  assert.equal(
    transporterCreations,
    beforeTransporters,
    "no SMTP transporter is even built for gmail"
  );
  assert.equal(logs.length, 0, "a successful send prints nothing");
  assert.equal(errors.length, 0, "a successful send prints nothing");

  // 1) the OAuth token exchange
  const tokenCall = fetchCalls[beforeFetch];
  assert.equal(tokenCall.url, "https://oauth2.googleapis.com/token");
  assert.equal(tokenCall.options.method, "POST");
  assert.match(String(tokenCall.options.body), /grant_type=refresh_token/);
  assert.match(String(tokenCall.options.body), /test-client-id/);
  assert.match(String(tokenCall.options.body), /test-refresh-token/);

  // 2) the message send, authenticated with the access token
  const sendCall = fetchCalls[beforeFetch + 1];
  assert.equal(
    sendCall.url,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
  );
  assert.equal(
    sendCall.options.headers.Authorization,
    "Bearer ya29.test-access-token"
  );

  const raw = JSON.parse(sendCall.options.body).raw;
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert.ok(decoded.includes("To: recipient@example.com"));
  assert.ok(
    decoded.includes(Buffer.from("Plain body", "utf8").toString("base64"))
  );
});

test("the Gmail access token is cached across sends", async () => {
  useGmailConfig();
  queueGmailSendResponses();
  queueResendResponse({ ok: true, status: 200, json: { id: "gmail-msg-2" } });

  const beforeFetch = fetchCalls.length;

  await emailService.sendEmail(message());
  await emailService.sendEmail(message());

  assert.equal(
    fetchCalls.length,
    beforeFetch + 3,
    "one token exchange for two sends"
  );
  assert.equal(fetchCalls[beforeFetch].url, "https://oauth2.googleapis.com/token");
  assert.match(fetchCalls[beforeFetch + 1].url, /\/messages\/send$/);
  assert.match(fetchCalls[beforeFetch + 2].url, /\/messages\/send$/);
});

test("a failed Gmail token exchange is a credential-safe error and sends nothing", async () => {
  useGmailConfig();
  queueResendResponse({
    ok: false,
    status: 400,
    json: {
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    },
  });

  const beforeFetch = fetchCalls.length;
  const beforeSmt = smtpCalls.length;

  await assert.rejects(
    () => emailService.sendEmail(message()),
    (error) => {
      assert.match(error.message, /Gmail OAuth token request failed/);
      assert.match(error.message, /invalid_grant/);
      assert.ok(!error.message.includes("test-refresh-token"));
      assert.ok(!error.message.includes("test-client-secret"));
      return true;
    }
  );

  assert.equal(fetchCalls.length, beforeFetch + 1, "only the token call");
  assert.equal(smtpCalls.length, beforeSmt, "no SMTP fallback");
});

test("a Gmail API rejection is surfaced as a clear, credential-safe error", async () => {
  useGmailConfig();
  queueGmailSendResponses({
    ok: false,
    status: 401,
    json: {
      error: {
        code: 401,
        message: "Request had invalid authentication credentials.",
      },
    },
  });

  const beforeSmt = smtpCalls.length;

  await assert.rejects(
    () => emailService.sendEmail(message()),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /invalid authentication credentials/);
      assert.ok(
        !error.message.includes("ya29.test-access-token"),
        "the access token never appears in an error"
      );
      return true;
    }
  );

  assert.equal(smtpCalls.length, beforeSmt, "no silent SMTP fallback");
});

test("gmail without EMAIL_FROM fails with a message naming the variable", async () => {
  setEnv({
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "gmail",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GOOGLE_REFRESH_TOKEN: "test-refresh-token",
  });
  emailService.clearGmailAccessToken();

  const beforeFetch = fetchCalls.length;

  await assert.rejects(
    () => emailService.sendEmail(message()),
    /EMAIL_PROVIDER=gmail but these are missing or empty: EMAIL_FROM/
  );
  assert.equal(fetchCalls.length, beforeFetch, "no token request was made");
});

test("verifyEmailConnection for gmail: silent success, credential-safe failure", async () => {
  // Success path: the OAuth exchange runs, nothing is printed
  useGmailConfig();
  queueResendResponse({
    ok: true,
    status: 200,
    json: { access_token: "ya29.verify-token", expires_in: 3600 },
  });

  const beforeTransporters = transporterCreations;
  const { logs, errors } = await captureConsole(async () => {
    const ok = await emailService.verifyEmailConnection();
    assert.equal(ok, true);
  });

  assert.equal(transporterCreations, beforeTransporters, "no SMTP involvement");
  assert.equal(logs.length, 0);
  assert.equal(errors.length, 0);

  // Failure path: one clear line, no credential values
  useGmailConfig();
  queueResendResponse({ ok: false, status: 400, json: { error: "invalid_grant" } });

  const failure = await captureConsole(async () => {
    const ok = await emailService.verifyEmailConnection();
    assert.equal(ok, false);
  });

  assert.equal(failure.errors.length, 1);
  assert.match(failure.errors[0], /Gmail OAuth verification failed/);
  assert.match(failure.errors[0], /invalid_grant/);
  assert.ok(!failure.errors[0].includes("test-refresh-token"));
  assert.ok(!failure.errors[0].includes("ya29"), "no token values logged");
});
