// Shared session helpers used by the app root (Home), the route guard
// (ProtectedRoute) and the login page, so all three agree on what
// "logged in" means.
//
// A local session counts as valid only when ALL of these hold:
//   - a token exists in localStorage
//   - the saved user object exists
//   - the token's own expiry claim (exp) has not passed
// This is a cheap first filter, not the authority: the backend re-checks
// the signature, the user's existence and the account state on every
// request, and any genuine 401 clears the session through the axios
// interceptor in services/api.js.

const TOKEN_KEY = "token";
const USER_KEY = "user";

// The saved user object, or null when it is missing or corrupted.
// A corrupted localStorage value must never crash a render.
const getSessionUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};

const getToken = () => localStorage.getItem(TOKEN_KEY);

// Reads the exp claim from the JWT payload (the base64url middle segment).
// Tokens whose expiry cannot be read are treated as expired, so only
// tokens this app could have minted are ever accepted locally.
const isTokenExpired = (token) => {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );

    if (typeof payload.exp !== "number") {
      return true;
    }

    return payload.exp * 1000 <= Date.now();
  } catch {
    return true; // not a decodable JWT -> unusable
  }
};

// True when a usable session exists (token + user + unexpired token).
const hasValidSession = () => {
  const token = getToken();
  return Boolean(token && getSessionUser() && !isTokenExpired(token));
};

// Removes the only two keys this app stores. Used by explicit logout
// (Navbar) and whenever an unusable or expired session is detected.
// Never call it for a valid session during normal loading or navigation.
const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

// Where each role belongs: used after a successful login, for already
// authenticated visitors of the login page, and for wrong-role visits
// to a protected page.
const homePathFor = (user) =>
  user && user.role === "manager"
    ? "/manager/dashboard"
    : "/employee/dashboard";

export {
  getSessionUser,
  getToken,
  isTokenExpired,
  hasValidSession,
  clearSession,
  homePathFor,
};
