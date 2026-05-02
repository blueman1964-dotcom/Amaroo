import { useMemo, useState } from 'react'
import { extractHourlyWeather, fetchRouteWeather } from '../utils/weatherApi'

const BOM_FORECASTS = [
  { name: 'Moreton Bay', lat: -27.5, lon: 153.4, icon: '⚓', url: 'https://www.bom.gov.au/cgi-bin/marine/forecasts.pl?area=qt&tz=EST&type=IDQ10183' },
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
  { name: 'Moreton Bay', lat: -27.5, lon: 153.4, zoom: 7 },
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
  const url = new URL('https://embed.windy.com/embed2.html')
  url.searchParams.set('lat', String(location.lat))
  url.searchParams.set('lon', String(location.lon))
  url.searchParams.set('zoom', String(location.zoom))
  url.searchParams.set('level', 'surface')
  url.searchParams.set('overlay', mapOverlayForWindy(overlay))
  url.searchParams.set('product', 'ecmwf')
  url.searchParams.set('menu', '')
  url.searchParams.set('message', 'true')
  url.searchParams.set('type', 'map')
  url.searchParams.set('location', 'coordinates')
  url.searchParams.set('detail', 'true')
  url.searchParams.set('detailLat', String(location.lat))
  url.searchParams.set('detailLon', String(location.lon))
  url.searchParams.set('metricWind', 'kt')
  url.searchParams.set('metricTemp', '°C')
  url.searchParams.set('metricRain', 'mm')
  return url.toString()
}

function windyOpenUrl(location, overlay = 'currents') {
  const lat = location.lat.toFixed(3)
  const lon = location.lon.toFixed(3)
  const zoom = location.zoom
  return `https://www.windy.com/${lat}/${lon}?${overlay},${lat},${lon},${zoom}`
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

export default function Weather() {
  const [subTab, setSubTab] = useState('map')
  const [overlay, setOverlay] = useState('wind')
  const [location, setLocation] = useState(LOCATIONS[0])
  const [nearest, setNearest] = useState('')
  const [forecasts, setForecasts] = useState({})
  const [tideStation, setTideStation] = useState(TIDE_STATIONS[0])

  const windySrc = useMemo(() => buildWindySrc(location, overlay), [location, overlay])
  const windyOverlayUrl = useMemo(() => windyOpenUrl(location, mapOverlayForWindy(overlay)), [location, overlay])
  const windyWindUrl = useMemo(() => windyOpenUrl(location, 'wind'), [location])
  const windyWavesUrl = useMemo(() => windyOpenUrl(location, 'waves'), [location])
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
          { id: 'tides', label: 'Tides' },
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
                onClick={() => setLocation(loc)}
                className={`px-3 py-2 rounded ${location.name === loc.name ? 'bg-[#0A4A52] text-white' : 'bg-teal-50 text-[#0A4A52]'}`}
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

      {subTab === 'tides' && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-3">
            ⚓ Tidal information is critical for bar crossings. Always check your port before departure. Wide Bay Bar and Jumpinpin should only be crossed at or near High Water in calm conditions.
          </div>
          <button type="button" onClick={useNearest} className="px-4 py-2 bg-[#0A4A52] text-white rounded-lg">Tides Near Me</button>
          {nearest ? <div className="text-sm text-slate-600">{nearest}</div> : null}

          <div className="grid md:grid-cols-2 gap-2">
            {TIDE_STATIONS.map((station) => (
              <div
                key={station.name}
                className={`bg-white rounded-lg shadow border-l-4 p-3 ${tideStation.name === station.name ? 'border-l-[#C4603A]' : 'border-l-[#0A4A52]'}`}
              >
                <button
                  type="button"
                  onClick={() => setTideStation(station)}
                  className="text-left w-full font-medium text-slate-800"
                >
                  {station.name}
                </button>
                <div className="mt-2">
                  <a
                    href={windyStationUrl(station, 'tides')}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-[#C4603A] underline"
                  >
                    Open in Windy Tide View
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4">
            <div className="font-semibold text-[#0A4A52]">{tideStation.name} - Official Tide Sources</div>
            <div className="text-sm text-slate-600 mt-2">
              Synthetic tide estimates have been removed. Use the official providers below for operational tide windows and bar crossing planning.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={windyStationUrl(tideStation, 'tides')}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 rounded bg-[#C4603A] text-white text-sm"
              >
                Open {tideStation.name} in Windy Tide View
              </a>
              <a
                href={windyStationUrl(tideStation, 'currents')}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 rounded bg-[#0A4A52] text-white text-sm"
              >
                Open {tideStation.name} in Windy Currents
              </a>
              {TIDE_OFFICIAL_LINKS.map((source) => (
                <a
                  key={source.name}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded bg-[#0A4A52] text-white text-sm"
                >
                  {source.name}
                </a>
              ))}
            </div>
            <div className="mt-4 rounded border border-slate-200 overflow-hidden">
              <iframe
                src="https://www.bom.gov.au/australia/tides/"
                title="BOM Tide Predictions"
                style={{ width: '100%', height: '560px', border: 'none' }}
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              />
            </div>
            <div className="text-xs text-slate-500 mt-3">
              If your station is not pre-selected, search for {tideStation.name} in the BOM tide page. Always verify final crossing times with local port notices.
            </div>
          </div>
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
