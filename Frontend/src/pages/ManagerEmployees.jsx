import { useEffect, useState } from "react";
import {
  Users,
  UserPlus,
  UserCheck,
  UserX,
  AlertCircle,
} from "lucide-react";
import api from "../services/api";
import Navbar from "../components/Navbar";

const ManagerEmployees = () => {
  const [employees, setEmployees] = useState([]);
  const [message, setMessage] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    department: "",
    designation: "",
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const loadEmployees = () => {
    return api
      .get("/users?role=employee")
      .then((response) => {
        setEmployees(response.data.data);
      })
      .catch((error) => {
        setMessage(error.response?.data?.message || "Could not load employees");
      });
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  const handleAddEmployee = async (e) => {
    e.preventDefault();

    try {
      const response = await api.post("/users", formData);

      setMessage(`Employee created: ${response.data.data.name}`);

      // Clear the form and show the new employee in the list
      setFormData({ name: "", email: "", password: "", department: "", designation: "" });
      loadEmployees();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not create employee");
    }
  };

  const toggleStatus = async (employee) => {
    try {
      await api.put(`/users/${employee._id}/status`, {
        isActive: !employee.isActive,
      });

      loadEmployees();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not change status");
    }
  };

  return (
    <div className="app-layout">
      <Navbar />

      <main className="main-content">
        <div className="page-header">
          <div className="page-title-group">
            <h1>Employee Directory</h1>
            <p>Add new team members and manage active access permissions.</p>
          </div>
        </div>

        {message && (
          <div
            className={`alert-banner ${
              message.toLowerCase().includes("created") ? "success" : "error"
            }`}
          >
            <AlertCircle size={16} />
            <span>{message}</span>
          </div>
        )}

        {/* Add Employee Form */}
        <div className="form-card">
          <div className="form-title">
            <UserPlus size={18} className="text-muted" />
            <span>Add New Employee</span>
          </div>

          <form onSubmit={handleAddEmployee}>
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
                <label>Department</label>
                <input
                  name="department"
                  className="form-control"
                  placeholder="e.g. Engineering"
                  value={formData.department}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label>Designation</label>
                <input
                  name="designation"
                  className="form-control"
                  placeholder="e.g. Senior Frontend Dev"
                  value={formData.designation}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                <UserPlus size={16} />
                <span>Create Employee Account</span>
              </button>
            </div>
          </form>
        </div>

        {/* All Employees Directory */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <Users size={18} className="text-muted" />
              <h2>All Employees ({employees.length})</h2>
            </div>
          </div>

          {employees.length === 0 ? (
            <div className="empty-state">No employees added yet</div>
          ) : (
            <div className="table-responsive">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <tr key={employee._id}>
                      <td style={{ fontWeight: 600 }}>{employee.name}</td>
                      <td>{employee.email}</td>
                      <td>{employee.department || "-"}</td>
                      <td>{employee.designation || "-"}</td>
                      <td>
                        {employee.isActive ? (
                          <span className="badge badge-active">Active</span>
                        ) : (
                          <span className="badge badge-inactive">Inactive</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`btn btn-sm ${
                            employee.isActive ? "btn-danger" : "btn-secondary"
                          }`}
                          onClick={() => toggleStatus(employee)}
                        >
                          {employee.isActive ? (
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
