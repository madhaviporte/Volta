import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Zap, Mail, Lock, LogIn, AlertCircle } from "lucide-react";
import api, { resetSessionExpired } from "../services/api";
import { getSessionUser, hasValidSession, homePathFor } from "../services/auth";

// Basic shape check only. The server remains the authority on whether an
// account exists and whether the password is right; this just catches
// typos before a request is made.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Login = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
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

    // Field-level checks first: an empty or malformed value is described
    // precisely and never becomes a generic "wrong credentials" answer.
    const trimmedEmail = email.trim();
    const nextErrors = { email: "", password: "" };

    if (!trimmedEmail) {
      nextErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email =
        "Enter a valid email address, e.g. name@company.com.";
    }

    if (!password) {
      nextErrors.password = "Enter your password.";
    }

    setFieldErrors(nextErrors);

    if (nextErrors.email || nextErrors.password) {
      setMessage("");
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post("/auth/login", {
        email: trimmedEmail,
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
      const status = error.response?.status;
      const serverMessage = error.response?.data?.message;

      // The backend answers the two rejected-credential cases separately
      // (unknown address vs. wrong password), so its message is shown as-is:
      //   "Email address is incorrect or not registered."
      //   "Incorrect password. Please try again."
      // This deliberately reveals whether an address has an account - an
      // accepted trade-off for this internal tool, documented in
      // Backend/src/controllers/authController.js.
      if (status === 400 || status === 401) {
        setMessage(
          serverMessage ||
            "Sign-in failed. Please check your email address and password."
        );
      } else if (status === 403) {
        setMessage(
          serverMessage || "This account is inactive. Contact your manager."
        );
      } else {
        setMessage(
          serverMessage ||
            "Login failed. Please check your connection and try again."
        );
      }
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

        {/* noValidate: the messages below are shown in the card itself,
            consistently in every browser, instead of native tooltips. */}
        <form onSubmit={handleLogin} noValidate>
          <div className="form-group">
            <label>Email Address</label>
            <div style={{ position: "relative" }}>
              <input
                type="email"
                className="form-control"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // Clear the message as soon as the manager corrects it
                  if (fieldErrors.email) {
                    setFieldErrors((current) => ({ ...current, email: "" }));
                  }
                }}
                required
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? "login-email-error" : undefined
                }
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
            {fieldErrors.email && (
              <p className="field-error" id="login-email-error">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="form-group">
            <label>Password</label>
            <div style={{ position: "relative" }}>
              <input
                type="password"
                className="form-control"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) {
                    setFieldErrors((current) => ({ ...current, password: "" }));
                  }
                }}
                required
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={
                  fieldErrors.password ? "login-password-error" : undefined
                }
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
            {fieldErrors.password && (
              <p className="field-error" id="login-password-error">
                {fieldErrors.password}
              </p>
            )}
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

        {/* Public legal pages, both reachable without signing in */}
        <p className="login-legal">
          <Link to="/privacy-policy">Privacy Policy</Link>
          <span className="login-legal-sep">·</span>
          <Link to="/terms-of-service">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;