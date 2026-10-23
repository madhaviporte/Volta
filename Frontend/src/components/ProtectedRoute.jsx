import { Navigate } from "react-router-dom";
import {
  clearSession,
  getSessionUser,
  hasValidSession,
  homePathFor,
} from "../services/auth";

// Wraps pages that need a logged-in user.
// "allowedRole" (optional) limits the page to one role,
// e.g. allowedRole="manager" for the manager dashboard.
//
// A session is only trusted when it has a token, a saved user AND an
// unexpired token (services/auth.js); the backend still re-validates
// everything on each request. Expired or unusable sessions are cleared
// here exactly once, so a refresh can never leave a half-dead session
// that bounces between pages.
const ProtectedRoute = ({ children, allowedRole }) => {
  // Not logged in (or expired session) -> go to login page
  if (!hasValidSession()) {
    clearSession();
    return <Navigate to="/login" replace />;
  }

  const user = getSessionUser();

  // Logged in but wrong role -> send the user to their own dashboard
  if (allowedRole && user.role !== allowedRole) {
    return <Navigate to={homePathFor(user)} replace />;
  }

  return children;
};

export default ProtectedRoute;
