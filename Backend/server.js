require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const userRoutes = require("./src/routes/userRoutes");
const taskRoutes = require("./src/routes/taskRoutes");
const dashboardRoutes = require("./src/routes/dashboardRoutes");
const notificationRoutes = require("./src/routes/notificationRoutes");
const {
  generateDeadlineNotifications,
} = require("./src/controllers/notificationController");

const app = express();

connectDB();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Volta API is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);

// Port must be a usable TCP port. Treat 0/blank/invalid as unset so a
// stray PORT=0 in the environment can't push the server onto a random port
// (the frontend expects http://localhost:3000).
const parsedPort = parseInt(process.env.PORT, 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Create deadline/overdue reminders once at startup,
// then refresh them every 6 hours.
// Opening /api/notifications also refreshes them on demand.
generateDeadlineNotifications();
setInterval(generateDeadlineNotifications, 6 * 60 * 60 * 1000);