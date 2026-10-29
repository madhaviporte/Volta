// Helpers shared by the task, dashboard and notification controllers for
// multi-assignee tasks.
//
// Storage layout (backward compatible):
//   - `assignedTo` keeps holding the primary assignee, exactly as before,
//     so old documents, old queries and old API responses still work.
//   - `assignees` holds everyone the task is assigned to, without
//     duplicates (first entry == assignedTo).
//   - `progress` holds one entry per assignee with that person's own
//     status, so five people on one task keep five independent statuses.
// Documents written before this feature have only `assignedTo`, so every
// reader here falls back to it: getAssigneeIds() and getAssigneeStatus()
// behave identically to the old code for those rows.
//
// The organization hierarchy (Founder, Director, C-Suite, C-Suite
// Executive, Senior Associate, Associate, Trainee, Intern) is already
// represented by the existing role / designation / department fields on
// User, so no second hierarchy is stored here. Application role stays
// separate from that hierarchy: receiving a task never changes role, and
// the ability to create or assign tasks is still controlled only by the
// managerOnly middleware.

const { isValidId } = require("./validation");
const Task = require("../models/Task");

const VALID_STATUSES = Task.TASK_STATUSES;

// Turns the request value into an ordered list of unique id strings.
// Accepts the legacy single value (a string) or the new list (an array).
// Duplicates collapse to one entry, so the same person can never appear
// twice in a task or receive two notifications for one event.
const normalizeAssigneeIds = (value) => {
  const raw = Array.isArray(value) ? value : [value];
  const ids = [];

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();

    if (trimmed && !ids.includes(trimmed)) {
      ids.push(trimmed);
    }
  }

  return ids;
};

// True when every id is a well-formed ObjectId string.
const haveValidIdFormat = (ids) => ids.length > 0 && ids.every((id) => isValidId(id));

// A plain id string from either an ObjectId or a populated document,
// so the same helpers work on the raw task and on the populated API
// response.
const idOf = (value) => {
  if (!value) {
    return null;
  }

  return value._id ? value._id.toString() : value.toString();
};

// Everyone a task is assigned to, as id strings, for both new documents
// (assignees) and legacy documents that only carry assignedTo.
const getAssigneeIds = (task) => {
  if (Array.isArray(task.assignees) && task.assignees.length > 0) {
    return task.assignees.map((id) => idOf(id)).filter(Boolean);
  }

  return task.assignedTo ? [idOf(task.assignedTo)].filter(Boolean) : [];
};

// The progress entry of one assignee, or null (legacy documents have none).
const getProgressEntry = (task, userId) => {
  if (!userId || !Array.isArray(task.progress)) {
    return null;
  }

  const wanted = idOf(userId);

  return task.progress.find((entry) => idOf(entry.user) === wanted) || null;
};

// One assignee's own status. For a legacy document (or an assignee that
// predates the progress array) this falls back to the task's status,
// which is exactly what the old single-status behaviour was.
const getAssigneeStatus = (task, userId) => {
  const entry = getProgressEntry(task, userId);
  return entry ? entry.status : task.status;
};

// The overall task status derived from every assignee's own status:
//   - all assignees completed            -> Completed
//   - some completed, some not           -> In Progress (part delivered)
//   - at least one In Progress           -> In Progress
//   - otherwise at least one On Hold     -> On Hold
//   - otherwise                          -> Pending
// Returns null when there are no entries, so callers keep the stored
// task.status for legacy documents.
const deriveOverallStatus = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const statuses = entries.map((entry) => entry.status);

  if (statuses.every((status) => status === "Completed")) {
    return "Completed";
  }

  if (statuses.includes("Completed") || statuses.includes("In Progress")) {
    return "In Progress";
  }

  if (statuses.includes("On Hold")) {
    return "On Hold";
  }

  return "Pending";
};

// who is new, who is leaving and who stays when the assignee list changes
const diffAssignees = (oldIds, newIds) => {
  const oldList = oldIds.map((id) => idOf(id));
  const newList = newIds.map((id) => idOf(id));

  return {
    added: newList.filter((id) => !oldList.includes(id)),
    removed: oldList.filter((id) => !newList.includes(id)),
    kept: newList.filter((id) => oldList.includes(id)),
  };
};

// The viewer's own status for API responses: assignees get their own
// entry, everyone else (e.g. a manager who is not on the task) sees the
// overall task status, which is what the old response carried.
const statusForViewer = (task, userId) => {
  if (userId && getProgressEntry(task, userId)) {
    return getProgressEntry(task, userId).status;
  }

  return task.status;
};

module.exports = {
  VALID_STATUSES,
  idOf,
  normalizeAssigneeIds,
  haveValidIdFormat,
  getAssigneeIds,
  getProgressEntry,
  getAssigneeStatus,
  deriveOverallStatus,
  diffAssignees,
  statusForViewer,
};
