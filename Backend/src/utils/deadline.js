// Shared deadline logic for tasks.
// Used by both the task controller and the dashboard controller so the
// rules exist in only one place.

// How many days ahead a task counts as "upcoming"
const UPCOMING_DAYS = 3;

// A task is overdue when its due date has passed and it is not completed
const isTaskOverdue = (task) => {
  return task.status !== "Completed" && task.dueDate && task.dueDate < new Date();
};

// A task is "upcoming" when it is due within the next 3 days and not completed
const isTaskDueSoon = (task) => {
  if (!task.dueDate || task.status === "Completed") {
    return false;
  }

  const threeDaysFromNow = new Date(Date.now() + UPCOMING_DAYS * 24 * 60 * 60 * 1000);
  return task.dueDate >= new Date() && task.dueDate <= threeDaysFromNow;
};

// Adds isOverdue / dueSoon flags to a task so the frontend
// does not have to calculate them itself
const addDeadlineFlags = (task) => {
  const taskObject = task.toObject();
  taskObject.isOverdue = isTaskOverdue(task);
  taskObject.dueSoon = isTaskDueSoon(task);
  return taskObject;
};

module.exports = { isTaskOverdue, isTaskDueSoon, addDeadlineFlags, UPCOMING_DAYS };
