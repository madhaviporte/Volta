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
const {
  VALID_STATUSES,
  normalizeAssigneeIds,
  haveValidIdFormat,
  getAssigneeIds,
  getProgressEntry,
  getAssigneeStatus,
  deriveOverallStatus,
  statusForViewer,
  idOf,
} = require("../utils/assignees");

// Allowed values (must match the Task model enums)
const VALID_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

// ---------- Small helpers used only in this file ----------

// Saves one history entry for a task and returns it, so callers can use
// its id to build a per-action dedupe key for notifications. `assignee`
// names the person a STATUS_CHANGED entry belongs to when the task has
// several assignees (it is optional, so old entries stay valid).
const recordHistory = async (taskId, action, performedById, oldValue, newValue, assignee) => {
  return TaskHistory.create({
    task: taskId,
    action: action,
    performedBy: performedById,
    oldValue: oldValue,
    newValue: newValue,
    assignee: assignee || null,
  });
};

// Every population the task API needs: the primary assignee, the full
// assignee list and each person's progress entry, plus the creator.
const populateTask = (query) => {
  return query
    .populate("assignedTo", "name")
    .populate("createdBy", "name")
    .populate("assignees", "name")
    .populate("progress.user", "name role");
};

// Loads a task the way the API returns it: names populated, deadline
// flags and the viewer's own status (see utils/assignees.js).
const loadTaskResponse = async (taskId, viewerId) => {
  const task = await populateTask(Task.findById(taskId));
  return addDeadlineFlagsFor(task, viewerId);
};

const addDeadlineFlagsFor = (task, viewerId) => {
  const myStatus = statusForViewer(task, viewerId);
  const overallStatus = task.status;

  // Deadline flags follow the viewer's own share of the work: a task this
  // person has finished is not "overdue" for them while the others are
  // still working. The payload keeps the overall status in `status` (so
  // old clients see exactly what they saw before) and adds `myStatus`.
  const plain = addDeadlineFlags({ ...task.toObject(), status: myStatus });
  plain.status = overallStatus;
  plain.myStatus = myStatus;

  return plain;
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
// Every assignee has access to the task (not just the primary one), so
// each of the five people on a shared task can open it, comment on it and
// update their own status. Employees still only ever reach tasks they are
// actually on - and, as before, only req.user is trusted, never an id
// from the frontend.
const canAccessTask = (user, task) => {
  if (user.role === "manager") {
    return true;
  }

  return getAssigneeIds(task).includes(user._id.toString());
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
    const { title, description, assignedTo, assignees, priority, status, dueDate } = req.body;

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

    // The assignee list comes from the new multi-select field
    // (assignees: [id, id, ...]) or, for existing clients and older
    // callers, from the single assignedTo id. Both end up in one
    // de-duplicated list; the first entry becomes the primary assignee.
    const usesList = assignees !== undefined && assignees !== null;
    const rawAssignees = usesList ? assignees : assignedTo;

    if (
      rawAssignees === undefined ||
      rawAssignees === null ||
      (typeof rawAssignees === "string" && !rawAssignees.trim()) ||
      (Array.isArray(rawAssignees) && rawAssignees.length === 0)
    ) {
      return res.status(400).json({
        success: false,
        message: usesList
          ? "assignees must include at least one user"
          : "assignedTo (employee id) is required",
      });
    }

    // Duplicate ids collapse here, so the same person is only ever
    // assigned (and notified) once per task.
    const assigneeIds = normalizeAssigneeIds(rawAssignees);
    const badAssigneeMessage = usesList
      ? "assignees must be existing, active users"
      : "assignedTo must be an existing employee";

    // A malformed id would reach findById and throw a CastError (500)
    if (!haveValidIdFormat(assigneeIds)) {
      return res.status(400).json({
        success: false,
        message: badAssigneeMessage,
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

    // Every selected user must exist and be active. Eligibility covers
    // employees and managers alike (C-Suite, C-Suite Executives and any
    // other level): being assigned a task grants no permissions and never
    // changes anyone's application role.
    const foundUsers = await User.find({ _id: { $in: assigneeIds } });
    const usersById = new Map(foundUsers.map((user) => [user._id.toString(), user]));
    const ineligible = assigneeIds.filter((id) => {
      const user = usersById.get(id);
      return !user || !user.isActive;
    });

    if (ineligible.length > 0) {
      return res.status(400).json({
        success: false,
        message: badAssigneeMessage,
      });
    }

    const assigneeNames = assigneeIds.map((id) => usersById.get(id).name);

    const taskStatus = status || "Pending";

    const task = await Task.create({
      title: title.trim(),
      description: description ? description.trim() : "",
      assignedTo: assigneeIds[0],
      assignees: assigneeIds,
      // Each assignee starts with their own copy of the starting status
      progress: assigneeIds.map((id) => ({
        user: id,
        status: taskStatus,
        completedAt: taskStatus === "Completed" ? new Date() : null,
      })),
      createdBy: req.user._id,
      priority: priority || "Medium",
      status: taskStatus,
      // If the manager creates the task already completed, set completedAt
      completedAt: taskStatus === "Completed" ? new Date() : null,
      dueDate: dueDateValue,
    });

    await recordHistory(task._id, "TASK_CREATED", req.user._id, null, {
      title: task.title,
      assignedTo: assigneeNames.join(", "),
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
    });

    // The first assignment is recorded once per assignee, so the history
    // shows exactly who the task was handed to (a single-assignee task
    // gets the same one entry it always had).
    for (let index = 0; index < assigneeIds.length; index++) {
      await recordHistory(task._id, "ASSIGNED", req.user._id, null, assigneeNames[index]);
    }

    // Everyone selected learns that the task is theirs. The manager who
    // assigned it already knows, so they are never notified about
    // themselves; the dedupe key is per assignee, so five people on one
    // task get five notifications and a retry cannot add a sixth.
    for (const assigneeId of assigneeIds) {
      if (assigneeId === req.user._id.toString()) {
        continue;
      }

      await createActivityNotification({
        user: assigneeId,
        task: task,
        type: "task_assigned",
        message: `You have been assigned the task "${task.title}" by ${req.user.name}`,
        dedupeKey: `task_assigned:${task._id}:${assigneeId}`,
      });
    }

    const taskWithNames = await loadTaskResponse(task._id, req.user._id);

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

    // Employee can only ever see their own tasks: the shared tasks they
    // are on (assignees) plus older rows that only carry assignedTo.
    if (req.user.role === "employee") {
      filter = { $or: [{ assignees: req.user._id }, { assignedTo: req.user._id }] };
    } else if (req.query.employeeId) {
      // Manager can filter by employee with /api/tasks?employeeId=...
      // A malformed id would make Task.find throw a CastError (500)
      if (!isValidId(req.query.employeeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid employee id",
        });
      }

      filter = {
        $or: [{ assignees: req.query.employeeId }, { assignedTo: req.query.employeeId }],
      };
    }

    const tasks = await populateTask(Task.find(filter)).sort({ createdAt: -1 });

    const tasksWithFlags = tasks.map((task) => addDeadlineFlagsFor(task, req.user._id));

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
    // so the access check can compare the plain assignee ids
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

    // Access is allowed, now add the names and each assignee's own status
    const taskWithNames = await loadTaskResponse(task._id, req.user._id);

    return res.status(200).json({
      success: true,
      data: taskWithNames,
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
// Manager can edit the task and change its assignees - one person or
// several at once (the multi-select field or the legacy single id)
const updateTask = async (req, res) => {
  try {
    const { title, description, assignedTo, assignees, priority, status, dueDate } = req.body;

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

    if (assignees !== undefined && assignees !== null && !Array.isArray(assignees)) {
      return res.status(400).json({
        success: false,
        message: "assignees must be a list of user ids",
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
    const oldAssigneeIds = getAssigneeIds(task);

    // Update only the fields that were sent
    if (title) task.title = title.trim();
    if (description !== undefined && description !== null) task.description = description.trim();
    if (priority) task.priority = priority;
    if (dueDateValue) task.dueDate = dueDateValue;

    // ---------- Assignee change (multi-select list or the legacy id) ----------
    // The request may name one person (old clients) or several (the new
    // multi-select). Either way we end up with a de-duplicated list that
    // must only contain existing, active users - employees and managers
    // alike. Being on a task grants no permissions and never changes a
    // user's role.
    const usesList = assignees !== undefined && assignees !== null;
    const badAssigneeMessage = usesList
      ? "assignees must be existing, active users"
      : "assignedTo must be an existing employee";
    let newAssigneeIds = null;

    if (usesList) {
      newAssigneeIds = normalizeAssigneeIds(assignees);

      if (newAssigneeIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "assignees must include at least one user",
        });
      }
    } else if (assignedTo) {
      newAssigneeIds = normalizeAssigneeIds(assignedTo);
    }

    let addedIds = [];
    let removedIds = [];

    if (newAssigneeIds) {
      if (!haveValidIdFormat(newAssigneeIds)) {
        return res.status(400).json({
          success: false,
          message: badAssigneeMessage,
        });
      }

      const foundUsers = await User.find({ _id: { $in: newAssigneeIds } });
      const usersById = new Map(foundUsers.map((user) => [user._id.toString(), user]));
      const ineligible = newAssigneeIds.filter((id) => {
        const user = usersById.get(id);
        return !user || !user.isActive;
      });

      if (ineligible.length > 0) {
        return res.status(400).json({
          success: false,
          message: badAssigneeMessage,
        });
      }

      addedIds = newAssigneeIds.filter((id) => !oldAssigneeIds.includes(id));
      removedIds = oldAssigneeIds.filter((id) => !newAssigneeIds.includes(id));

      // Nothing to do when the same set of people is sent back
      if (addedIds.length > 0 || removedIds.length > 0) {
        task.assignees = newAssigneeIds;
        task.assignedTo = newAssigneeIds[0];

        // People who stay keep their own status; new people start with
        // their own "Pending" entry; people who leave lose their entry
        // (their notifications for this task are removed below, because
        // they can no longer open the task).
        const keptEntries = (task.progress || []).filter((entry) =>
          newAssigneeIds.includes(idOf(entry.user))
        );

        task.progress = newAssigneeIds.map(
          (id) =>
            keptEntries.find((entry) => idOf(entry.user) === id) || {
              user: id,
              status: "Pending",
              completedAt: null,
            }
        );
      }
    }

    const wasReassigned = addedIds.length > 0 || removedIds.length > 0;

    // Exactly one person replaced by exactly one other person is the
    // original single-assignee reassignment, kept exactly as it was so
    // existing history entries and notifications read the same as before.
    const isSingleSwap =
      wasReassigned && oldAssigneeIds.length === 1 && newAssigneeIds.length === 1;

    // Names for the history entries and messages of whoever joined/left
    const changedUserIds = [...addedIds, ...removedIds];
    const changedUsers =
      changedUserIds.length > 0 ? await User.find({ _id: { $in: changedUserIds } }) : [];
    const nameOf = (id) => {
      const user = changedUsers.find((entry) => entry._id.toString() === id);
      return user ? user.name : null;
    };

    // ---------- Task-level status ----------
    // A single-assignee task keeps the old behaviour: the manager can set
    // the status directly. On a task with several assignees the overall
    // status is a roll-up of everyone's own status, so it is changed by
    // each person updating their own status (PUT /:id/status) instead of
    // being overwritten here - one person finishing never changes the
    // four other people's work.
    if (status && getAssigneeIds(task).length > 1) {
      return res.status(400).json({
        success: false,
        message:
          "Each assignee updates their own status on a task with multiple assignees",
      });
    }

    const statusChanged = status ? applyStatusChange(task, status) : false;

    if (status && task.progress && task.progress.length === 1) {
      // Keep the sole assignee's entry in step with the task status
      const entry = task.progress[0];
      entry.status = task.status;
      entry.completedAt = task.status === "Completed" ? task.completedAt : null;
    }

    await task.save();

    // Notification cleanup follows the existing design (rows are keyed to
    // the task and leave with it for the person they address): people who
    // were taken off the task must not keep anything for work they no
    // longer own, and a completed task must stop showing deadline/overdue
    // reminders. Rows addressed to anyone else (e.g. the manager's
    // activity feed) are untouched. The scheduler creates fresh reminder
    // rows for the current assignees while the task is still open and due
    // soon/overdue.
    if (wasReassigned && removedIds.length > 0) {
      await Notification.deleteMany({ task: task._id, user: { $in: removedIds } });
    }

    if (statusChanged && task.status === "Completed") {
      await Notification.deleteMany({
        task: task._id,
        user: { $in: getAssigneeIds(task) },
        type: { $in: DEADLINE_NOTIFICATION_TYPES },
      });
    }

    // Record history entries for what changed
    if (wasReassigned && isSingleSwap) {
      const oldEmployeeName = nameOf(removedIds[0]);
      const newEmployeeName = nameOf(addedIds[0]);

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
    } else if (wasReassigned) {
      // A wider change: one entry per person who joined (or left), so the
      // history shows the full assignment record for each assignee, and
      // one notification for every new assignee. The dedupe keys carry
      // the user id, so each person is notified exactly once even if the
      // request is retried.
      for (const addedId of addedIds) {
        const assignedEntry = await recordHistory(
          task._id,
          "ASSIGNED",
          req.user._id,
          null,
          nameOf(addedId)
        );

        if (addedId === req.user._id.toString()) {
          continue;
        }

        await createActivityNotification({
          user: addedId,
          task: task,
          type: "task_reassigned",
          message: `Task "${task.title}" has been assigned to you by ${req.user.name}`,
          dedupeKey: `task_reassigned:${task._id}:${assignedEntry._id}:${addedId}`,
        });
      }

      for (const removedId of removedIds) {
        await recordHistory(
          task._id,
          "UNASSIGNED",
          req.user._id,
          nameOf(removedId),
          null
        );
      }

      // The task's owner hears about the change unless they made it
      if (task.createdBy && task.createdBy.toString() !== req.user._id.toString()) {
        await createActivityNotification({
          user: task.createdBy,
          task: task,
          type: "task_reassigned",
          message: `${req.user.name} updated the assignees of "${task.title}"`,
          dedupeKey: `task_reassigned_manager:${task._id}:${[...addedIds, ...removedIds].join("-")}`,
        });
      }
    }

    if (statusChanged) {
      await recordHistory(
        task._id,
        "STATUS_CHANGED",
        req.user._id,
        oldStatus,
        task.status,
        task.assignedTo
      );
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

    const taskWithNames = await loadTaskResponse(task._id, req.user._id);

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

    // Whose status is being changed? Every assignee updates their own
    // entry, so one person finishing never touches the other people's
    // work. A manager who is not on the task keeps the old behaviour and
    // can still set the status of a single-assignee task (the task and
    // its one assignee move together). On a task with several assignees
    // there is no single status a bystander could set without overwriting
    // someone's progress, so that is rejected with a clear message.
    const assigneeIds = getAssigneeIds(task);
    const requesterId = req.user._id.toString();
    let targetUserId = null;

    if (assigneeIds.includes(requesterId)) {
      targetUserId = requesterId;
    } else if (req.user.role === "manager" && assigneeIds.length === 1) {
      targetUserId = assigneeIds[0];
    } else if (req.user.role === "manager") {
      return res.status(400).json({
        success: false,
        message: "Each assignee updates their own status on a task with multiple assignees",
      });
    }

    const oldIndividualStatus = getAssigneeStatus(task, targetUserId);
    const individualChanged = oldIndividualStatus !== status;

    // Keep this assignee's own entry: statuses stay independent, and the
    // overall task status is re-derived from all of them below.
    let progressEntry = getProgressEntry(task, targetUserId);

    if (!progressEntry) {
      // Tasks written before per-assignee progress have no entry yet
      progressEntry = { user: targetUserId, status: oldIndividualStatus, completedAt: null };
      task.progress = [...(task.progress || []), progressEntry];
    }

    progressEntry.status = status;
    progressEntry.completedAt =
      status === "Completed" ? new Date() : null;

    // The task's own status is the roll-up of everyone's entry (see
    // utils/assignees.js); for a single assignee that is exactly their
    // status, so single-assignee tasks behave exactly as before.
    const overallStatus = deriveOverallStatus(task.progress) || task.status;
    const overallChanged = applyStatusChange(task, overallStatus);
    const statusChanged = individualChanged || overallChanged;

    if (statusChanged) {
      await task.save();
      const statusEntry = await recordHistory(
        task._id,
        "STATUS_CHANGED",
        req.user._id,
        oldIndividualStatus,
        status,
        targetUserId
      );

      // Completing removes this person's deadline/overdue reminders so
      // they cannot mislead; when the whole task is finished, everyone's
      // reminders go. Reopening lets the scheduler create fresh ones on
      // its next run. Task activity rows (e.g. the manager's completion
      // notification below) are kept.
      if (status === "Completed" || task.status === "Completed") {
        await Notification.deleteMany({
          task: task._id,
          user:
            task.status === "Completed" && status === "Completed"
              ? { $in: assigneeIds }
              : targetUserId,
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
            message: `${req.user.name} changed the status of "${task.title}" from ${oldIndividualStatus} to ${status}`,
            dedupeKey: `task_status_changed:${task._id}:${statusEntry._id}`,
          });
        }
      }
    }

    const taskWithNames = await loadTaskResponse(task._id, req.user._id);

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
    // Keep everyone else on the task in the loop: every other assignee
    // and the manager who created the task, except the person who wrote
    // the comment. Self-comments stay silent. One notification per
    // recipient, keyed by recipient, so a comment on a task shared by
    // five people reaches four people exactly once each. For a task with
    // a single assignee this is the same two-sided conversation as before.
    const actorId = req.user._id.toString();
    const recipientIds = [
      ...getAssigneeIds(task),
      ...(task.createdBy ? [task.createdBy.toString()] : []),
    ].filter((id, index, all) => id !== actorId && all.indexOf(id) === index);

    for (const recipientId of recipientIds) {
      await createActivityNotification({
        user: recipientId,
        task: task,
        type: "task_commented",
        message: `${req.user.name} commented on "${task.title}": "${commentPreview(comment.message)}"`,
        dedupeKey: `task_commented:${task._id}:${comment._id}:${recipientId}`,
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

    // Oldest entry first so the history reads in order. `assignee` names
    // the person a status entry belongs to on a shared task.
    const history = await TaskHistory.find({ task: task._id })
      .populate("performedBy", "name role")
      .populate("assignee", "name role")
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
