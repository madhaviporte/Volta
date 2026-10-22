import { useState } from "react";
import { KeyRound, Mail, AlertCircle, Save } from "lucide-react";
import api from "../services/api";
import Navbar from "../components/Navbar";

// Manager-only account settings. Both forms change the logged-in manager's
// OWN credentials; the backend derives the account from the JWT, so there is
// no user id field here anywhere.
const ManagerSettings = () => {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  // One shared success/error banner for the page
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  // Guards against duplicate submissions on each form
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [emailForm, setEmailForm] = useState({
    currentPassword: "",
    newEmail: user?.email || "",
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  });

  const showMessage = (text, error) => {
    setMessage(text);
    setIsError(Boolean(error));
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();

    // Ignore repeat submits while a request is already in flight
    if (savingEmail) return;

    setSavingEmail(true);

    try {
      const response = await api.put("/auth/me", {
        currentPassword: emailForm.currentPassword,
        newEmail: emailForm.newEmail,
      });

      showMessage(response.data.message, false);

      // Keep the cached session user in sync with the new login email so
      // the navbar and future sessions reflect it immediately.
      const stored = JSON.parse(localStorage.getItem("user") || "null");
      if (stored) {
        stored.email = response.data.user.email;
        localStorage.setItem("user", JSON.stringify(stored));
      }

      setEmailForm({ currentPassword: "", newEmail: response.data.user.email });
    } catch (error) {
      showMessage(
        error.response?.data?.message || "Could not update login email",
        true
      );
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();

    if (savingPassword) return;

    // Cheap client-side check so the mismatch is caught before a round trip.
    // The backend re-validates everything regardless.
    if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
      showMessage("New password and confirmation do not match", true);
      return;
    }

    setSavingPassword(true);

    try {
      const response = await api.put("/auth/me", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
        confirmNewPassword: passwordForm.confirmNewPassword,
      });

      showMessage(response.data.message, false);
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmNewPassword: "",
      });
    } catch (error) {
      showMessage(
        error.response?.data?.message || "Could not update password",
        true
      );
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="app-layout">
      <Navbar />

      <main className="main-content">
        <div className="page-header">
          <div className="page-title-group">
            <h1>Account Settings</h1>
            <p>
              Update the login credentials for your own manager account. Your
              current password is always required.
            </p>
          </div>
        </div>

        {message && (
          <div className={`alert-banner ${isError ? "error" : "success"}`}>
            <AlertCircle size={16} />
            <span>{message}</span>
          </div>
        )}

        {/* Change login email */}
        <div className="form-card">
          <div className="form-title">
            <Mail size={18} className="text-muted" />
            <span>Change Login Email</span>
          </div>

          <form onSubmit={handleEmailSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>New Login Email *</label>
                <input
                  type="email"
                  name="newEmail"
                  className="form-control"
                  placeholder="manager@company.com"
                  value={emailForm.newEmail}
                  onChange={(e) =>
                    setEmailForm({ ...emailForm, newEmail: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>Current Password *</label>
                <input
                  type="password"
                  name="currentPassword"
                  className="form-control"
                  placeholder="••••••••"
                  value={emailForm.currentPassword}
                  onChange={(e) =>
                    setEmailForm({
                      ...emailForm,
                      currentPassword: e.target.value,
                    })
                  }
                  required
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingEmail}
              >
                <Save size={16} />
                <span>{savingEmail ? "Saving..." : "Save Login Email"}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Change password */}
        <div className="form-card">
          <div className="form-title">
            <KeyRound size={18} className="text-muted" />
            <span>Change Password</span>
          </div>

          <form onSubmit={handlePasswordSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Current Password *</label>
                <input
                  type="password"
                  name="currentPassword"
                  className="form-control"
                  placeholder="••••••••"
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      currentPassword: e.target.value,
                    })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>New Password *</label>
                <input
                  type="password"
                  name="newPassword"
                  className="form-control"
                  placeholder="At least 6 characters"
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      newPassword: e.target.value,
                    })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>Confirm New Password *</label>
                <input
                  type="password"
                  name="confirmNewPassword"
                  className="form-control"
                  placeholder="Repeat the new password"
                  value={passwordForm.confirmNewPassword}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      confirmNewPassword: e.target.value,
                    })
                  }
                  required
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingPassword}
              >
                <KeyRound size={16} />
                <span>
                  {savingPassword ? "Saving..." : "Save New Password"}
                </span>
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

export default ManagerSettings;
