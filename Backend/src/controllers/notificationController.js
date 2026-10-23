const mongoose = require("mongoose");

const Notification = require("../models/Notification");
const Task = require("../models/Task");
const { isValidId } = require("../utils/validation");
const { isTaskOverdue, isTaskDueSoon } = require("../utils/deadline");

// ---------- Generating notifications ----------

// Reminder types produced by the deadline scheduler, always addressed to
// the employee assigned to the task. Used by the task controller too,
// which removes these rows (and only these) when a task is completed or
// changes hands, so task activity rows are never lost.
const DEADLINE_NOTIFICATION_TYPES = ["deadline_soon", "overdue"];

// Creates one notification, but only if the same task does not already
// have a notification of the same type for the same user.
// This is what stops duplicate notifications from being created.
const createNotificationOnce = async (task, type, message) => {
  const existing = await Notification.findOne({
    task: task._id,
    type: type,
    user: task.assignedTo,
  });

  if (existing) {
    return; // already created before, do nothing
  }

  try {
    await Notification.create({
      user: task.assignedTo,
      task: task._id,
      type: type,
      message: message,
      dedupeKey: `deadline:${task._id}:${task.assignedTo}:${type}`,
    });
  } catch (error) {
    // Code 11000 = duplicate key. This can only happen when two
    // generations run at exactly the same moment, so we ignore it.
    if (error.code !== 11000) {
      throw error;
    }
  }
};

// Creates one activity notification for one specific recipient.
// The dedupeKey names the exact action (task + the comment / history
// entry / assignment it came from), so processing the same action more
// than once can never produce a second notification. Notifications are
// only created here as a direct result of a real action - never when a
// page is loaded or refreshed. "task" is optional: meeting
// notifications are not tied to a task.
const createActivityNotification = async ({ user, task, type, message, dedupeKey }) => {
  // No recipient (e.g. nobody to notify) -> nothing to do
  if (!user) {
    return;
  }

  const existing = await Notification.findOne({ dedupeKey: dedupeKey });

  if (existing) {
    return; // this exact action was already recorded
  }

  try {
    await Notification.create({
      user: user,
      task: task ? task._id : null,
      type: type,
      message: message,
      dedupeKey: dedupeKey,
    });
  } catch (error) {
    // Code 11000 = duplicate key: two identical actions raced; one row is enough
    if (error.code !== 11000) {
      throw error;
    }
  }
};

// Looks at all tasks that are not completed and creates:
// - a "deadline_soon" notification when the due date is within 3 days
// - an "overdue" notification when the due date has passed
// Completed tasks are skipped, so they never create overdue notifications.
// Called at server start, every 6 hours, and when a user opens their notifications.
const generateDeadlineNotifications = async () => {
  try {
    // status "$ne" Completed means "not equal to Completed"
    const tasks = await Task.find({ status: { $ne: "Completed" } });

    for (const task of tasks) {
      if (isTaskDueSoon(task)) {
        await createNotificationOnce(
          task,
          "deadline_soon",
          `Deadline approaching: "${task.title}" is due on ${task.dueDate.toLocaleDateString()}`
        );
      }

      if (isTaskOverdue(task)) {
        await createNotificationOnce(
          task,
          "overdue",
          `Task overdue: "${task.title}" was due on ${task.dueDate.toLocaleDateString()}`
        );
      }
    }
  } catch (error) {
    // Never crash the app because reminders could not be generated
    console.error("Generate deadline notifications error:", error.message);
  }
};

// ---------- Notification APIs ----------

// GET /api/notifications  (any logged-in user)
// Refreshes the reminders first, then returns only the notifications
// of the logged-in user, newest first.
const getMyNotifications = async (req, res) => {
  try {
    // Make sure the reminders are up to date before showing them
    await generateDeadlineNotifications();

    const notifications = await Notification.find({ user: req.user._id })
      .populate("task", "title status dueDate")
      .sort({ createdAt: -1 });

    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount,
      data: notifications,
    });
  } catch (error) {
    console.error("Get notifications error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/notifications/:id/read  (any logged-in user)
// Marks one notification as read, but only if it belongs
// to the logged-in user.
const markNotificationRead = async (req, res) => {
  try {
    // A malformed id would make findById throw a CastError (500)
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification id",
      });
    }

    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    // A user can only mark their own notification as read
    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You cannot update this notification",
      });
    }

    notification.isRead = true;
    await notification.save();

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification,
    });
  } catch (error) {
    console.error("Mark notification read error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/notifications/read-all  (any logged-in user)
// Marks every notification of the logged-in user as read.
const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  generateDeadlineNotifications,
  createActivityNotification,
  DEADLINE_NOTIFICATION_TYPES,
};
