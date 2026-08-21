import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';

const msalInstance = new PublicClientApplication(msalConfig);

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

    // Clean up stale URL hash after processing
    if (window.location.hash && (window.location.hash.includes("code=") || window.location.hash.includes("error="))) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  })
  .catch((error) => {
    console.warn("MSAL redirect promise note:", error);
    // Remove invalid/expired hash from address bar
    if (window.location.hash && (window.location.hash.includes("code=") || window.location.hash.includes("error="))) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  })
  .finally(() => {
    // Add event callback for successful logins
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
