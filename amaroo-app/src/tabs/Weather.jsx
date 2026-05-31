import { useEffect, useMemo, useState } from 'react'
import { extractHourlyWeather, fetchCurrentConditions, fetchRouteWeather, fetchWeatherForecast } from '../utils/weatherApi'
import { fetchOceanCurrent, formatCurrent, interpolateCurrent } from '../utils/oceanCurrent'

const BOM_FORECASTS = [
  { name: 'Moreton Bay', lat: -27.524, lon: 153.43, icon: '⚓', url: 'https://www.bom.gov.au/cgi-bin/marine/forecasts.pl?area=qt&tz=EST&type=IDQ10183' },
  { name: 'Gold Coast Waters', lat: -28.0, lon: 153.4, icon: '🌊', url: 'https://www.bom.gov.au/marine/forecasts.shtml?area=qt' },
  { name: 'Sunshine Coast Waters', lat: -26.7, lon: 153.1, icon: '🌊', url: 'https://www.bom.gov.au/marine/forecasts.shtml?area=qt' },
  { name: 'Wide Bay Waters', lat: -25.0, lon: 153.2, icon: '🌊', url: 'https://www.bom.gov.au/marine/forecasts.shtml?area=qt' },
  { name: 'Capricornia Waters', lat: -23.2, lon: 150.8, icon: '🌊', url: 'https://www.bom.gov.au/marine/forecasts.shtml?area=qt' },
  { name: 'Whitsunday Waters', lat: -20.3, lon: 149.0, icon: '🌊', url: 'https://www.bom.gov.au/marine/forecasts.shtml?area=qt' },
  { name: 'Cairns', lat: -16.9, lon: 145.8, icon: '🌊', url: 'https://www.bom.gov.au/marine/forecasts.shtml?area=qt' },
]

const WEATHER_RESOURCES = [
  { name: 'PredictWind Offshore App', url: 'https://www.predictwind.com', description: 'Premium route weather forecasting' },
  { name: 'Windy.com', url: 'https://www.windy.com', description: 'Interactive animated weather maps - your subscription' },
  { name: 'BOM Marine Forecasts', url: 'https://www.bom.gov.au/marine/', description: 'Official Australian marine forecasts' },
  { name: 'Passage Weather', url: 'https://www.passageweather.com', description: 'Free GRIB viewer and forecasts' },
  { name: 'NOAA GRIB2 Files', url: 'https://nomads.ncep.noaa.gov', description: 'Raw GFS model GRIB files' },
  { name: 'Open-Meteo Marine', url: 'https://open-meteo.com/en/docs/marine-weather-api', description: 'Free marine weather API used by this app' },
]

const TIDE_STATIONS = [
  { name: 'Brisbane Bar (Fisherman Islands)', lat: -27.37, lon: 153.17 },
  { name: 'Moreton Island', lat: -27.13, lon: 153.38 },
  { name: 'Tangalooma', lat: -27.16, lon: 153.37 },
  { name: 'Mooloolaba', lat: -26.68, lon: 153.13 },
  { name: 'Noosa Bar', lat: -26.38, lon: 153.09 },
  { name: 'Tin Can Bay (Wide Bay Bar)', lat: -25.91, lon: 153.01 },
  { name: 'Bundaberg / Burnett Heads', lat: -24.76, lon: 152.41 },
  { name: 'Gladstone', lat: -23.84, lon: 151.26 },
  { name: 'Mackay', lat: -21.14, lon: 149.19 },
  { name: 'Whitsunday Group', lat: -20.27, lon: 148.96 },
  { name: 'Cairns', lat: -16.92, lon: 145.78 },
]

const TIDE_OFFICIAL_LINKS = [
  { name: 'BOM Tide Predictions', url: 'https://www.bom.gov.au/australia/tides/' },
  { name: 'Queensland Tide Tables (MSQ)', url: 'https://www.msq.qld.gov.au/Safety/Tides' },
]

const LOCATIONS = [
  { name: 'Moreton Bay', lat: -27.524, lon: 153.43, zoom: 8 },
  { name: 'Wide Bay Bar', lat: -25.0, lon: 153.2, zoom: 9 },
  { name: 'Sunshine Coast', lat: -26.7, lon: 153.1, zoom: 9 },
  { name: 'Gold Coast', lat: -28.0, lon: 153.4, zoom: 9 },
  { name: 'Whitsundays', lat: -20.3, lon: 149.0, zoom: 8 },
  { name: 'Cairns', lat: -16.9, lon: 145.8, zoom: 9 },
]

const OVERLAYS = [
  { label: '🌬 Wind', value: 'wind' },
  { label: '🌊 Waves & Tides', value: 'waves' },
  { label: '🌗 Tide (if available)', value: 'tides' },
  { label: '🌧 Rain', value: 'rain' },
  { label: '🌡 Temp', value: 'temp' },
  { label: '☁ Clouds', value: 'clouds' },
  { label: '🧭 Current', value: 'currents' },
]

function nearestStation(lat, lon) {
  let nearest = TIDE_STATIONS[0]
  let best = Number.POSITIVE_INFINITY
  for (const station of TIDE_STATIONS) {
    const d = Math.hypot(lat - station.lat, lon - station.lon)
    if (d < best) {
      best = d
      nearest = station
    }
  }
  return nearest
}

function mapOverlayForWindy(overlay) {
  if (overlay === 'waves') return 'waves'
  if (overlay === 'wind') return 'wind'
  if (overlay === 'tides') return 'tides'
  return overlay
}

function buildWindySrc(location, overlay) {
  const url = new URL('https://embed.windy.com/embed.html')
  url.searchParams.set('type', 'map')
  url.searchParams.set('location', 'coordinates')
  url.searchParams.set('metricRain', 'default')
  url.searchParams.set('metricTemp', 'default')
  url.searchParams.set('metricWind', 'kt')
  url.searchParams.set('zoom', String(location.zoom || 8))
  url.searchParams.set('overlay', mapOverlayForWindy(overlay))
  url.searchParams.set('product', 'ecmwf')
  url.searchParams.set('level', 'surface')
  url.searchParams.set('lat', String(location.lat))
  url.searchParams.set('lon', String(location.lon))
  return url.toString()
}

function windyOpenUrl(location, overlay = 'currents') {
  const lat = location.lat.toFixed(3)
  const lon = location.lon.toFixed(3)
  const zoom = location.zoom
  return `https://www.windy.com/?${overlay},${lat},${lon},${zoom}`
}

function windyStationUrl(station, overlay = 'tides') {
  const lat = station.lat.toFixed(3)
  const lon = station.lon.toFixed(3)
  return `https://www.windy.com/${lat}/${lon}?${overlay},${lat},${lon},9`
}

function ForecastCard({ forecast }) {
  if (!forecast) return <div className="text-sm text-slate-500 mt-2">Loading conditions...</div>
  return (
    <div className="mt-2 text-sm space-y-1">
      <div>Wind: <strong>{forecast.windKn ?? '-'} kn</strong> {forecast.windDirCompass} ({forecast.windDirDeg ?? '-'}°)</div>
      <div>Gusts: {forecast.windGustKn ?? '-'} kn</div>
      <div>Waves: {forecast.waveHeightM ?? '-'} m · {forecast.wavePeriodS ?? '-'}s</div>
      <div>Swell: {forecast.swellHeightM ?? '-'} m {forecast.swellDirCompass} · {forecast.swellPeriodS ?? '-'}s</div>
    </div>
  )
}

const HOME_LAT = -27.524
const HOME_LON = 153.430

function degreesToArrow(deg) {
  if (deg == null) return '–'
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘']
  return arrows[Math.round(deg / 45) % 8]
}

const LAST_WEATHER_KEY = 'amaroo_last_weather_snapshot'

export default function Weather() {
  const [subTab, setSubTab] = useState('map')
  const [overlay, setOverlay] = useState('waves')
  const [location, setLocation] = useState(LOCATIONS[0])
  const [nearest, setNearest] = useState('')
  const [forecasts, setForecasts] = useState({})
  const [tideStation, setTideStation] = useState(TIDE_STATIONS[0])
  const [currentConditions, setCurrentConditions] = useState(null)
  const [oceanCurrent, setOceanCurrent] = useState(null)
  const [conditionsLoading, setConditionsLoading] = useState(false)
  const [conditionsUpdatedAt, setConditionsUpdatedAt] = useState(null)
  const [forecastDays, setForecastDays] = useState([])
  const [forecastLoading, setForecastLoading] = useState(false)
  const [gpsCoords, setGpsCoords] = useState(null)

  const activeCoords = gpsCoords || { lat: location.lat, lon: location.lon }

  const fetchConditionsAndForecast = async (lat, lon) => {
    setConditionsLoading(true)
    setForecastLoading(true)
    const [condResult, forecastResult, currentResult] = await Promise.all([
      fetchCurrentConditions(lat, lon),
      fetchWeatherForecast(lat, lon),
      fetchOceanCurrent(lat, lon, 6),
    ])
    if (condResult.conditions) {
      setCurrentConditions(condResult.conditions)
      setConditionsUpdatedAt(new Date())
      try {
        window.localStorage.setItem(LAST_WEATHER_KEY, JSON.stringify(condResult.conditions))
      } catch {
        // Ignore local storage write errors.
      }
    }
    const nearestCurrent = interpolateCurrent(currentResult, Date.now())
    setOceanCurrent(nearestCurrent)
    setConditionsLoading(false)
    if (forecastResult.days?.length) setForecastDays(forecastResult.days)
    setForecastLoading(false)
  }

  useEffect(() => {
    // Try GPS, fall back to selected location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
          setGpsCoords(coords)
          fetchConditionsAndForecast(coords.lat, coords.lon)
        },
        () => fetchConditionsAndForecast(location.lat, location.lon),
        { timeout: 8000 },
      )
    } else {
      fetchConditionsAndForecast(location.lat, location.lon)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const windySrc = useMemo(() => buildWindySrc({ ...location, lat: activeCoords.lat, lon: activeCoords.lon }, overlay), [location, overlay, activeCoords])
  const windyOverlayUrl = useMemo(() => windyOpenUrl({ ...location, lat: activeCoords.lat, lon: activeCoords.lon }, mapOverlayForWindy(overlay)), [location, overlay, activeCoords])
  const windyWindUrl = useMemo(() => windyOpenUrl({ ...location, lat: activeCoords.lat, lon: activeCoords.lon }, 'wind'), [location, activeCoords])
  const windyWavesUrl = useMemo(() => windyOpenUrl({ ...location, lat: activeCoords.lat, lon: activeCoords.lon }, 'waves'), [location, activeCoords])
  const windyTidesUrl = useMemo(() => windyOpenUrl(location, 'tides'), [location])
  const windyCurrentsUrl = useMemo(() => windyOpenUrl(location, 'currents'), [location])

  const fetchForecastFor = async (name, lat, lon) => {
    if (forecasts[name]) return
    const hour = new Date().getHours()
    const { marineData, windData, error } = await fetchRouteWeather(lat, lon)
    if (error) {
      setForecasts((prev) => ({ ...prev, [name]: null }))
      return
    }
    const weather = extractHourlyWeather(marineData, windData, hour)
    setForecasts((prev) => ({ ...prev, [name]: weather }))
  }

  const useNearest = () => {
    if (!navigator.geolocation) {
      setNearest('Geolocation unavailable in this browser.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const station = nearestStation(pos.coords.latitude, pos.coords.longitude)
        setNearest(`Nearest tide station: ${station.name}`)
        setTideStation(station)
      },
      () => {
        setNearest('Unable to get location. Select a tide station manually.')
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'map', label: 'Wind & Swell Map' },
          { id: 'bom', label: 'Marine Forecasts' },
          { id: 'grib', label: 'GRIB / Download' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`px-3 py-2 rounded-full text-sm ${subTab === tab.id ? 'bg-[#0A4A52] text-white' : 'bg-slate-200 text-slate-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'map' && (
        <div className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4 space-y-3">

          {/* Current Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-[#0A4A52]">Current Conditions {gpsCoords ? '📍 GPS' : `— ${location.name}`}</h4>
              <button type="button" onClick={() => fetchConditionsAndForecast(activeCoords.lat, activeCoords.lon)}
                className="text-xs text-[#0A4A52] border border-[#0A4A52] px-2 py-1 rounded hover:bg-teal-50">
                Refresh
              </button>
            </div>
            {conditionsLoading ? (
              <div className="text-sm text-slate-400">Fetching conditions…</div>
            ) : currentConditions ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500 mb-0.5">💨 Wind</div>
                  <div className="font-bold text-[#0A4A52]">{currentConditions.windKn ?? '–'} kn</div>
                  <div className="text-xs text-slate-500">{currentConditions.windDirCompass} · gusts {currentConditions.windGustKn ?? '–'} kn</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500 mb-0.5">🌊 Waves</div>
                  <div className="font-bold text-[#0A4A52]">{currentConditions.waveHeightM ?? '–'} m</div>
                  <div className="text-xs text-slate-500">{currentConditions.wavePeriodS ?? '–'}s · {currentConditions.waveDirCompass}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500 mb-0.5">🌀 Swell</div>
                  <div className="font-bold text-[#0A4A52]">{currentConditions.swellHeightM ?? '–'} m</div>
                  <div className="text-xs text-slate-500">{currentConditions.swellDirCompass} · {currentConditions.swellPeriodS ?? '–'}s</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500 mb-0.5">🌡️ Temp</div>
                  <div className="font-bold text-[#0A4A52]">{currentConditions.temperatureC ?? '–'}°C</div>
                  {conditionsUpdatedAt && <div className="text-xs text-slate-400">{conditionsUpdatedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</div>}
                </div>
                {oceanCurrent && (
                  <div className="rounded-lg bg-slate-50 p-2 md:col-span-2">
                    <div className="text-xs text-slate-500 mb-0.5">↔ Current</div>
                    <div className="font-bold text-[#0A4A52]">{formatCurrent(oceanCurrent.currentSpeedKn, oceanCurrent.currentDirectionDeg)}</div>
                    <div className="text-xs text-slate-500">Source: Stormglass</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-400">No conditions data. Click Refresh to fetch.</div>
            )}
          </div>

          {/* 7-day forecast */}
          {(forecastLoading || forecastDays.length > 0) && (
            <div>
              <h4 className="font-semibold text-[#0A4A52] mb-2">7-Day Forecast</h4>
              {forecastLoading ? (
                <div className="text-sm text-slate-400">Loading forecast…</div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {forecastDays.map((day) => {
                    const date = new Date(day.date + 'T00:00:00')
                    return (
                      <div key={day.date} className="shrink-0 w-28 rounded-lg bg-slate-50 border border-slate-200 p-2 text-center text-xs">
                        <div className="font-semibold text-[#0A4A52]">{date.toLocaleDateString('en-AU', { weekday: 'short' })}</div>
                        <div className="text-slate-400">{date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</div>
                        <div className="mt-1">🌊 {day.maxWaveM ?? '–'}m</div>
                        <div>🌀 {day.maxSwellM ?? '–'}m {day.swellPeriodS ? `${day.swellPeriodS}s` : ''}</div>
                        <div>{degreesToArrow(day.swellDirDeg)} {day.swellDirCompass ?? '–'}</div>
                        <div>💨 {day.maxWindKn ?? '–'}kn</div>
                        {day.maxGustKn != null && <div className="text-slate-500">G {day.maxGustKn}kn</div>}
                        <div>🌡️ {day.maxTempC ?? '–'}°C</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Windy deep-link buttons */}
          <div className="flex flex-wrap gap-2">
            <a href={windyWavesUrl} target="_blank" rel="noreferrer"
              className="flex-1 min-w-fit text-center rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm font-medium">
              🌊 Open Waves in Windy
            </a>
            <a href={windyWindUrl} target="_blank" rel="noreferrer"
              className="flex-1 min-w-fit text-center rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm font-medium">
              💨 Open Wind Models in Windy
            </a>
          </div>
          <p className="text-xs text-slate-500">Opens Windy.com — sign in for 14-day premium forecast and model comparison</p>

          <div className="rounded-lg border border-[#C4603A]/30 bg-[#FFF7F3] p-3 text-sm text-slate-700">
            Windy Premium mode: this embedded map can show tide-related overlays when available. For full tide tools tied to your Windy login, use the buttons below to open Windy directly.
          </div>
          <div className="rounded-lg border border-[#0A4A52]/20 bg-teal-50 p-3 text-sm text-slate-700">
            Use Windy Premium session: open these links in a new tab while logged into Windy with Google for full Premium data.
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={windyOverlayUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded bg-[#0A4A52] text-white text-sm"
            >
              Open Selected Layer in Windy
            </a>
            <a
              href={windyWindUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded bg-[#0A4A52] text-white text-sm"
            >
              Open Wind Map
            </a>
            <a
              href={windyWavesUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded bg-[#0A4A52] text-white text-sm"
            >
              Open Waves & Tides Map
            </a>
            <a
              href={windyTidesUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded bg-[#C4603A] text-white text-sm"
            >
              Open Windy Tide View
            </a>
            <a
              href={windyCurrentsUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded bg-[#0A4A52] text-white text-sm"
            >
              Open Windy Currents View
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            {OVERLAYS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOverlay(o.value)}
                className={`px-3 py-2 rounded ${overlay === o.value ? 'bg-[#C4603A] text-white' : 'bg-slate-100 text-slate-700'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {LOCATIONS.map((loc) => (
              <button
                key={loc.name}
                type="button"
                onClick={() => { setLocation(loc); setGpsCoords(null); fetchConditionsAndForecast(loc.lat, loc.lon) }}
                className={`px-3 py-2 rounded ${location.name === loc.name ? 'bg-[#C4603A] text-white' : 'bg-teal-50 text-[#0A4A52]'}`}
              >
                {loc.name}
              </button>
            ))}
          </div>
          <iframe
            src={windySrc}
            style={{ width: '100%', height: '600px', border: 'none' }}
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups"
            title="Windy Weather Map"
          />
          <p className="text-xs text-slate-500">
            Weather data powered by Windy.com. Wind uses the Wind map overlay, and Waves & Tides uses the Waves/Tides overlay (Basic map mode is not used).
          </p>
        </div>
      )}

      {subTab === 'bom' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {BOM_FORECASTS.map((item) => (
            <div key={item.name} className="bg-white rounded-lg shadow border-l-4 border-l-[#0A4A52] p-3">
              <div className="text-[#0A4A52] font-semibold">{item.icon} {item.name}</div>
              <button
                type="button"
                onClick={() => fetchForecastFor(item.name, item.lat, item.lon)}
                className="text-[#C4603A] text-sm mt-1 underline"
              >
                Refresh in-app forecast
              </button>
              <ForecastCard forecast={forecasts[item.name]} />
              <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 mt-2 inline-block underline">
                Open official BOM text forecast
              </a>
            </div>
          ))}
        </div>
      )}

      {subTab === 'grib' && (
        <div className="grid md:grid-cols-2 gap-3">
          {WEATHER_RESOURCES.map((resource) => (
            <a
              key={resource.name}
              href={resource.url}
              target="_blank"
              rel="noreferrer"
              className="bg-white rounded-lg shadow border-t-4 border-t-[#0A4A52] p-4"
            >
              <div className="font-semibold text-[#0A4A52]">{resource.name}</div>
              <div className="text-sm text-slate-600 mt-1">{resource.description}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
