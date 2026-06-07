import { useCallback, useState } from "react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import { setDashboardConfig } from "@/lib/connection-config";

function detectTokenFromUrl(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? params.get("session_token");
    if (token) return token;
    const hash = window.location.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash.replace("#", "?"));
      const t = hashParams.get("token") ?? hashParams.get("session_token");
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  return "";
}

const STATE_READY = "ready" as const;
const STATE_CONNECTING = "connecting" as const;
const STATE_SUCCESS = "success" as const;
const STATE_ERROR = "error" as const;

type PageState =
  | { phase: typeof STATE_READY }
  | { phase: typeof STATE_CONNECTING }
  | { phase: typeof STATE_SUCCESS }
  | { phase: typeof STATE_ERROR; message: string };

export default function SetupPage() {
  const [url, setUrl] = useState(() => {
    try {
      return window.location.origin;
    } catch {
      return "http://localhost:9119";
    }
  });
  const [token, setToken] = useState(detectTokenFromUrl);
  const [showToken, setShowToken] = useState(false);
  const [state, setState] = useState<PageState>({ phase: STATE_READY });

  const handleConnect = useCallback(async () => {
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();
    if (!trimmedUrl || !trimmedToken) {
      setState({ phase: STATE_ERROR, message: "Both fields are required." });
      return;
    }

    setState({ phase: STATE_CONNECTING });

    try {
      const apiUrl = trimmedUrl.replace(/\/+$/, "") + "/api/status";
      const res = await fetch(apiUrl, {
        headers: {
          "X-Hermes-Session-Token": trimmedToken,
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        setState({
          phase: STATE_ERROR,
          message: `Connection failed: ${text.slice(0, 200)}`,
        });
        return;
      }

      const data = await res.json();
      if (!data || typeof data !== "object") {
        setState({
          phase: STATE_ERROR,
          message: "Unexpected response from server.",
        });
        return;
      }

      setState({ phase: STATE_SUCCESS });
      setDashboardConfig(trimmedUrl, trimmedToken);
      window.location.reload();
    } catch (err) {
      const msg =
        err instanceof TypeError && err.message === "Failed to fetch"
          ? "Cannot reach the dashboard. Check the URL and make sure the dashboard is running."
          : err instanceof Error
            ? err.message
            : "Unknown error";
      setState({ phase: STATE_ERROR, message: msg });
    }
  }, [url, token]);

  return (
    <div className="flex min-h-dvh min-w-0 flex-col items-center justify-center bg-black px-4">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col items-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "var(--component-tab-clip-path, #0a2a2a)" }}
          >
            <span className="text-[1.5rem] font-bold text-midground">H</span>
          </div>
          <div className="text-center">
            <Typography
              className="font-bold text-[1.125rem] leading-[0.95] tracking-[0.0525rem] text-midground uppercase"
              style={{ mixBlendMode: "plus-lighter" }}
            >
              Hermes
              <br />
              Agent
            </Typography>
            <p className="mt-2 text-sm text-text-tertiary">
              Connect to your dashboard
            </p>
          </div>
        </div>

        <div
          className="flex flex-col gap-5 rounded-lg border border-current/20 p-6"
          style={{
            background: "var(--component-sidebar-background, #0a0a0a)",
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="setup-url"
              className="font-mondwest text-display text-xs tracking-[0.12em] text-text-secondary uppercase"
            >
              Dashboard URL
            </label>
            <Input
              id="setup-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:9119"
              disabled={state.phase === STATE_CONNECTING}
              autoComplete="url"
              className="w-full"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="setup-token"
              className="font-mondwest text-display text-xs tracking-[0.12em] text-text-secondary uppercase"
            >
              Session Token
            </label>
            <div className="relative">
              <Input
                id="setup-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your session token"
                disabled={state.phase === STATE_CONNECTING}
                autoComplete="off"
                className="w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary cursor-pointer"
                aria-label={showToken ? "Hide token" : "Show token"}
                tabIndex={-1}
              >
                {showToken ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          {state.phase === STATE_ERROR && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.message}
            </div>
          )}

          <Button
            onClick={handleConnect}
            disabled={state.phase === STATE_CONNECTING}
            className="w-full font-mondwest text-display uppercase tracking-[0.12em]"
          >
            {state.phase === STATE_CONNECTING ? "Connecting..." : "Connect"}
          </Button>
        </div>

        <p className="text-center text-xs text-text-tertiary">
          Run <code className="rounded bg-muted/20 px-1 py-0.5 text-midground">hermes dashboard --insecure</code>{" "}
          and copy the session token from the terminal output.
        </p>
      </div>
    </div>
  );
}
