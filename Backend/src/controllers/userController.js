const bcrypt = require("bcryptjs");

const User = require("../models/User");

// POST /api/users  (manager only)
// Managers create employees. There is no public registration.
const createEmployee = async (req, res) => {
  try {
    const { name, email, password, department, designation } = req.body;

    if (!name || !email || !password) {
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
      role: "employee", // managers create employees, so the role is fixed here
      department,
      designation,
    });

    return res.status(201).json({
      success: true,
      message: "Employee created successfully",
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
const updateUser = async (req, res) => {
  try {
    const { name, email, password, department, designation } = req.body;

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update only the fields that were sent
    if (name) user.name = name;
    if (email) user.email = email;
    if (department !== undefined) user.department = department;
    if (designation !== undefined) user.designation = designation;

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
