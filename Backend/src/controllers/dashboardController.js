const Task = require("../models/Task");
const { isTaskOverdue, isTaskDueSoon, addDeadlineFlags } = require("../utils/deadline");
const {
  getAssigneeIds,
  getAssigneeStatus,
  statusForViewer,
} = require("../utils/assignees");

// Small helper that counts task statistics from a list of tasks.
// With `userId` it counts each task by THAT person's own status, so an
// employee on a shared task sees their own progress (and one person
// finishing never turns the other people's cards green). Without it the
// overall task status is used, which is what the manager view shows.
const countStats = (tasks, userId) => {
  let pendingTasks = 0;
  let inProgressTasks = 0;
  let completedTasks = 0;
  let overdueTasks = 0;
  let upcomingTasks = 0;

  for (const task of tasks) {
    const status = userId ? getAssigneeStatus(task, userId) : task.status;

    if (status === "Pending") pendingTasks++;
    if (status === "In Progress") inProgressTasks++;
    if (status === "Completed") completedTasks++;

    // Deadline flags follow the same status: a task that is finished for
    // this person is neither overdue nor due soon for them.
    const flagged = addDeadlineFlags({ ...task.toObject(), status });

    if (flagged.isOverdue) overdueTasks++;
    if (flagged.dueSoon) upcomingTasks++;
  }

  return {
    totalTasks: tasks.length,
    pendingTasks,
    inProgressTasks,
    completedTasks,
    overdueTasks,
    upcomingTasks,
  };
};

// GET /api/dashboard/manager  (manager only)
const getManagerDashboard = async (req, res) => {
  try {
    const tasks = await Task.find({})
      .populate("assignedTo", "name")
      .populate("assignees", "name")
      .populate("progress.user", "name");

    // Overall numbers for all tasks (the task's own rolled-up status)
    const overallStats = countStats(tasks);

    // Group the tasks by assignee to build person-wise numbers. A task
    // shared by five people counts once for each of them, with that
    // person's own status - so the manager sees who has finished and who
    // is still working. Legacy tasks (one assignee, no progress entries)
    // group exactly as they always did.
    const employeeStats = [];
    const entryById = new Map();

    for (const task of tasks) {
      const nameById = new Map();

      for (const person of task.assignees || []) {
        nameById.set(person._id.toString(), person.name);
      }

      if (task.assignedTo) {
        nameById.set(task.assignedTo._id.toString(), task.assignedTo.name);
      }

      for (const entry of task.progress || []) {
        if (entry.user && entry.user._id) {
          nameById.set(entry.user._id.toString(), entry.user.name);
        }
      }

      for (const assigneeId of getAssigneeIds(task)) {
        let employeeEntry = entryById.get(assigneeId);

        if (!employeeEntry) {
          employeeEntry = {
            id: assigneeId,
            employee: nameById.get(assigneeId) || "Unknown",
            totalTasks: 0,
            pending: 0,
            inProgress: 0,
            completed: 0,
            overdue: 0,
          };
          entryById.set(assigneeId, employeeEntry);
          employeeStats.push(employeeEntry);
        }

        employeeEntry.totalTasks++;

        const status = getAssigneeStatus(task, assigneeId);

        if (status === "Pending") employeeEntry.pending++;
        if (status === "In Progress") employeeEntry.inProgress++;
        if (status === "Completed") employeeEntry.completed++;
        if (isTaskOverdue(task) && status !== "Completed") employeeEntry.overdue++;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        overall: overallStats,
        employees: employeeStats,
      },
    });
  } catch (error) {
    console.error("Manager dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// GET /api/dashboard/employee  (employee only)
const getEmployeeDashboard = async (req, res) => {
  try {
    // Always use the logged-in user, never an id from the frontend.
    // The $or also matches older tasks that only carry assignedTo, so
    // every task this person is on shows up exactly once.
    const tasks = await Task.find({
      $or: [{ assignees: req.user._id }, { assignedTo: req.user._id }],
    })
      .populate("assignedTo", "name")
      // The assigner shown next to each task in the employee's list
      // (name + organizational details, never a raw id)
      .populate("createdBy", "name designation department")
      .sort({ dueDate: 1 });

    return res.status(200).json({
      success: true,
      data: {
        stats: countStats(tasks, req.user._id),
        tasks: tasks.map((task) => {
          const myStatus = statusForViewer(task, req.user._id);
          const plain = addDeadlineFlags({ ...task.toObject(), status: myStatus });

          // "status" stays the task's overall status (unchanged for the
          // old clients); "myStatus" and the deadline flags describe this
          // person's own share of the work.
          plain.status = task.status;
          plain.myStatus = myStatus;

          return plain;
        }),
      },
    });
  } catch (error) {
    console.error("Employee dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

module.exports = {
  getManagerDashboard,
  getEmployeeDashboard,
};
