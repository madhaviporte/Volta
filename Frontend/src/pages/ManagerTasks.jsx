import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ListTodo,
  PlusCircle,
  Edit,
  Trash2,
  Eye,
  AlertCircle,
  CheckCircle2,
  XCircle,
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

const ManagerTasks = () => {
  const [employees, setEmployees] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [message, setMessage] = useState("");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    assignedTo: "",
    priority: "Medium",
    dueDate: "",
  });

  // Edit/reassign: which task is being edited and its form values
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState({
    title: "",
    description: "",
    assignedTo: "",
    priority: "Medium",
    dueDate: "",
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  // Managers pick an assignee from this list
  const loadEmployees = () => {
    return api
      .get("/users?role=employee")
      .then((response) => {
        setEmployees(response.data.data);
      })
      .catch(() => {
        setMessage("Could not load employees");
      });
  };

  const loadTasks = () => {
    return api
      .get("/tasks")
      .then((response) => {
        setTasks(response.data.data);
      })
      .catch(() => {
        setMessage("Could not load tasks");
      });
  };

  useEffect(() => {
    loadEmployees();
    loadTasks();
  }, []);

  const handleCreateTask = async (e) => {
    e.preventDefault();

    try {
      await api.post("/tasks", formData);

      setMessage("Task created successfully");

      setFormData({ title: "", description: "", assignedTo: "", priority: "Medium", dueDate: "" });
      loadTasks();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not create task");
    }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await api.delete(`/tasks/${taskId}`);
      loadTasks();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not delete task");
    }
  };

  // Fills the edit form with the task's current values
  const handleStartEdit = (task) => {
    setEditingId(task._id);

    setEditFormData({
      title: task.title,
      description: task.description || "",
      assignedTo: task.assignedTo?._id || "",
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
    });
  };

  const handleEditChange = (e) => {
    setEditFormData({
      ...editFormData,
      [e.target.name]: e.target.value,
    });
  };

  // Saves the edited task through the existing update API.
  // Changing "Assign To" here is what reassigns the task.
  const handleUpdateTask = async (e) => {
    e.preventDefault();

    try {
      await api.put(`/tasks/${editingId}`, editFormData);

      setMessage("Task updated successfully");

      setEditingId(null);
      loadTasks();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not update task");
    }
  };

  return (
    <div className="app-layout">
      <Navbar />

      <main className="main-content">
        <div className="page-header">
          <div className="page-title-group">
            <h1>Task Management</h1>
            <p>Create, assign, edit, and monitor all organization tasks.</p>
          </div>
        </div>

        {message && (
          <div
            className={`alert-banner ${
              message.toLowerCase().includes("success") || message.toLowerCase().includes("created")
                ? "success"
                : "error"
            }`}
          >
            <AlertCircle size={16} />
            <span>{message}</span>
          </div>
        )}

        {/* Create Task Form */}
        <div className="form-card">
          <div className="form-title">
            <PlusCircle size={18} className="text-muted" />
            <span>Create New Task</span>
          </div>

          <form onSubmit={handleCreateTask}>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: "span 2" }}>
                <label>Task Title *</label>
                <input
                  name="title"
                  className="form-control"
                  placeholder="e.g. Implement OAuth login flow"
                  value={formData.title}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group" style={{ gridColumn: "span 2" }}>
                <label>Description</label>
                <input
                  name="description"
                  className="form-control"
                  placeholder="Provide context or instructions..."
                  value={formData.description}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label>Assign To *</label>
                <select
                  name="assignedTo"
                  className="form-control"
                  value={formData.assignedTo}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option key={employee._id} value={employee._id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Priority</label>
                <select
                  name="priority"
                  className="form-control"
                  value={formData.priority}
                  onChange={handleChange}
                >
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                  <option>Urgent</option>
                </select>
              </div>

              <div className="form-group">
                <label>Due Date *</label>
                <input
                  type="date"
                  name="dueDate"
                  className="form-control"
                  value={formData.dueDate}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                <PlusCircle size={16} />
                <span>Create Task</span>
              </button>
            </div>
          </form>
        </div>

        {/* Edit/reassign form, shown only while editing a task */}
        {editingId && (
          <div className="form-card" style={{ border: "2px solid var(--primary)" }}>
            <div className="form-title" style={{ color: "var(--primary)" }}>
              <Edit size={18} />
              <span>Edit Task / Reassign</span>
            </div>

            <form onSubmit={handleUpdateTask}>
              <div className="form-grid">
                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Title *</label>
                  <input
                    name="title"
                    className="form-control"
                    value={editFormData.title}
                    onChange={handleEditChange}
                    required
                  />
                </div>

                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Description</label>
                  <input
                    name="description"
                    className="form-control"
                    value={editFormData.description}
                    onChange={handleEditChange}
                  />
                </div>

                <div className="form-group">
                  <label>Assign To *</label>
                  <select
                    name="assignedTo"
                    className="form-control"
                    value={editFormData.assignedTo}
                    onChange={handleEditChange}
                    required
                  >
                    {employees.map((employee) => (
                      <option key={employee._id} value={employee._id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Priority</label>
                  <select
                    name="priority"
                    className="form-control"
                    value={editFormData.priority}
                    onChange={handleEditChange}
                  >
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                    <option>Urgent</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Due Date *</label>
                  <input
                    type="date"
                    name="dueDate"
                    className="form-control"
                    value={editFormData.dueDate}
                    onChange={handleEditChange}
                    required
                  />
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  <CheckCircle2 size={16} />
                  <span>Save Changes</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingId(null)}
                >
                  <XCircle size={16} />
                  <span>Cancel</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* All Tasks Master Table */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <ListTodo size={18} className="text-muted" />
              <h2>All Tasks ({tasks.length})</h2>
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="empty-state">No tasks created yet</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Assigned To</th>
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
                      <td>{task.assignedTo?.name || "Unassigned"}</td>
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
                        <div className="btn-group">
                          <Link
                            to={`/tasks/${task._id}`}
                            className="btn btn-secondary btn-sm"
                            title="View Details"
                          >
                            <Eye size={12} />
                            <span>View</span>
                          </Link>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleStartEdit(task)}
                            title="Edit / Reassign"
                          >
                            <Edit size={12} />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteTask(task._id)}
                            title="Delete Task"
                          >
                            <Trash2 size={12} />
                            <span>Delete</span>
                          </button>
                        </div>
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

export default ManagerTasks;
