// Turns an in-app notification row into exactly ONE email, sent through the
// existing emailService transporter (no second transporter, no duplicated
// SMTP configuration).
//
// Safety rules this module is built around:
//   - Request handlers never await anything here. They call
//     enqueueNotificationEmail(), which only appends work to an in-process
//     queue, so API responses never wait on Gmail and an SMTP outage can
//     never turn a successful response into a failure.
//   - The in-app row is always created first, by the notification
//     controllers; email is a best-effort side effect of that creation.
//   - Delivery state lives on the row itself (see the Notification model):
//       pending -> sending -> sent            (success)
//                            -> failed         (retryable, capped)
//       pending -> skipped                    (inactive/invalid recipient)
//     The move to "sending" is an atomic findOneAndUpdate claim, so two
//     concurrent attempts can never both send, and "sent" is written only
//     after SMTP accepts the message.
//   - Rows created before this feature (or while email was disabled) carry
//     no email fields at all, so they are never emailed retroactively.
//
// Recipients are NOT selected here: the row's `user` is exactly the
// recipient the existing in-app logic already chose. This module only
// re-reads that user from MongoDB to get their current address and
// active state.

const emailService = require("./emailService");
const Notification = require("../models/Notification");
const Task = require("../models/Task");
const User = require("../models/User");

// Bounded retries: three claimed attempts per notification, ever.
const MAX_EMAIL_ATTEMPTS = 3;
// The scheduled job examines at most this many rows per run.
const RETRY_BATCH_SIZE = 25;
// A "sending" row older than this is considered abandoned (crashed process)
// and becomes claimable again.
const STALE_CLAIM_MS = 10 * 60 * 1000;
// Pause between two outgoing messages so a burst (five assignees, or a
// scheduler run that creates many reminders at once) never floods SMTP.
const SEND_GAP_MS = 150;
const MAX_SUBJECT_LENGTH = 120;
const MAX_ERROR_LENGTH = 200;

// Human titles for the existing notification types (no new types are
// introduced; unknown types fall back to a generic label).
const TYPE_TITLES = {
  deadline_soon: "Deadline approaching",
  overdue: "Task overdue",
  task_assigned: "Task assigned",
  task_reassigned: "Task reassigned",
  task_status_changed: "Status changed",
  task_completed: "Task completed",
  task_commented: "New comment",
  meeting_created: "Meeting scheduled",
  meeting_updated: "Meeting updated",
};

// ---------- Small helpers ----------

// Escapes every HTML special character so user-controlled text (task
// titles, comments, names) can never inject markup into the email.
const escapeHtml = (value) =>
  String(value === null || value === undefined ? "" : value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]
  );

// Subjects are header values: line breaks would allow header injection and
// very long titles are unreadable, so both are removed here.
const sanitizeSubject = (value) =>
  String(value === null || value === undefined ? "" : value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH);

// Deliberately conservative address check: schema emails are not validated
// for format, and a malformed or multi-line address must never reach SMTP.
const isSendableAddress = (email) =>
  typeof email === "string" &&
  email.length <= 254 &&
  !/[\r\n]/.test(email) &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Failure summaries are logged / stored server-side only; never credentials.
const safeErrorMessage = (error) =>
  String((error && error.message) || error)
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, MAX_ERROR_LENGTH);

const frontendBase = () =>
  String(process.env.FRONTEND_BASE_URL || "").replace(/\/+$/, "");

// The action link uses the REAL existing frontend routes only:
//   tasks   -> {FRONTEND_BASE_URL}/tasks/{taskId}
//   meetings-> {FRONTEND_BASE_URL}/meetings
// No tokens and no invented routes. When FRONTEND_BASE_URL is not
// configured the email simply goes out without the button.
const actionLinkFor = (notification, task) => {
  const base = frontendBase();

  if (!base) {
    return { url: "", label: "" };
  }

  if (notification.type && notification.type.startsWith("meeting_")) {
    return { url: `${base}/meetings`, label: "Open meetings" };
  }

  if (task) {
    return { url: `${base}/tasks/${task._id}`, label: "Open task" };
  }

  return { url: "", label: "" };
};

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

// ---------- Template ----------

// Clean, text-based, mobile-friendly HTML: one column, no images, no
// external resources, inline styles only. Every interpolated value is
// escaped with escapeHtml().
const buildHtml = ({ recipientName, title, message, details, action, footer }) => {
  const detailRows = details
    .map(
      ([label, value]) => `
              <tr>
                <td style="padding:6px 0;width:110px;color:#64748b;font-size:13px;">${escapeHtml(label)}</td>
                <td style="padding:6px 0;color:#0f172a;font-size:13px;">${escapeHtml(value)}</td>
              </tr>`
    )
    .join("");

  const actionBlock = action.url
    ? `
            <p style="margin:24px 0 4px;">
              <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(action.label)}</a>
            </p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
            <tr>
              <td style="padding:28px 28px 24px 28px;">
                <p style="margin:0 0 4px 0;font-size:12px;letter-spacing:2px;color:#2563eb;font-weight:bold;text-transform:uppercase;">Volta</p>
                <p style="margin:0 0 18px 0;font-size:12px;color:#94a3b8;">Task Management System</p>

                <h1 style="margin:0 0 12px 0;font-size:20px;color:#0f172a;">${escapeHtml(title)}</h1>
                <p style="margin:0 0 6px 0;font-size:14px;color:#334155;">Hi ${escapeHtml(recipientName)},</p>
                <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(message)}</p>${
    detailRows
      ? `
                <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:0;">${detailRows}
                </table>`
      : ""
  }${actionBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px 28px;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">${escapeHtml(footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

// Builds the complete { to, subject, text, html } message for one
// notification row and its (already validated) recipient.
const buildNotificationEmail = (notification, recipient, task) => {
  const title = TYPE_TITLES[notification.type] || "Notification";
  const subject = sanitizeSubject(
    task ? `${title}: ${task.title}` : title
  );
  const action = actionLinkFor(notification, task);

  const details = task
    ? [
        ["Task", task.title],
        ["Priority", task.priority],
        ["Due date", formatDate(task.dueDate)],
        ["Status", task.status],
      ]
    : [];

  const footer =
    "You received this automated message because notifications are enabled for your Volta account. Sign in to Volta to view details and reply.";

  const textLines = [
    "VOLTA - Task Management System",
    "",
    title,
    "",
    `Hi ${recipient.name},`,
    notification.message,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
  ];

  if (action.url) {
    textLines.push("", `Open it here: ${action.url}`);
  }

  textLines.push("", footer);

  const text = textLines.join("\n");

  return {
    to: recipient.email,
    subject,
    text,
    html: buildHtml({
      recipientName: recipient.name,
      title,
      message: notification.message,
      details,
      action,
      footer,
    }),
  };
};

// ---------- Delivery state machine ----------

// The fields written when a notification row is created. Empty object while
// email is disabled, so those environments keep the exact old behaviour.
const emailTrackingFields = () =>
  emailService.isEmailEnabled()
    ? { emailStatus: "pending", emailAttempts: 0 }
    : {};

// Atomically claims a row for exactly one delivery attempt. Only one of
// any number of concurrent callers can win, because the filter and the
// update happen as a single MongoDB operation.
const claimForSending = (notificationId) =>
  Notification.findOneAndUpdate(
    {
      _id: notificationId,
      $or: [
        { emailStatus: "pending" },
        {
          emailStatus: "failed",
          emailAttempts: { $lt: MAX_EMAIL_ATTEMPTS },
        },
        {
          // recover rows abandoned by a crashed process
          emailStatus: "sending",
          emailLastAttemptAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) },
        },
      ],
    },
    {
      $set: { emailStatus: "sending", emailLastAttemptAt: new Date() },
      $inc: { emailAttempts: 1 },
    },
    { returnDocument: "after" }
  );

// Sends ONE notification's email. Never throws; every failure is recorded
// on the row and logged without credentials or message content.
const dispatchNotificationEmail = async (notificationId) => {
  if (!emailService.isEmailEnabled()) {
    return;
  }

  let claimed = null;

  try {
    claimed = await claimForSending(notificationId);

    if (!claimed) {
      return; // already sent / in flight / retry budget spent / not an emailable row
    }

    // Recipient identity is re-read from the database here: current
    // address, current name, current active state.
    const recipient = await User.findById(claimed.user);

    if (
      !recipient ||
      !recipient.isActive ||
      !isSendableAddress(recipient.email)
    ) {
      await Notification.updateOne(
        { _id: claimed._id, emailStatus: "sending" },
        { $set: { emailStatus: "skipped" } }
      );

      // Server-side trace only: id and type, never the address or content.
      console.log(
        `Notification email skipped (${claimed.type}, ${claimed._id}): recipient inactive or has no usable address`
      );
      return;
    }

    const task = claimed.task ? await Task.findById(claimed.task) : null;
    const email = buildNotificationEmail(claimed, recipient, task);

    // Resolves only when SMTP accepts the message; "sent" is never
    // written before that happens.
    await emailService.sendEmail(email);

    // Server-side trace so production logs show real deliveries: id and
    // type only - never the recipient address or message content.
    console.log(`Notification email delivered (${claimed.type}, ${claimed._id})`);

    try {
      await Notification.updateOne(
        { _id: claimed._id, emailStatus: "sending" },
        { $set: { emailStatus: "sent", emailSentAt: new Date() } }
      );
    } catch (recordError) {
      // The mail DID go out; only the bookkeeping failed. Logging this
      // separately keeps it from being misread as a delivery failure
      // (the stale-claim recovery may resend much later - accepted
      // trade-off, documented in the audit).
      console.error(
        "Email delivered but the confirmation could not be recorded:",
        safeErrorMessage(recordError)
      );
    }
  } catch (error) {
    console.error("Notification email failed:", safeErrorMessage(error));

    if (claimed) {
      try {
        await Notification.updateOne(
          { _id: claimed._id, emailStatus: "sending" },
          {
            $set: {
              emailStatus: "failed",
              emailLastError: safeErrorMessage(error),
            },
          }
        );
      } catch (recordError) {
        console.error(
          "Could not record the email failure:",
          safeErrorMessage(recordError)
        );
      }
    }
  }
};

// In-process, strictly serial queue with a short gap between messages.
// API handlers call this and return immediately - no SMTP is ever awaited
// inside a request.
let sendQueue = Promise.resolve();

const enqueueNotificationEmail = (notificationId) => {
  if (!emailService.isEmailEnabled()) {
    return;
  }

  sendQueue = sendQueue
    .then(() => dispatchNotificationEmail(notificationId))
    .catch(() => undefined) // dispatch logs its own errors
    .then(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, SEND_GAP_MS);
        })
    );
};

// Controlled retry pass for rows that failed (or were left behind). Called
// ONLY on the existing scheduler cadence (server start + every 6 hours),
// bounded by RETRY_BATCH_SIZE and by MAX_EMAIL_ATTEMPTS per row, so there
// is no unbounded background job and no infinite retry loop. New rows are
// never touched here: they go out through the queue at creation time.
const retryFailedNotificationEmails = async () => {
  if (!emailService.isEmailEnabled()) {
    return;
  }

  try {
    const stale = new Date(Date.now() - STALE_CLAIM_MS);

    const dueRows = await Notification.find({
      $or: [
        { emailStatus: "failed", emailAttempts: { $lt: MAX_EMAIL_ATTEMPTS } },
        { emailStatus: "sending", emailLastAttemptAt: { $lt: stale } },
        { emailStatus: "pending", createdAt: { $lt: stale } },
      ],
    })
      .select("_id")
      .limit(RETRY_BATCH_SIZE);

    for (const row of dueRows) {
      enqueueNotificationEmail(row._id);
    }
  } catch (error) {
    // A retry scan must never break the scheduler or the API
    console.error("Email retry scan failed:", safeErrorMessage(error));
  }
};

module.exports = {
  enqueueNotificationEmail,
  dispatchNotificationEmail,
  retryFailedNotificationEmails,
  emailTrackingFields,
  buildNotificationEmail,
  escapeHtml,
  sanitizeSubject,
  MAX_EMAIL_ATTEMPTS,
};
