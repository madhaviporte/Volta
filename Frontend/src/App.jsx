import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import ManagerDashboard from "./pages/ManagerDashboard";
import ManagerEmployees from "./pages/ManagerEmployees";
import ManagerSettings from "./pages/ManagerSettings";
import ManagerTasks from "./pages/ManagerTasks";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import TaskDetails from "./pages/TaskDetails";
import MeetingUpdates from "./pages/MeetingUpdates";
import ProtectedRoute from "./components/ProtectedRoute";
import {
  clearSession,
  getSessionUser,
  hasValidSession,
  homePathFor,
} from "./services/auth";
// Stylesheets, in cascade order: global.css must come first because it
// carries the web-font @import, which has to stay at the top of the bundle.
// Each component/page keeps its own file under src/styles, and shared UI
// primitives (buttons, forms, cards, tables, badges, stat cards) live in
// src/styles/shared.
import "./styles/global.css";
import "./styles/theme.css";
import "./styles/shared/Buttons.css";
import "./styles/shared/Forms.css";
import "./styles/shared/Cards.css";
import "./styles/shared/Tables.css";
import "./styles/shared/Badges.css";
import "./styles/shared/StatCards.css";
import "./styles/Navbar.css";
import "./styles/Login.css";
import "./styles/NotificationBell.css";
import "./styles/TaskDetails.css";

// Opens the app: users with a valid session go to their own dashboard,
// everyone else (including expired or corrupted sessions) goes to the
// login page. The session check lives in services/auth.js so the route
// guard and the login page use the exact same rules.
const Home = () => {
  if (!hasValidSession()) {
    // Only an unusable session is cleared here; a valid session is
    // never touched during normal loading or navigation.
    clearSession();
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={homePathFor(getSessionUser())} replace />;
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

        {/* Manager-only account settings (change own login email/password) */}
        <Route
          path="/manager/settings"
          element={
            <ProtectedRoute allowedRole="manager">
              <ManagerSettings />
            </ProtectedRoute>
          }
        />

        {/* Both roles can view meetings; the backend scopes what they see */}
        <Route
          path="/meetings"
          element={
            <ProtectedRoute>
              <MeetingUpdates />
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

        {/* Unknown URLs go through Home, so a logged-in user lands on
            their own dashboard and only a visitor without a session is
            sent to the login page. "replace" keeps the broken URL out of
            the history stack, so Back returns to the real previous page
            instead of reliving the redirect. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;