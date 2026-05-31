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
    windUrl.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m')
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

const MPS_TO_KNOTS = 1.944

function mpsToKn(value, dp = 1) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const mul = 10 ** dp
  return Math.round(num * MPS_TO_KNOTS * mul) / mul
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

  const windSpeedSeries = w.wind_speed_10m || w.windspeed_10m || []
  const windDirSeries = w.wind_direction_10m || w.winddirection_10m || []
  const windGustSeries = w.wind_gusts_10m || w.windgusts_10m || []

  const windDirDeg = roundOrNull(windDirSeries?.[safeHour], 0)
  const waveDirDeg = roundOrNull(m.wave_direction?.[safeHour], 0)
  const swellDirDeg = roundOrNull(m.swell_wave_direction?.[safeHour], 0)
  return {
    windKn: roundOrNull(windSpeedSeries?.[safeHour], 1),
    windGustKn: roundOrNull(windGustSeries?.[safeHour], 1),
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
    temperatureC: roundOrNull(w.temperature_2m?.[safeHour], 1),
  }
}

export async function fetchCurrentConditions(lat, lng) {
  try {
    const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine')
    marineUrl.searchParams.set('latitude', lat.toFixed(4))
    marineUrl.searchParams.set('longitude', lng.toFixed(4))
    marineUrl.searchParams.set('current', 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height')
    marineUrl.searchParams.set('timezone', 'auto')

    const windUrl = new URL('https://api.open-meteo.com/v1/forecast')
    windUrl.searchParams.set('latitude', lat.toFixed(4))
    windUrl.searchParams.set('longitude', lng.toFixed(4))
    windUrl.searchParams.set('current', 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m')
    windUrl.searchParams.set('wind_speed_unit', 'kn')
    windUrl.searchParams.set('timezone', 'auto')

    const [marineRes, windRes] = await Promise.all([fetch(marineUrl.toString()), fetch(windUrl.toString())])
    if (!marineRes.ok || !windRes.ok) throw new Error('Weather API request failed')
    const [marineData, windData] = await Promise.all([marineRes.json(), windRes.json()])

    const mc = marineData?.current
    const wc = windData?.current
    const windDirDeg = roundOrNull(wc?.wind_direction_10m, 0)
    const waveDirDeg = roundOrNull(mc?.wave_direction, 0)
    const swellDirDeg = roundOrNull(mc?.swell_wave_direction, 0)

    return {
      conditions: {
        windKn: roundOrNull(wc?.wind_speed_10m, 1),
        windGustKn: roundOrNull(wc?.wind_gusts_10m, 1),
        windDirDeg,
        windDirCompass: degToCompass(windDirDeg),
        waveHeightM: roundOrNull(mc?.wave_height, 1),
        wavePeriodS: roundOrNull(mc?.wave_period, 1),
        waveDirDeg,
        waveDirCompass: degToCompass(waveDirDeg),
        swellHeightM: roundOrNull(mc?.swell_wave_height, 1),
        swellDirDeg,
        swellDirCompass: degToCompass(swellDirDeg),
        swellPeriodS: roundOrNull(mc?.swell_wave_period, 1),
        windWaveHeightM: roundOrNull(mc?.wind_wave_height, 1),
        temperatureC: roundOrNull(wc?.temperature_2m, 1),
      },
      error: null,
    }
  } catch (err) {
    return { conditions: null, error: err.message }
  }
}

function safeMax(values) {
  const nums = values.filter((v) => Number.isFinite(Number(v)))
  return nums.length ? Math.max(...nums) : null
}

export async function fetchWeatherForecast(lat, lng) {
  try {
    const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine')
    marineUrl.searchParams.set('latitude', lat.toFixed(4))
    marineUrl.searchParams.set('longitude', lng.toFixed(4))
    marineUrl.searchParams.set('hourly', 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period')
    marineUrl.searchParams.set('forecast_days', '7')
    marineUrl.searchParams.set('timezone', 'auto')

    const windUrl = new URL('https://api.open-meteo.com/v1/forecast')
    windUrl.searchParams.set('latitude', lat.toFixed(4))
    windUrl.searchParams.set('longitude', lng.toFixed(4))
    windUrl.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m')
    windUrl.searchParams.set('wind_speed_unit', 'kn')
    windUrl.searchParams.set('forecast_days', '7')
    windUrl.searchParams.set('timezone', 'auto')

    const [marineRes, windRes] = await Promise.all([fetch(marineUrl.toString()), fetch(windUrl.toString())])
    if (!marineRes.ok || !windRes.ok) throw new Error('Weather API request failed')
    const [marineData, windData] = await Promise.all([marineRes.json(), windRes.json()])

    const times = marineData?.hourly?.time || []
    const days = []
    const seenDays = new Set()

    times.forEach((time) => {
      const day = time.split('T')[0]
      if (seenDays.has(day)) return
      seenDays.add(day)
      const dayIndices = []
      times.forEach((t, j) => { if (t.startsWith(day)) dayIndices.push(j) })

      const maxWave = safeMax(dayIndices.map((j) => marineData.hourly.wave_height?.[j]))
      const maxSwell = safeMax(dayIndices.map((j) => marineData.hourly.swell_wave_height?.[j]))
      const maxWindKn = safeMax(dayIndices.map((j) => windData.hourly.wind_speed_10m?.[j]))
      const maxGustKn = safeMax(dayIndices.map((j) => windData.hourly.wind_gusts_10m?.[j]))
      const maxTemp = safeMax(dayIndices.map((j) => windData.hourly.temperature_2m?.[j]))

      const maxSwellIdx = dayIndices.reduce((best, j) =>
        (marineData.hourly.swell_wave_height?.[j] ?? -1) > (marineData.hourly.swell_wave_height?.[best] ?? -1) ? j : best,
      dayIndices[0])
      const swellDirDeg = marineData.hourly.swell_wave_direction?.[maxSwellIdx]
      const swellPeriodS = safeMax(dayIndices.map((j) => marineData.hourly.swell_wave_period?.[j]))

      days.push({
        date: day,
        maxWaveM: roundOrNull(maxWave, 1),
        maxSwellM: roundOrNull(maxSwell, 1),
        swellDirDeg: roundOrNull(swellDirDeg, 0),
        swellDirCompass: degToCompass(swellDirDeg),
        swellPeriodS: roundOrNull(swellPeriodS, 1),
        maxWindKn: roundOrNull(maxWindKn, 1),
        maxGustKn: roundOrNull(maxGustKn, 1),
        maxTempC: roundOrNull(maxTemp, 1),
      })
    })

    return { days, error: null }
  } catch (err) {
    return { days: [], error: err.message }
  }
}

export function routeMidpoint(waypoints) {
  if (!waypoints || waypoints.length === 0) return { lat: -27.5, lng: 153.4 }
  const lat = waypoints.reduce((sum, wp) => sum + wp.lat, 0) / waypoints.length
  const lng = waypoints.reduce((sum, wp) => sum + wp.lng, 0) / waypoints.length
  return { lat, lng }
}
