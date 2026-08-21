/*
 * Microsoft Azure Active Directory (MSAL) Configuration for Blitz.ai
 */

// Dynamically match exact Azure Portal redirect URIs with trailing slash
const getRedirectUri = () => {
  const origin = window.location.origin;
  return origin.endsWith('/') ? origin : `${origin}/`;
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
    storeAuthStateInCookie: false,
  },
};

// Scopes prompted for user consent during sign-in
export const loginRequest = {
  scopes: ["User.Read", "openid", "profile", "email"],
};
