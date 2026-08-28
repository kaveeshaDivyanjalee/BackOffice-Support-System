/*
 * Microsoft Azure Active Directory (MSAL) Configuration for Blitz.ai
 */

// Dynamically matches exact Azure Portal redirect URIs for both environments
const getRedirectUri = () => {
  const origin = window.location.origin;
  let uri;
  // Production Azure entry has trailing slash: https://backofficeagent.sltdigitallab.lk/
  if (origin.includes("backofficeagent.sltdigitallab.lk")) {
    uri = origin.endsWith('/') ? origin : `${origin}/`;
  } else {
    // Localhost with explicit /auth path: http://localhost:3000/auth
    uri = `${origin.replace(/\/$/, "")}/auth`;
  }
  console.log("🔒 [MSAL Config] getRedirectUri():", uri);
  return uri;
};

export const msalConfig = {
  auth: {
    clientId: "1be92fb6-e237-4bd6-ae1e-f2c4644d1766",
    authority: "https://login.microsoftonline.com/534253fc-dfb6-462f-b5ca-cbe81939f5ee",
    redirectUri: getRedirectUri(),
    postLogoutRedirectUri: getRedirectUri(),
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: true,
  },
};

// Scopes prompted for user consent during sign-in
export const loginRequest = {
  scopes: ["User.Read", "openid", "profile", "email"],
};