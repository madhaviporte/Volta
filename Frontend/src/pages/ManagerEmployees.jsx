import { useEffect, useState } from "react";
import {
  Users,
  UserPlus,
  UserCheck,
  UserX,
  Edit,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import api from "../services/api";
import Navbar from "../components/Navbar";
import { getSessionUser } from "../services/auth";

// The only two roles the backend accepts (mirrors the User schema enum)
const ROLES = [
  { value: "employee", label: "Employee" },
  { value: "manager", label: "Manager" },
];

// Job organisation fields (requirement: keep these separate from the
// application role above - a "Manager" account still picks a department
// and a designation like anyone else).
const DEPARTMENTS = [
  "Executive Leadership",
  "Engineering / Technology",
  "Product",
  "Design",
  "Marketing",
  "Finance",
  "Operations",
  "Human Resources",
  "Sales",
  "Customer Support",
];

const DESIGNATIONS = [
  "Founder",
  "Director",
  "CEO",
  "COO",
  "CTO",
  "CFO",
  "CMO",
  "C-Suite Executive",
  "Senior Associate",
  "Associate",
  "Trainee",
  "Intern",
];

// Accounts created before these lists existed may still hold free-text
// values (or be empty). When the stored value is not one of the current
// options it is offered first, so the edit form keeps showing what is
// actually saved and saving without touching the field leaves it intact
// instead of silently swapping in a different value.
const optionsWith = (options, storedValue) =>
  storedValue && !options.includes(storedValue)
    ? [storedValue, ...options]
    : options;

const renderRoleBadge = (role) => (
  <span className={`badge badge-role-${role === "manager" ? "manager" : "employee"}`}>
    {role === "manager" ? "Manager" : "Employee"}
  </span>
);

const emptyForm = {
  name: "",
  email: "",
  password: "",
  department: "",
  designation: "",
  role: "employee",
};

const ManagerEmployees = () => {
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState("");

  // Guards against double-clicks firing the same request twice
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const [formData, setFormData] = useState(emptyForm);

  // Edit an existing account: which user is open and its form values
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState({
    name: "",
    email: "",
    department: "",
    designation: "",
    role: "employee",
  });

  // A manager may edit their own details, but the backend refuses a self
  // role change (it would allow demoting the last manager), so that one
  // field is locked for the logged-in account instead of failing on save.
  const currentUserId = getSessionUser()?.id;

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const loadUsers = () => {
    return api
      .get("/users")
      .then((response) => {
        setUsers(response.data.data);
      })
      .catch((error) => {
        setMessage(error.response?.data?.message || "Could not load users");
      });
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();

    if (creating) return;

    setCreating(true);

    try {
      const response = await api.post("/users", formData);
      const created = response.data.data;

      setMessage(
        `${created.role === "manager" ? "Manager" : "Employee"} created: ${created.name}`
      );

      // Clear the form and show the new account in the list
      setFormData(emptyForm);
      loadUsers();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not create account");
    } finally {
      // Re-enable on success and on failure alike
      setCreating(false);
    }
  };

  // Fills the edit form with the account's current values
  const handleStartEdit = (user) => {
    setEditingId(user._id);

    setEditFormData({
      name: user.name || "",
      email: user.email || "",
      department: user.department || "",
      designation: user.designation || "",
      role: user.role || "employee",
    });
  };

  const handleEditChange = (e) => {
    setEditFormData({
      ...editFormData,
      [e.target.name]: e.target.value,
    });
  };

  // Saves the edited account through the existing update API.
  // Changing "Role" here is what promotes or demotes the account; the
  // backend re-checks authorization on every request, so the new role
  // applies from the next request onwards.
  const handleUpdateUser = async (e) => {
    e.preventDefault();

    if (saving) return;

    setSaving(true);

    try {
      await api.put(`/users/${editingId}`, editFormData);

      setMessage(`User updated: ${editFormData.name}`);

      setEditingId(null);
      loadUsers();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not update user");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (user) => {
    if (togglingId) return;

    setTogglingId(user._id);

    try {
      await api.put(`/users/${user._id}/status`, {
        isActive: !user.isActive,
      });

      loadUsers();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not change status");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="app-layout">
      <Navbar />

      <main className="main-content">
        <div className="page-header">
          <div className="page-title-group">
            <h1>User Directory</h1>
            <p>
              Add new team members, edit account details and manage roles and
              access permissions.
            </p>
          </div>
        </div>

        {message && (
          <div
            className={`alert-banner ${
              message.toLowerCase().includes("created") ||
              message.toLowerCase().includes("updated")
                ? "success"
                : "error"
            }`}
          >
            <AlertCircle size={16} />
            <span>{message}</span>
          </div>
        )}

        {/* Add Account Form */}
        <div className="form-card">
          <div className="form-title">
            <UserPlus size={18} className="text-muted" />
            <span>Add New Account</span>
          </div>

          <form onSubmit={handleAddUser}>
            <div className="form-grid">
              <div className="form-group">
                <label>Full Name *</label>
                <input
                  name="name"
                  className="form-control"
                  placeholder="e.g. John Doe"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>Email Address *</label>
                <input
                  type="email"
                  name="email"
                  className="form-control"
                  placeholder="john@company.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>Password *</label>
                <input
                  type="password"
                  name="password"
                  className="form-control"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>Role</label>
                <select
                  name="role"
                  className="form-control"
                  value={formData.role}
                  onChange={handleChange}
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Department</label>
                <select
                  name="department"
                  className="form-control"
                  value={formData.department}
                  onChange={handleChange}
                >
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Designation</label>
                <select
                  name="designation"
                  className="form-control"
                  value={formData.designation}
                  onChange={handleChange}
                >
                  <option value="">Select designation</option>
                  {DESIGNATIONS.map((designation) => (
                    <option key={designation} value={designation}>
                      {designation}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                <UserPlus size={16} />
                <span>
                  {creating
                    ? "Creating..."
                    : formData.role === "manager"
                      ? "Create Manager Account"
                      : "Create Employee Account"}
                </span>
              </button>
            </div>
          </form>
        </div>

        {/* Edit account form, shown only while editing a user */}
        {editingId && (
          <div className="form-card" style={{ border: "2px solid var(--primary)" }}>
            <div className="form-title" style={{ color: "var(--primary)" }}>
              <Edit size={18} />
              <span>Edit User</span>
            </div>

            <form onSubmit={handleUpdateUser}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Full Name *</label>
                  <input
                    name="name"
                    className="form-control"
                    value={editFormData.name}
                    onChange={handleEditChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Email Address *</label>
                  <input
                    type="email"
                    name="email"
                    className="form-control"
                    value={editFormData.email}
                    onChange={handleEditChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Role</label>
                  <select
                    name="role"
                    className="form-control"
                    value={editFormData.role}
                    onChange={handleEditChange}
                    disabled={editingId === currentUserId}
                    title={
                      editingId === currentUserId
                        ? "You cannot change your own role"
                        : undefined
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Department</label>
                  <select
                    name="department"
                    className="form-control"
                    value={editFormData.department}
                    onChange={handleEditChange}
                  >
                    <option value="">Not set</option>
                    {optionsWith(DEPARTMENTS, editFormData.department).map(
                      (department) => (
                        <option key={department} value={department}>
                          {department}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div className="form-group">
                  <label>Designation</label>
                  <select
                    name="designation"
                    className="form-control"
                    value={editFormData.designation}
                    onChange={handleEditChange}
                  >
                    <option value="">Not set</option>
                    {optionsWith(DESIGNATIONS, editFormData.designation).map(
                      (designation) => (
                        <option key={designation} value={designation}>
                          {designation}
                        </option>
                      )
                    )}
                  </select>
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

        {/* All Users Directory */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <Users size={18} className="text-muted" />
              <h2>All Users ({users.length})</h2>
            </div>
          </div>

          {users.length === 0 ? (
            <div className="empty-state">No users added yet</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user._id}>
                      <td style={{ fontWeight: 600 }}>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{user.department || "-"}</td>
                      <td>{user.designation || "-"}</td>
                      <td>{renderRoleBadge(user.role)}</td>
                      <td>
                        {user.isActive ? (
                          <span className="badge badge-active">Active</span>
                        ) : (
                          <span className="badge badge-inactive">Inactive</span>
                        )}
                      </td>
                      <td>
                        <div className="btn-group">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleStartEdit(user)}
                            disabled={togglingId !== null}
                          >
                            <Edit size={12} />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            className={`btn btn-sm ${
                              user.isActive ? "btn-danger" : "btn-secondary"
                            }`}
                            onClick={() => toggleStatus(user)}
                            disabled={togglingId !== null}
                          >
                            {user.isActive ? (
                              <>
                                <UserX size={12} />
                                <span>Deactivate</span>
                              </>
                            ) : (
                              <>
                                <UserCheck size={12} />
                                <span>Activate</span>
                              </>
                            )}
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

export default ManagerEmployees;
