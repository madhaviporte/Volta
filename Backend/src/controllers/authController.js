const bcrypt = require("bcryptjs");

const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const { isText, isEmail, hasMinLength } = require("../utils/validation");

// A fixed bcrypt hash of a throwaway string (not a credential, grants
// nothing). Comparing against it when the email is unknown keeps the login
// response time uniform, so timing cannot reveal which emails are
// registered.
const DUMMY_PASSWORD_HASH =
  "$2b$10$lMj1PBUzaRfKhu.4Qkp1bu/3sKmZgncu70EM3keMOCKng5euG.zPq";

// There is no public registration.
// Employee accounts are created by the manager through POST /api/users
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!isText(email) || !isText(password) || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email });

    // Always run exactly one bcrypt comparison — for an unknown email the
    // password is compared against DUMMY_PASSWORD_HASH, so response times
    // do not distinguish "no such user" from "wrong password".
    const isPasswordValid = await bcrypt.compare(
      password,
      user ? user.password : DUMMY_PASSWORD_HASH
    );

    if (!user || !isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // The account state is only revealed after the password is proven, so
    // an unauthenticated caller can never confirm an inactive account
    // exists (a wrong password on it answers the same generic 401).
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive",
      });
    }

    const token = generateToken(user._id);

    return res.status(200).json({
      success: true,
      message: "Login successful",

      token,

      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        designation: user.designation,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/auth/me  (manager only)
//
// Lets the logged-in manager change their OWN login email and/or password.
// The account is ALWAYS taken from the verified token (req.user set by the
// protect middleware) - a user id from the client is never trusted, so a
// manager can only ever edit themselves. Employees never reach this handler
// because the managerOnly middleware rejects them first.
//
// Session behaviour: JWTs here carry only { userId } and are re-validated
// against the database on every request, so the CURRENT token stays valid
// after an email or password change and the manager is NOT logged out.
// Only future logins use the new credentials. Because a stolen token would
// likewise survive a password change, this endpoint does not silently mint
// a new token (the frontend would have to swap it); if token invalidation
// on password change is ever required, that is an authentication redesign
// and must be decided explicitly.
const updateMyCredentials = async (req, res) => {
  try {
    // req.user is the authenticated manager loaded from the token; no
    // client-supplied id is involved anywhere below.
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, user no longer exists",
      });
    }

    const { currentPassword, newEmail, newPassword, confirmNewPassword } =
      req.body;

    // The current password is mandatory for ANY credential change.
    if (!isText(currentPassword) || !currentPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password is required",
      });
    }

    // Validate email/length/confirmation shape BEFORE the bcrypt work, so
    // malformed input answers 400 without paying the hash-compare cost.
    if (newEmail !== undefined) {
      if (!isText(newEmail) || !newEmail.trim()) {
        return res.status(400).json({
          success: false,
          message: "Login email must be text",
        });
      }

      if (!isEmail(newEmail)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid login email",
        });
      }
    }

    if (newPassword !== undefined) {
      if (!isText(newPassword) || !hasMinLength(newPassword, 6)) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 6 characters",
        });
      }

      // Confirmation is only meaningful for a password change
      if (newPassword !== confirmNewPassword) {
        return res.status(400).json({
          success: false,
          message: "New password and confirmation do not match",
        });
      }
    }

    // At least one change must be requested
    if (newEmail === undefined && newPassword === undefined) {
      return res.status(400).json({
        success: false,
        message: "Provide a new login email or a new password",
      });
    }

    // Prove the current password with the existing bcrypt setup. The
    // plaintext is never stored or logged.
    const isCurrentValid = await bcrypt.compare(currentPassword, user.password);

    if (!isCurrentValid) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const normalizedEmail =
      newEmail === undefined ? undefined : newEmail.trim().toLowerCase();

    // Reject a duplicate login identifier with a clear 4xx (never a 500
    // from the unique index). The existing email is excluded from the
    // conflict check, so keeping the same email is not a false conflict.
    if (normalizedEmail && normalizedEmail !== user.email) {
      const existing = await User.findOne({ email: normalizedEmail });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: "That login email is already in use",
        });
      }

      user.email = normalizedEmail;
    }

    // Hash the new password with the same approach as everywhere else
    // (bcrypt, cost 10) before saving. The model strips `password` from
    // toJSON, so the response below can never leak the hash.
    if (newPassword) {
      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        newEmail !== undefined && newPassword !== undefined
          ? "Login email and password updated"
          : newEmail !== undefined
            ? "Login email updated"
            : "Password updated",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        designation: user.designation,
      },
    });
  } catch (error) {
    console.error("Update account settings error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

module.exports = {
  login,
  updateMyCredentials,
};