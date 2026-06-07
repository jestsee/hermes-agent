import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";
import AuthGate from "./components/AuthGate";
import { SystemActionsProvider } from "./contexts/SystemActions";
import { I18nProvider } from "./i18n";
import { exposePluginSDK } from "./plugins";
import { ThemeProvider } from "./themes";
import { HERMES_BASE_PATH } from "./lib/api";
import { getDashboardConfig } from "./lib/connection-config";

registerSW({ immediate: true });

exposePluginSDK();

// If the dashboard didn't inject a session token (open from a PWA sideload,
// direct file access, or after a dashboard restart), fall back to a stored
// config from localStorage. This must happen synchronously before React
// renders so that fetchJSON and gatewayClient see the token immediately.
if (
  typeof window !== "undefined" &&
  !window.__HERMES_SESSION_TOKEN__ &&
  !window.__HERMES_AUTH_REQUIRED__
) {
  const stored = getDashboardConfig();
  if (stored) {
    window.__HERMES_SESSION_TOKEN__ = stored.token;
    window.__HERMES_CONFIG_SOURCE__ = "stored";
  }
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={HERMES_BASE_PATH || undefined}>
    <I18nProvider>
      <ThemeProvider>
        <SystemActionsProvider>
          <AuthGate>
            <App />
          </AuthGate>
        </SystemActionsProvider>
      </ThemeProvider>
    </I18nProvider>
  </BrowserRouter>,
);
