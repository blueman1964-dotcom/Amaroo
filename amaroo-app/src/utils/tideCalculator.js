/**
 * Tide calculation engine for Amaroo.
 * Uses Rule of Twelfths for height interpolation between tide events.
 */
import { STANDARD_PORTS, SECONDARY_PORTS } from '../data/tideStations'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a date string "YYYY-MM-DD" into a Date at midnight AEST (UTC+10) */
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - 10 * 3600 * 1000) // midnight AEST as UTC
}

/** Format a Date to "YYYY-MM-DD" in AEST */
function toAESTDateStr(date) {
  const aest = new Date(date.getTime() + 10 * 3600 * 1000)
  const y = aest.getUTCFullYear()
  const m = String(aest.getUTCMonth() + 1).padStart(2, '0')
  const d = String(aest.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** "HH:MM" → minutes since midnight */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

/** minutes since midnight → "HH:MM" */
function minutesToTime(mins) {
  const h = Math.floor(((mins % 1440) + 1440) % 1440 / 60)
  const m = ((mins % 1440) + 1440) % 1440 % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Haversine distance in nautical miles */
function haversineNm(lat1, lng1, lat2, lng2) {
  const R = 3440.065 // nm
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Apply time diff (hwDiff or lwDiff) to minutes */
function applyDiff(baseMinutes, diff) {
  return baseMinutes + diff.h * 60 + diff.m
}

// ── Data lookup ───────────────────────────────────────────────────────────────

/** Get standard port tides for a specific date string "YYYY-MM-DD" */
function getStandardPortTidesForDate(portId, dateStr) {
  const port = STANDARD_PORTS[portId]
  if (!port) return []
  return port.tides.filter((t) => t.date === dateStr)
}

/** Get all standard or secondary port info */
function getStationInfo(stationId) {
  if (STANDARD_PORTS[stationId]) {
    return { ...STANDARD_PORTS[stationId], id: stationId }
  }
  const sec = SECONDARY_PORTS.find((p) => p.id === stationId)
  if (sec) return sec
  return null
}

// ── Core calculation ──────────────────────────────────────────────────────────

/**
 * Get corrected tide events for a secondary port on a given date.
 * Applies time corrections (hwDiff/lwDiff) and height corrections (ratio/constant).
 */
function getSecondaryPortTidesForDate(secPort, dateStr) {
  const standardTides = getStandardPortTidesForDate(secPort.standardPort, dateStr)
  if (!standardTides.length) return []

  return standardTides
    .map((tide) => {
      const baseMins = timeToMinutes(tide.time)
      const diff = tide.type === 'high' ? secPort.hwDiff : secPort.lwDiff
      const correctedMins = applyDiff(baseMins, diff)
      const correctedHeight = Math.round((tide.height * secPort.ratio + secPort.constant) * 100) / 100

      return {
        date: dateStr,
        time: minutesToTime(correctedMins),
        type: tide.type,
        height: Math.max(0, correctedHeight),
      }
    })
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get all tide events for a station on a given date.
 * stationId: standard port key or secondary port id
 * date: "YYYY-MM-DD"
 */
export function getTidesForDate(stationId, dateStr) {
  if (STANDARD_PORTS[stationId]) {
    return getStandardPortTidesForDate(stationId, dateStr)
  }
  const sec = SECONDARY_PORTS.find((p) => p.id === stationId)
  if (sec) {
    return getSecondaryPortTidesForDate(sec, dateStr)
  }
  return []
}

/**
 * Get all tide events across a date range (inclusive).
 * startDate / endDate: "YYYY-MM-DD"
 */
export function getTidesForRange(stationId, startDate, endDate) {
  const result = []
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  const cur = new Date(start)

  while (cur <= end) {
    const ds = toAESTDateStr(cur)
    result.push(...getTidesForDate(stationId, ds))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  return result.sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    return d !== 0 ? d : a.time.localeCompare(b.time)
  })
}

/**
 * Rule of Twelfths tide height interpolation.
 * Fraction through a tidal cycle (0..1) → proportion of range moved.
 */
function ruleOfTwelfths(fraction) {
  // Each 1/6 of the cycle moves 1,2,3,3,2,1 twelfths of the range
  const twelfths = [1, 2, 3, 3, 2, 1]
  let moved = 0
  const sixthPos = fraction * 6 // position in sixths (0..6)
  const fullSixths = Math.floor(sixthPos)
  const remainder = sixthPos - fullSixths

  for (let i = 0; i < fullSixths && i < 6; i++) {
    moved += twelfths[i]
  }
  if (fullSixths < 6) {
    moved += twelfths[fullSixths] * remainder
  }

  return moved / 12
}

/**
 * Calculate estimated tide height at any datetime using Rule of Twelfths.
 * Returns height in metres above LAT datum, or null if no data available.
 */
export function getCurrentTideHeight(stationId, datetime) {
  const dateStr = toAESTDateStr(datetime)
  const aestMs = datetime.getTime() + 10 * 3600 * 1000
  const minutesSinceMidnight =
    ((aestMs % (24 * 3600 * 1000)) + 24 * 3600 * 1000) % (24 * 3600 * 1000) / 60000

  // Get tides for today and adjacent days for boundary cases
  const prevDate = new Date(parseDate(dateStr))
  prevDate.setUTCDate(prevDate.getUTCDate() - 1)
  const nextDate = new Date(parseDate(dateStr))
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)

  const allTides = [
    ...getTidesForDate(stationId, toAESTDateStr(prevDate)),
    ...getTidesForDate(stationId, dateStr),
    ...getTidesForDate(stationId, toAESTDateStr(nextDate)),
  ]

  if (!allTides.length) return null

  // Convert all tides to absolute minutes (relative to today midnight)
  const tidesWithAbsMins = allTides.map((t) => {
    const dayOffset = t.date === dateStr ? 0 : t.date < dateStr ? -1440 : 1440
    return {
      ...t,
      absMins: timeToMinutes(t.time) + dayOffset,
    }
  })

  tidesWithAbsMins.sort((a, b) => a.absMins - b.absMins)

  // Find bracketing tides
  let prevTide = null
  let nextTide = null

  for (let i = 0; i < tidesWithAbsMins.length; i++) {
    if (tidesWithAbsMins[i].absMins <= minutesSinceMidnight) {
      prevTide = tidesWithAbsMins[i]
    } else {
      nextTide = tidesWithAbsMins[i]
      break
    }
  }

  if (!prevTide && tidesWithAbsMins.length) prevTide = tidesWithAbsMins[0]
  if (!nextTide && tidesWithAbsMins.length) nextTide = tidesWithAbsMins[tidesWithAbsMins.length - 1]

  if (!prevTide || !nextTide || prevTide === nextTide) {
    return prevTide?.height ?? nextTide?.height ?? null
  }

  const totalMins = nextTide.absMins - prevTide.absMins
  if (totalMins <= 0) return prevTide.height

  const elapsed = minutesSinceMidnight - prevTide.absMins
  const fraction = Math.min(1, Math.max(0, elapsed / totalMins))

  const range = Math.abs(nextTide.height - prevTide.height)
  const proportion = ruleOfTwelfths(fraction)

  if (nextTide.type === 'high') {
    // Rising tide
    return Math.round((prevTide.height + proportion * range) * 100) / 100
  } else {
    // Falling tide
    return Math.round((prevTide.height - proportion * range) * 100) / 100
  }
}

/**
 * Generate (time, height) points at intervalMinutes across a full day.
 * date: "YYYY-MM-DD"
 */
export function getTideCurvePoints(stationId, dateStr, intervalMinutes = 30) {
  const points = []
  const base = parseDate(dateStr) // midnight AEST as UTC

  for (let mins = 0; mins <= 24 * 60; mins += intervalMinutes) {
    const dt = new Date(base.getTime() + mins * 60 * 1000) // base is already midnight AEST as UTC
    const height = getCurrentTideHeight(stationId, dt)
    if (height !== null) {
      points.push({
        time: minutesToTime(mins),
        timeMinutes: mins,
        height,
      })
    }
  }

  return points
}

/**
 * Get next `count` tide events after a datetime.
 */
export function getNextTides(stationId, datetime, count = 4) {
  const dateStr = toAESTDateStr(datetime)
  const minutesSinceMidnight =
    ((datetime.getTime() + 10 * 3600 * 1000) % (24 * 3600 * 1000)) / 60000

  // Fetch 3 days of data to be safe
  const results = []
  const startDate = parseDate(dateStr)

  for (let dayOffset = 0; dayOffset <= 7 && results.length < count; dayOffset++) {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + dayOffset)
    const ds = toAESTDateStr(d)
    const tides = getTidesForDate(stationId, ds)

    for (const tide of tides) {
      const tideMins = timeToMinutes(tide.time)
      const absMins = tideMins + dayOffset * 1440
      if (absMins > minutesSinceMidnight && results.length < count) {
        results.push({ ...tide, daysFromNow: dayOffset })
      }
    }
  }

  return results
}

/**
 * Get next `count` high tides after datetime.
 */
export function getNextHighTides(stationId, datetime, count = 2) {
  const tides = getNextTides(stationId, datetime, count * 4)
  return tides.filter((t) => t.type === 'high').slice(0, count)
}

/**
 * Get next `count` low tides after datetime.
 */
export function getNextLowTides(stationId, datetime, count = 2) {
  const tides = getNextTides(stationId, datetime, count * 4)
  return tides.filter((t) => t.type === 'low').slice(0, count)
}

/**
 * Find nearest station (standard or secondary) to given coordinates.
 * Returns { station, id, distanceNm }
 */
export function findNearestStation(lat, lng) {
  let nearest = null
  let nearestDist = Infinity

  for (const [id, port] of Object.entries(STANDARD_PORTS)) {
    const d = haversineNm(lat, lng, port.lat, port.lng)
    if (d < nearestDist) {
      nearestDist = d
      nearest = { ...port, id }
    }
  }

  for (const sec of SECONDARY_PORTS) {
    const d = haversineNm(lat, lng, sec.lat, sec.lng)
    if (d < nearestDist) {
      nearestDist = d
      nearest = { ...sec, id: sec.id }
    }
  }

  return nearest ? { station: nearest, id: nearest.id, distanceNm: nearestDist } : null
}

/**
 * Get all stations with their distance from a location.
 * Returns sorted array of { id, name, lat, lng, type, standardPort?, distanceNm }
 */
export function getAllStationsWithDistance(lat, lng) {
  const stations = []

  for (const [id, port] of Object.entries(STANDARD_PORTS)) {
    stations.push({
      id,
      name: port.name,
      lat: port.lat,
      lng: port.lng,
      type: 'standard',
      distanceNm: haversineNm(lat, lng, port.lat, port.lng),
    })
  }

  for (const sec of SECONDARY_PORTS) {
    stations.push({
      id: sec.id,
      name: sec.name,
      lat: sec.lat,
      lng: sec.lng,
      type: 'secondary',
      standardPort: sec.standardPort,
      distanceNm: haversineNm(lat, lng, sec.lat, sec.lng),
    })
  }

  return stations.sort((a, b) => a.distanceNm - b.distanceNm)
}

/**
 * Depth under keel calculator.
 * Samples tide height every 10 minutes over the period.
 * chartDepth: charted depth at location (m)
 * keel: vessel draught (m)
 * startDatetime: Date object
 * durationHours: number
 */
export function getMinDepthOverPeriod(stationId, chartDepth, keel, startDatetime, durationHours) {
  const intervalMins = 10
  const totalPoints = Math.ceil((durationHours * 60) / intervalMins) + 1
  const curvePoints = []

  let minDepth = Infinity
  let minDepthTime = null
  let minTideHeight = null

  for (let i = 0; i < totalPoints; i++) {
    const dt = new Date(startDatetime.getTime() + i * intervalMins * 60 * 1000)
    const tideHeight = getCurrentTideHeight(stationId, dt) ?? 0
    const availableDepth = chartDepth + tideHeight - keel

    const aestMs = dt.getTime() + 10 * 3600 * 1000
    const mins = (aestMs % (24 * 3600 * 1000)) / 60000
    const timeStr = minutesToTime(mins)

    curvePoints.push({
      time: timeStr,
      timeMs: dt.getTime(),
      tideHeight,
      availableDepth,
    })

    if (availableDepth < minDepth) {
      minDepth = availableDepth
      minDepthTime = dt
      minTideHeight = tideHeight
    }
  }

  return {
    minDepth: Math.round(minDepth * 100) / 100,
    minDepthTime,
    minTideHeight,
    isSafe: minDepth > 0,
    clearance: Math.round(minDepth * 100) / 100,
    curvePoints,
  }
}

/** Expose station info lookup for UI */
export { getStationInfo, toAESTDateStr, timeToMinutes, minutesToTime, SECONDARY_PORTS, STANDARD_PORTS }
