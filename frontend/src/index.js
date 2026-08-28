import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';

const msalInstance = new PublicClientApplication(msalConfig);
window.msalInstance = msalInstance;


// Initialize MSAL and process any incoming redirect authentication code
msalInstance.initialize()
  .then(() => msalInstance.handleRedirectPromise())
  .then((authResult) => {
    if (authResult?.account) {
      msalInstance.setActiveAccount(authResult.account);
    } else {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        msalInstance.setActiveAccount(accounts[0]);
      }
    }

    // Clean up hash and reset /auth path back to root / after processing
    if (window.location.hash && (window.location.hash.includes("code=") || window.location.hash.includes("error="))) {
      window.history.replaceState(null, "", window.location.pathname === "/auth" ? "/" : window.location.pathname);
    } else if (window.location.pathname === "/auth") {
      window.history.replaceState(null, "", "/");
    }
  })
  .catch((error) => {
    console.warn("MSAL redirect promise note:", error);
    if (window.location.hash && (window.location.hash.includes("code=") || window.location.hash.includes("error="))) {
      window.history.replaceState(null, "", window.location.pathname === "/auth" ? "/" : window.location.pathname);
    } else if (window.location.pathname === "/auth") {
      window.history.replaceState(null, "", "/");
    }
  })

  .finally(() => {
    msalInstance.addEventCallback((event) => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload?.account) {
        msalInstance.setActiveAccount(event.payload.account);
      }
    });

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(
      <React.StrictMode>
        <MsalProvider instance={msalInstance}>
          <App />
        </MsalProvider>
      </React.StrictMode>
    );
  });



reportWebVitals();
