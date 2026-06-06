/**
 * web-shim.ts
 *
 * Browser implementation of `window.hermesDesktop` — the preload bridge that
 * the Electron desktop app exposes via IPC. This shim lets the React renderer
 * run in a plain browser (no Electron) by:
 *
 *   - Storing the dashboard URL + access token in localStorage
 *   - Routing all REST calls through a Vite dev-server proxy that injects the
 *     `hermes_session_at` cookie (browsers can't set Cookie headers on
 *     cross-origin fetches)
 *   - Minting short-lived WebSocket tickets via POST /api/auth/ws-ticket
 *   - Stubbing Electron-only features (terminal, file ops, etc.)
 *
 * Auth flow (mirrors the Electron Desktop's "token" mode):
 *   1. User enters dashboard URL + access token in the setup page
 *   2. Token is stored in localStorage as `hermes_web_access_token`
 *   3. Every fetch sends `X-Hermes-Token: <token>` header
 *   4. Vite proxy converts that header to `Cookie: hermes_session_at=<token>`
 *   5. WS ticket mint uses the same proxy path
 */

import type {
  DesktopBootProgress,
  DesktopConnectionConfig,
  DesktopConnectionConfigInput,
  DesktopConnectionProbeResult,
  DesktopConnectionTestResult,
  DesktopOauthLoginResult,
  DesktopOauthLogoutResult,
  HermesApiRequest,
  HermesConnection,
  HermesReadDirResult,
  HermesReadFileTextResult,
  HermesSelectPathsOptions,
  HermesTerminalSession,
  HermesTerminalExit,
  HermesTitleBarTheme,
  HermesWindowState,
  HermesPreviewTarget,
  HermesPreviewWatch,
  HermesNotification,
  DesktopActiveProfile,
  DesktopVersionInfo,
  DesktopUpdateStatus,
  DesktopUpdateApplyResult,
  DesktopUpdateProgress,
  BackendExit,
  DesktopBootstrapState,
  DesktopBootstrapEvent,
} from './global'

// ── localStorage keys ──────────────────────────────────────────────────────
const STORAGE_PREFIX = 'hermes_web_'
const KEY_DASHBOARD_URL = `${STORAGE_PREFIX}dashboard_url`
const KEY_ACCESS_TOKEN = `${STORAGE_PREFIX}access_token`
const KEY_CONFIGURED = `${STORAGE_PREFIX}configured`

// ── Helpers ────────────────────────────────────────────────────────────────

function getStoredUrl(): string {
  try {
    return localStorage.getItem(KEY_DASHBOARD_URL) || ''
  } catch {
    return ''
  }
}

function getStoredToken(): string {
  try {
    return localStorage.getItem(KEY_ACCESS_TOKEN) || ''
  } catch {
    return ''
  }
}

function isConfigured(): boolean {
  return Boolean(getStoredUrl() && getStoredToken())
}

function normalizeBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '')
  return url
}

function buildWsUrl(baseUrl: string, ticket: string): string {
  const parsed = new URL(baseUrl)
  const wsScheme = parsed.protocol === 'https:' ? 'wss' : 'ws'
  return `${wsScheme}://${parsed.host}/api/ws?ticket=${encodeURIComponent(ticket)}`
}

/**
 * Make a fetch request through the Vite proxy. The proxy reads the
 * `X-Hermes-Token` header and converts it to a `hermes_session_at` cookie.
 */
async function proxyFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const baseUrl = getStoredUrl()
  const token = getStoredToken()

  if (!baseUrl || !token) {
    throw new Error('Dashboard URL and access token are required. Open Settings to configure.')
  }

  const url = path
  const timeoutMs = options.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hermes-Token': token,
      'X-Hermes-Target': baseUrl,
    }

    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers,
      signal: controller.signal,
    }

    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body)
    }

    const res = await fetch(url, fetchOptions)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${res.status}: ${text || res.statusText}`)
    }

    const text = await res.text()
    if (!text) return null as T

    // Detect HTML response (SPA fallback)
    if (/^\s*<(?:!doctype|html)/i.test(text)) {
      throw new Error(
        `Expected JSON from ${url} but got HTML (status ${res.status}). ` +
          'The endpoint is likely missing on the Hermes backend.'
      )
    }

    return JSON.parse(text) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Mint a WebSocket ticket from the dashboard.
 * The ticket is single-use with ~30s TTL.
 */
async function mintWsTicket(baseUrl: string): Promise<string> {
  const token = getStoredToken()
  const res = await fetch('/api/auth/ws-ticket', {
    method: 'POST',
    headers: {
      'X-Hermes-Token': token,
      'X-Hermes-Target': baseUrl,
    },
  })

  if (!res.ok) {
    throw new Error(`Failed to mint WebSocket ticket: ${res.status}`)
  }

  const data = await res.json()
  return data.ticket
}

// ── Web Shim Implementation ────────────────────────────────────────────────

const webShim = {
  // ── Connection ─────────────────────────────────────────────────────────

  async getConnection(_profile?: string | null): Promise<HermesConnection> {
    const baseUrl = getStoredUrl()
    const token = getStoredToken()

    if (!baseUrl || !token) {
      throw new Error('Not configured. Open Settings → Gateway to set up your connection.')
    }

    // Build a temporary WS URL (will be re-minted on actual connect)
    const parsed = new URL(baseUrl)
    const wsScheme = parsed.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${wsScheme}://${parsed.host}/api/ws?token=${encodeURIComponent(token)}`

    return {
      baseUrl,
      token,
      wsUrl,
      authMode: 'token',
      mode: 'remote',
      source: 'settings',
      isFullscreen: false,
      nativeOverlayWidth: 0,
      windowButtonPosition: null,
      logs: ['Web client — connected via web-shim'],
    }
  },

  async touchBackend(_profile?: string | null): Promise<{ ok: boolean }> {
    return { ok: true }
  },

  async getGatewayWsUrl(_profile?: null | string): Promise<string> {
    const baseUrl = getStoredUrl()
    if (!baseUrl) throw new Error('Dashboard URL not configured')

    // Mint a fresh WS ticket (single-use, 30s TTL)
    const ticket = await mintWsTicket(baseUrl)
    return buildWsUrl(baseUrl, ticket)
  },

  // ── Boot ───────────────────────────────────────────────────────────────

  async getBootProgress(): Promise<DesktopBootProgress> {
    return {
      phase: 'renderer.ready',
      progress: 100,
      running: false,
      message: 'Ready',
      error: null,
      fakeMode: false,
      timestamp: Date.now(),
    }
  },

  // ── Connection Config ──────────────────────────────────────────────────

  async getConnectionConfig(_profile?: null | string): Promise<DesktopConnectionConfig> {
    const url = getStoredUrl()
    const token = getStoredToken()
    const configured = isConfigured()

    return {
      mode: configured ? 'remote' : 'local',
      profile: null,
      envOverride: false,
      remoteAuthMode: 'token',
      remoteOauthConnected: false,
      remoteTokenPreview: token ? `...${token.slice(-6)}` : null,
      remoteTokenSet: Boolean(token),
      remoteUrl: url,
    }
  },

  async saveConnectionConfig(payload: DesktopConnectionConfigInput): Promise<DesktopConnectionConfig> {
    if (payload.remoteUrl) {
      localStorage.setItem(KEY_DASHBOARD_URL, normalizeBaseUrl(payload.remoteUrl))
    }
    if (payload.remoteToken) {
      localStorage.setItem(KEY_ACCESS_TOKEN, payload.remoteToken)
    }
    if (payload.mode) {
      localStorage.setItem(KEY_CONFIGURED, payload.mode === 'remote' ? 'true' : 'false')
    }
    return this.getConnectionConfig(payload.profile)
  },

  async applyConnectionConfig(payload: DesktopConnectionConfigInput): Promise<DesktopConnectionConfig> {
    return this.saveConnectionConfig(payload)
  },

  async testConnectionConfig(payload: DesktopConnectionConfigInput): Promise<DesktopConnectionTestResult> {
    const url = payload.remoteUrl || getStoredUrl()
    const token = payload.remoteToken || getStoredToken()

    if (!url) {
      return { baseUrl: '', ok: false, version: null }
    }

    try {
      const normalizedUrl = normalizeBaseUrl(url)
      const res = await fetch('/api/status', {
        headers: token ? { 'X-Hermes-Token': token, 'X-Hermes-Target': url } : {},
      })
      const data = await res.json()
      return {
        baseUrl: normalizedUrl,
        ok: res.ok,
        version: data.version || null,
      }
    } catch {
      return { baseUrl: url, ok: false, version: null }
    }
  },

  async probeConnectionConfig(remoteUrl: string): Promise<DesktopConnectionProbeResult> {
    const normalizedUrl = normalizeBaseUrl(remoteUrl)

    try {
      const res = await fetch('/api/status')
      const data = await res.json()

      // Check auth providers
      let providers: { name: string; displayName: string; supportsPassword?: boolean }[] = []
      try {
        const provRes = await fetch('/api/auth/providers')
        if (provRes.ok) {
          providers = await provRes.json()
        }
      } catch {
        // Ignore — providers endpoint may not exist
      }

      return {
        baseUrl: normalizedUrl,
        reachable: res.ok,
        authMode: data.auth_required ? 'oauth' : 'token',
        providers,
        version: data.version || null,
        error: null,
      }
    } catch (err) {
      return {
        baseUrl: normalizedUrl,
        reachable: false,
        authMode: 'unknown',
        providers: [],
        version: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },

  async oauthLoginConnectionConfig(_remoteUrl: string): Promise<DesktopOauthLoginResult> {
    // OAuth login not supported in web client — use token auth
    return { ok: false, baseUrl: '', connected: false }
  },

  async oauthLogoutConnectionConfig(_remoteUrl?: string): Promise<DesktopOauthLogoutResult> {
    localStorage.removeItem(KEY_ACCESS_TOKEN)
    return { ok: true, connected: false }
  },

  // ── Profile ────────────────────────────────────────────────────────────

  profile: {
    async get(): Promise<DesktopActiveProfile> {
      return { profile: null }
    },
    async set(_name: string | null): Promise<DesktopActiveProfile> {
      return { profile: null }
    },
  },

  // ── REST API ───────────────────────────────────────────────────────────

  async api<T>(request: HermesApiRequest): Promise<T> {
    return proxyFetch<T>(request.path, {
      method: request.method,
      body: request.body,
      timeoutMs: request.timeoutMs,
    })
  },

  // ── Notifications ──────────────────────────────────────────────────────

  async notify(payload: HermesNotification): Promise<boolean> {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(payload.title || 'Hermes', {
        body: payload.body || '',
        silent: payload.silent,
      })
      return true
    }
    return false
  },

  // ── Microphone ─────────────────────────────────────────────────────────

  async requestMicrophoneAccess(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      return true
    } catch {
      return false
    }
  },

  // ── File Operations (web stubs) ────────────────────────────────────────

  async readFileDataUrl(_filePath: string): Promise<string> {
    throw new Error('File reading is not available in the web client.')
  },

  async readFileText(_filePath: string): Promise<HermesReadFileTextResult> {
    throw new Error('File reading is not available in the web client.')
  },

  async selectPaths(_options?: HermesSelectPathsOptions): Promise<string[]> {
    // Use the browser's file picker as a fallback
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = _options?.multiple ?? false
      if (_options?.directories) {
        input.webkitdirectory = true
      }
      input.onchange = () => {
        const files = Array.from(input.files || [])
        resolve(files.map(f => f.name))
      }
      input.oncancel = () => resolve([])
      input.click()
    })
  },

  // ── Clipboard ──────────────────────────────────────────────────────────

  async writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  },

  async saveImageFromUrl(_url: string): Promise<boolean> {
    throw new Error('Image saving is not available in the web client.')
  },

  async saveImageBuffer(_data: ArrayBuffer | Uint8Array, _ext: string): Promise<string> {
    throw new Error('Image saving is not available in the web client.')
  },

  async saveClipboardImage(): Promise<string> {
    throw new Error('Clipboard image saving is not available in the web client.')
  },

  getPathForFile(_file: File): string {
    return ''
  },

  // ── Preview ────────────────────────────────────────────────────────────

  async normalizePreviewTarget(target: string, _baseDir?: string): Promise<HermesPreviewTarget | null> {
    // Basic URL preview
    try {
      const url = new URL(target)
      return {
        kind: 'url',
        label: url.pathname,
        source: target,
        url: target,
      }
    } catch {
      return null
    }
  },

  async watchPreviewFile(_url: string): Promise<HermesPreviewWatch> {
    throw new Error('File watching is not available in the web client.')
  },

  async stopPreviewFileWatch(_id: string): Promise<boolean> {
    return false
  },

  // ── Title Bar (no-op in web) ───────────────────────────────────────────

  setTitleBarTheme(_payload: HermesTitleBarTheme): void {
    // No-op in web
  },

  setPreviewShortcutActive(_active: boolean): void {
    // No-op in web
  },

  // ── External Links ─────────────────────────────────────────────────────

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async fetchLinkTitle(url: string): Promise<string> {
    try {
      const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`)
      const text = await res.text()
      const match = text.match(/<title[^>]*>([^<]+)<\/title>/i)
      return match?.[1]?.trim() || url
    } catch {
      return url
    }
  },

  // ── Settings ───────────────────────────────────────────────────────────

  settings: {
    async getDefaultProjectDir(): Promise<{ defaultLabel: string; dir: null | string }> {
      return { defaultLabel: 'Home', dir: null }
    },
    async pickDefaultProjectDir(): Promise<{ canceled: boolean; dir: null | string }> {
      return { canceled: true, dir: null }
    },
    async setDefaultProjectDir(_dir: null | string): Promise<{ dir: null | string }> {
      return { dir: null }
    },
  },

  // ── Logs ───────────────────────────────────────────────────────────────

  async revealLogs(): Promise<{ ok: boolean; path: string; error?: string }> {
    return { ok: false, path: '', error: 'Log viewer not available in web client.' }
  },

  async getRecentLogs(): Promise<{ path: string; lines: string[] }> {
    try {
      const baseUrl = getStoredUrl()
      if (!baseUrl) return { path: '', lines: [] }
      const data = await proxyFetch<{ lines: string[] }>('/api/logs/recent?lines=100')
      return { path: 'remote', lines: data?.lines || [] }
    } catch {
      return { path: '', lines: [] }
    }
  },

  // ── File System ────────────────────────────────────────────────────────

  async readDir(_path: string): Promise<HermesReadDirResult> {
    return { entries: [], error: 'Directory reading is not available in the web client.' }
  },

  async gitRoot(_path: string): Promise<string | null> {
    return null
  },

  // ── Terminal (stub) ────────────────────────────────────────────────────

  terminal: {
    async dispose(_id: string): Promise<boolean> {
      return false
    },
    onData(_id: string, _callback: (payload: string) => void): () => void {
      return () => {}
    },
    onExit(_id: string, _callback: (payload: HermesTerminalExit) => void): () => void {
      return () => {}
    },
    async resize(_id: string, _size: { cols: number; rows: number }): Promise<boolean> {
      return false
    },
    async start(_options?: { cols?: number; cwd?: string; rows?: number }): Promise<HermesTerminalSession> {
      throw new Error('Terminal is not available in the web client.')
    },
    async write(_id: string, _data: string): Promise<boolean> {
      return false
    },
  },

  // ── Event Listeners (no-op stubs) ─────────────────────────────────────

  onClosePreviewRequested(_callback: () => void): () => void {
    return () => {}
  },

  onOpenUpdatesRequested(_callback: () => void): () => void {
    return () => {}
  },

  onWindowStateChanged(_callback: (payload: HermesWindowState) => void): () => void {
    return () => {}
  },

  onPreviewFileChanged(_callback: (payload: { id: string; path: string; url: string }) => void): () => void {
    return () => {}
  },

  onBackendExit(_callback: (payload: BackendExit) => void): () => void {
    return () => {}
  },

  onPowerResume(_callback: () => void): () => void {
    return () => {}
  },

  onBootProgress(_callback: (payload: DesktopBootProgress) => void): () => void {
    return () => {}
  },

  // ── Bootstrap ──────────────────────────────────────────────────────────

  async getBootstrapState(): Promise<DesktopBootstrapState> {
    return {
      active: false,
      manifest: null,
      stages: {},
      error: null,
      log: [],
      startedAt: null,
      completedAt: null,
      unsupportedPlatform: null,
    }
  },

  async resetBootstrap(): Promise<{ ok: boolean }> {
    return { ok: true }
  },

  async repairBootstrap(): Promise<{ ok: boolean }> {
    return { ok: true }
  },

  async cancelBootstrap(): Promise<{ ok: boolean; cancelled: boolean }> {
    return { ok: true, cancelled: false }
  },

  onBootstrapEvent(_callback: (payload: DesktopBootstrapEvent) => void): () => void {
    return () => {}
  },

  // ── Version ────────────────────────────────────────────────────────────

  async getVersion(): Promise<DesktopVersionInfo> {
    return {
      appVersion: 'web-0.1.0',
      electronVersion: 'N/A (web)',
      nodeVersion: 'N/A (web)',
      platform: navigator.platform,
      hermesRoot: getStoredUrl() || 'web',
    }
  },

  // ── Updates (stub) ─────────────────────────────────────────────────────

  updates: {
    async check(): Promise<DesktopUpdateStatus> {
      return { supported: false, reason: 'Updates are managed server-side for the web client.' }
    },
    async apply(_opts?: unknown): Promise<DesktopUpdateApplyResult> {
      return { ok: false, error: 'Updates are not available in the web client.' }
    },
    async getBranch(): Promise<{ branch: string }> {
      return { branch: 'main' }
    },
    async setBranch(_name: string): Promise<{ branch: string }> {
      return { branch: 'main' }
    },
    onProgress(_callback: (payload: DesktopUpdateProgress) => void): () => void {
      return () => {}
    },
  },
}

// ── Installation ─────────────────────────────────────────────────────────

export function installWebShim(): void {
  if (typeof window === 'undefined') return

  // Only install if not already present (Electron's preload sets this first)
  if (window.hermesDesktop) {
    console.log('[web-shim] window.hermesDesktop already exists — skipping install')
    return
  }

  console.log('[web-shim] Installing browser shim for window.hermesDesktop')
  ;(window as any).hermesDesktop = webShim
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.hermesDesktop)
}

export function isWebShimInstalled(): boolean {
  return typeof window !== 'undefined' &&
    Boolean((window as any).__webShimInstalled)
}
