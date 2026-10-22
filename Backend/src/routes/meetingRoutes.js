const express = require("express");
const { protect, managerOnly } = require("../middleware/authMiddleware");
const {
  createMeeting,
  getMeetings,
  updateMeeting,
  cancelMeeting,
  addSummary,
} = require("../controllers/meetingController");

const router = express.Router();

// Every meeting route needs a logged-in user
router.use(protect);

// Managers schedule, edit, cancel and publish summaries;
// employees can only read (the controller scopes reads to participants).
router.post("/", managerOnly, createMeeting);
router.get("/", getMeetings);
router.put("/:id", managerOnly, updateMeeting);
router.put("/:id/cancel", managerOnly, cancelMeeting);
router.put("/:id/summary", managerOnly, addSummary);

module.exports = router;
