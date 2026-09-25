import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ListTodo,
  Clock,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  AlertCircle,
} from "lucide-react";
import api from "../services/api";
import Navbar from "../components/Navbar";

const renderPriorityBadge = (priority) => {
  const p = (priority || "Medium").toLowerCase();
  return <span className={`badge badge-priority-${p}`}>{priority || "Medium"}</span>;
};

const renderStatusBadge = (status) => {
  const s = (status || "Pending").toLowerCase().replace(/\s+/g, "-");
  return <span className={`badge badge-status-${s}`}>{status || "Pending"}</span>;
};

const EmployeeDashboard = () => {
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
  const [error, setError] = useState("");

  // Upcoming and overdue lists are filtered from the same task list
  // the backend already sends. The backend adds the flags:
  // dueSoon = deadline within the next 3 days, isOverdue = past deadline
  // and not completed. No new date calculation happens here.
  const upcomingTasks = tasks.filter((task) => task.dueSoon);

  const overdueTasks = tasks.filter((task) => task.isOverdue);

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
    <div className="app-layout">
      <Navbar />

      <main className="main-content">
        <div className="page-header">
          <div className="page-title-group">
            <h1>Employee Dashboard</h1>
            <p>Welcome back, {user ? user.name : "Employee"}. Manage your workload and update task progress.</p>
          </div>
        </div>

        {error && (
          <div className="alert-banner error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* KPI Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Total Assigned</span>
              <div className="stat-icon total">
                <ListTodo size={18} />
              </div>
            </div>
            <span className="stat-value">{stats.totalTasks}</span>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Pending</span>
              <div className="stat-icon pending">
                <Clock size={18} />
              </div>
            </div>
            <span className="stat-value">{stats.pendingTasks}</span>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">In Progress</span>
              <div className="stat-icon progress">
                <PlayCircle size={18} />
              </div>
            </div>
            <span className="stat-value">{stats.inProgressTasks}</span>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Completed</span>
              <div className="stat-icon completed">
                <CheckCircle2 size={18} />
              </div>
            </div>
            <span className="stat-value">{stats.completedTasks}</span>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Overdue</span>
              <div className="stat-icon overdue">
                <AlertTriangle size={18} />
              </div>
            </div>
            <span className="stat-value">{stats.overdueTasks}</span>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Next 3 Days</span>
              <div className="stat-icon upcoming">
                <Calendar size={18} />
              </div>
            </div>
            <span className="stat-value">{stats.upcomingTasks}</span>
          </div>
        </div>

        {/* Upcoming Tasks Section */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <Calendar size={18} className="text-muted" />
              <h2>Upcoming Deadlines (Next 3 Days)</h2>
            </div>
          </div>

          {upcomingTasks.length === 0 ? (
            <div className="empty-state">No upcoming deadlines in the next 3 days</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
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
                        <Link to={`/tasks/${task._id}`} style={{ fontWeight: 600 }}>
                          {task.title}
                        </Link>
                      </td>
                      <td>{renderPriorityBadge(task.priority)}</td>
                      <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                      <td>{renderStatusBadge(task.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Overdue Tasks Section */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <AlertTriangle size={18} className="text-muted" />
              <h2>Overdue Tasks</h2>
            </div>
          </div>

          {overdueTasks.length === 0 ? (
            <div className="empty-state">No overdue tasks. Great job!</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
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
                        <Link to={`/tasks/${task._id}`} style={{ fontWeight: 600 }}>
                          {task.title}
                        </Link>
                      </td>
                      <td>{renderPriorityBadge(task.priority)}</td>
                      <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                      <td>{renderStatusBadge(task.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* My Tasks Section */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <ListTodo size={18} className="text-muted" />
              <h2>My Tasks ({tasks.length})</h2>
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="empty-state">No tasks assigned to you yet</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
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
                        <Link to={`/tasks/${task._id}`} style={{ fontWeight: 600 }}>
                          {task.title}
                        </Link>
                      </td>
                      <td>{renderPriorityBadge(task.priority)}</td>
                      <td>
                        <select
                          className="select-status-inline"
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
                      <td>
                        {task.isOverdue ? (
                          <span className="badge badge-overdue">Yes</span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default EmployeeDashboard;
