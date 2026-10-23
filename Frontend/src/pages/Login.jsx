import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Zap, Mail, Lock, LogIn, AlertCircle } from "lucide-react";
import api, { resetSessionExpired } from "../services/api";
import { getSessionUser, hasValidSession, homePathFor } from "../services/auth";

const Login = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Already logged in (e.g. the browser Back button returned here, or the
  // URL was opened directly): send the user to their own dashboard instead
  // of showing the login form again. "replace" keeps the login page out of
  // the history stack so Back from the dashboard does not land here.
  if (hasValidSession()) {
    return <Navigate to={homePathFor(getSessionUser())} replace />;
  }

  const handleLogin = async (e) => {
    e.preventDefault();

    // One login request at a time
    if (submitting) return;

    setSubmitting(true);

    try {
      const response = await api.post("/auth/login", {
        email,
        password,
      });

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));

      // A fresh session: any earlier 401 handled for this page session
      // must not suppress expiry handling for the new token.
      resetSessionExpired();

      setMessage("Login successful");

      // The backend decides the role, and it decides where the user goes.
      // "replace" swaps the login page out of the history stack, so the
      // browser Back button returns to whatever came before it (usually
      // an external page), not to the login form.
      navigate(homePathFor(response.data.user), { replace: true });
    } catch (error) {
      setMessage(
        error.response?.data?.message || "Login failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <Zap size={28} />
          </div>
          <h1>Sign in to Volta</h1>
          <p>Enterprise Task & Team OS</p>
        </div>

        {message && (
          <div className={`alert-banner ${message.toLowerCase().includes("successful") ? "success" : "error"}`}>
            <AlertCircle size={16} />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>Email Address</label>
            <div style={{ position: "relative" }}>
              <input
                type="email"
                className="form-control"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ paddingLeft: "36px" }}
              />
              <Mail
                size={16}
                style={{
                  position: "absolute",
                  left: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Password</label>
            <div style={{ position: "relative" }}>
              <input
                type="password"
                className="form-control"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ paddingLeft: "36px" }}
              />
              <Lock
                size={16}
                style={{
                  position: "absolute",
                  left: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: "12px" }}
            disabled={submitting}
          >
            <LogIn size={16} />
            <span>{submitting ? "Signing in..." : "Login to Portal"}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;