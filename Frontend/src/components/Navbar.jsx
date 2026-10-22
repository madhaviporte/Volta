import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  CalendarDays,
  LogOut,
  Zap,
  User,
  Shield,
  Sun,
  Moon,
  Settings,
} from "lucide-react";
import NotificationBell from "./NotificationBell";

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const user = JSON.parse(localStorage.getItem("user") || "null");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  // The theme lives on <html data-theme> (set before first paint by the
  // inline script in index.html); the toggle just flips it and persists
  // the choice to localStorage. Declared before any early return so hooks
  // always run in the same order.
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
  );

  if (!user) return null;

  const isManager = user.role === "manager";

  const isActive = (path) => location.pathname === path;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);

    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage unavailable: the theme still applies for this session
    }
  };

  const themeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <header className="app-header">
      <div className="header-container">
        {/* Brand / Logo */}
        <div className="brand-group">
          <Link to="/" className="brand-logo">
            <div className="logo-icon-box">
              <Zap className="logo-icon" size={20} />
            </div>
            <span className="brand-name">VOLTA</span>
          </Link>
          <span className="role-tag">
            <Shield size={12} className="role-icon" />
            {isManager ? "Manager Console" : "Employee Workspace"}
          </span>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-menu">
          {isManager ? (
            <>
              <Link
                to="/manager/dashboard"
                className={`nav-item ${isActive("/manager/dashboard") ? "active" : ""}`}
              >
                <LayoutDashboard size={16} />
                <span>Dashboard</span>
              </Link>
              <Link
                to="/manager/tasks"
                className={`nav-item ${isActive("/manager/tasks") ? "active" : ""}`}
              >
                <CheckSquare size={16} />
                <span>Tasks</span>
              </Link>
              <Link
                to="/meetings"
                className={`nav-item ${isActive("/meetings") ? "active" : ""}`}
              >
                <CalendarDays size={16} />
                <span>Meetings</span>
              </Link>
              <Link
                to="/manager/employees"
                className={`nav-item ${isActive("/manager/employees") ? "active" : ""}`}
              >
                <Users size={16} />
                <span>Employees</span>
              </Link>
              <Link
                to="/manager/settings"
                className={`nav-item ${isActive("/manager/settings") ? "active" : ""}`}
              >
                <Settings size={16} />
                <span>Settings</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/employee/dashboard"
                className={`nav-item ${isActive("/employee/dashboard") ? "active" : ""}`}
              >
                <LayoutDashboard size={16} />
                <span>Dashboard</span>
              </Link>
              <Link
                to="/meetings"
                className={`nav-item ${isActive("/meetings") ? "active" : ""}`}
              >
                <CalendarDays size={16} />
                <span>Meetings</span>
              </Link>
            </>
          )}
        </nav>

        {/* User profile & actions */}
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={themeLabel}
            aria-pressed={theme === "dark"}
            title={themeLabel}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {!isManager && (
            <div className="notif-wrapper">
              <NotificationBell />
            </div>
          )}

          <div className="user-pill">
            <div className="avatar">
              <User size={16} />
            </div>
            <div className="user-details">
              <span className="user-name">{user.name}</span>
              <span className="user-role">{user.role}</span>
            </div>
          </div>

          <button
            type="button"
            className="btn-logout"
            onClick={handleLogout}
            title="Logout"
          >
            <LogOut size={16} />
            <span className="logout-text">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
