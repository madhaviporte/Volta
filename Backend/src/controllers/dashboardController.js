const Task = require("../models/Task");
const { isTaskOverdue, isTaskDueSoon, addDeadlineFlags } = require("../utils/deadline");

// Small helper that counts task statistics from a list of tasks
const countStats = (tasks) => {
  let pendingTasks = 0;
  let inProgressTasks = 0;
  let completedTasks = 0;
  let overdueTasks = 0;
  let upcomingTasks = 0;

  for (const task of tasks) {
    if (task.status === "Pending") pendingTasks++;
    if (task.status === "In Progress") inProgressTasks++;
    if (task.status === "Completed") completedTasks++;
    if (isTaskOverdue(task)) overdueTasks++;
    if (isTaskDueSoon(task)) upcomingTasks++;
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
    const tasks = await Task.find({}).populate("assignedTo", "name");

    // Overall numbers for all tasks
    const overallStats = countStats(tasks);

    // Group the tasks by employee to build employee-wise numbers
    const employeeStats = [];

    for (const task of tasks) {
      const employeeId = task.assignedTo._id.toString();

      // Find the employee in the list, or add them when seen for the first time
      let employeeEntry = null;
      for (const entry of employeeStats) {
        if (entry.id === employeeId) {
          employeeEntry = entry;
        }
      }

      if (!employeeEntry) {
        employeeEntry = {
          id: employeeId,
          employee: task.assignedTo.name,
          totalTasks: 0,
          pending: 0,
          inProgress: 0,
          completed: 0,
          overdue: 0,
        };
        employeeStats.push(employeeEntry);
      }

      employeeEntry.totalTasks++;
      if (task.status === "Pending") employeeEntry.pending++;
      if (task.status === "In Progress") employeeEntry.inProgress++;
      if (task.status === "Completed") employeeEntry.completed++;
      if (isTaskOverdue(task)) employeeEntry.overdue++;
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
    // Always use the logged-in user, never an id from the frontend
    const tasks = await Task.find({ assignedTo: req.user._id })
      .populate("assignedTo", "name")
      .populate("createdBy", "name")
      .sort({ dueDate: 1 });

    return res.status(200).json({
      success: true,
      data: {
        stats: countStats(tasks),
        tasks: tasks.map(addDeadlineFlags),
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
