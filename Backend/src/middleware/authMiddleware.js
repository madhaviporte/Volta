const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Checks the "Authorization: Bearer <token>" header.
// On success, the logged-in user is attached to req.user.
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Header must look like: Bearer <token>
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, no token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    // Verify the token signature and expiry
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Load the real user from the database
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, user no longer exists",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, this account is deactivated",
      });
    }

    // Attach the logged-in user to the request
    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, token is invalid or expired",
    });
  }
};

// Use after "protect" to allow managers only
const managerOnly = (req, res, next) => {
  if (req.user && req.user.role === "manager") {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Access denied. Managers only",
  });
};

module.exports = { protect, managerOnly };
