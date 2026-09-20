import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import ManagerDashboard from "./pages/ManagerDashboard";
import ManagerEmployees from "./pages/ManagerEmployees";
import ManagerTasks from "./pages/ManagerTasks";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import TaskDetails from "./pages/TaskDetails";
import ProtectedRoute from "./components/ProtectedRoute";
import "./index.css";

// Opens the app: logged-in users go to their dashboard,
// everyone else goes to the login page
const Home = () => {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (user && user.role === "manager") {
    return <Navigate to="/manager/dashboard" replace />;
  }

  if (user) {
    return <Navigate to="/employee/dashboard" replace />;
  }

  return <Navigate to="/login" replace />;
};

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />

        {/* Only managers can open this page */}
        <Route
          path="/manager/dashboard"
          element={
            <ProtectedRoute allowedRole="manager">
              <ManagerDashboard />
            </ProtectedRoute>
          }
        />

        {/* Only employees can open this page */}
        <Route
          path="/employee/dashboard"
          element={
            <ProtectedRoute allowedRole="employee">
              <EmployeeDashboard />
            </ProtectedRoute>
          }
        />

        {/* Manager-only pages */}
        <Route
          path="/manager/employees"
          element={
            <ProtectedRoute allowedRole="manager">
              <ManagerEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="/manager/tasks"
          element={
            <ProtectedRoute allowedRole="manager">
              <ManagerTasks />
            </ProtectedRoute>
          }
        />

        {/* Both roles can open a task, the backend checks access */}
        <Route
          path="/tasks/:taskId"
          element={
            <ProtectedRoute>
              <TaskDetails />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;