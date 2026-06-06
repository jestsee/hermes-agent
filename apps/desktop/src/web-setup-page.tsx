/**
 * WebSetupPage
 *
 * Clean setup page for the web client. Prompts for:
 *   1. Dashboard URL (e.g. https://hermes.jestsee.com)
 *   2. Access token (the hermes_session_at JWT)
 *
 * Stores credentials in localStorage, then reloads the app.
 */

import { useCallback, useState } from 'react'

const STORAGE_PREFIX = 'hermes_web_'
const KEY_DASHBOARD_URL = `${STORAGE_PREFIX}dashboard_url`
const KEY_ACCESS_TOKEN = `${STORAGE_PREFIX}access_token`

interface ProbeResult {
  reachable: boolean
  version: string | null
  authMode: string | null
  error: string | null
}

export function WebSetupPage({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(KEY_DASHBOARD_URL) || '' } catch { return '' }
  })
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(KEY_ACCESS_TOKEN) || '' } catch { return '' }
  })
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const probe = useCallback(async () => {
    if (!url.trim()) return
    setProbing(true)
    setError(null)
    setProbeResult(null)

    try {
      // Probe through the Vite proxy — the proxy is already configured
      // with HERMES_WEB_TARGET pointing to the actual dashboard
      const res = await fetch('/api/status', {
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json().catch(() => ({}))

      setProbeResult({
        reachable: res.ok,
        version: data.version || null,
        authMode: data.auth_required ? 'oauth/cookie' : 'token',
        error: null,
      })
    } catch (err) {
      setProbeResult({
        reachable: false,
        version: null,
        authMode: null,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setProbing(false)
    }
  }, [url])

  const handleSave = useCallback(async () => {
    if (!url.trim() || !token.trim()) {
      setError('Both dashboard URL and access token are required.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const normalizedUrl = url.trim().replace(/\/+$/, '')

      // Validate the token by making a test request
      const res = await fetch('/api/sessions?limit=1', {
        headers: { 'X-Hermes-Token': token.trim() },
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Authentication failed (${res.status}): ${text || res.statusText}`)
      }

      // Save to localStorage
      localStorage.setItem(KEY_DASHBOARD_URL, normalizedUrl)
      localStorage.setItem(KEY_ACCESS_TOKEN, token.trim())

      // Reload to trigger the app with the new config
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [url, token])

  const handleClear = useCallback(() => {
    localStorage.removeItem(KEY_DASHBOARD_URL)
    localStorage.removeItem(KEY_ACCESS_TOKEN)
    setUrl('')
    setToken('')
    setProbeResult(null)
    setError(null)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-md p-8 space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="text-4xl mb-2">🐝</div>
          <h1 className="text-2xl font-bold">Hermes Web Client</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Connect to your Hermes Agent dashboard
          </p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Dashboard URL */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Dashboard URL
            </label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onBlur={probe}
              placeholder="https://hermes.jestsee.com"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg
                text-zinc-100 placeholder-zinc-500
                focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
            />
            {probeResult && (
              <div className={`mt-1 text-xs ${probeResult.reachable ? 'text-green-400' : 'text-red-400'}`}>
                {probeResult.reachable ? (
                  <span>
                    ✅ Reachable — v{probeResult.version || '?'} — auth: {probeResult.authMode}
                  </span>
                ) : (
                  <span>❌ {probeResult.error || 'Unreachable'}</span>
                )}
              </div>
            )}
          </div>

          {/* Access Token */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Access Token
            </label>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="eyJhbGciOi..."
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg
                text-zinc-100 placeholder-zinc-500
                focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Get this from{' '}
              <code className="bg-zinc-800 px-1 rounded">POST /api/auth/ws-ticket</code>
              or the browser cookie <code className="bg-zinc-800 px-1 rounded">hermes_session_at</code>
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !url.trim() || !token.trim()}
              className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700
                disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors"
            >
              {saving ? 'Connecting...' : 'Connect'}
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Help */}
        <div className="text-xs text-zinc-500 space-y-1">
          <p>
            <strong>How to get your access token:</strong>
          </p>
          <pre className="bg-zinc-900 p-2 rounded overflow-x-auto text-zinc-400">
{`curl -X POST -b "hermes_session_at=YOUR_JWT" \\
  https://your-dashboard.com/api/auth/ws-ticket`}
          </pre>
          <p>
            Or copy the <code className="bg-zinc-800 px-1 rounded">hermes_session_at</code> cookie
            from your browser's DevTools → Application → Cookies.
          </p>
        </div>
      </div>
    </div>
  )
}
