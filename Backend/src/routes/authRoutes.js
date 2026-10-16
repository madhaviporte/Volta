const express = require("express");
const rateLimit = require("express-rate-limit");
const { login } = require("../controllers/authController");

const router = express.Router();

// Only login is public.
// Employees are created by the manager through POST /api/users

// Brute-force protection: counts failed attempts only (successful logins do
// not consume the budget), 10 per client per 15 minutes, standard RateLimit
// headers, 429 with the usual { success, message } body.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  message: {
    success: false,
    message: "Too many login attempts, please try again later.",
  },
});

router.post("/login", loginLimiter, login);

module.exports = router;
