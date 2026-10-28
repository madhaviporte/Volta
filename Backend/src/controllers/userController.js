const bcrypt = require("bcryptjs");

const User = require("../models/User");
const { isValidId, isText, isValidRole } = require("../utils/validation");

// POST /api/users  (manager only)
// Managers create employee accounts and additional manager accounts.
// There is no public registration.
const createEmployee = async (req, res) => {
  try {
    const { name, email, password, department, designation, role } = req.body;

    if (!isText(name) || !isText(email) || !isText(password) || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // The role is optional and defaults to employee, so the existing
    // employee-creation flow keeps working unchanged. Only the two roles
    // the schema allows can be requested; anything else answers 400 here
    // instead of surfacing as a mongoose validation error (500).
    if (role !== undefined && !isValidRole(role)) {
      return res.status(400).json({
        success: false,
        message: 'role must be "manager" or "employee"',
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      // Defaults to employee; managers may explicitly ask for "manager",
      // which is how additional manager accounts are created.
      role: role === undefined ? "employee" : role,
      department,
      designation,
    });

    return res.status(201).json({
      success: true,
      message:
        user.role === "manager"
          ? "Manager created successfully"
          : "Employee created successfully",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        designation: user.designation,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.error("Create employee error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// GET /api/users  (manager only)
// Optional filters: ?role=employee  or  ?department=IT
const getUsers = async (req, res) => {
  try {
    const filter = {};

    if (req.query.role === "employee" || req.query.role === "manager") {
      filter.role = req.query.role;
    }

    if (req.query.department) {
      // A non-string filter (e.g. an injected query object) would make
      // User.find throw a CastError (500)
      if (!isText(req.query.department)) {
        return res.status(400).json({
          success: false,
          message: "department must be text",
        });
      }

      filter.department = req.query.department;
    }

    const users = await User.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// GET /api/users/:id  (manager only)
const getUserById = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get user error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/users/:id  (manager only)
// Edits name, email, department, designation, password and role. Because
// the protect middleware reloads the user from the database on every
// request (JWTs carry only { userId }), a role change takes effect
// immediately - no token reissue needed.
const updateUser = async (req, res) => {
  try {
    const { name, email, password, department, designation, role } = req.body;

    // Validate the id and field types before touching the database, so
    // malformed input answers 400 instead of failing inside mongoose (500)
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    if (name && !isText(name)) {
      return res.status(400).json({
        success: false,
        message: "Name must be text",
      });
    }

    if (name && isText(name) && !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    if (email && !isText(email)) {
      return res.status(400).json({
        success: false,
        message: "Email must be text",
      });
    }

    if (email && isText(email) && !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (password && !isText(password)) {
      return res.status(400).json({
        success: false,
        message: "Password must be text",
      });
    }

    if (department !== undefined && department !== null && !isText(department)) {
      return res.status(400).json({
        success: false,
        message: "Department must be text",
      });
    }

    if (designation !== undefined && designation !== null && !isText(designation)) {
      return res.status(400).json({
        success: false,
        message: "Designation must be text",
      });
    }

    // Role changes are only ever accepted as one of the two real roles;
    // null, "", objects or invented roles answer 400 instead of reaching
    // mongoose. Sending the current role again is a harmless no-op.
    if (role !== undefined && !isValidRole(role)) {
      return res.status(400).json({
        success: false,
        message: 'role must be "manager" or "employee"',
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // A manager must not change their OWN role: demoting the last manager
    // would leave the system with nobody able to manage accounts. This
    // mirrors the "cannot change your own status" rule below, and the
    // whole handler already sits behind managerOnly, so an employee can
    // never reach it to grant themselves manager access. Re-sending the
    // current role is accepted as a no-op, so saving an edit form that
    // includes the unchanged role still works.
    if (
      role !== undefined &&
      role !== user.role &&
      user._id.toString() === req.user._id.toString()
    ) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own role",
      });
    }

    // Reject a duplicate login identifier with a clear 409 (never a 500
    // from the unique index). The account's own email is excluded, so
    // saving a user without touching their email is not a false conflict.
    if (email) {
      const normalizedEmail = email.trim().toLowerCase();

      if (normalizedEmail !== user.email) {
        const existingUserWithEmail = await User.findOne({
          email: normalizedEmail,
        });

        if (existingUserWithEmail) {
          return res.status(409).json({
            success: false,
            message: "User already exists with this email",
          });
        }
      }
    }

    // Update only the fields that were sent
    if (name) user.name = name;
    if (email) user.email = email;
    if (department !== undefined) user.department = department;
    if (designation !== undefined) user.designation = designation;

    // Role switch between manager and employee (validated above)
    if (role !== undefined) user.role = role;

    // Hash the new password if the manager set one
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
      }

      user.password = await bcrypt.hash(password, 10);
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: user,
    });
  } catch (error) {
    console.error("Update user error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/users/:id/status  (manager only)
// Activates or deactivates an employee. A deactivated user cannot log in.
const updateUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false",
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // A manager should not deactivate their own account
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own status",
      });
    }

    user.isActive = isActive;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User ${isActive ? "activated" : "deactivated"} successfully`,
      data: user,
    });
  } catch (error) {
    console.error("Update user status error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

module.exports = {
  createEmployee,
  getUsers,
  getUserById,
  updateUser,
  updateUserStatus,
};
