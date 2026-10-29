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
import DescriptionEditor from "../components/DescriptionEditor";

const renderPriorityBadge = (priority) => {
  const p = (priority || "Medium").toLowerCase();
  return <span className={`badge badge-priority-${p}`}>{priority || "Medium"}</span>;
};

const renderStatusBadge = (status) => {
  const s = (status || "Pending").toLowerCase().replace(/\s+/g, "-");
  return <span className={`badge badge-status-${s}`}>{status || "Pending"}</span>;
};

// Adds/removes one user from an assignee selection (create and edit forms).
// The form state is an OBJECT (title, description, assignees, ...), so the
// updater spreads it and replaces only the assignees list - handing the bare
// array to the setter would replace the whole form value with an array and
// leave every other field (and the selection itself) undefined.
const toggleAssignee = (setter, userId) => {
  setter((prev) => {
    const current = Array.isArray(prev.assignees) ? prev.assignees : [];

    return {
      ...prev,
      assignees: current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    };
  });
};

// Multi-select "Assign To" field: one checkbox per eligible user. Both the
// create and the edit form render this same block, so they can never
// disagree on the shape of the payload (assignees: [id, id, ...]).
// Managers and employees are both selectable - being assigned a task does
// not change anyone's role or permissions.
const AssigneePicker = ({ users = [], selected = [], onToggle }) => {
  if (users.length === 0) {
    return (
      <div className="assignee-picker">
        <p className="assignee-picker-empty">No users available yet</p>
      </div>
    );
  }

  return (
    <div className="assignee-picker" role="group" aria-label="Assign to">
      {users.map((person) => {
        const checked = selected.includes(person._id);

        return (
          <label
            key={person._id}
            className={`assignee-option${checked ? " selected" : ""}`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(person._id)}
            />
            <span className="assignee-option-name">{person.name}</span>
            <span className="assignee-option-role">
              {person.designation || (person.role === "manager" ? "Manager" : "Employee")}
            </span>
          </label>
        );
      })}
    </div>
  );
};

// Every name a task is assigned to, in the order they were selected.
const assigneeNames = (task) => {
  const names = (task.assignees || []).map((person) => person.name).filter(Boolean);

  if (names.length > 0) return names.join(", ");
  return task.assignedTo ? task.assignedTo.name : "Unassigned";
};

const ManagerTasks = () => {
  // Everyone a task can be assigned to: employees and eligible managers
  // (the endpoint is manager-only, and the backend re-validates every id)
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [message, setMessage] = useState("");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    assignees: [],
    priority: "Medium",
    dueDate: "",
  });

  // In-flight guards so a double click can never fire the same request twice
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Edit/reassign: which task is being edited and its form values
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState({
    title: "",
    description: "",
    assignees: [],
    priority: "Medium",
    dueDate: "",
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  // Managers pick their assignees from this list (active users only;
  // the backend rejects anything else anyway)
  const loadEmployees = () => {
    return api
      .get("/users")
      .then((response) => {
        setAssignableUsers(
          (response.data.data || []).filter((person) => person.isActive !== false)
        );
      })
      .catch(() => {
        setMessage("Could not load users");
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

    // Ignore repeat submits while the first request is still pending
    if (creating) return;

    // At least one person must be selected (the old single dropdown made
    // this impossible to skip)
    if (formData.assignees.length === 0) {
      setMessage("Select at least one person to assign this task to");
      return;
    }

    setCreating(true);

    try {
      await api.post("/tasks", formData);

      setMessage("Task created successfully");

      setFormData({ title: "", description: "", assignees: [], priority: "Medium", dueDate: "" });
      loadTasks();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not create task");
    } finally {
      // Always re-enable, so a failed request never locks the form
      setCreating(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    // A delete is already running: don't queue up another one
    if (deletingId) return;

    const task = tasks.find((t) => t._id === taskId);

    const confirmed = window.confirm(
      task
        ? `Delete "${task.title}" permanently?\n\nIts comments, history and notifications will be removed too. This cannot be undone.`
        : "Delete this task permanently?\n\nThis cannot be undone."
    );

    // Cancelled: no delete request is ever sent
    if (!confirmed) return;

    setDeletingId(taskId);

    try {
      await api.delete(`/tasks/${taskId}`);
      loadTasks();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not delete task");
    } finally {
      setDeletingId(null);
    }
  };

  // Fills the edit form with the task's current values
  const handleStartEdit = (task) => {
    setEditingId(task._id);

    setEditFormData({
      title: task.title,
      description: task.description || "",
      // Older tasks only carry the primary assignee, so both shapes end
      // up as the same list of ids
      assignees: task.assignees?.length
        ? task.assignees.map((person) => person._id)
        : task.assignedTo?._id
          ? [task.assignedTo._id]
          : [],
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

    if (saving) return;

    if (editFormData.assignees.length === 0) {
      setMessage("Select at least one person to assign this task to");
      return;
    }

    setSaving(true);

    try {
      await api.put(`/tasks/${editingId}`, editFormData);

      setMessage("Task updated successfully");

      setEditingId(null);
      loadTasks();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not update task");
    } finally {
      setSaving(false);
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
              <div className="form-group span-2">
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

              <div className="form-group span-2">
                <label htmlFor="task-description">Description</label>
                <DescriptionEditor
                  fieldId="task-description"
                  placeholder="Provide context or instructions..."
                  value={formData.description}
                  onChange={(text) => setFormData((prev) => ({ ...prev, description: text }))}
                />
              </div>

              <div className="form-group span-2">
                <label>Assign To * (pick one or more people)</label>

                <AssigneePicker
                  users={assignableUsers}
                  selected={formData.assignees}
                  onToggle={(userId) => toggleAssignee(setFormData, userId)}
                />
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
              <button type="submit" className="btn btn-primary" disabled={creating}>
                <PlusCircle size={16} />
                <span>{creating ? "Creating..." : "Create Task"}</span>
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
                <div className="form-group span-2">
                  <label>Title *</label>
                  <input
                    name="title"
                    className="form-control"
                    value={editFormData.title}
                    onChange={handleEditChange}
                    required
                  />
                </div>

                <div className="form-group span-2">
                  <label htmlFor="task-edit-description">Description</label>
                  <DescriptionEditor
                    fieldId="task-edit-description"
                    value={editFormData.description}
                    onChange={(text) => setEditFormData((prev) => ({ ...prev, description: text }))}
                  />
                </div>

                <div className="form-group span-2">
                  <label>Assign To * (pick one or more people)</label>
                  <AssigneePicker
                    users={assignableUsers}
                    selected={editFormData.assignees}
                    onToggle={(userId) => toggleAssignee(setEditFormData, userId)}
                  />
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
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  <CheckCircle2 size={16} />
                  <span>{saving ? "Saving..." : "Save Changes"}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingId(null)}
                  disabled={saving}
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
                            disabled={deletingId !== null}
                            title="Delete Task"
                          >
                            <Trash2 size={12} />
                            <span>{deletingId === task._id ? "Deleting..." : "Delete"}</span>
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
