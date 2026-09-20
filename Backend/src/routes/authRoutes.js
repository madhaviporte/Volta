const express = require("express");
const { login } = require("../controllers/authController");

const router = express.Router();

// Only login is public.
// Employees are created by the manager through POST /api/users
router.post("/login", login);

module.exports = router;