const express = require("express");
const { protect, managerOnly } = require("../middleware/authMiddleware");
const {
  getManagerDashboard,
  getEmployeeDashboard,
} = require("../controllers/dashboardController");

const router = express.Router();

router.use(protect);

// Manager sees stats for all employees, employee sees only their own stats
router.get("/manager", managerOnly, getManagerDashboard);
router.get("/employee", getEmployeeDashboard);

module.exports = router;
