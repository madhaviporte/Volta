const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");

const router = express.Router();

// Every notification route needs a logged-in user
router.use(protect);

router.get("/", getMyNotifications);
router.put("/read-all", markAllNotificationsRead);
router.put("/:id/read", markNotificationRead);

module.exports = router;
