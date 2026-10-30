
const nodemailer = require("nodemailer");

// SMTP settings are read as trimmed strings: values pasted into a hosting
// dashboard (Render and friends) often carry a stray space or trailing
// newline, and an untrimmed credential fails authentication with no clear
// indication of why.
const smtpSetting = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

// Every setting the transporter needs. SMTP_PORT is included because a
// missing port used to reach nodemailer as NaN and fail at connection time
// with an unrelated-looking error; it is now reported up front instead.
const REQUIRED_SMTP_SETTINGS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
];

// Outgoing email is on whenever the SMTP settings are available, and can be
// switched off without unsetting them by setting EMAIL_ENABLED=false. This is
// the single switch every caller (controllers, scheduler, tests) consults, so
// an environment without SMTP config behaves exactly as before this feature.
const isEmailEnabled = () => {
  if (process.env.EMAIL_ENABLED === "false") {
    return false;
  }

  return REQUIRED_SMTP_SETTINGS.every((name) => Boolean(smtpSetting(name)));
};

// One safe, human-readable line for the startup log: only variable NAMES and
// the non-secret host/port are ever printed - never credential values. This
// is what tells an operator, from production logs alone, whether the running
// process can send email at all.
const describeEmailConfig = () => {
  if (process.env.EMAIL_ENABLED === "false") {
    return "Email notifications: disabled (EMAIL_ENABLED=false)";
  }

  const missing = REQUIRED_SMTP_SETTINGS.filter((name) => !smtpSetting(name));

  if (missing.length > 0) {
    return `Email notifications: disabled (missing or empty: ${missing.join(", ")})`;
  }

  return `Email notifications: enabled (host ${smtpSetting("SMTP_HOST")}, port ${smtpSetting("SMTP_PORT")})`;
};

// One transporter for the whole process, built from the SMTP_* environment
// variables. Nothing else in the codebase may create a second one.
//
// The explicit timeouts matter in production: a host that silently drops
// outbound SMTP traffic (Render free web services block ports 25, 465 and 587)
// would otherwise hold every attempt for minutes before reporting anything,
// stalling the serial send queue. Short timeouts turn that into a fast, clear
// failure that the scheduled retry job can see and record.
const configuredPort = Number(smtpSetting("SMTP_PORT"));

const transporter = nodemailer.createTransport({
  host: smtpSetting("SMTP_HOST"),
  port: Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : undefined,
  secure: configuredPort === 465,
  connectionTimeout: 10 * 1000,
  greetingTimeout: 10 * 1000,
  socketTimeout: 30 * 1000,

  auth: {
    user: smtpSetting("SMTP_USER"),
    pass: smtpSetting("SMTP_PASS"),
  },
});

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

// Test Gmail SMTP connection
const verifyEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log("Gmail SMTP connection successful!");
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

// Send email
const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) {
    throw new Error("Recipient email is required");
  }

  return transporter.sendMail({
    from: process.env.SMTP_FROM,
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
  describeEmailConfig,
};
