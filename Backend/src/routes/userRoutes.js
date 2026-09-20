const express = require("express");
const { protect, managerOnly } = require("../middleware/authMiddleware");
const {
  createEmployee,
  getUsers,
  getUserById,
  updateUser,
  updateUserStatus,
} = require("../controllers/userController");

const router = express.Router();

// All user management routes are for managers only
router.use(protect, managerOnly);

router.post("/", createEmployee);
router.get("/", getUsers);
router.get("/:id", getUserById);
router.put("/:id", updateUser);
router.put("/:id/status", updateUserStatus);

module.exports = router;
