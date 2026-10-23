const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // The user who receives the notification. Deadline reminders go to
    // the employee assigned to the task; task activity notifications go
    // to the task's owning manager or to the assigned employee,
    // depending on who performed the action.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The task this notification is about. Optional: meeting
    // notifications (see type below) are not tied to any task.
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
    },

    // Deadline reminders (scheduler -> assigned employee):
    //   "deadline_soon" = due within the next 3 days
    //   "overdue"       = due date has passed and task is not completed
    // Task activity (task controllers -> manager or assigned employee):
    //   "task_assigned"     = a task was assigned to the employee
    //   "task_reassigned"   = a task changed hands
    //   "task_status_changed" = someone changed the task status
    //   "task_completed"    = the task was completed    //   "task_commented"   = someone commented on the task
    // Meeting activity (meeting controller -> participating employees):
    //   "meeting_created"  = a manager scheduled a new meeting
    //   "meeting_updated"  = a manager changed the meeting details
    type: {
      type: String,
      enum: [
        "deadline_soon",
        "overdue",
        "task_assigned",
        "task_reassigned",
        "task_status_changed",
        "task_completed",
        "task_commented",
        "meeting_created",
        "meeting_updated",
      ],
      required: true,
    },

    // Human readable text shown to the employee
    message: {
      type: String,
      required: true,
      trim: true,
    },

    // The user can mark notifications as read
    isRead: {
      type: Boolean,
      default: false,
    },

    // Idempotency key naming the exact action this row stands for, e.g.
    // "deadline:<taskId>:<userId>:overdue" or "task_commented:<taskId>:<commentId>".
    // The controller checks it before inserting, and the unique index
    // below is the safety net: a retried request, a replayed event or
    // two racing scheduler runs can never produce a second row for the
    // same action. Legacy rows (created before this field existed) have
    // no key; the sparse option keeps them valid.
    dedupeKey: {
      type: String,
    },
  },
  {
    timestamps: true, // gives createdAt automatically
  }
);

// One notification per action, ever.
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

// Supporting index for the per-user listing and the dedupe lookups.
// (Replaces the old compound unique index: duplicate protection now
// lives on dedupeKey, which is per-action, so repeated activity on the
// same task can create its own notifications.)
notificationSchema.index({ task: 1, type: 1, user: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
