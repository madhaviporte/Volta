const mongoose = require("mongoose");

const Task = require("../models/Task");
const User = require("../models/User");
const Comment = require("../models/Comment");
const TaskHistory = require("../models/TaskHistory");
const Notification = require("../models/Notification");
const {
  createActivityNotification,
  DEADLINE_NOTIFICATION_TYPES,
} = require("./notificationController");
const { addDeadlineFlags } = require("../utils/deadline");
const { isValidId, isText, parseDueDate } = require("../utils/validation");

// Allowed values (must match the Task model enums)
const VALID_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const VALID_STATUSES = ["Pending", "In Progress", "Completed", "On Hold"];

// ---------- Small helpers used only in this file ----------

// Saves one history entry for a task and returns it, so callers can use
// its id to build a per-action dedupe key for notifications.
const recordHistory = async (taskId, action, performedById, oldValue, newValue) => {
  return TaskHistory.create({
    task: taskId,
    action: action,
    performedBy: performedById,
    oldValue: oldValue,
    newValue: newValue,
  });
};

// Truncates a comment so a notification message stays one readable line.
const commentPreview = (message) => {
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
};

// Applies the completedAt rules when the status changes.
// Returns true when the status actually changed.
const applyStatusChange = (task, newStatus) => {
  if (task.status === newStatus) {
    return false;
  }

  // Completed tasks get a completion date
  if (newStatus === "Completed") {
    task.completedAt = new Date();
  } else if (task.status === "Completed") {
    // Moving a task out of "Completed" clears the completion date
    task.completedAt = null;
  }

  task.status = newStatus;
  return true;
};

// Managers can access every task, employees only their own assigned tasks.
// For employees we only trust req.user, never an id from the frontend.
const canAccessTask = (user, task) => {
  if (user.role === "manager") {
    return true;
  }

  return task.assignedTo.toString() === user._id.toString();
};

// MongoDB transactions need a replica set (MongoDB Atlas qualifies).
// On a standalone deployment the driver refuses transactions, so the
// caller falls back to the same deletes run sequentially.
const isTransactionUnsupported = (error) => {
  return Boolean(
    error &&
      (error.code === 20 ||
        /Transaction numbers|replica set|standalone/i.test(String(error.message || "")))
  );
};

// ---------- Task controllers ----------

// POST /api/tasks  (manager only)
const createTask = async (req, res) => {
  try {
    const { title, description, assignedTo, priority, status, dueDate } = req.body;

    if (!isText(title) || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    if (description !== undefined && description !== null && !isText(description)) {
      return res.status(400).json({
        success: false,
        message: "Description must be text",
      });
    }

    if (!assignedTo) {
      return res.status(400).json({
        success: false,
        message: "assignedTo (employee id) is required",
      });
    }

    // A malformed id would reach findById and throw a CastError (500)
    if (!isValidId(assignedTo)) {
      return res.status(400).json({
        success: false,
        message: "assignedTo must be an existing employee",
      });
    }

    if (!dueDate) {
      return res.status(400).json({
        success: false,
        message: "dueDate is required",
      });
    }

    const dueDateValue = parseDueDate(dueDate);

    if (!dueDateValue) {
      return res.status(400).json({
        success: false,
        message: "dueDate must be a valid date",
      });
    }

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    // The task must be assigned to an existing employee
    const employee = await User.findById(assignedTo);

    if (!employee || employee.role !== "employee") {
      return res.status(400).json({
        success: false,
        message: "assignedTo must be an existing employee",
      });
    }

    const taskStatus = status || "Pending";

    const task = await Task.create({
      title: title.trim(),
      description: description ? description.trim() : "",
      assignedTo: assignedTo,
      createdBy: req.user._id,
      priority: priority || "Medium",
      status: taskStatus,
      // If the manager creates the task already completed, set completedAt
      completedAt: taskStatus === "Completed" ? new Date() : null,
      dueDate: dueDateValue,
    });

    await recordHistory(task._id, "TASK_CREATED", req.user._id, null, {
      title: task.title,
      assignedTo: employee.name,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
    });

    // The first assignment is also recorded as its own history entry
    await recordHistory(task._id, "ASSIGNED", req.user._id, null, employee.name);

    // The assignee learns that the task is now theirs (the manager who
    // assigned it already knows, so they are not notified)
    await createActivityNotification({
      user: employee._id,
      task: task,
      type: "task_assigned",
      message: `You have been assigned the task "${task.title}" by ${req.user.name}`,
      dedupeKey: `task_assigned:${task._id}:${employee._id}`,
    });

    const taskWithNames = await Task.findById(task._id)
      .populate("assignedTo", "name")
      .populate("createdBy", "name");

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: taskWithNames,
    });
  } catch (error) {
    console.error("Create task error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// GET /api/tasks  (both roles)
// Manager sees all tasks, employee sees only their own tasks
const getTasks = async (req, res) => {
  try {
    let filter = {};

    // Employee can only ever see their own tasks
    if (req.user.role === "employee") {
      filter = { assignedTo: req.user._id };
    } else if (req.query.employeeId) {
      // Manager can filter by employee with /api/tasks?employeeId=...
      // A malformed id would make Task.find throw a CastError (500)
      if (!isValidId(req.query.employeeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid employee id",
        });
      }

      filter = { assignedTo: req.query.employeeId };
    }

    const tasks = await Task.find(filter)
      .populate("assignedTo", "name")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 });

    const tasksWithFlags = tasks.map(addDeadlineFlags);

    return res.status(200).json({
      success: true,
      count: tasksWithFlags.length,
      data: tasksWithFlags,
    });
  } catch (error) {
    console.error("Get tasks error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// GET /api/tasks/:id  (both roles)
const getTaskById = async (req, res) => {
  try {
    // A malformed id is a client error, not a server error
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    // Load the task without populating first,
    // so the access check can compare the plain assignedTo id
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({
        success: false,
        message: "You cannot view this task",
      });
    }

    // Access is allowed, now add the employee and manager names
    const taskWithNames = await Task.findById(task._id)
      .populate("assignedTo", "name")
      .populate("createdBy", "name");

    return res.status(200).json({
      success: true,
      data: addDeadlineFlags(taskWithNames),
    });
  } catch (error) {
    console.error("Get task error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/tasks/:id  (manager only)
// Manager can edit the task and reassign it to another employee
const updateTask = async (req, res) => {
  try {
    const { title, description, assignedTo, priority, status, dueDate } = req.body;

    // Validate the id and every field before touching the database, so
    // malformed input answers 400 instead of failing inside mongoose (500)
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    if (title !== undefined && title !== null && title !== "") {
      if (!isText(title)) {
        return res.status(400).json({
          success: false,
          message: "Title must be text",
        });
      }

      if (!title.trim()) {
        return res.status(400).json({
          success: false,
          message: "Title is required",
        });
      }
    }

    if (description !== undefined && description !== null && !isText(description)) {
      return res.status(400).json({
        success: false,
        message: "Description must be text",
      });
    }

    if (assignedTo && !isValidId(assignedTo)) {
      return res.status(400).json({
        success: false,
        message: "assignedTo must be an existing employee",
      });
    }

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    let dueDateValue = null;

    if (dueDate) {
      dueDateValue = parseDueDate(dueDate);

      if (!dueDateValue) {
        return res.status(400).json({
          success: false,
          message: "dueDate must be a valid date",
        });
      }
    }

    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Remember the old values so we can record them in the history
    const oldDetails = {
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate,
    };
    const oldStatus = task.status;
    const oldAssignedToId = task.assignedTo.toString();

    // Update only the fields that were sent
    if (title) task.title = title.trim();
    if (description !== undefined && description !== null) task.description = description.trim();
    if (priority) task.priority = priority;
    if (dueDateValue) task.dueDate = dueDateValue;

    // Reassignment: check that the new employee exists
    let oldEmployeeName = null;
    let newEmployeeName = null;
    let wasReassigned = false;

    if (assignedTo && assignedTo !== oldAssignedToId) {
      const newEmployee = await User.findById(assignedTo);

      if (!newEmployee || newEmployee.role !== "employee") {
        return res.status(400).json({
          success: false,
          message: "assignedTo must be an existing employee",
        });
      }

      const oldEmployee = await User.findById(oldAssignedToId).select("name");

      task.assignedTo = assignedTo;
      wasReassigned = true;
      oldEmployeeName = oldEmployee ? oldEmployee.name : null;
      newEmployeeName = newEmployee.name;
    }

    const statusChanged = status ? applyStatusChange(task, status) : false;

    await task.save();

    // Notification cleanup follows the existing design (rows are keyed to
    // the task and leave with it for the person they address): after a
    // reassignment the previous employee must not keep anything for work
    // they no longer own, and a completed task must stop showing
    // deadline/overdue reminders. Rows addressed to anyone else (e.g. the
    // manager's activity feed) are untouched. The scheduler creates fresh
    // reminder rows for the current assignee while the task is still open
    // and due soon/overdue.
    if (wasReassigned) {
      await Notification.deleteMany({ task: task._id, user: oldAssignedToId });
    }

    if (statusChanged && task.status === "Completed") {
      await Notification.deleteMany({
        task: task._id,
        user: task.assignedTo,
        type: { $in: DEADLINE_NOTIFICATION_TYPES },
      });
    }

    // Record history entries for what changed
    if (wasReassigned) {
      const reassignedEntry = await recordHistory(
        task._id,
        "REASSIGNED",
        req.user._id,
        oldEmployeeName,
        newEmployeeName
      );

      // The new assignee learns the task is now theirs
      await createActivityNotification({
        user: task.assignedTo,
        task: task,
        type: "task_reassigned",
        message: `Task "${task.title}" has been assigned to you by ${req.user.name}`,
        dedupeKey: `task_reassigned:${task._id}:${reassignedEntry._id}`,
      });

      // The manager who owns the task hears about the reassignment,
      // unless they performed it themselves (no self-notifications).
      // Only relevant when more than one manager can edit tasks.
      if (task.createdBy && task.createdBy.toString() !== req.user._id.toString()) {
        await createActivityNotification({
          user: task.createdBy,
          task: task,
          type: "task_reassigned",
          message: `${req.user.name} reassigned "${task.title}" from ${oldEmployeeName || "unassigned"} to ${newEmployeeName}`,
          dedupeKey: `task_reassigned_manager:${task._id}:${reassignedEntry._id}`,
        });
      }
    }

    if (statusChanged) {
      await recordHistory(task._id, "STATUS_CHANGED", req.user._id, oldStatus, task.status);
    }

    const detailsChanged = title || description !== undefined || priority || dueDate;

    if (detailsChanged) {
      await recordHistory(task._id, "UPDATED", req.user._id, oldDetails, {
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.dueDate,
      });
    }

    const taskWithNames = await Task.findById(task._id)
      .populate("assignedTo", "name")
      .populate("createdBy", "name");

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: taskWithNames,
    });
  } catch (error) {
    console.error("Update task error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/tasks/:id/status  (both roles)
// Employee updates the status of their own task
const updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Employee can update only their own task
    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({
        success: false,
        message: "You cannot update this task",
      });
    }

    const oldStatus = task.status;
    const statusChanged = applyStatusChange(task, status);

    if (statusChanged) {
      await task.save();
      const statusEntry = await recordHistory(
        task._id,
        "STATUS_CHANGED",
        req.user._id,
        oldStatus,
        task.status
      );

      // Completing a task removes its deadline/overdue reminders so they
      // cannot mislead; reopening a task lets the scheduler create fresh
      // ones on its next run. Task activity rows (e.g. the manager's
      // completion notification below) are kept.
      if (task.status === "Completed") {
        await Notification.deleteMany({
          task: task._id,
          user: task.assignedTo,
          type: { $in: DEADLINE_NOTIFICATION_TYPES },
        });
      }

      // The manager who owns the task hears about employee activity on
      // it: a separate "completed" notification when the task finishes,
      // a status-change notification otherwise. The manager's own changes
      // are already known to them, so they are never notified about
      // themselves.
      if (task.createdBy && task.createdBy.toString() !== req.user._id.toString()) {
        if (task.status === "Completed") {
          await createActivityNotification({
            user: task.createdBy,
            task: task,
            type: "task_completed",
            message: `${req.user.name} completed the task "${task.title}"`,
            dedupeKey: `task_completed:${task._id}:${statusEntry._id}`,
          });
        } else {
          await createActivityNotification({
            user: task.createdBy,
            task: task,
            type: "task_status_changed",
            message: `${req.user.name} changed the status of "${task.title}" from ${oldStatus} to ${task.status}`,
            dedupeKey: `task_status_changed:${task._id}:${statusEntry._id}`,
          });
        }
      }
    }

    const taskWithNames = await Task.findById(task._id)
      .populate("assignedTo", "name")
      .populate("createdBy", "name");

    return res.status(200).json({
      success: true,
      message: "Task status updated successfully",
      data: taskWithNames,
    });
  } catch (error) {
    console.error("Update task status error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// DELETE /api/tasks/:id  (manager only)
const deleteTask = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Everything that belongs to the task leaves with it: the task history
    // API can only be read while its task exists, so keeping the rows would
    // only orphan them (the old DELETED entry was itself unreachable the
    // moment its task disappeared). The task document is removed LAST, so a
    // failure mid-way leaves the task in place and the delete can simply be
    // retried. On a replica set (MongoDB Atlas) the whole removal runs in one
    // transaction; on standalone MongoDB it falls back to sequential deletes.
    try {
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          await TaskHistory.deleteMany({ task: task._id }).session(session);
          await Comment.deleteMany({ task: task._id }).session(session);
          await Notification.deleteMany({ task: task._id }).session(session);
          await Task.findByIdAndDelete(task._id).session(session);
        });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      // Anything other than the topology limitation is a real failure:
      // the transaction has already rolled back, so surface it as 500
      // with the task (and all its data) still intact.
      if (!isTransactionUnsupported(error)) {
        throw error;
      }

      await TaskHistory.deleteMany({ task: task._id });
      await Comment.deleteMany({ task: task._id });
      await Notification.deleteMany({ task: task._id });
      await Task.findByIdAndDelete(task._id);
    }

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully",
    });
  } catch (error) {
    console.error("Delete task error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// ---------- Comment controllers ----------

// POST /api/tasks/:taskId/comments  (both roles)
const addComment = async (req, res) => {
  try {
    const { message } = req.body;

    if (!isText(message) || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Comment message is required",
      });
    }

    if (!isValidId(req.params.taskId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Employee can comment only on their own task
    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({
        success: false,
        message: "You cannot comment on this task",
      });
    }

    const comment = await Comment.create({
      task: task._id,
      user: req.user._id,
      message: message.trim(),
    });

    // Keep the other side of the conversation in the loop: a comment
    // from the assigned employee goes to the task's manager, a comment
    // from the manager goes to the assigned employee. Self-comments stay
    // silent. The notification carries the actor, the task title and a
    // short preview of the comment.
    const actorId = req.user._id.toString();
    const assigneeId = task.assignedTo.toString();
    const creatorId = task.createdBy ? task.createdBy.toString() : "";

    const commentRecipient =
      actorId === assigneeId ? task.createdBy : actorId === creatorId ? task.assignedTo : null;

    if (commentRecipient) {
      await createActivityNotification({
        user: commentRecipient,
        task: task,
        type: "task_commented",
        message: `${req.user.name} commented on "${task.title}": "${commentPreview(comment.message)}"`,
        dedupeKey: `task_commented:${task._id}:${comment._id}`,
      });
    }

    // Return the comment with the user's name
    const commentWithUser = await Comment.findById(comment._id).populate("user", "name role");

    return res.status(201).json({
      success: true,
      message: "Comment added successfully",
      data: commentWithUser,
    });
  } catch (error) {
    console.error("Add comment error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// GET /api/tasks/:taskId/comments  (both roles)
const getComments = async (req, res) => {
  try {
    if (!isValidId(req.params.taskId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({
        success: false,
        message: "You cannot view this task",
      });
    }

    // Oldest comments first so they read like a conversation
    const comments = await Comment.find({ task: task._id })
      .populate("user", "name role")
      .sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: comments.length,
      data: comments,
    });
  } catch (error) {
    console.error("Get comments error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// ---------- History controller ----------

// GET /api/tasks/:taskId/history  (both roles)
const getTaskHistory = async (req, res) => {
  try {
    if (!isValidId(req.params.taskId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({
        success: false,
        message: "You cannot view this task",
      });
    }

    // Oldest entry first so the history reads in order
    const history = await TaskHistory.find({ task: task._id })
      .populate("performedBy", "name role")
      .sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error) {
    console.error("Get task history error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

module.exports = {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  updateTaskStatus,
  addComment,
  getComments,
  getTaskHistory,
};
