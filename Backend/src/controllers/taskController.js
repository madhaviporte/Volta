const Task = require("../models/Task");
const User = require("../models/User");
const Comment = require("../models/Comment");
const TaskHistory = require("../models/TaskHistory");
const Notification = require("../models/Notification");
const { addDeadlineFlags } = require("../utils/deadline");

// Allowed values (must match the Task model enums)
const VALID_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const VALID_STATUSES = ["Pending", "In Progress", "Completed", "On Hold"];

// ---------- Small helpers used only in this file ----------

// Saves one history entry for a task
const recordHistory = async (taskId, action, performedById, oldValue, newValue) => {
  await TaskHistory.create({
    task: taskId,
    action: action,
    performedBy: performedById,
    oldValue: oldValue,
    newValue: newValue,
  });
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

// ---------- Task controllers ----------

// POST /api/tasks  (manager only)
const createTask = async (req, res) => {
  try {
    const { title, description, assignedTo, priority, status, dueDate } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    if (!assignedTo) {
      return res.status(400).json({
        success: false,
        message: "assignedTo (employee id) is required",
      });
    }

    if (!dueDate) {
      return res.status(400).json({
        success: false,
        message: "dueDate is required",
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
      dueDate: new Date(dueDate),
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
    if (description !== undefined) task.description = description.trim();
    if (priority) task.priority = priority;
    if (dueDate) task.dueDate = new Date(dueDate);

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

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const statusChanged = status ? applyStatusChange(task, status) : false;

    await task.save();

    // Record history entries for what changed
    if (wasReassigned) {
      await recordHistory(task._id, "REASSIGNED", req.user._id, oldEmployeeName, newEmployeeName);
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
      await recordHistory(task._id, "STATUS_CHANGED", req.user._id, oldStatus, task.status);
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
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Record the deletion in the history before removing the task
    await recordHistory(task._id, "DELETED", req.user._id, { title: task.title }, null);

    // Comments belong to the task, so remove them too
    await Comment.deleteMany({ task: task._id });

    // Reminders of a deleted task are not needed anymore
    await Notification.deleteMany({ task: task._id });

    await Task.findByIdAndDelete(task._id);

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

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Comment message is required",
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
