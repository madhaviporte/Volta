
const nodemailer = require("nodemailer");

// Outgoing email is on whenever the SMTP settings are available, and can be
// switched off without unsetting them by setting EMAIL_ENABLED=false. This is
// the single switch every caller (controllers, scheduler, tests) consults, so
// an environment without SMTP config behaves exactly as before this feature.
const isEmailEnabled = () => {
  if (process.env.EMAIL_ENABLED === "false") {
    return false;
  }

  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  );
};

// One transporter for the whole process, built from the SMTP_* environment
// variables. Nothing else in the codebase may create a second one.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,

  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Test Gmail SMTP connection
const verifyEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log("Gmail SMTP connection successful!");
    return true;
  } catch (error) {
    console.error("Gmail SMTP connection failed:", error.message);
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
};
