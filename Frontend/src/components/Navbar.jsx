import { useEffect, useRef, useState } from "react";
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
  Menu,
  X,
  MoreVertical,
} from "lucide-react";
import NotificationBell from "./NotificationBell";
import { clearSession, getSessionUser } from "../services/auth";

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const user = getSessionUser();

  const handleLogout = () => {
    clearSession();
    // "replace" swaps the dashboard page out of the history stack, so the
    // browser Back button cannot return to an authenticated page that would
    // only bounce straight back to the login screen.
    navigate("/login", { replace: true });
  };

  // The theme lives on <html data-theme> (set before first paint by the
  // inline script in index.html); the toggle just flips it and persists
  // the choice to localStorage. Declared before any early return so hooks
  // always run in the same order.
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
  );

  // Mobile menu: on small screens the nav links live in a dropdown that
  // a hamburger button opens (CSS hides both on wide screens). The links
  // themselves are unchanged, so desktop navigation is untouched.
  const [menuOpen, setMenuOpen] = useState(false);
  const navToggleRef = useRef(null);
  const navMenuRef = useRef(null);
  // Three-dot logout menu (compact screens only). Kept as its own state
  // next to the nav-menu state so the two dropdowns never share a toggle.
  const [logoutOpen, setLogoutOpen] = useState(false);
  const logoutMenuRef = useRef(null);
  const [lastPath, setLastPath] = useState(location.pathname);

  // Close the mobile menu on outside click (the toggle button itself is
  // excluded so its click does not immediately reopen the menu) or Escape.
  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      const insideMenu =
        navMenuRef.current && navMenuRef.current.contains(event.target);
      const onToggle =
        navToggleRef.current && navToggleRef.current.contains(event.target);

      if (!insideMenu && !onToggle) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  // Dismissal rules for the three-dot logout menu: outside click or
  // Escape closes it (selecting Logout closes it in the handler below).
  // On wide screens CSS pins the logout button into the sidebar and
  // ignores this state, so it only matters below 1024px.
  useEffect(() => {
    if (!logoutOpen) {
      return undefined;
    }

    const handleOutsideClick = (event) => {
      if (logoutMenuRef.current && !logoutMenuRef.current.contains(event.target)) {
        setLogoutOpen(false);
      }
    };

    const handleEscapeKey = (event) => {
      if (event.key === "Escape") {
        setLogoutOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscapeKey);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [logoutOpen]);

  // Any navigation (link click, browser Back/Forward) closes the menu
  // again. This uses the "adjust state during render" pattern from the
  // React docs instead of an effect, so the menu closes in the same
  // render as the page it was opened from.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMenuOpen(false);
  }

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
    <>
      {/* Left sidebar: primary navigation (as in the reference). On
          narrow screens CSS turns it into a dropdown panel below the top
          bar, opened by the hamburger button — the same menuOpen state,
          outside-click and Escape handling as before, just repositioned. */}
      <aside
        id="primary-nav"
        className={`app-sidebar${menuOpen ? " open" : ""}`}
        ref={navMenuRef}
      >
        {/* Navigation Tabs */}
        <nav className="nav-menu" aria-label="Main navigation">
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
      </aside>

      {/* Top bar: brand, theme toggle, notifications, profile, the
          three-dot logout menu and (on compact screens) the hamburger. */}
      <header className="app-topbar">
        {/* Brand / Logo — stays in the top bar (as in the reference), so
            the identity remains visible on every screen size even when
            the sidebar collapses into the mobile dropdown. */}
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
          {/* Both roles get the bell; the backend only ever returns
              notifications addressed to the logged-in user */}
          <div className="notif-wrapper">
            <NotificationBell />
          </div>

          <div className="user-pill">
            <div className="avatar">
              <User size={16} />
            </div>
            <div className="user-details">
              <span className="user-name">{user.name}</span>
              <span className="user-role">{user.role}</span>
            </div>
          </div>

          {/* Three-dot menu: below 1024px it holds the single logout
              button; on wide screens CSS pins that same button to the
              bottom-left of the sidebar (see styles/Navbar.css). */}
          <div className="logout-menu" ref={logoutMenuRef}>
            <button
              type="button"
              className="logout-menu-toggle"
              onClick={() => setLogoutOpen((open) => !open)}
              aria-label={logoutOpen ? "Close logout menu" : "Open logout menu"}
              aria-expanded={logoutOpen}
              title={logoutOpen ? "Close logout menu" : "Open logout menu"}
            >
              <MoreVertical size={18} />
            </button>

            <div className={`logout-menu-panel${logoutOpen ? " open" : ""}`}>
              <button
                type="button"
                className="btn-logout"
                onClick={() => {
                  setLogoutOpen(false);
                  handleLogout();
                }}
                title="Logout"
              >
                <LogOut size={16} />
                <span className="logout-text">Logout</span>
              </button>
            </div>
          </div>

          {/* Hamburger: last in the row, so it sits at the far-right
              corner of the topbar on compact screens. Hidden by CSS
              wherever the sidebar is visible. */}
          <button
            type="button"
            className="nav-toggle"
            ref={navToggleRef}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            title={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
    </>
  );
};

export default Navbar;
