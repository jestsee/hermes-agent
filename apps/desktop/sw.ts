import { precacheAndRoute } from 'workbox-precaching'
import { setCacheNameDetails } from 'workbox-core'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, NetworkOnly } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

setCacheNameDetails({ prefix: 'hermes' })

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'pages' })
)

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly()
)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
