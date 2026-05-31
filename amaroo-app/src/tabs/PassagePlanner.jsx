import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Download, Save, Trash2, Upload, X } from 'lucide-react'
import PassagePlannerMap from '../components/common/PassagePlannerMap'
import { totalRouteNm } from '../utils/calculations'
import {
  deleteSavedRoute,
  getFuelLog,
  getSavedRoutes,
  getVesselSettings,
  saveRoute,
} from '../db/api'
import { extractHourlyWeather, fetchRouteWeather, routeMidpoint } from '../utils/weatherApi'
import { fetchOceanCurrentWithMeta, interpolateCurrent } from '../utils/oceanCurrent'
import PassageWeatherTimeline from '../components/PassageWeatherTimeline'
import { rpmToFuelBurnLhr, stwToRpm } from '../utils/vesselConstants'
import { foulingPenalty } from '../utils/hullFouling'

const STORAGE_KEY = 'amaroo_passage_plan_v2'
const PENDING_VOYAGE_KEY = 'amaroo_pending_voyage_transfer'

function uid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createWaypoint(lat, lng, name, index) {
  return {
    id: uid(),
    name: name ?? `WP ${index + 1}`,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
  }
}

function parseGpx(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) return []
  const rtepts = Array.from(doc.querySelectorAll('rtept'))
  const wpts = Array.from(doc.querySelectorAll('wpt'))
  const points = rtepts.length > 0 ? rtepts : wpts
  return points
    .map((pt, i) => ({
      id: uid(),
      name: pt.querySelector('name')?.textContent?.trim() || `WP ${i + 1}`,
      lat: parseFloat(pt.getAttribute('lat')),
      lng: parseFloat(pt.getAttribute('lon')),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
}

function buildGpx(waypoints, routeName) {
  const name = escapeXml(routeName || 'Amaroo Route')
  const now = new Date().toISOString()
  const rtepts = waypoints
    .map(
      (wp) =>
        `    <rtept lat="${wp.lat.toFixed(6)}" lon="${wp.lng.toFixed(6)}">\n      <name>${escapeXml(wp.name || 'WP')}</name>\n    </rtept>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Amaroo Vessel Manager" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <time>${now}</time>
  </metadata>
  <rte>
    <name>${name}</name>
${rtepts}
  </rte>
</gpx>`
}

function calculateLifetimeLpnm(fuelLog, cruiseSpeed = 12) {
  if (!fuelLog?.length || fuelLog.length < 2 || cruiseSpeed <= 0) return null
  const sorted = [...fuelLog]
    .filter((e) => e.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
  let totalLitres = 0
  let totalHours = 0
  for (let i = 1; i < sorted.length; i++) {
    const litres = Number(sorted[i].litres || 0)
    const delta = Number(sorted[i].engine_hours_at_fill) - Number(sorted[i - 1].engine_hours_at_fill)
    if (litres > 0 && Number.isFinite(delta) && delta > 0) {
      totalLitres += litres
      totalHours += delta
    }
  }
  if (totalHours <= 0) return null
  return Math.round((totalLitres / totalHours / cruiseSpeed) * 100) / 100
}

function ModeBtn({ id, label, Icon, activeMode, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        activeMode === id
          ? 'bg-[#0A4A52] text-white'
          : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {Icon && <Icon size={15} />}
      {label}
    </button>
  )
}

function Toast({ toast }) {
  if (!toast) return null
  return (
    <div
      className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium pointer-events-none ${
        toast.type === 'error' ? 'bg-red-600' : 'bg-[#0A4A52]'
      }`}
    >
      {toast.message}
    </div>
  )
}

export default function PassagePlanner({ goTab, onCheckTides, hullFouling }) {
    console.log('[PassagePlanner] ENTER component');
  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState('build')
  const [waypoints, setWaypoints] = useState([])
  const [fitTrigger, setFitTrigger] = useState(0)

  // Saved routes
  const [savedRoutes, setSavedRoutes] = useState([])
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [routeNameInput, setRouteNameInput] = useState('')

  // Trip parameters
  const [speed, setSpeed] = useState(12)
  const [departureDateTime, setDepartureDateTime] = useState(() => {
    const d = new Date()
    d.setHours(9, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [burnRateLph, setBurnRateLph] = useState('')
  const [efficiencyLpnm, setEfficiencyLpnm] = useState('')
  const [fuelPriceOverride, setFuelPriceOverride] = useState('')
  const [departurePort, setDeparturePort] = useState('Aquatic Paradise')
  const [destination, setDestination] = useState('')

  // Supabase data
  const [fuelLog, setFuelLog] = useState([])
  const [vesselSettings, setVesselSettings] = useState(null)

  // Timeline
  const [showTimeline, setShowTimeline] = useState(false)

  // Toast
  const [toast, setToast] = useState(null)

  // Weather (preserved from original)
  const [weather, setWeather] = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState(null)
  const [weatherCurrentNotice, setWeatherCurrentNotice] = useState(null)
  const [weatherMidpoint, setWeatherMidpoint] = useState({ lat: -27.5, lng: 153.4 })
  const lastWeatherContextKeyRef = useRef(null)

  const fileInputRef = useRef(null)
  const toastTimer = useRef(null)

  // Derived from departureDateTime for weather fetch
  const departureDate = departureDateTime.split('T')[0]
  const departureHour = parseInt(departureDateTime.split('T')[1]?.split(':')[0] || '9', 10)
  const weatherContextKey = useMemo(
    () => JSON.stringify({
      departureDate,
      departureHour,
      waypoints: waypoints.map((wp) => [wp.lat, wp.lng, wp.name]),
    }),
    [departureDate, departureHour, waypoints],
  )

  function showToast(message, type = 'success') {
    clearTimeout(toastTimer.current)
    setToast({ message, type })
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  // Check Cache API for shared GPX from Web Share Target
  useEffect(() => {
    async function checkSharedGpx() {
      if (!('caches' in window)) return
      try {
        const cache = await caches.open('shared-gpx')
        const response = await cache.match('pending')
        if (!response) return
        await cache.delete('pending')
        const text = await response.text()
        const imported = parseGpx(text)
        if (imported.length > 0) {
          setWaypoints(imported)
          setFitTrigger((t) => t + 1)
          setMode('build')
          showToast(`Route imported from Navionics — ${imported.length} waypoints loaded`)
        }
      } catch (err) {
        console.error('[PassagePlanner] Share target read error:', err)
      }
    }
    checkSharedGpx()
  }, [])

  // Load persisted plan
  useEffect(() => {
    setMounted(true)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      if (Array.isArray(s.waypoints) && s.waypoints.length > 0) setWaypoints(s.waypoints)
      if (s.speed) setSpeed(s.speed)
      if (s.departureDateTime) setDepartureDateTime(s.departureDateTime)
      if (s.burnRateLph) setBurnRateLph(s.burnRateLph)
      if (s.efficiencyLpnm) setEfficiencyLpnm(s.efficiencyLpnm)
      if (s.fuelPriceOverride) setFuelPriceOverride(s.fuelPriceOverride)
      if (s.departurePort) setDeparturePort(s.departurePort)
      if (s.destination) setDestination(s.destination)
      if (s.weather) setWeather(s.weather)
      if (s.weatherMidpoint) setWeatherMidpoint(s.weatherMidpoint)
    } catch { /* ignore malformed localStorage */ }
  }, [])

  // Persist plan on changes
  useEffect(() => {
    if (!mounted) return
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        waypoints,
        speed,
        departureDateTime,
        burnRateLph,
        efficiencyLpnm,
        fuelPriceOverride,
        departurePort,
        destination,
        weather,
        weatherMidpoint,
      }),
    )
  }, [mounted, waypoints, speed, departureDateTime, burnRateLph, efficiencyLpnm, fuelPriceOverride, departurePort, destination, weather, weatherMidpoint])

  useEffect(() => {
    if (!mounted) return
    if (lastWeatherContextKeyRef.current == null) {
      lastWeatherContextKeyRef.current = weatherContextKey
      return
    }
    if (lastWeatherContextKeyRef.current !== weatherContextKey) {
      setWeather(null)
      setWeatherError(null)
    }
    lastWeatherContextKeyRef.current = weatherContextKey
  }, [mounted, weatherContextKey])

  // Load Supabase data
  useEffect(() => {
    getFuelLog().then((r) => setFuelLog(r || []))
    getVesselSettings().then((r) => setVesselSettings(r?.data || r || null))
  }, [])

  // Load saved routes when entering that mode
  const loadSavedRoutes = useCallback(async () => {
    setSavedRoutesLoading(true)
    try {
      const rows = await getSavedRoutes()
      setSavedRoutes(rows || [])
    } catch (err) {
      showToast(`Failed to load saved routes: ${err.message}`, 'error')
    } finally {
      setSavedRoutesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode === 'saved') loadSavedRoutes()
  }, [mode, loadSavedRoutes])

  // Calculations (memoised, real-time)
  const distNm = useMemo(() => {
    console.log('[PassagePlanner] ENTER totalRouteNm useMemo', { waypointsLen: waypoints.length });
    return totalRouteNm(waypoints);
  }, [waypoints]);

  console.log('[PassagePlanner] before calculations useMemo', { waypointsLen: waypoints.length, speed, fuelLogLen: fuelLog.length, vesselSettings });
  console.log('[PassagePlanner] ENTER calculations useMemo', { distNm, speed, fuelLogLen: fuelLog.length, vesselSettings });
  const calculations = useMemo(() => {
    if (!distNm) return null;
    const spd = parseFloat(speed) || 12;
    const durationHrs = distNm / spd;
    const durationH = Math.floor(durationHrs);
    const durationM = Math.round((durationHrs - durationH) * 60);

    const manualLph = parseFloat(burnRateLph);
    const manualLpnm = parseFloat(efficiencyLpnm);

    // RPM curve fuel calculation (Speed tab method)
    let curveAdj = {};
    try { curveAdj = JSON.parse(localStorage.getItem('amaroo_rpm_curve_adj') || '{}') } catch { /* ignore */ }
    const monthsSinceHaulout = hullFouling?.monthsSinceHaulout ?? 0;
    const fp = foulingPenalty(monthsSinceHaulout);
    const estimatedRpm = stwToRpm(spd, curveAdj);
    const curveLph = rpmToFuelBurnLhr(estimatedRpm) * fp.fuelMultiplier;
    const curveLpnm = curveLph / spd;

    let fuelLpnm, fuelMethod;
    if (manualLpnm > 0) {
      fuelLpnm = manualLpnm;
      fuelMethod = `${manualLpnm} L/nm (manual)`;
    } else if (manualLph > 0) {
      fuelLpnm = manualLph / spd;
      fuelMethod = `${manualLph} L/hr ÷ ${spd} kn`;
    } else {
      fuelLpnm = curveLpnm;
      const rpmLabel = Math.round(estimatedRpm);
      const lphLabel = Math.round(curveLph);
      fuelMethod = fp.fuelIncreasePct > 0
        ? `${lphLabel} L/hr @ ${rpmLabel} RPM +${fp.fuelIncreasePct}% fouling`
        : `${lphLabel} L/hr @ ${rpmLabel} RPM`;
    }

    const fuelRequired = Math.round(fuelLpnm * distNm * 10) / 10;
    const TOTAL_CAPACITY = 2950;
    const RESERVE = Math.round(TOTAL_CAPACITY * 0.1);
    const fuelRemaining = Math.round(TOTAL_CAPACITY - fuelRequired);
    const fuelRemainingPct = Math.max(0, Math.round((fuelRemaining / TOTAL_CAPACITY) * 100));

    const prices = (fuelLog || []).filter((e) => Number(e.cost_per_litre) > 0).map((e) => Number(e.cost_per_litre));
    const recentPrice = prices.at(-1) || null;
    const price = parseFloat(fuelPriceOverride) > 0 ? parseFloat(fuelPriceOverride) : recentPrice;
    const estCost = price ? Math.round(fuelRequired * price * 100) / 100 : null;
    const priceSource = parseFloat(fuelPriceOverride) > 0 ? 'manual' : recentPrice ? 'recent fill' : null;

    let eta = null;
    if (departureDateTime) {
      const dep = new Date(departureDateTime);
      if (!isNaN(dep.getTime())) {
        eta = new Date(dep.getTime() + durationHrs * 3600 * 1000);
      }
    }

    return {
      distNm, durationH, durationM, durationHrs,
      fuelRequired, fuelMethod,
      fuelRemaining, fuelRemainingPct, TOTAL_CAPACITY,
      belowReserve: fuelRemaining < RESERVE, RESERVE,
      eta, estCost, priceSource,
    };
  }, [distNm, speed, fuelLog, burnRateLph, efficiencyLpnm, fuelPriceOverride, departureDateTime, hullFouling]);

  // --- Handlers ---

  const handleMapClick = useCallback((latlng) => {
    if (mode !== 'build') return
    setWaypoints((prev) => [...prev, createWaypoint(latlng.lat, latlng.lng, null, prev.length)])
  }, [mode])

  const handleWaypointDrag = useCallback((index, latlng) => {
    setWaypoints((prev) =>
      prev.map((wp, i) =>
        i === index
          ? { ...wp, lat: Math.round(latlng.lat * 1e6) / 1e6, lng: Math.round(latlng.lng * 1e6) / 1e6 }
          : wp,
      ),
    )
  }, [])

  const handleRenameWaypoint = useCallback((index, name) => {
    setWaypoints((prev) => prev.map((wp, i) => (i === index ? { ...wp, name } : wp)))
  }, [])

  const handleDeleteWaypoint = useCallback((index) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleClearAll = useCallback(() => {
    setWaypoints([])
    setWeather(null)
    setWeatherError(null)
  }, [])

  const handleGpxFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const imported = parseGpx(text)
      if (imported.length === 0) {
        showToast('No waypoints found in GPX file', 'error')
        return
      }
      setWaypoints(imported)
      setFitTrigger((t) => t + 1)
      setMode('build')
      showToast(`${imported.length} waypoints imported from ${file.name}`)
    } catch (err) {
      showToast(`GPX import failed: ${err.message}`, 'error')
    }
    e.target.value = ''
  }, [])

  const handleExportGpx = useCallback(() => {
    if (waypoints.length === 0) return
    const name = destination || departurePort || 'Amaroo Route'
    const gpx = buildGpx(waypoints, name)
    const blob = new Blob([gpx], { type: 'application/gpx+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `amaroo-route-${Date.now()}.gpx`
    a.click()
    URL.revokeObjectURL(url)
  }, [waypoints, destination, departurePort])

  const handleLoadSavedRoute = useCallback((route) => {
    const wps = (route.waypoints || []).map((wp, i) => ({
      id: uid(),
      name: wp.name || `WP ${i + 1}`,
      lat: Number(wp.lat),
      lng: Number(wp.lng),
    }))
    setWaypoints(wps)
    setFitTrigger((t) => t + 1)
    setMode('build')
    showToast(`"${route.name}" loaded — ${wps.length} waypoints`)
  }, [])

  const handleSaveRoute = useCallback(async () => {
    const name = routeNameInput.trim()
    if (!name || waypoints.length === 0) return
    try {
      const wpsToStore = waypoints.map(({ name: n, lat, lng }) => ({ name: n, lat, lng }))
      await saveRoute(name, wpsToStore, distNm, '')
      setSaveDialogOpen(false)
      setRouteNameInput('')
      showToast(`Route "${name}" saved`)
      if (mode === 'saved') loadSavedRoutes()
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error')
    }
  }, [routeNameInput, waypoints, distNm, mode, loadSavedRoutes])

  const handleDeleteSavedRoute = useCallback(async (id, name) => {
    if (!window.confirm(`Delete route "${name}"?`)) return
    try {
      await deleteSavedRoute(id)
      setSavedRoutes((r) => r.filter((x) => x.id !== id))
      showToast(`Route "${name}" deleted`)
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error')
    }
  }, [])

  const handleFetchWeather = useCallback(async () => {
    if (waypoints.length < 2) return
    setWeatherLoading(true)
    setWeatherError(null)
    setWeatherCurrentNotice(null)
    try {
      const mid = routeMidpoint(waypoints)
      setWeatherMidpoint(mid)
      const { marineData, windData, error } = await fetchRouteWeather(mid.lat, mid.lng, departureDate)
      if (error) throw new Error(error)
      const extracted = extractHourlyWeather(marineData, windData, Number(departureHour))
      const departureStamp = new Date(`${departureDate}T${String(departureHour).padStart(2, '0')}:00`).getTime() || Date.now()
      const currentResult = await fetchOceanCurrentWithMeta(mid.lat, mid.lng, 6, departureStamp)
      const currentSeries = Array.isArray(currentResult?.data) ? currentResult.data : null
      const currentPoint = interpolateCurrent(currentSeries, departureStamp)

      if (currentResult?.cached) {
        setWeatherCurrentNotice('⚠️ Ocean current is using cached Stormglass data (live request failed).')
      } else if (currentResult?.error) {
        const quotaText = currentResult?.code === 'quota_exceeded'
          ? 'Stormglass quota exceeded.'
          : 'Ocean current unavailable.'
        setWeatherCurrentNotice(`${quotaText} ${currentResult.error}`)
      }

      setWeather({
        ...extracted,
        currentSpeedKn: currentPoint?.currentSpeedKn ?? 0,
        currentDirDeg: currentPoint?.currentDirectionDeg ?? 0,
        currentAvailable: Array.isArray(currentSeries) && currentSeries.length > 0,
        currentSource: currentResult?.source || (Array.isArray(currentSeries) ? 'stormglass' : 'unavailable'),
        currentCode: currentResult?.code || null,
      })
    } catch (err) {
      setWeatherError(err.message)
    } finally {
      setWeatherLoading(false)
    }
  }, [waypoints, departureDate, departureHour])

  const handleSendToVoyageLog = useCallback(() => {
    if (!weather) return
    const durationMinutes = calculations ? calculations.durationH * 60 + calculations.durationM : null
    const departureConditions = {
      wind_speed: weather.windKn,
      wind_direction: weather.windDirCompass,
      wind_direction_degrees: weather.windDirDeg,
      wave_height: weather.waveHeightM,
      swell_height: weather.swellHeightM,
      swell_direction: weather.swellDirCompass,
      swell_period: weather.swellPeriodS,
      comfort:
        weather.windKn >= 30 || weather.waveHeightM >= 2
          ? 'No-Go'
          : weather.windKn >= 20 || weather.waveHeightM >= 1.5
            ? 'Marginal'
            : 'Good',
      temperature: weather.temperatureC,
    }
    localStorage.setItem(
      PENDING_VOYAGE_KEY,
      JSON.stringify({
        weather,
        departureConditions,
        capturedAt: new Date().toISOString(),
        departureDate,
        departureHour,
        midpoint: weatherMidpoint,
        trip: {
          waypoints,
          departurePort,
          destination,
          distanceNm: calculations?.distNm ?? distNm ?? null,
          speedKnots: parseFloat(speed) || 12,
          durationMinutes,
          fuelUsedLitres: calculations?.fuelRequired ?? null,
          estCost: calculations?.estCost ?? null,
          conditions:
            weather.windKn >= 30 || weather.waveHeightM >= 2
              ? 'No-Go'
              : weather.windKn >= 20 || weather.waveHeightM >= 1.5
                ? 'Marginal'
                : 'Comfortable',
        },
        createdAt: new Date().toISOString(),
      }),
    )
    if (goTab) goTab('voyagelog')
  }, [weather, calculations, waypoints, departurePort, destination, departureDate, departureHour, weatherMidpoint, speed, distNm, goTab])

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />

      {/* Mode selector row */}
      <div className="flex flex-wrap items-center gap-2">
        <ModeBtn id="build" label="Build Route" activeMode={mode} onSelect={setMode} />
        <ModeBtn id="import" label="Import GPX" Icon={Upload} activeMode={mode} onSelect={setMode} />
        <ModeBtn id="saved" label="Saved Routes" Icon={BookOpen} activeMode={mode} onSelect={setMode} />
        <div className="flex-1" />
        {waypoints.length > 0 && (
          <button
            type="button"
            onClick={() => { setRouteNameInput(destination || ''); setSaveDialogOpen(true) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-[#0A4A52] text-[#0A4A52] hover:bg-teal-50"
          >
            <Save size={15} /> Save Route
          </button>
        )}
        <button
          type="button"
          onClick={handleExportGpx}
          disabled={waypoints.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[#C4603A] text-white hover:bg-[#b25532] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={15} /> Export GPX
        </button>
      </div>

      {/* Import GPX panel */}
      {mode === 'import' && (
        <div className="bg-white rounded-xl shadow border-t-4 border-[#0A4A52] p-4">
          <h3 className="font-serif text-lg text-[#0A4A52] mb-1">Import GPX File</h3>
          <p className="text-sm text-slate-500 mb-3">
            Select a .gpx file exported from Navionics, Raymarine Axiom, or any GPX-compatible app.
            Shared files from the Android share sheet are automatically imported here.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx,application/gpx+xml"
            onChange={handleGpxFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-[#0A4A52] text-white rounded-lg text-sm hover:bg-[#083b42]"
          >
            Choose GPX File…
          </button>
        </div>
      )}

      {/* Map + side panel */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Map */}
        <div className="lg:w-2/3">
          <div className="bg-white rounded-xl shadow border-t-4 border-[#0A4A52] p-4">
            {mode === 'build' && (
              <p className="text-sm text-slate-500 mb-2">
                {waypoints.length === 0
                  ? 'Click or tap the map to add waypoints. OpenSeaMap overlays are active.'
                  : `${waypoints.length} waypoint${waypoints.length !== 1 ? 's' : ''} · drag markers to reposition`}
              </p>
            )}
            <div className="rounded overflow-hidden border border-slate-200">
              {mounted ? (
                <PassagePlannerMap
                  waypoints={waypoints}
                  onMapClick={mode === 'build' ? handleMapClick : undefined}
                  onWaypointDrag={mode === 'build' ? handleWaypointDrag : undefined}
                  fitTrigger={fitTrigger}
                />
              ) : (
                <div className="h-[400px] grid place-items-center text-slate-500 bg-slate-50">
                  Loading map…
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="lg:w-1/3 flex flex-col gap-4">
          {/* Waypoint list (build or import mode) */}
          {mode !== 'saved' && (
            <div className="bg-white rounded-xl shadow border-t-4 border-[#0A4A52] p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-serif text-lg text-[#0A4A52]">Waypoints</h3>
                {waypoints.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50"
                  >
                    Clear All
                  </button>
                )}
              </div>
              {waypoints.length === 0 ? (
                <p className="text-sm text-slate-400">
                  {mode === 'build'
                    ? 'Click the map to add waypoints.'
                    : 'Switch to Import GPX mode to load a file.'}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {waypoints.map((wp, idx) => (
                    <div
                      key={wp.id}
                      className="flex items-center gap-2 py-1 border-b border-slate-100 last:border-0"
                    >
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${
                          idx === 0
                            ? 'bg-green-600'
                            : idx === waypoints.length - 1
                              ? 'bg-[#C4603A]'
                              : 'bg-[#0A4A52]'
                        }`}
                      >
                        {idx === 0 ? 'S' : idx === waypoints.length - 1 ? 'E' : idx}
                      </span>
                      <input
                        type="text"
                        value={wp.name}
                        onChange={(e) => handleRenameWaypoint(idx, e.target.value)}
                        className="flex-1 min-w-0 border-b border-slate-200 bg-transparent text-sm focus:outline-none focus:border-[#0A4A52] py-0.5"
                      />
                      <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                        {wp.lat.toFixed(3)}, {wp.lng.toFixed(3)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteWaypoint(idx)}
                        className="text-slate-400 hover:text-red-500 flex-shrink-0"
                        aria-label={`Delete ${wp.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {distNm && (
                <div className="mt-2 pt-2 border-t border-slate-100 text-sm font-medium text-[#0A4A52]">
                  Total: {distNm} nm
                </div>
              )}
            </div>
          )}

          {/* Saved routes panel */}
          {mode === 'saved' && (
            <div className="bg-white rounded-xl shadow border-t-4 border-[#0A4A52] p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-serif text-lg text-[#0A4A52]">Saved Routes</h3>
                <button
                  type="button"
                  onClick={loadSavedRoutes}
                  className="text-xs text-slate-500 hover:text-[#0A4A52]"
                >
                  Refresh
                </button>
              </div>
              {savedRoutesLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : savedRoutes.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No saved routes yet. Build a route, then tap{' '}
                  <span className="font-medium text-[#0A4A52]">Save Route</span>.
                </p>
              ) : (
                <div className="space-y-2">
                  {savedRoutes.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:border-teal-300 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-slate-800 truncate">{r.name}</div>
                        <div className="text-xs text-slate-500">
                          {r.total_nm ? `${r.total_nm} nm · ` : ''}
                          {Array.isArray(r.waypoints) ? r.waypoints.length : '?'} waypoints
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadSavedRoute(r)}
                        className="px-2 py-1 text-xs bg-[#0A4A52] text-white rounded hover:bg-[#083b42]"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedRoute(r.id, r.name)}
                        className="text-slate-400 hover:text-red-500 flex-shrink-0"
                        aria-label={`Delete ${r.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Trip details */}
          <div className="bg-white rounded-xl shadow border-t-4 border-[#C4603A] p-4">
            <h3 className="font-serif text-lg text-[#0A4A52] mb-3">Trip Details</h3>
            <label className="text-sm block mb-2">
              Departure Port
              <input
                type="text"
                value={departurePort}
                onChange={(e) => setDeparturePort(e.target.value)}
                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
              />
            </label>
            <label className="text-sm block mb-2">
              Destination
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
              />
            </label>
            <details className="mt-1">
              <summary className="text-xs text-slate-500 cursor-pointer select-none hover:text-[#0A4A52] py-1">
                Advanced fuel parameters
              </summary>
              <div className="mt-2 space-y-2 pl-1">
                <label className="text-xs block">
                  Burn Rate override (L/hr)
                  <input
                    type="number"
                    value={burnRateLph}
                    onChange={(e) => setBurnRateLph(e.target.value)}
                    placeholder="Leave blank for auto"
                    className="w-full mt-0.5 rounded border border-slate-300 p-1.5 text-sm"
                  />
                </label>
                <label className="text-xs block">
                  Efficiency override (L/nm)
                  <input
                    type="number"
                    value={efficiencyLpnm}
                    onChange={(e) => setEfficiencyLpnm(e.target.value)}
                    placeholder="Leave blank for auto"
                    className="w-full mt-0.5 rounded border border-slate-300 p-1.5 text-sm"
                  />
                </label>
                <label className="text-xs block">
                  Fuel Price override ($/L)
                  <input
                    type="number"
                    value={fuelPriceOverride}
                    onChange={(e) => setFuelPriceOverride(e.target.value)}
                    placeholder="Optional"
                    className="w-full mt-0.5 rounded border border-slate-300 p-1.5 text-sm"
                  />
                </label>
              </div>
            </details>
          </div>

          {/* Weather */}
          <div className="bg-white rounded-xl shadow border-t-4 border-[#0A4A52] p-4">
            <h3 className="font-serif text-lg text-[#0A4A52] mb-2">Route Weather</h3>
            <button
              type="button"
              onClick={handleFetchWeather}
              disabled={waypoints.length < 2 || weatherLoading}
              className="w-full px-4 py-2 rounded-lg bg-[#C4603A] text-white text-sm hover:bg-[#b25532] disabled:opacity-50"
            >
              {weatherLoading ? 'Fetching…' : 'Fetch Route Weather'}
            </button>
            {weatherError && <p className="text-xs text-red-600 mt-2">{weatherError}</p>}
            {weatherCurrentNotice && <p className="text-xs text-amber-700 mt-2">{weatherCurrentNotice}</p>}
            {weather && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-400">
                  {departureDate} {departureHour}:00 · midpoint ({weatherMidpoint.lat.toFixed(2)}°,{' '}
                  {weatherMidpoint.lng.toFixed(2)}°)
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    { label: 'Wind', value: `${weather.windKn} kn`, sub: `${weather.windDirCompass} · gusts ${weather.windGustKn} kn` },
                    {
                      label: 'Waves',
                      value: `${weather.waveHeightM} m · ${weather.wavePeriodS}s`,
                      sub: `${weather.waveDirCompass} (${weather.waveDirDeg}°)`,
                    },
                    {
                      label: 'Swell',
                      value: `${weather.swellHeightM} m · ${weather.swellPeriodS}s`,
                      sub: `${weather.swellDirCompass} (${weather.swellDirDeg}°)`,
                    },
                    {
                      label: 'Ocean Current',
                      value: `${Number(weather.currentSpeedKn || 0).toFixed(2)} kn`,
                      sub: (weather.currentSource === 'stormglass' || weather.currentAvailable || weather.currentDirDeg != null)
                        ? `Flow towards ${Number(weather.currentDirDeg || 0).toFixed(1)}°T${String(weather.currentSource || '').includes('cache') ? ' (cached)' : ''}`
                        : 'Unavailable from provider (using 0 current)',
                    },
                    ...(weather.temperatureC != null ? [{ label: '🌡️ Temp', value: `${weather.temperatureC}°C`, sub: 'Air temperature' }] : []),
                    {
                      label: 'Comfort',
                      value: weather.windKn >= 30 || weather.waveHeightM >= 2
                        ? 'No-Go'
                        : weather.windKn >= 20 || weather.waveHeightM >= 1.5
                          ? 'Marginal'
                          : 'Comfortable',
                      color: weather.windKn >= 30 || weather.waveHeightM >= 2
                        ? 'text-red-600'
                        : weather.windKn >= 20 || weather.waveHeightM >= 1.5
                          ? 'text-amber-600'
                          : 'text-green-600',
                    },
                  ].map((item) => (
                    <div key={item.label} className="bg-slate-50 rounded p-2">
                      <div className="text-xs text-slate-500 mb-0.5">{item.label}</div>
                      <div className={`font-bold text-[#0A4A52] ${item.color || ''}`}>{item.value}</div>
                      {item.sub && <div className="text-xs text-slate-500">{item.sub}</div>}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  Source: Open-Meteo Marine API (wind/wave/swell) + Stormglass.io (ocean current)
                </p>
                <button
                  type="button"
                  onClick={handleSendToVoyageLog}
                  className="w-full py-2 bg-[#0A4A52] text-white rounded text-sm font-medium hover:bg-[#083b42]"
                >
                  Send Trip &amp; Weather to Voyage Log →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Calculations panel — only when 2+ waypoints */}
      {calculations && (
        <div className="bg-white rounded-xl shadow border-t-4 border-[#0A4A52] p-4">
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Passage Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {/* Distance */}
            <div className="bg-teal-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Distance</div>
              <div className="text-2xl font-bold text-[#0A4A52]">{calculations.distNm}</div>
              <div className="text-xs text-slate-500">nm · {waypoints.length} waypoints</div>
            </div>

            {/* Fuel Required */}
            <div className="bg-teal-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Fuel Required</div>
              <div className="text-2xl font-bold text-[#0A4A52]">
                {calculations.fuelRequired.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500">L · {calculations.fuelMethod}</div>
              {calculations.estCost && (
                <div className="text-xs text-[#C4603A] mt-0.5">
                  ${calculations.estCost.toFixed(0)} ({calculations.priceSource})
                </div>
              )}
            </div>

            {/* Fuel Remaining */}
            <div
              className={`rounded-lg p-3 ${
                calculations.belowReserve ? 'bg-red-50 border border-red-200' : 'bg-teal-50'
              }`}
            >
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                Remaining (full tank)
              </div>
              <div
                className={`text-2xl font-bold ${
                  calculations.belowReserve ? 'text-red-600' : 'text-[#0A4A52]'
                }`}
              >
                {calculations.fuelRemaining.toLocaleString()}
              </div>
              <div className="text-xs text-slate-500">
                L ({calculations.fuelRemainingPct}% of {calculations.TOTAL_CAPACITY.toLocaleString()}L)
              </div>
              {calculations.belowReserve && (
                <div className="text-xs text-red-600 mt-0.5 font-medium">⚠ Below 10% reserve</div>
              )}
            </div>

            {/* Duration */}
            <div className="bg-teal-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Est. Duration</div>
              <div className="text-2xl font-bold text-[#0A4A52]">
                {calculations.durationH}h {String(calculations.durationM).padStart(2, '0')}m
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <span className="text-xs text-slate-500">Speed</span>
                <input
                  type="number"
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  min="1"
                  max="30"
                  className="w-14 text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                />
                <span className="text-xs text-slate-500">kn</span>
              </div>
            </div>

            {/* ETA */}
            <div className="bg-teal-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">ETA</div>
              {calculations.eta ? (
                <>
                  <div className="text-lg font-bold text-[#0A4A52] leading-tight">
                    {calculations.eta.toLocaleString('en-AU', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                  <div className="text-2xl font-bold text-[#0A4A52]">
                    {calculations.eta.toLocaleTimeString('en-AU', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-400 mb-1">Set departure →</div>
              )}
              <input
                type="datetime-local"
                value={departureDateTime}
                onChange={(e) => setDepartureDateTime(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white mt-1 focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
              />
            </div>
          </div>

          {/* Action buttons row */}
          <div className="mt-3 flex flex-wrap gap-2">
            {onCheckTides && waypoints.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  const midIdx = Math.floor(waypoints.length / 2)
                  const mid = waypoints[midIdx]
                  onCheckTides({ midLat: mid?.lat, midLng: mid?.lng })
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0A4A52] text-white text-sm font-semibold hover:bg-teal-700 transition"
              >
                🌊 Check Tides at Route
              </button>
            )}
            <button
              type="button"
              title={waypoints.length < 2 || !departureDateTime ? 'Add waypoints and set departure time to enable' : undefined}
              disabled={waypoints.length < 2 || !departureDateTime}
              onClick={() => setShowTimeline((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#0A4A52] text-[#0A4A52] text-sm font-semibold hover:bg-teal-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {showTimeline ? 'Hide Timeline ↑' : '🌦 Weather Timeline'}
            </button>
          </div>
        </div>
      )}

      {/* Passage Weather Timeline */}
      {showTimeline && calculations && (
        (() => { console.log('[PassagePlanner] Rendering PassageWeatherTimeline', { waypointsLen: waypoints.length, departureDateTime, totalDistanceNm: calculations.distNm, speed }); return null })() ||
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowTimeline(false)}
            className="absolute top-6 right-6 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-sm"
            aria-label="Close timeline"
          >
            ×
          </button>
          <PassageWeatherTimeline
            waypoints={waypoints}
            departureTime={departureDateTime}
            totalDistanceNm={calculations.distNm}
            vesselSpeedKnots={parseFloat(speed) || 12}
            departurePort={departurePort}
            destination={destination}
            onDepartureTimeChange={setDepartureDateTime}
            monthsSinceHaulout={Number(hullFouling?.monthsSinceHaulout || 0)}
          />
        </div>
      )}

      {/* Save route dialog */}
      {saveDialogOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 shadow-xl w-full max-w-sm">
            <h3 className="font-serif text-xl text-[#0A4A52] mb-1">Save Route</h3>
            <p className="text-sm text-slate-500 mb-3">
              {waypoints.length} waypoints{distNm ? ` · ${distNm} nm` : ''}
            </p>
            <input
              type="text"
              value={routeNameInput}
              onChange={(e) => setRouteNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveRoute()}
              placeholder="e.g. Aquatic Paradise to Coomera"
              className="w-full border border-slate-300 rounded-lg p-2 mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A52]"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveRoute}
                disabled={!routeNameInput.trim()}
                className="flex-1 bg-[#0A4A52] text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setSaveDialogOpen(false); setRouteNameInput('') }}
                className="flex-1 border border-slate-300 rounded-lg py-2 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
