import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

/**
 * Vite config for the Hermes Desktop app.
 *
 * In web mode (HERMES_WEB_MODE=1), the dev server proxies /api/* requests to
 * the remote dashboard. The proxy reads `X-Hermes-Token` from the request
 * headers and converts it to a `hermes_session_at` cookie — browsers can't
 * set Cookie headers on cross-origin fetches, so this is the bridge.
 *
 * Usage:
 *   HERMES_WEB_MODE=1 HERMES_WEB_TARGET=https://hermes.jestsee.com npm run dev:renderer
 */

const webTarget = process.env.HERMES_WEB_TARGET || ''
const isWebMode = process.env.HERMES_WEB_MODE === '1'

function webProxy() {
  if (!isWebMode || !webTarget) return {}

  return {
    proxy: {
      // REST API proxy — injects hermes_session_at cookie from X-Hermes-Token header
      '/api': {
        target: webTarget,
        changeOrigin: true,
        secure: true,
        configure: (proxy: any) => {
          proxy.on('proxyReq', (proxyReq: any, req: any) => {
            const token = req.headers['x-hermes-token']
            if (token) {
              proxyReq.setHeader('Cookie', `hermes_session_at=${token}`)
              proxyReq.removeHeader('x-hermes-token')
            }
          })
        },
      },
      // WebSocket proxy — same cookie injection for WS upgrade
      '/api/ws': {
        target: webTarget.replace('https:', 'wss:').replace('http:', 'ws:'),
        ws: true,
        secure: true,
        configure: (proxy: any) => {
          proxy.on('upgradeReq', (req: any) => {
            // WS tickets are passed as query params, no cookie needed
          })
        },
      },
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // Keep desktop packaging stable: Shiki ships many dynamic chunks by
    // default, and electron-builder can OOM scanning thousands of files.
    // Collapsing to a single chunk is intentional, so the renderer bundle is
    // large by design (~22 MB). Raise the warning ceiling above that so the
    // cosmetic "chunk larger than 500 kB" nag stays quiet, while still acting
    // as a regression alarm if the bundle balloons well past today's size.
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hermes/shared': path.resolve(__dirname, '../shared/src'),
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
      'react/jsx-dev-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-runtime.js')
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    host: isWebMode ? '0.0.0.0' : '127.0.0.1',
    port: 5174,
    strictPort: true,
    ...webProxy(),
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  }
})
