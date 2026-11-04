const nodemailer = require("nodemailer");
const crypto = require("crypto");

// Environment values are read as trimmed strings: values pasted into a
// hosting dashboard (Render and friends) often carry a stray space or
// trailing newline, and an untrimmed credential fails authentication with
// no clear indication of why.
const envSetting = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

// Settings the Gmail SMTP transport needs. SMTP_PORT is included because a
// missing port reaches nodemailer as NaN and fails at connection time with
// an unrelated-looking error.
const REQUIRED_SMTP_SETTINGS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
];

// Settings the Resend HTTPS API needs.
const REQUIRED_RESEND_SETTINGS = ["RESEND_API_KEY", "EMAIL_FROM"];

// Settings the Gmail API (OAuth2) needs. EMAIL_FROM is the verified
// sender address of the authenticated Google account.
const REQUIRED_GMAIL_SETTINGS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "EMAIL_FROM",
];

// Which transport sends mail, chosen ONLY by EMAIL_PROVIDER:
//   smtp   - the existing Gmail SMTP transport (default; local development)
//   resend - Resend HTTPS API (production on hosts that block outbound
//            SMTP, e.g. Render Free, which drops ports 25/465/587)
// Anything else counts as unconfigured - there is never a silent fallback
// from one provider to the other.
const emailProvider = () => {
  const raw = envSetting("EMAIL_PROVIDER");
  return raw ? raw.toLowerCase() : "smtp";
};

const requiredSettingsFor = (provider) => {
  if (provider === "resend") {
    return REQUIRED_RESEND_SETTINGS;
  }

  if (provider === "gmail") {
    return REQUIRED_GMAIL_SETTINGS;
  }

  return provider === "smtp" ? REQUIRED_SMTP_SETTINGS : [];
};

// The selected provider's settings must ALL be present - half-configured
// never counts as configured, and an UNKNOWN provider is never configured
// (an empty requirements list must not read as "nothing left to check").
const providerConfigured = () => {
  const required = requiredSettingsFor(emailProvider());

  if (required.length === 0) {
    return false;
  }

  return required.every((name) => Boolean(envSetting(name)));
};

// Outgoing email is on whenever the SELECTED provider's settings are
// available, and can be switched off without unsetting them by setting
// EMAIL_ENABLED=false. This is the single switch every caller
// (controllers, scheduler, tests) consults, so an environment without email
// config behaves exactly as before this feature: in-app notifications only.
const isEmailEnabled = () => {
  if (process.env.EMAIL_ENABLED === "false") {
    return false;
  }

  return providerConfigured();
};

// Reports ONLY misconfiguration, so a healthy setup prints nothing and the
// terminal stays clean. Called once at startup; never throws; prints
// variable NAMES only - never values or credentials.
const logEmailSetupProblem = () => {
  if (process.env.EMAIL_ENABLED === "false") {
    return; // switched off on purpose, not a problem
  }

  const provider = emailProvider();

  if (provider !== "smtp" && provider !== "resend" && provider !== "gmail") {
    console.error(
      `Email is off: unknown EMAIL_PROVIDER "${provider}" (expected smtp, resend or gmail). In-app notifications keep working.`
    );
    return;
  }

  const missing = requiredSettingsFor(provider).filter(
    (name) => !envSetting(name)
  );

  if (missing.length > 0) {
    console.error(
      `Email is off: EMAIL_PROVIDER=${provider} but these are missing or empty: ${missing.join(", ")}. ` +
        "In-app notifications keep working; no email is sent or reported as sent."
    );
  }
};

// One transporter for the whole process, built LAZILY from the SMTP_*
// environment variables and only when EMAIL_PROVIDER=smtp - when Resend is
// selected no SMTP object is ever created. Nothing else in the codebase may
// create a second one.
//
// The explicit timeouts matter in production: a host that silently drops
// outbound SMTP traffic (Render free web services block ports 25/465/587)
// would otherwise hold every attempt for minutes before reporting anything,
// stalling the serial send queue. Short timeouts turn that into a fast, clear
// failure that the scheduled retry job can see and record.
let transporter = null;

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  const configuredPort = Number(envSetting("SMTP_PORT"));

  transporter = nodemailer.createTransport({
    host: envSetting("SMTP_HOST"),
    port: Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : undefined,
    secure: configuredPort === 465,
    connectionTimeout: 10 * 1000,
    greetingTimeout: 10 * 1000,
    socketTimeout: 30 * 1000,

    auth: {
      user: envSetting("SMTP_USER"),
      pass: envSetting("SMTP_PASS"),
    },
  });

  return transporter;
};

// Error codes that mean "the connection itself never happened" - a dropped
// or refused outbound connection, as opposed to authentication (EAUTH) or
// message-level (5xx) rejections.
const BLOCKED_CONNECTION_CODES = [
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EPIPE",
  "ECONNECTION",
];

// nodemailer wraps low-level socket failures as ESOCKET/ECONNECTION and
// keeps the OS-level reason in the message ("connect ECONNREFUSED ...",
// "Connection timeout", "Greeting never received"), so both the code and
// the message are inspected. Authentication (EAUTH) and server-side 5xx
// rejections deliberately do not match: those are not transport blocks.
const isBlockedConnectionError = (error) => {
  const code = (error && error.code) || "";
  const message = String((error && error.message) || "");

  if (BLOCKED_CONNECTION_CODES.includes(code)) {
    return true;
  }

  return (
    BLOCKED_CONNECTION_CODES.some((name) => message.includes(name)) ||
    /connection timeout|greeting never received/i.test(message)
  );
};

// Checks the configured transport once at startup. Only the smtp provider
// performs a real handshake; with EMAIL_PROVIDER=resend no SMTP is involved
// at all, so nothing is contacted here. Success is silent (clean terminal);
// failures are always logged.
const verifyEmailConnection = async () => {
  // The Gmail provider verifies by performing the OAuth exchange itself:
  // a revoked refresh token or a wrong client secret is reported once at
  // startup instead of at the first notification. No email is sent here.
  if (emailProvider() === "gmail") {
    try {
      await getGmailAccessToken();
      return true;
    } catch (error) {
      console.error("Gmail OAuth verification failed:", error.message);
      return false;
    }
  }

  if (emailProvider() !== "smtp") {
    return true;
  }

  try {
    await getTransporter().verify();
    return true;
  } catch (error) {
    console.error("Gmail SMTP connection failed:", error.message);

    // A refused/dropped connection (rather than an auth or message error)
    // is the signature of a platform-level SMTP block. Logged as a plain
    // hint next to the real error; no configuration values are printed.
    if (isBlockedConnectionError(error)) {
      console.error(
        "Outbound SMTP appears blocked or unreachable on this host. " +
          "Render free web services drop traffic to ports 25, 465 and 587, " +
          "so Gmail SMTP cannot deliver from there without a paid instance " +
          "type or an HTTPS-based email provider."
      );
    }

    return false;
  }
};

// ---------- Resend (HTTPS API) ----------

const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15 * 1000;
const MAX_API_ERROR_LENGTH = 200;

// API failure text is server-side only and truncated; the key is never part
// of it and is never logged.
const safeApiMessage = (raw) =>
  String(raw === null || raw === undefined ? "" : raw)
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, MAX_API_ERROR_LENGTH);

// Sends one message through the Resend HTTPS API - never SMTP. Missing
// credentials and API rejections THROW with a clear, safe message, so the
// caller records a real failure: nothing is ever reported as sent when it
// was not.
const sendViaResend = async ({ to, subject, text, html }) => {
  const apiKey = envSetting("RESEND_API_KEY");
  const from = envSetting("EMAIL_FROM");

  if (!apiKey) {
    throw new Error("EMAIL_PROVIDER=resend but RESEND_API_KEY is not set");
  }

  if (!from) {
    throw new Error("EMAIL_PROVIDER=resend but EMAIL_FROM is not set");
  }

  let response;

  try {
    response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Resend request failed: ${safeApiMessage((error && error.message) || error)}`
    );
  }

  if (!response.ok) {
    let apiMessage = "";

    try {
      const payload = await response.json();
      apiMessage = safeApiMessage(payload && payload.message);
    } catch (parseError) {
      apiMessage = "";
    }

    throw new Error(
      `Resend API rejected the message (HTTP ${response.status})${
        apiMessage ? `: ${apiMessage}` : ""
      }`
    );
  }

  let messageId = "";

  try {
    const payload = await response.json();
    messageId = payload && payload.id ? String(payload.id) : "";
  } catch (parseError) {
    messageId = "";
  }

  // Same result shape as nodemailer, so existing callers (testEmail.js)
  // keep working with either provider.
  return { messageId, provider: "resend" };
};

// ---------- Gmail API (OAuth2) ----------

// The Gmail API needs no SMTP ports, so this provider works both in local
// development and on hosts that block outbound SMTP (Render Free). Access
// tokens are obtained from Google's token endpoint using the long-lived
// refresh token and cached in memory until shortly before they expire, so
// a refresh costs at most one HTTPS call per token lifetime. Tokens and
// credentials are never logged and never appear in error messages.
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_TIMEOUT_MS = 15 * 1000;
const GMAIL_TOKEN_SKEW_MS = 5 * 60 * 1000;

let gmailTokenCache = { key: null, accessToken: null, expiresAt: 0 };
let gmailTokenRequest = null;

// Drops the cached access token (exported for tests and credential
// rotation). The next send then performs a fresh exchange.
const clearGmailAccessToken = () => {
  gmailTokenCache = { key: null, accessToken: null, expiresAt: 0 };
};

// Extracts the human-readable reason from a Google error payload without
// ever touching credentials (string form or { error: { message } } form).
const googleErrorReason = (payload) => {
  const error = payload && payload.error;

  if (!error) {
    return "";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || "";
};

// Exchanges the refresh token for a short-lived access token. One
// request at a time: concurrent sends share the same in-flight exchange
// instead of each asking Google for their own token, and a failed
// exchange is never cached (the next send retries it).
const getGmailAccessToken = async () => {
  const clientId = envSetting("GOOGLE_CLIENT_ID");
  const clientSecret = envSetting("GOOGLE_CLIENT_SECRET");
  const refreshToken = envSetting("GOOGLE_REFRESH_TOKEN");
  const cacheKey = `${clientId}:${clientSecret}:${refreshToken}`;

  const cached = gmailTokenCache;

  if (
    cached.key === cacheKey &&
    cached.accessToken &&
    Date.now() < cached.expiresAt - GMAIL_TOKEN_SKEW_MS
  ) {
    return cached.accessToken;
  }

  if (gmailTokenRequest) {
    return gmailTokenRequest;
  }

  gmailTokenRequest = (async () => {
    let response;

    try {
      response = await fetch(GMAIL_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Gmail token request failed: ${safeApiMessage(
          (error && error.message) || error
        )}`
      );
    }

    let payload;

    try {
      payload = await response.json();
    } catch (parseError) {
      payload = {};
    }

    if (!response.ok || !payload.access_token) {
      const reason = googleErrorReason(payload) || `HTTP ${response.status}`;

      throw new Error(
        `Gmail OAuth token request failed: ${safeApiMessage(reason)}`
      );
    }

    const expiresIn =
      Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600;

    gmailTokenCache = {
      key: cacheKey,
      accessToken: payload.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return gmailTokenCache.accessToken;
  })().finally(() => {
    gmailTokenRequest = null;
  });

  return gmailTokenRequest;
};

// RFC 2047: subjects with non-ASCII characters must be encoded in the
// header; plain ASCII subjects stay readable.
const encodeGmailHeader = (value) =>
  /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

// Base64 body content with RFC-compliant 76-character line breaks.
const gmailBase64Body = (input) =>
  Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");

// Builds the complete RFC 2822 message (base64url, as the Gmail API
// expects) from the shared { from, to, subject, text, html } shape every
// notification email already uses. Text and HTML are both kept so clients
// that only show plain text still work; user-controlled content stays
// escaped by the existing template before it ever reaches this function.
const buildGmailRawMessage = ({ from, to, subject, text, html }) => {
  const boundary = `volta-${crypto.randomBytes(12).toString("hex")}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeGmailHeader(subject || "")}`,
    "MIME-Version: 1.0",
  ];

  const hasText = Boolean(text);
  const hasHtml = Boolean(html);

  let message;

  if (hasText && hasHtml) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    message = [
      ...headers,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      gmailBase64Body(text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      gmailBase64Body(html),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    const body = hasHtml ? html : text || "";

    headers.push(
      `Content-Type: ${
        hasHtml ? "text/html" : "text/plain"
      }; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      gmailBase64Body(body),
      ""
    );

    message = headers.join("\r\n");
  }

  return Buffer.from(message, "utf8").toString("base64url");
};

// Sends one message through the Gmail API - never SMTP, never Resend.
// Missing OAuth settings THROW with a clear message naming only the
// variable NAMES, so the caller records a real failure: nothing is ever
// reported as sent when it was not.
const sendViaGmail = async ({ to, subject, text, html }) => {
  const missing = REQUIRED_GMAIL_SETTINGS.filter((name) => !envSetting(name));

  if (missing.length > 0) {
    throw new Error(
      `EMAIL_PROVIDER=gmail but these are missing or empty: ${missing.join(", ")}`
    );
  }

  const accessToken = await getGmailAccessToken();

  let response;

  try {
    response = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: buildGmailRawMessage({
          from: envSetting("EMAIL_FROM"),
          to,
          subject,
          text,
          html,
        }),
      }),
      signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Gmail API request failed: ${safeApiMessage(
        (error && error.message) || error
      )}`
    );
  }

  let payload;

  try {
    payload = await response.json();
  } catch (parseError) {
    payload = {};
  }

  if (!response.ok) {
    const reason = googleErrorReason(payload);

    throw new Error(
      `Gmail API rejected the message (HTTP ${response.status})${
        reason ? `: ${safeApiMessage(reason)}` : ""
      }`
    );
  }

  // Same result shape as the other providers, so callers stay
  // provider-agnostic.
  return {
    messageId: payload && payload.id ? String(payload.id) : "",
    provider: "gmail",
  };
};

// Send email - the single entry point for every caller. The transport is
// chosen ONLY by EMAIL_PROVIDER; templates, recipients and callers stay
// provider-agnostic.
const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) {
    throw new Error("Recipient email is required");
  }

  const provider = emailProvider();

  if (provider === "gmail") {
    return sendViaGmail({ to, subject, text, html });
  }

  if (provider === "resend") {
    return sendViaResend({ to, subject, text, html });
  }

  if (provider !== "smtp") {
    throw new Error(
      `Unknown EMAIL_PROVIDER "${provider}" (expected smtp, resend or gmail)`
    );
  }

  return getTransporter().sendMail({
    from: envSetting("SMTP_FROM"),
    to,
    subject,
    text,
    html,
  });
};

module.exports = {
  sendEmail,
  verifyEmailConnection,
  isEmailEnabled,
  emailProvider,
  logEmailSetupProblem,
  buildGmailRawMessage,
  clearGmailAccessToken,
};
