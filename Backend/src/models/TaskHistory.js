const mongoose = require("mongoose");

const taskHistorySchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },

    // Example: "TASK_CREATED", "ASSIGNED", "REASSIGNED", "UPDATED",
    // "STATUS_CHANGED", "DELETED"
    action: {
      type: String,
      required: true,
    },

    // Who did this action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Value before the change (null for creation)
    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Value after the change (null for deletion)
    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // For STATUS_CHANGED entries: whose status changed. Tasks with a
    // single assignee record the same values as before, so old rows and
    // old readers are unaffected; the field simply says which person a
    // status entry belongs to when a task has several assignees.
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true, // gives createdAt, shown with each history entry
  }
);

module.exports = mongoose.model("TaskHistory", taskHistorySchema);
