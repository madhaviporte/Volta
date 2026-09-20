import { Navigate } from "react-router-dom";

// Wraps pages that need a logged-in user.
// "allowedRole" (optional) limits the page to one role,
// e.g. allowedRole="manager" for the manager dashboard.
const ProtectedRoute = ({ children, allowedRole }) => {
  const token = localStorage.getItem("token");
  const user = JSON.parse(localStorage.getItem("user") || "null");

  // Not logged in -> go to login page
  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  // Logged in but wrong role -> send the user to their own dashboard
  if (allowedRole && user.role !== allowedRole) {
    if (user.role === "manager") {
      return <Navigate to="/manager/dashboard" replace />;
    }

    return <Navigate to="/employee/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
