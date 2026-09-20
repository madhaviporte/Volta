import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";

const EmployeeDashboard = () => {
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
  });

  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");

  // Upcoming and overdue lists are filtered from the same task list
  // the backend already sends. The backend adds the flags:
  // dueSoon = deadline within the next 3 days, isOverdue = past deadline
  // and not completed. No new date calculation happens here.
  const upcomingTasks = tasks.filter((task) => task.dueSoon);

  const overdueTasks = tasks.filter((task) => task.isOverdue);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const response = await api.get("/dashboard/employee");

        setStats(response.data.data.stats);
        setTasks(response.data.data.tasks);
      } catch (apiError) {
        setError(apiError.response?.data?.message || "Could not load statistics");
      }
    };

    loadDashboard();
  }, []);

  const handleStatusChange = async (task, newStatus) => {
    try {
      await api.put(`/tasks/${task._id}/status`, { status: newStatus });

      // Reload so the stats and the task list stay correct
      const response = await api.get("/dashboard/employee");
      setStats(response.data.data.stats);
      setTasks(response.data.data.tasks);
    } catch (error) {
      setError(error.response?.data?.message || "Could not update status");
    }
  };

  return (
    <div className="page">
      <h1>Employee Dashboard</h1>

      <h2>Welcome, {user ? user.name : "Employee"}</h2>

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
      </div>

      <div className="card">
        <h2>Upcoming Tasks</h2>

        {upcomingTasks.length === 0 && <p>No upcoming deadlines in the next 3 days</p>}

        {upcomingTasks.length > 0 && (
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Task</th>
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
                  <td>{task.priority}</td>
                  <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                  <td>{task.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Overdue Tasks</h2>

        {overdueTasks.length === 0 && <p>No overdue tasks</p>}

        {overdueTasks.length > 0 && (
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Task</th>
                <th>Priority</th>
                <th>Due Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {overdueTasks.map((task) => (
                <tr key={task._id}>
                  <td>
                    <Link to={`/tasks/${task._id}`}>{task.title}</Link>
                  </td>
                  <td>{task.priority}</td>
                  <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                  <td>{task.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>My Tasks</h2>

        {tasks.length === 0 && <p>No tasks assigned to you yet</p>}

        {tasks.length > 0 && (
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Title</th>
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
                  <td>{task.priority}</td>
                  <td>
                    <select
                      value={task.status}
                      onChange={(e) => handleStatusChange(task, e.target.value)}
                    >
                      <option>Pending</option>
                      <option>In Progress</option>
                      <option>Completed</option>
                      <option>On Hold</option>
                    </select>
                  </td>
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

export default EmployeeDashboard;
