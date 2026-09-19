require("dotenv").config();

const bcrypt = require("bcryptjs");

const connectDB = require("../src/config/db");
const User = require("../src/models/User");

const createManager = async () => {
  try {
    await connectDB();

    const existingManager = await User.findOne({
      email: "manager@volta.com",
    });

    if (existingManager) {
      console.log("Manager already exists");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash("Manager@123", 10);

    await User.create({
      name: "Volta Manager",
      email: "manager@volta.com",
      password: hashedPassword,
      role: "manager",
      department: "Management",
      designation: "Manager",
    });

    console.log("Manager created successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error creating manager:", error.message);
    process.exit(1);
  }
};

createManager();