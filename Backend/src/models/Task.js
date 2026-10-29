const mongoose = require("mongoose");

// Status values shared by the task itself and each assignee's own
// progress entry (must match the enums below).
const TASK_STATUSES = ["Pending", "In Progress", "Completed", "On Hold"];

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    // The primary assignee (the first person on the list). This field is
    // kept exactly as it always was, so existing task documents, queries
    // and API responses keep working unchanged; every new task also fills
    // in "assignees" below, and older documents that only have this field
    // are read through utils/assignees.js (which falls back to it).
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Everyone the task is assigned to, in selection order, without
    // duplicates. One task can be assigned to several people at once;
    // the first entry is also stored in assignedTo above. Employees and
    // managers (C-Suite, C-Suite Executives, and every other level) can
    // all appear here - receiving a task never changes a user's role.
    assignees: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    // Each assignee's own status, tracked independently of the others:
    // one person completing the task never changes anyone else's entry.
    // "status" on the task itself is the overall roll-up of these entries
    // (see utils/assignees.js). Documents created before multi-assignee
    // support have no entries and fall back to the task's own status.
    progress: {
      type: [
        new mongoose.Schema(
          {
            user: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              required: true,
            },
            status: {
              type: String,
              enum: TASK_STATUSES,
              default: "Pending",
            },
            // Set when this particular assignee finishes their share
            completedAt: {
              type: Date,
              default: null,
            },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    // Manager who created the task
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
    },

    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "Pending",
    },

    // When the task should be finished.
    // A task is overdue when dueDate is in the past and status is not "Completed".
    dueDate: {
      type: Date,
      required: true,
    },

    // Set automatically when the status becomes "Completed"
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
  }
);

// One assignee appears at most once per task
taskSchema.index({ assignees: 1 });

module.exports = mongoose.model("Task", taskSchema);
module.exports.TASK_STATUSES = TASK_STATUSES;
