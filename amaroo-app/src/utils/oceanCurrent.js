import { supabase } from '../db/supabase'

const OCEAN_CURRENT_CACHE_PREFIX = 'amaroo_ocean_current'

function cacheKey(lat, lng, forecastHours, startTime) {
  const roundedLat = Number(lat).toFixed(2)
  const roundedLng = Number(lng).toFixed(2)
  const safeHours = Number.isFinite(Number(forecastHours)) ? Math.round(Number(forecastHours)) : 10
  const start = startTime ? new Date(startTime) : new Date()
  start.setMinutes(0, 0, 0)
  const startBucket = Math.floor(start.getTime() / (60 * 60 * 1000))
  return `${OCEAN_CURRENT_CACHE_PREFIX}_${roundedLat}_${roundedLng}_${safeHours}_${startBucket}`
}

function readCachedCurrent(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.data) && parsed.data.length ? parsed : null
  } catch {
    return null
  }
}

function writeCachedCurrent(key, data, source) {
  try {
    localStorage.setItem(key, JSON.stringify({
      data,
      source,
      cachedAt: new Date().toISOString(),
    }))
  } catch {
    // Ignore storage errors.
  }
}

async function extractInvokeErrorDetails(error) {
  const fallback = {
    message: error?.message || 'Live ocean current unavailable',
    code: null,
  }

  try {
    const response = error?.context
    if (!response || typeof response.text !== 'function') return fallback

    const raw = await response.text()
    if (!raw) return fallback

    try {
      const parsed = JSON.parse(raw)
      const code = parsed?.code || null
      const providerStatus = parsed?.providerStatus
      const detail = parsed?.detail
      const errorMsg = parsed?.error || fallback.message
      const msg = formatProviderErrorMessage({
        errorMsg,
        code,
        providerStatus,
        detail,
        fallbackMessage: fallback.message,
      })

      return {
        message: msg,
        code,
      }
    } catch {
      return {
        message: raw.slice(0, 220),
        code: null,
      }
    }
  } catch {
    return fallback
  }
}

async function probeEdgeFunctionError(body) {
  try {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!baseUrl || !anonKey) return null

    const res = await fetch(`${baseUrl}/functions/v1/get-ocean-current`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(body),
    })

    if (res.ok) return null

    const raw = await res.text()
    try {
      const parsed = JSON.parse(raw)
      const code = parsed?.code || null
      const providerStatus = parsed?.providerStatus
      const detail = parsed?.detail
      const errorMsg = parsed?.error || `Edge function error ${res.status}`
      const message = formatProviderErrorMessage({
        errorMsg,
        code,
        providerStatus,
        detail,
        fallbackMessage: `Edge function error ${res.status}`,
      })
      return { message, code }
    } catch {
      return { message: raw.slice(0, 220), code: null }
    }
  } catch {
    return null
  }
}

function formatProviderErrorMessage({ errorMsg, code, providerStatus, detail, fallbackMessage }) {
  if (code === 'quota_exceeded') {
    const quotaInfo = parseStormglassQuotaMeta(detail)
    if (quotaInfo) {
      return `Stormglass daily quota reached (${quotaInfo.requestCount}/${quotaInfo.dailyQuota}). Ocean current will use cached data when available. Quota resets at midnight UTC.`
    }
    return 'Stormglass daily quota reached. Ocean current will use cached data when available. Quota resets at midnight UTC.'
  }

  return [
    errorMsg || fallbackMessage,
    providerStatus ? `(provider status ${providerStatus})` : null,
    detail ? `- ${String(detail).slice(0, 180)}` : null,
  ].filter(Boolean).join(' ')
}

function parseStormglassQuotaMeta(detail) {
  if (!detail) return null
  const text = String(detail)

  // Try JSON first if provider detail is serialized object text.
  try {
    const parsed = JSON.parse(text)
    const dailyQuota = Number(parsed?.meta?.dailyQuota)
    const requestCount = Number(parsed?.meta?.requestCount)
    if (Number.isFinite(dailyQuota) && Number.isFinite(requestCount)) {
      return { dailyQuota, requestCount }
    }
  } catch {
    // Fall through to regex extraction.
  }

  const quotaMatch = text.match(/"dailyQuota"\s*:\s*(\d+)/)
  const countMatch = text.match(/"requestCount"\s*:\s*(\d+)/)
  if (!quotaMatch || !countMatch) return null
  const dailyQuota = Number(quotaMatch[1])
  const requestCount = Number(countMatch[1])
  if (!Number.isFinite(dailyQuota) || !Number.isFinite(requestCount)) return null
  return { dailyQuota, requestCount }
}

/**
 * Fetches ocean current forecast from Stormglass
 * via Supabase Edge Function proxy.
 *
 * Returns array of { timestamp, currentSpeedKn, currentDirectionDeg }
 * matching the timeline physics current input shape.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} forecastHours
 * @param {string | number | Date | null} startTime
 * @returns {Promise<Array|null>}
 */
export async function fetchOceanCurrent(lat, lng, forecastHours = 10, startTime = null) {
  const result = await fetchOceanCurrentWithMeta(lat, lng, forecastHours, startTime)
  return result?.data || null
}

/**
 * Returns ocean current with metadata so UI can show precise source/failure details.
 * @returns {Promise<{ data: Array|null, source: string, error: string|null, code: string|null, cached: boolean, cachedAt: string|null }>}
 */
export async function fetchOceanCurrentWithMeta(lat, lng, forecastHours = 10, startTime = null) {
  const key = cacheKey(lat, lng, forecastHours, startTime)
  const payload = {
    lat,
    lng,
    forecastHours,
    startTime: startTime ? new Date(startTime).toISOString() : null,
  }
  try {
    const { data, error } = await supabase.functions.invoke('get-ocean-current', {
      body: payload,
    })

    if (error) {
      let parsedError = await extractInvokeErrorDetails(error)
      if (String(parsedError?.message || '').includes('non-2xx status code')) {
        const probed = await probeEdgeFunctionError(payload)
        if (probed?.message) parsedError = probed
      }
      console.warn('Ocean current fetch failed:', parsedError)
      const cached = readCachedCurrent(key)
      if (cached) {
        return {
          data: cached.data,
          source: `cache (${cached.source || 'previous fetch'})`,
          error: parsedError.message,
          code: parsedError.code,
          cached: true,
          cachedAt: cached.cachedAt || null,
        }
      }
      return {
        data: null,
        source: 'unavailable',
        error: parsedError.message,
        code: parsedError.code,
        cached: false,
        cachedAt: null,
      }
    }

    // Some function responses use 200 with an { error } payload.
    if (data?.error) {
      const cached = readCachedCurrent(key)
      if (cached) {
        return {
          data: cached.data,
          source: `cache (${cached.source || 'previous fetch'})`,
          error: data.error,
          code: data.code || null,
          cached: true,
          cachedAt: cached.cachedAt || null,
        }
      }
      return {
        data: null,
        source: 'unavailable',
        error: data.error,
        code: data.code || null,
        cached: false,
        cachedAt: null,
      }
    }

    const rows = Array.isArray(data?.data) ? data.data : null
    if (rows?.length) {
      const source = data?.source || 'live'
      writeCachedCurrent(key, rows, source)
      console.info(`Ocean current: ${data?.pointCount} points from ${source} (${data?.resolution || 'unknown'})`)
      return {
        data: rows,
        source,
        error: null,
        code: null,
        cached: false,
        cachedAt: null,
      }
    }

    const cached = readCachedCurrent(key)
    if (cached) {
      return {
        data: cached.data,
        source: `cache (${cached.source || 'previous fetch'})`,
        error: 'No live current rows returned',
        code: null,
        cached: true,
        cachedAt: cached.cachedAt || null,
      }
    }

    return {
      data: null,
      source: 'unavailable',
      error: 'No live current rows returned',
      code: null,
      cached: false,
      cachedAt: null,
    }
  } catch (err) {
    console.warn('Ocean current fetch error:', err?.message || err)
    const cached = readCachedCurrent(key)
    if (cached) {
      return {
        data: cached.data,
        source: `cache (${cached.source || 'previous fetch'})`,
        error: err?.message || 'Live ocean current unavailable',
        code: null,
        cached: true,
        cachedAt: cached.cachedAt || null,
      }
    }
    return {
      data: null,
      source: 'unavailable',
      error: err?.message || 'Live ocean current unavailable',
      code: null,
      cached: false,
      cachedAt: null,
    }
  }
}

/**
 * Finds the nearest interpolated current data for a target timestamp.
 * @param {Array} currentData
 * @param {number} targetTimestamp
 * @returns {{ currentSpeedKn: number, currentDirectionDeg: number } | null}
 */
export function interpolateCurrent(currentData, targetTimestamp) {
  if (!currentData || currentData.length === 0) return null

  const target = new Date(targetTimestamp).getTime()

  let before = null
  let after = null

  for (const point of currentData) {
    const t = new Date(point.timestamp).getTime()
    if (!Number.isFinite(t)) continue
    if (t <= target) before = point
    if (t > target && !after) after = point
  }

  if (!before && after) {
    return {
      currentSpeedKn: Number(after.currentSpeedKn ?? 0),
      currentDirectionDeg: Number(after.currentDirectionDeg ?? 0),
    }
  }
  if (before && !after) {
    return {
      currentSpeedKn: Number(before.currentSpeedKn ?? 0),
      currentDirectionDeg: Number(before.currentDirectionDeg ?? 0),
    }
  }
  if (!before || !after) return null

  const tBefore = new Date(before.timestamp).getTime()
  const tAfter = new Date(after.timestamp).getTime()
  if (!Number.isFinite(tBefore) || !Number.isFinite(tAfter) || tAfter <= tBefore) {
    return {
      currentSpeedKn: Number(before.currentSpeedKn ?? 0),
      currentDirectionDeg: Number(before.currentDirectionDeg ?? 0),
    }
  }

  const fraction = (target - tBefore) / (tAfter - tBefore)
  const currentSpeedKn = Number(before.currentSpeedKn ?? 0) +
    fraction * (Number(after.currentSpeedKn ?? 0) - Number(before.currentSpeedKn ?? 0))

  let dDir = Number(after.currentDirectionDeg ?? 0) - Number(before.currentDirectionDeg ?? 0)
  if (dDir > 180) dDir -= 360
  if (dDir < -180) dDir += 360
  const currentDirectionDeg = (Number(before.currentDirectionDeg ?? 0) + fraction * dDir + 360) % 360

  return {
    currentSpeedKn: Math.round(currentSpeedKn * 100) / 100,
    currentDirectionDeg: Math.round(currentDirectionDeg * 10) / 10,
  }
}

/**
 * Returns a human-readable current summary, e.g. "1.2 kn NNE".
 */
export function formatCurrent(currentSpeedKn, currentDirectionDeg) {
  if (currentSpeedKn == null || currentDirectionDeg == null) return '—'
  return `${Number(currentSpeedKn).toFixed(1)} kn ${degreesToCardinal(currentDirectionDeg)}`
}

function degreesToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round((((Number(deg) % 360) + 360) % 360) / 22.5) % 16]
}
