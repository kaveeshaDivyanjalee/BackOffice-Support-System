/*
 * Microsoft Azure Active Directory (MSAL) Configuration for Blitz.ai
 */

// Dynamically matches exact Azure Portal redirect URIs for both environments
const getRedirectUri = () => {
  const origin = window.location.origin;
  // Production Azure entry MUST have trailing slash: https://backofficeagent.sltdigitallab.lk/
  if (origin.includes("backofficeagent.sltdigitallab.lk")) {
    return origin.endsWith('/') ? origin : `${origin}/`;
  }
  // Localhost Azure entry has no trailing slash: http://localhost:3000
  return origin.replace(/\/$/, "");
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
    storeAuthStateInCookie: true, // Enables cookie storage for reliable local dev authentication
  },
};

// Scopes prompted for user consent during sign-in
export const loginRequest = {
  scopes: ["User.Read", "openid", "profile", "email"],
};

