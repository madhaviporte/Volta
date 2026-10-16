import axios from "axios";

const api = axios.create({
  // Set by the host at build time (VITE_API_BASE_URL); local dev falls back to port 3000.
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Automatically send the saved JWT with every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Expired/invalid session: a 401 on an authenticated request clears the saved
// session and shows the login page. Login attempts are skipped so a wrong
// password keeps its own error message; requests without a token are skipped,
// which also prevents redirect loops; 403 is forbidden, not expiry.
let sessionExpiredHandled = false;

const handleSessionExpired = () => {
  // Several simultaneous 401s clear storage and redirect exactly once.
  if (sessionExpiredHandled) {
    return;
  }
  sessionExpiredHandled = true;

  // The only two keys this app stores.
  localStorage.removeItem("token");
  localStorage.removeItem("user");

  if (window.location.pathname === "/login") {
    return;
  }

  // Full page navigation, so no stale in-memory React state survives.
  window.location.replace("/login");
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const config = error.config;
    // The request interceptor attaches Authorization only when a token exists;
    // both casings are checked because axios may normalize header casing.
    const carriedToken = Boolean(
      config?.headers?.Authorization || config?.headers?.authorization
    );
    const isLoginAttempt = String(config?.url || "").endsWith("/auth/login");

    if (status === 401 && carriedToken && !isLoginAttempt) {
      handleSessionExpired();
    }

    return Promise.reject(error);
  }
);

export default api;
