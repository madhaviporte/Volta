import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";

const ManagerEmployees = () => {
  const navigate = useNavigate();

  const [employees, setEmployees] = useState([]);
  const [message, setMessage] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    department: "",
    designation: "",
  });

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const loadEmployees = async () => {
    try {
      const response = await api.get("/users?role=employee");
      setEmployees(response.data.data);
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not load employees");
    }
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
    <div className="page">
      <h1>Employees</h1>

      <p>
        <Link to="/manager/dashboard">Dashboard</Link> |{" "}
        <Link to="/manager/tasks">Tasks</Link>
      </p>

      {message && <p>{message}</p>}

      <form onSubmit={handleAddEmployee}>
        <h2>Add Employee</h2>

        <div>
          <label>Name</label>
          <input name="name" value={formData.name} onChange={handleChange} required />
        </div>

        <div>
          <label>Email</label>
          <input type="email" name="email" value={formData.email} onChange={handleChange} required />
        </div>

        <div>
          <label>Password</label>
          <input type="password" name="password" value={formData.password} onChange={handleChange} required />
        </div>

        <div>
          <label>Department</label>
          <input name="department" value={formData.department} onChange={handleChange} />
        </div>

        <div>
          <label>Designation</label>
          <input name="designation" value={formData.designation} onChange={handleChange} />
        </div>

        <button type="submit">Add Employee</button>
      </form>

      <div className="card">
        <h2>All Employees</h2>

        {employees.length === 0 && <p>No employees yet</p>}

        <table border="1" cellPadding="6">
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
                <td>{employee.name}</td>
                <td>{employee.email}</td>
                <td>{employee.department}</td>
                <td>{employee.designation}</td>
                <td>{employee.isActive ? "Active" : "Inactive"}</td>
                <td>
                  <button onClick={() => toggleStatus(employee)}>
                    {employee.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default ManagerEmployees;
