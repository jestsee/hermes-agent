import { useEffect, useState, type ReactNode } from "react";
import SetupPage from "@/pages/SetupPage";

const AUTH_REQUIRED_EVENT = "hermes:auth-required";

export function dispatchAuthRequired(): void {
  try {
    sessionStorage.setItem("hermes.needsSetup", "1");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
}

function isSetupRequired(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__HERMES_SESSION_TOKEN__) return false;
  if (window.__HERMES_AUTH_REQUIRED__) return false;
  try {
    if (sessionStorage.getItem("hermes.needsSetup") === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const [needsSetup, setNeedsSetup] = useState(isSetupRequired);

  useEffect(() => {
    const handler = () => setNeedsSetup(true);
    window.addEventListener(AUTH_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
  }, []);

  if (needsSetup) {
    return <SetupPage />;
  }

  return <>{children}</>;
}
