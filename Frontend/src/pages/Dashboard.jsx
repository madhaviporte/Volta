import { useNavigate } from "react-router-dom";

const Dashboard = () => {
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem("user") || "null");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  if (!user) {
    return <p className="page">Loading user...</p>;
  }

  return (
    <div className="page">
      <h1>Volta Dashboard</h1>

      <h2>Welcome, {user.name}</h2>

      <div className="card">
        <p>
          <strong>Name:</strong> {user.name}
        </p>
        <p>
          <strong>Email:</strong> {user.email}
        </p>
        <p>
          <strong>Role:</strong> {user.role}
        </p>
        {user.department && (
          <p>
            <strong>Department:</strong> {user.department}
          </p>
        )}
        {user.designation && (
          <p>
            <strong>Designation:</strong> {user.designation}
          </p>
        )}
      </div>

      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default Dashboard;
