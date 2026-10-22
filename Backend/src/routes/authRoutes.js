const express = require("express");
const rateLimit = require("express-rate-limit");
const { login, updateMyCredentials } = require("../controllers/authController");
const { protect, managerOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// Only login is public.
// Employees are created by the manager through POST /api/users

// Brute-force protection: counts failed attempts only (successful logins do
// not consume the budget), 10 per client per 15 minutes, standard RateLimit
// headers, 429 with the usual { success, message } body.
//
// LOGIN_RATE_LIMIT may raise or lower the budget (test environments need a
// higher one so the suite's negative login tests never trip the limiter).
// Unset or invalid values keep the default of 10, so production behaviour
// is unchanged.
const parsedLoginLimit = parseInt(process.env.LOGIN_RATE_LIMIT, 10);
const loginLimit =
  Number.isInteger(parsedLoginLimit) && parsedLoginLimit > 0 ? parsedLoginLimit : 10;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: loginLimit,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  message: {
    success: false,
    message: "Too many login attempts, please try again later.",
  },
});

router.post("/login", loginLimiter, login);

// Manager-only account settings. The account being edited is derived from
// the verified token (req.user) inside the controller - no client-supplied
// id is trusted, and employees are rejected by managerOnly with a 403.
router.put("/me", protect, managerOnly, updateMyCredentials);

module.exports = router;
