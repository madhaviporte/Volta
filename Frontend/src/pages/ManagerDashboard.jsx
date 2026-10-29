import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ListTodo,
  Clock,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Users,
  AlertCircle,
  ExternalLink,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import api from "../services/api";
import Navbar from "../components/Navbar";
import MeetingSection from "../components/MeetingSection";
import "../styles/ManagerDashboard.css";

const renderPriorityBadge = (priority) => {
  const p = (priority || "Medium").toLowerCase();
  return <span className={`badge badge-priority-${p}`}>{priority || "Medium"}</span>;
};

const renderStatusBadge = (status) => {
  const s = (status || "Pending").toLowerCase().replace(/\s+/g, "-");
  return <span className={`badge badge-status-${s}`}>{status || "Pending"}</span>;
};

// Everyone a task is assigned to, in selection order. Older tasks only
// carry the primary assignee, which the fallback keeps working.
const assigneeNames = (task) => {
  const names = (task.assignees || []).map((person) => person.name).filter(Boolean);

  if (names.length > 0) return names.join(", ");
  return task.assignedTo ? task.assignedTo.name : "Unassigned";
};

const ManagerDashboard = () => {
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

  useEffect(() => {
    const loadStats = async () => {
      try {
        const response = await api.get("/dashboard/manager");

        setStats(response.data.data.overall);
        setEmployees(response.data.data.employees);
      } catch {
        setError("Could not load statistics");
      }

      try {
        const tasksResponse = await api.get("/tasks");

        setTasks(tasksResponse.data.data);
      } catch {
        setError("Could not load tasks");
      }
    };

    loadStats();
  }, []);

  // Overall completion shown by the Team Progress ring, computed from the
  // real statistics (never hard-coded): 0% while the data is loading or
  // when there are no tasks at all.
  const completionPct =
    stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  return (
    <div className="app-layout">
      <Navbar />

      <main className="main-content dashboard-grid">
        {/* Welcome banner (greeting + primary actions) */}
        <div className="welcome-banner">
          <div className="page-title-group">
            <p className="banner-eyebrow">
              Welcome back, {user ? user.name : "Manager"}
            </p>
            <h1>Manager Dashboard</h1>
            <p>Here's what's happening with your team today — progress, tasks and deadlines at a glance.</p>
          </div>
          <div className="btn-group">
            <Link to="/manager/tasks" className="btn btn-primary">
              <ListTodo size={16} />
              <span>Manage Tasks</span>
            </Link>
            <Link to="/manager/employees" className="btn btn-secondary">
              <Users size={16} />
              <span>Employees</span>
            </Link>
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
              <span className="stat-label">Total Tasks</span>
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

        {/* Team Progress — completion ring + status legend (real counts) */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <BarChart3 size={18} className="text-muted" />
              <h2>Team Progress</h2>
            </div>
            <Link
              to="/manager/tasks"
              className="btn btn-secondary btn-sm"
              title="Open task management"
            >
              <span>View details</span>
              <ChevronRight size={12} />
            </Link>
          </div>

          <div className="team-progress-body">
            <div className="progress-ring-wrap">
              <div
                className="progress-ring"
                style={{ "--progress": String(completionPct) }}
              >
                <span className="progress-ring-value">{completionPct}%</span>
              </div>
              <span className="progress-ring-caption">Overall completion</span>
            </div>

            <ul className="progress-legend">
              <li>
                <span className="legend-dot completed" />
                Completed
                <strong>{stats.completedTasks}</strong>
              </li>
              <li>
                <span className="legend-dot in-progress" />
                In Progress
                <strong>{stats.inProgressTasks}</strong>
              </li>
              <li>
                <span className="legend-dot pending" />
                Pending
                <strong>{stats.pendingTasks}</strong>
              </li>
            </ul>
          </div>
        </div>

        {/* Upcoming Deadlines */}
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
                        <Link to={`/tasks/${task._id}`} style={{ fontWeight: 600 }}>
                          {task.title}
                        </Link>
                      </td>
                      <td>{assigneeNames(task)}</td>
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

        {/* Meeting Updates */}
        <MeetingSection />

        {/* Employee Task Overview */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <Users size={18} className="text-muted" />
              <h2>Employee Workload Overview</h2>
            </div>
          </div>

          {employees.length === 0 ? (
            <div className="empty-state">No employees with tasks yet</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
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
                      <td style={{ fontWeight: 600 }}>{employee.employee}</td>
                      <td>{employee.totalTasks}</td>
                      <td>{employee.pending}</td>
                      <td>{employee.inProgress}</td>
                      <td>{employee.completed}</td>
                      <td>
                        {employee.overdue > 0 ? (
                          <span className="badge badge-overdue">{employee.overdue} Overdue</span>
                        ) : (
                          0
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Main Task Tracker (spans both columns) */}
        <div className="card-section dash-wide">
          <div className="card-header">
            <div className="card-title-group">
              <ListTodo size={18} className="text-muted" />
              <h2>All Tasks Tracker</h2>
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="empty-state">No tasks created yet</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Task Title</th>
                    <th>Employee</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Overdue</th>
                    <th>Action</th>
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
                      <td>{assigneeNames(task)}</td>
                      <td>{renderPriorityBadge(task.priority)}</td>
                      <td>{renderStatusBadge(task.status)}</td>
                      <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                      <td>
                        {task.isOverdue ? (
                          <span className="badge badge-overdue">Yes</span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>No</span>
                        )}
                      </td>
                      <td>
                        <Link to={`/tasks/${task._id}`} className="btn btn-secondary btn-sm">
                          <ExternalLink size={12} />
                          <span>View</span>
                        </Link>
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

export default ManagerDashboard;
