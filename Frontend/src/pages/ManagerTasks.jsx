import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";

const ManagerTasks = () => {
  const navigate = useNavigate();

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

  // Managers pick an assignee from this list
  const loadEmployees = async () => {
    try {
      const response = await api.get("/users?role=employee");
      setEmployees(response.data.data);
    } catch (error) {
      setMessage("Could not load employees");
    }
  };

  const loadTasks = async () => {
    try {
      const response = await api.get("/tasks");
      setTasks(response.data.data);
    } catch (error) {
      setMessage("Could not load tasks");
    }
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

  return (
    <div className="page">
      <h1>Tasks</h1>

      <p>
        <Link to="/manager/dashboard">Dashboard</Link> |{" "}
        <Link to="/manager/employees">Employees</Link>
      </p>

      {message && <p>{message}</p>}

      <form onSubmit={handleCreateTask}>
        <h2>Create Task</h2>

        <div>
          <label>Title</label>
          <input name="title" value={formData.title} onChange={handleChange} required />
        </div>

        <div>
          <label>Description</label>
          <input name="description" value={formData.description} onChange={handleChange} />
        </div>

        <div>
          <label>Assign To</label>
          <select name="assignedTo" value={formData.assignedTo} onChange={handleChange} required>
            <option value="">Select employee</option>
            {employees.map((employee) => (
              <option key={employee._id} value={employee._id}>
                {employee.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Priority</label>
          <select name="priority" value={formData.priority} onChange={handleChange}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
        </div>

        <div>
          <label>Due Date</label>
          <input type="date" name="dueDate" value={formData.dueDate} onChange={handleChange} required />
        </div>

        <button type="submit">Create Task</button>
      </form>

      <div className="card">
        <h2>All Tasks</h2>

        {tasks.length === 0 && <p>No tasks yet</p>}

        <table border="1" cellPadding="6">
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
                  <Link to={`/tasks/${task._id}`}>{task.title}</Link>
                </td>
                <td>{task.assignedTo?.name}</td>
                <td>{task.priority}</td>
                <td>{task.status}</td>
                <td>{task.dueDate ? task.dueDate.slice(0, 10) : "-"}</td>
                <td>{task.isOverdue ? "Yes" : "No"}</td>
                <td>
                  <button onClick={() => handleDeleteTask(task._id)}>Delete</button>
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

export default ManagerTasks;
