import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

const TILE_CACHE = 'map-tiles-v1'
const MAX_TILES = 500

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Web Share Target: intercept POST to /passage-planner, store file, redirect to app
  if (event.request.method === 'POST' && url.pathname === '/passage-planner') {
    event.respondWith(handleShareTarget(event.request))
    return
  }

  // Map tile caching: cache-first with 500-tile eviction
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('tiles.openseamap.org')
  ) {
    event.respondWith(cacheFirstTile(event.request))
    return
  }
})

async function handleShareTarget(request) {
  try {
    const formData = await request.formData()
    const gpxFile = formData.get('gpx')
    if (gpxFile) {
      const text = await gpxFile.text()
      const cache = await caches.open('shared-gpx')
      await cache.put(
        'pending',
        new Response(text, { headers: { 'Content-Type': 'application/gpx+xml' } }),
      )
    }
  } catch (err) {
    console.error('[SW] Share target error:', err)
  }
  // Redirect to app with voyage tab active
  return Response.redirect('/?tab=voyage', 303)
}

async function cacheFirstTile(request) {
  const cache = await caches.open(TILE_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const keys = await cache.keys()
      if (keys.length >= MAX_TILES) {
        await cache.delete(keys[0])
      }
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Network unavailable', { status: 408 })
  }
}
