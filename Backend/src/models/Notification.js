const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // The employee who receives the notification
    // (the one assigned to the task)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The task this notification is about
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },

    // "deadline_soon" = due within the next 3 days
    // "overdue"       = due date has passed and task is not completed
    type: {
      type: String,
      enum: ["deadline_soon", "overdue"],
      required: true,
    },

    // Human readable text shown to the employee
    message: {
      type: String,
      required: true,
      trim: true,
    },

    // The employee can mark notifications as read
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // gives createdAt automatically
  }
);

// Safety net so the same task can never get two notifications
// of the same type for the same user. The controller also checks
// before creating.
notificationSchema.index({ task: 1, type: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Notification", notificationSchema);
