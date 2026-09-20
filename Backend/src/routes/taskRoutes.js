const express = require("express");
const { protect, managerOnly } = require("../middleware/authMiddleware");
const {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  updateTaskStatus,
  addComment,
  getComments,
  getTaskHistory,
} = require("../controllers/taskController");

const router = express.Router();

// Every task route needs a logged-in user
router.use(protect);

// ---------- Task routes ----------

// Manager creates tasks; employees only GET (their own tasks)
router.post("/", managerOnly, createTask);

// Manager sees all tasks, employee sees only their own
router.get("/", getTasks);
router.get("/:id", getTaskById);

// Manager edits and deletes tasks; employees cannot
router.put("/:id", managerOnly, updateTask);
router.delete("/:id", managerOnly, deleteTask);

// Both roles update status, but the controller checks
// that an employee only updates their own task
router.put("/:id/status", updateTaskStatus);

// ---------- Comment routes ----------

router.post("/:taskId/comments", addComment);
router.get("/:taskId/comments", getComments);

// ---------- History route ----------

router.get("/:taskId/history", getTaskHistory);

module.exports = router;
