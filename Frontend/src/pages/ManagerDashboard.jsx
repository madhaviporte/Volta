import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";

const ManagerDashboard = () => {
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem("user") || "null");

  // Stats come from the backend. All values start at 0,
  // so nothing fake is shown if the API fails.
  const [stats, setStats] = useState({
    totalTasks: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    overdueTasks: 0,
    upcomingTasks: 0,
  });

  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");

  // Upcoming deadlines are filtered from the same task list the backend
  // already sends. The backend adds the dueSoon flag (deadline within the
  // next 3 days and not completed), so no new date calculation is done here.
  const upcomingTasks = tasks.filter((task) => task.dueSoon);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  useEffect(() => {
    const loadStats = async () => {
      try {
        const response = await api.get("/dashboard/manager");

        setStats(response.data.data.overall);
        setEmployees(response.data.data.employees);
      } catch (apiError) {
        setError(apiError.response?.data?.message || "Could not load statistics");
      }

      try {
        const tasksResponse = await api.get("/tasks");

        setTasks(tasksResponse.data.data);
      } catch (apiError) {
        setError("Could not load tasks");
      }
    };

    loadStats();
  }, []);

  return (
    <div className="page">
      <h1>Manager Dashboard</h1>

      <h2>Welcome, {user ? user.name : "Manager"}</h2>

      <p>
        <Link to="/manager/employees">Employees</Link> |{" "}
        <Link to="/manager/tasks">Tasks</Link>
      </p>

      {error && <p>{error}</p>}

      <div className="card">
        <p>
          <strong>Total Tasks:</strong> {stats.totalTasks}
        </p>
        <p>
          <strong>Pending Tasks:</strong> {stats.pendingTasks}
        </p>
        <p>
          <strong>In Progress Tasks:</strong> {stats.inProgressTasks}
        </p>
        <p>
          <strong>Completed Tasks:</strong> {stats.completedTasks}
        </p>
        <p>
          <strong>Overdue Tasks:</strong> {stats.overdueTasks}
        </p>
        <p>
          <strong>Upcoming Tasks (next 3 days):</strong> {stats.upcomingTasks}
        </p>
      </div>

      {/* Upcoming deadlines overview, straight from the real task list */}
      <div className="card">
        <h2>Upcoming Deadlines</h2>

        {upcomingTasks.length === 0 && <p>No upcoming deadlines in the next 3 days</p>}

        {upcomingTasks.length > 0 && (
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Task</th>
                <th>Employee</th>
                <th>Priority</th>
                <th>Due Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {upcomingTasks.map((task) => (
                <tr key={task._id}>
                  <td>
                    <Link to={`/tasks/${task._id}`}>{task.title}</Link>
                  </td>
                  <td>{task.assignedTo?.name}</td>
                  <td>{task.priority}</td>
                  <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                  <td>{task.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Employee-wise overview. The numbers come from the same
          dashboard API response, so no extra request is needed. */}
      <div className="card">
        <h2>Employee Task Overview</h2>

        {employees.length === 0 && <p>No employees with tasks yet</p>}

        {employees.length > 0 && (
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Total Tasks</th>
                <th>Pending</th>
                <th>In Progress</th>
                <th>Completed</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.employee}</td>
                  <td>{employee.totalTasks}</td>
                  <td>{employee.pending}</td>
                  <td>{employee.inProgress}</td>
                  <td>{employee.completed}</td>
                  <td>{employee.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Main task tracker: one table showing which task belongs
          to which employee and its current status */}
      <div className="card">
        <h2>Tasks</h2>

        {tasks.length === 0 && <p>No tasks yet</p>}

        {tasks.length > 0 && (
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Task</th>
                <th>Employee</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task._id}>
                  <td>
                    <Link to={`/tasks/${task._id}`}>{task.title}</Link>
                  </td>
                  <td>{task.assignedTo?.name}</td>
                  <td>{task.priority}</td>
                  <td>{task.status}</td>
                  <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                  <td>{task.isOverdue ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default ManagerDashboard;
