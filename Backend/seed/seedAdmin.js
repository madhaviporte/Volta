require("dotenv").config();

const bcrypt = require("bcryptjs");

const connectDB = require("../src/config/db");
const User = require("../src/models/User");

// Credentials come from the environment (SEED_MANAGER_EMAIL, SEED_MANAGER_PASSWORD).
// Missing values abort before any database connection, values are never
// printed, and existing accounts are never updated or reset.
const missingEnv = ["SEED_MANAGER_EMAIL", "SEED_MANAGER_PASSWORD"].filter(
  (name) => !process.env[name] || !String(process.env[name]).trim()
);

if (missingEnv.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnv.join(", ")}`
  );
  process.exit(1);
}

const managerEmail = process.env.SEED_MANAGER_EMAIL;
const managerPassword = process.env.SEED_MANAGER_PASSWORD;

const createManager = async () => {
  try {
    await connectDB();

    const existingManager = await User.findOne({ email: managerEmail });

    if (existingManager) {
      console.log("Manager already exists");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(managerPassword, 10);

    await User.create({
      name: "Volta Manager",
      email: managerEmail,
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
