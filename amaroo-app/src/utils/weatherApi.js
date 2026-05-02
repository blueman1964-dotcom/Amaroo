export async function fetchRouteWeather(lat, lng, date = null) {
  const targetDate = date || new Date().toISOString().split('T')[0]

  try {
    const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine')
    marineUrl.searchParams.set('latitude', lat.toFixed(4))
    marineUrl.searchParams.set('longitude', lng.toFixed(4))
    marineUrl.searchParams.set(
      'hourly',
      [
        'wave_height',
        'wave_direction',
        'wave_period',
        'swell_wave_height',
        'swell_wave_direction',
        'swell_wave_period',
        'wind_wave_height',
      ].join(','),
    )
    marineUrl.searchParams.set('start_date', targetDate)
    marineUrl.searchParams.set('end_date', targetDate)
    marineUrl.searchParams.set('timezone', 'Australia/Brisbane')

    const windUrl = new URL('https://api.open-meteo.com/v1/forecast')
    windUrl.searchParams.set('latitude', lat.toFixed(4))
    windUrl.searchParams.set('longitude', lng.toFixed(4))
    windUrl.searchParams.set('hourly', 'windspeed_10m,winddirection_10m,windgusts_10m')
    windUrl.searchParams.set('wind_speed_unit', 'kn')
    windUrl.searchParams.set('start_date', targetDate)
    windUrl.searchParams.set('end_date', targetDate)
    windUrl.searchParams.set('timezone', 'Australia/Brisbane')

    const [marineRes, windRes] = await Promise.all([fetch(marineUrl.toString()), fetch(windUrl.toString())])

    if (!marineRes.ok || !windRes.ok) {
      throw new Error('Weather API request failed')
    }

    const [marineData, windData] = await Promise.all([marineRes.json(), windRes.json()])
    return { marineData, windData, error: null }
  } catch (err) {
    return { marineData: null, windData: null, error: err.message }
  }
}

function roundOrNull(value, dp = 1) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const mul = 10 ** dp
  return Math.round(num * mul) / mul
}

function degToCompass(deg) {
  if (deg === null || deg === undefined || Number.isNaN(deg)) return '-'
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

export function extractHourlyWeather(marineData, windData, hour = 9) {
  const safeHour = Math.max(0, Math.min(hour, 23))
  const m = marineData?.hourly
  const w = windData?.hourly
  if (!m || !w) return null

  const windDirDeg = roundOrNull(w.winddirection_10m?.[safeHour], 0)
  const waveDirDeg = roundOrNull(m.wave_direction?.[safeHour], 0)
  const swellDirDeg = roundOrNull(m.swell_wave_direction?.[safeHour], 0)

  return {
    windKn: roundOrNull(w.windspeed_10m?.[safeHour], 1),
    windGustKn: roundOrNull(w.windgusts_10m?.[safeHour], 1),
    windDirDeg,
    windDirCompass: degToCompass(windDirDeg),
    waveHeightM: roundOrNull(m.wave_height?.[safeHour], 1),
    waveDirDeg,
    waveDirCompass: degToCompass(waveDirDeg),
    wavePeriodS: roundOrNull(m.wave_period?.[safeHour], 1),
    swellHeightM: roundOrNull(m.swell_wave_height?.[safeHour], 1),
    swellDirDeg,
    swellDirCompass: degToCompass(swellDirDeg),
    swellPeriodS: roundOrNull(m.swell_wave_period?.[safeHour], 1),
  }
}

export function routeMidpoint(waypoints) {
  if (!waypoints || waypoints.length === 0) return { lat: -27.5, lng: 153.4 }
  const lat = waypoints.reduce((sum, wp) => sum + wp.lat, 0) / waypoints.length
  const lng = waypoints.reduce((sum, wp) => sum + wp.lng, 0) / waypoints.length
  return { lat, lng }
}
