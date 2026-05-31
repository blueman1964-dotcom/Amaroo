import { useEffect, useMemo, useState, useRef } from 'react'
import { Camera, X } from 'lucide-react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
import { addVoyageLogEntry, db, updateVoyageLogEntry } from '../db/api'
import { fetchCurrentConditions } from '../utils/weatherApi'
import { useGPS } from '../hooks/useGPS'
import PhotoGallery, { PhotoImg } from '../components/PhotoGallery'
import PhotoUploader from '../components/PhotoUploader'
import { uploadPhoto, validatePhoto, deletePhoto, sanitizeFileName } from '../db/storage'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

const HOME_BERTH_COORDS = { lat: -27.524, lng: 153.43 }
const PENDING_VOYAGE_TRANSFER_KEY = 'amaroo_pending_voyage_transfer'
const VOYAGE_DRAFT_STORAGE_KEY = 'amaroo_voyage_log_draft'
const WEATHER_META_PREFIX = '\n__AMAROO_WEATHER__'
const DEPARTURE_CONDITIONS_PREFIX = '\n__AMAROO_DEPARTURE_CONDITIONS__'
const TRIP_NOTE_PREFIX = 'Passage plan:'
const WEATHER_NOTE_PREFIX = 'Weather at departure:'

const DEFAULT_FORM = {
  date: new Date().toISOString().split('T')[0],
  departure_time: '09:00',
  departure_port: 'Aquatic Paradise',
  destination: '',
  trip_log_start_nm: '',
  distance_nm: '',
  crew_count: '',
  conditions: '',
  fuel_used: '',
  engine_hours: '',
  wind_kn: '',
  wind_direction_deg: '',
  wave_height_m: '',
  wave_direction_deg: '',
  swell_height_m: '',
  notes: '',
}

function normalizeGeneratedLines(notes = '') {
  const lines = String(notes)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const plain = []
  let tripLine = ''
  let weatherLine = ''

  for (const line of lines) {
    if (line.startsWith(TRIP_NOTE_PREFIX)) {
      tripLine = line
      continue
    }
    if (line.startsWith(WEATHER_NOTE_PREFIX)) {
      weatherLine = line
      continue
    }
    plain.push(line)
  }

  if (tripLine) plain.push(tripLine)
  if (weatherLine) plain.push(weatherLine)

  return plain.join('\n')
}

function stripWeatherMeta(notes = '') {
  const [clean] = String(notes).split(WEATHER_META_PREFIX)
  const [cleanFinal] = clean.split(DEPARTURE_CONDITIONS_PREFIX)
  return normalizeGeneratedLines(cleanFinal)
}

function appendDepartureConditions(notes, conditions) {
  const [withoutConditions] = notes.split(DEPARTURE_CONDITIONS_PREFIX)
  if (!conditions) return withoutConditions
  return `${withoutConditions}${DEPARTURE_CONDITIONS_PREFIX}${JSON.stringify(conditions)}`
}

function extractDepartureConditions(notes = '') {
  const raw = String(notes)
  const idx = raw.indexOf(DEPARTURE_CONDITIONS_PREFIX)
  if (idx === -1) return null
  try {
    return JSON.parse(raw.slice(idx + DEPARTURE_CONDITIONS_PREFIX.length))
  } catch {
    return null
  }
}

function buildStoredNotes(notes, weatherFields) {
  const cleanNotes = stripWeatherMeta(notes)
  const hasWeather = Object.values(weatherFields).some((value) => value !== '' && value !== null && value !== undefined)
  if (!hasWeather) return cleanNotes
  return `${cleanNotes}${WEATHER_META_PREFIX}${JSON.stringify(weatherFields)}`
}

function extractStoredWeather(notes = '') {
  const raw = String(notes)
  const markerIndex = raw.indexOf(WEATHER_META_PREFIX)
  if (markerIndex === -1) return null
  const payload = raw.slice(markerIndex + WEATHER_META_PREFIX.length)
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function loadDraft() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(VOYAGE_DRAFT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function loadPendingTransfer() {
  if (typeof window === 'undefined') return null
  try {
    const raw =
      window.localStorage.getItem(PENDING_VOYAGE_TRANSFER_KEY) ||
      window.localStorage.getItem('amaroo_pending_weather')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearPendingTransfer() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(PENDING_VOYAGE_TRANSFER_KEY)
  window.localStorage.removeItem('amaroo_pending_weather')
}

function upsertGeneratedLine(notes, prefix, newLine) {
  const lines = stripWeatherMeta(notes)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(prefix))

  if (newLine) {
    lines.push(newLine)
  }

  return lines.join('\n')
}

function compactCard(weather) {
  return (
    <div className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4 mt-3">
      <h4 className="font-semibold text-[#0A4A52] mb-2">Departure Weather Preview</h4>
      <div className="text-sm space-y-1">
        <div>Wind: <strong>{weather.windKn ?? '-'} kn</strong> {weather.windDirCompass} ({weather.windDirDeg ?? '-'}°)</div>
        <div>Waves: <strong>{weather.waveHeightM ?? '-'} m</strong> {weather.waveDirCompass} · {weather.wavePeriodS ?? '-'}s</div>
        <div>Swell: <strong>{weather.swellHeightM ?? '-'} m</strong> {weather.swellDirCompass} · {weather.swellPeriodS ?? '-'}s</div>
      </div>
    </div>
  )
}

function tripLogRange(voyage) {
  const weatherData = extractStoredWeather(voyage.notes) || {}
  const startTripLog = Number(weatherData.trip_log_start_nm)
  const tripLogEnd = Number.isFinite(startTripLog)
    ? Math.round((startTripLog + Number(voyage.distance_nm || 0)) * 10) / 10
    : null
  return { startTripLog, tripLogEnd }
}

function toRad(deg) {
  return (deg * Math.PI) / 180
}

function haversineMeters(a, b) {
  if (!a || !b) return 0
  const R = 6_371_000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function normalizeTrackPoints(points) {
  if (!Array.isArray(points)) return []
  return points
    .map((p) => ({
      lat: Number(p?.lat),
      lng: Number(p?.lng),
      speed: p?.speed == null ? null : Number(p.speed),
      heading: p?.heading == null ? null : Number(p.heading),
      accuracy: p?.accuracy == null ? null : Number(p.accuracy),
      timestamp: p?.timestamp || null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

function summarizeTrack(points) {
  if (!points.length) {
    return { distanceNm: 0, durationHours: 0, maxSpeed: null, avgSpeed: 0 }
  }

  let meters = 0
  for (let i = 1; i < points.length; i += 1) {
    meters += haversineMeters(points[i - 1], points[i])
  }

  const firstTs = points[0].timestamp ? Date.parse(points[0].timestamp) : null
  const lastTs = points[points.length - 1].timestamp ? Date.parse(points[points.length - 1].timestamp) : null
  const durationMs = Number.isFinite(firstTs) && Number.isFinite(lastTs) ? Math.max(0, lastTs - firstTs) : 0
  const durationHours = durationMs / 3_600_000
  const distanceNm = meters / 1852
  const avgSpeed = durationHours > 0 ? distanceNm / durationHours : 0

  const speedVals = points.map((p) => p.speed).filter((v) => Number.isFinite(v))
  const maxSpeed = speedVals.length ? Math.max(...speedVals) : null

  return { distanceNm, durationHours, maxSpeed, avgSpeed }
}

function VoyageLocationDot() {
  const { position, startWatching, stopWatching } = useGPS()

  useEffect(() => {
    startWatching()
    return () => stopWatching()
  }, [startWatching, stopWatching])

  if (!position) return null
  const icon = L.divIcon({
    className: '',
    html: `<div style="position:relative;width:16px;height:16px">
      <div class="gps-pulse-ring"></div>
      <div style="position:absolute;inset:3px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
  return (
    <Marker position={[position.lat, position.lng]} icon={icon}>
      <Popup>Your location{position.accuracy != null ? ` (±${Math.round(position.accuracy)} m)` : ''}</Popup>
    </Marker>
  )
}

function TrackMapLayerControl({ baseLayer, setBaseLayer, overlays, setOverlays }) {
  const divRef = useRef(null)
  useEffect(() => {
    if (divRef.current) L.DomEvent.disableClickPropagation(divRef.current)
  }, [])
  return (
    <div className="leaflet-top leaflet-right">
      <div
        ref={divRef}
        className="leaflet-control"
        style={{
          background: 'white', borderRadius: 6, padding: '7px 10px',
          marginTop: 10, marginRight: 10,
          boxShadow: '0 1px 5px rgba(0,0,0,0.35)',
          fontSize: 12, minWidth: 120, userSelect: 'none',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, color: '#222', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Base</div>
        {[{ key: 'osm', label: 'Street map' }, { key: 'satellite', label: 'Satellite' }].map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginBottom: 3, color: '#333' }}>
            <input type="radio" name="vm-base" checked={baseLayer === key} onChange={() => setBaseLayer(key)} style={{ cursor: 'pointer' }} />
            {label}
          </label>
        ))}
        <div style={{ fontWeight: 700, margin: '7px 0 4px', color: '#222', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overlays</div>
        {[{ key: 'seamark', label: 'Nautical marks' }, { key: 'gebco', label: 'Depth contours' }].map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginBottom: 3, color: '#333' }}>
            <input type="checkbox" checked={overlays[key]} onChange={() => setOverlays((o) => ({ ...o, [key]: !o[key] }))} style={{ cursor: 'pointer' }} />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}

function FullscreenButton({ isFullscreen, onToggle, containerRef }) {
  const divRef = useRef(null)
  useEffect(() => {
    if (divRef.current) L.DomEvent.disableClickPropagation(divRef.current)
  }, [])
  return (
    <div className="leaflet-bottom leaflet-right">
      <div ref={divRef} className="leaflet-control" style={{ marginBottom: 30, marginRight: 10 }}>
        <button
          type="button"
          onClick={onToggle}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          style={{
            background: 'white', border: '2px solid rgba(0,0,0,0.2)', borderRadius: 4,
            width: 30, height: 30, cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <span style={{ lineHeight: 1 }}>⛶</span>
        </button>
      </div>
    </div>
  )
}

function FullscreenMapSync({ fullscreenState }) {
  const map = useMap()

  useEffect(() => {
    map.invalidateSize()
    const t = setTimeout(() => map.invalidateSize(), 120)
    return () => clearTimeout(t)
  }, [map, fullscreenState])

  return null
}

function TrackMap({ points }) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [baseLayer, setBaseLayer] = useState('osm')
  const [overlays, setOverlays] = useState({ seamark: true, gebco: true })
  const containerRef = useRef(null)

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement === containerRef.current) {
      document.exitFullscreen?.()
      return
    }
    containerRef.current?.requestFullscreen?.()
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }} className="map-fullscreen-container rounded-lg overflow-hidden border border-slate-200">
      <MapContainer
        center={[points[0].lat, points[0].lng]}
        zoom={11}
        style={{ height: isFullscreen ? '100dvh' : '380px', width: '100%' }}
        scrollWheelZoom
      >
        {baseLayer === 'osm' ? (
          <TileLayer
            url={`https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY}`}
            attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={20}
          />
        ) : (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics"
            maxZoom={19}
          />
        )}
        {overlays.seamark && (
          <TileLayer
            url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
            attribution="&copy; OpenSeaMap"
            opacity={baseLayer === 'satellite' ? 0.9 : 0.7}
          />
        )}
        {overlays.gebco && (
          <TileLayer
            url="https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"
            attribution="Depth contours &copy; Esri"
            opacity={0.8}
            maxZoom={19}
          />
        )}
        <TrackMapLayerControl baseLayer={baseLayer} setBaseLayer={setBaseLayer} overlays={overlays} setOverlays={setOverlays} />
        <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} containerRef={containerRef} />
        <FullscreenMapSync fullscreenState={isFullscreen} />
        <VoyageLocationDot />
        <FitTrackBounds points={points} />
        <Polyline positions={points.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#0A4A52', weight: 3 }} />
        <Marker position={[points[0].lat, points[0].lng]} icon={createColoredIcon('#16A34A')}>
          <Popup>Start: {points[0].timestamp ? new Date(points[0].timestamp).toLocaleString() : 'Unknown time'}</Popup>
        </Marker>
        <Marker position={[points[points.length - 1].lat, points[points.length - 1].lng]} icon={createColoredIcon('#DC2626')}>
          <Popup>End: {points[points.length - 1].timestamp ? new Date(points[points.length - 1].timestamp).toLocaleString() : 'Unknown time'}</Popup>
        </Marker>
        {points.slice(1, -1).map((p, idx) => (
          <CircleMarker key={`${p.lat}-${p.lng}-${idx}`} center={[p.lat, p.lng]} radius={3} pathOptions={{ color: '#0A4A52' }}>
            <Tooltip direction="top" offset={[0, -4]}>
              <div className="text-xs">
                <div>{p.timestamp ? new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Unknown time'}</div>
                <div>Speed: {p.speed == null ? '—' : `${p.speed.toFixed(1)} kn`}</div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}

function FitTrackBounds({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!points?.length) return
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [30, 30] })
  }, [map, points])

  return null
}

function createColoredIcon(color) {
  return L.divIcon({
    html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

export default function VoyageLog({ dataset, triggerRefresh }) {
  const voyageLog = Array.isArray(dataset?.voyageLog) ? dataset.voyageLog : []
  const [form, setForm] = useState(DEFAULT_FORM)
  const [weather, setWeather] = useState(null)
  const [loadingWeather, setLoadingWeather] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [pendingPhotos, setPendingPhotos] = useState([])
  const [existingPhotos, setExistingPhotos] = useState([])
  const [gallery, setGallery] = useState(null)
  const [trackModal, setTrackModal] = useState(null)

  const persistDraft = (nextForm, nextWeather) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      VOYAGE_DRAFT_STORAGE_KEY,
      JSON.stringify({ form: nextForm, weather: nextWeather }),
    )
  }

  useEffect(() => {
    const draft = loadDraft()
    const pending = loadPendingTransfer()

    if (pending?.trip || pending?.departureDate || pending?.departureHour !== undefined) {
      const baseForm = { ...DEFAULT_FORM, ...(draft?.form || {}) }
      const tripNoteParts = []
      if (pending.trip?.speedKnots) tripNoteParts.push(`planned speed ${pending.trip.speedKnots} kn`)
      if (pending.trip?.durationMinutes) {
        const hours = Math.floor(pending.trip.durationMinutes / 60)
        const minutes = pending.trip.durationMinutes % 60
        tripNoteParts.push(`ETA ${hours}h ${String(minutes).padStart(2, '0')}m`)
      }
      if (pending.trip?.estCost !== null && pending.trip?.estCost !== undefined) {
        tripNoteParts.push(`estimated fuel cost $${Number(pending.trip.estCost).toFixed(2)}`)
      }
      const tripNote = tripNoteParts.length ? `Passage plan: ${tripNoteParts.join(', ')}` : ''
      const transferTime = String(pending.departureHour ?? 9).padStart(2, '0') + ':00'
      const transferredForm = {
        ...baseForm,
        date: pending.departureDate || baseForm.date,
        departure_time: pending.departureHour !== undefined ? transferTime : baseForm.departure_time,
        departure_port: pending.trip?.departurePort || baseForm.departure_port,
        destination: pending.trip?.destination || baseForm.destination,
        distance_nm: pending.trip?.distanceNm ?? baseForm.distance_nm,
        fuel_used: pending.trip?.fuelUsedLitres ?? baseForm.fuel_used,
        conditions: pending.trip?.conditions || baseForm.conditions,
        notes: upsertGeneratedLine(baseForm.notes, TRIP_NOTE_PREFIX, tripNote),
        wind_kn: pending.weather?.windKn != null ? String(pending.weather.windKn) : baseForm.wind_kn,
        wind_direction_deg: pending.weather?.windDirDeg != null ? String(pending.weather.windDirDeg) : baseForm.wind_direction_deg,
        wave_height_m: pending.weather?.waveHeightM != null ? String(pending.weather.waveHeightM) : baseForm.wave_height_m,
        wave_direction_deg: pending.weather?.waveDirDeg != null ? String(pending.weather.waveDirDeg) : baseForm.wave_direction_deg,
        swell_height_m: pending.weather?.swellHeightM != null ? String(pending.weather.swellHeightM) : baseForm.swell_height_m,
      }
      setForm(transferredForm)
      setWeather(pending.weather || draft?.weather || null)
      persistDraft(transferredForm, pending.weather || draft?.weather || null)
      clearPendingTransfer()
      setDraftHydrated(true)
      return
    }

    if (draft) {
      setForm({ ...DEFAULT_FORM, ...draft.form })
      setWeather(draft.weather || null)
    }
    setDraftHydrated(true)
  }, [])

  useEffect(() => {
    if (!draftHydrated) return
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      VOYAGE_DRAFT_STORAGE_KEY,
      JSON.stringify({ form, weather }),
    )
  }, [draftHydrated, form, weather])

  // Auto-fetch weather when form first hydrates (skip if already have weather from pending transfer)
  useEffect(() => {
    if (!draftHydrated) return
    if (editingId) return
    if (weather) return
    fetchWeather().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftHydrated])

  const departureHour = useMemo(() => Number(form.departure_time.split(':')[0] || 9), [form.departure_time])
  const visibleVoyages = useMemo(() => [...voyageLog].sort((a, b) => new Date(b.date) - new Date(a.date)), [voyageLog])
  const tripLogEndNm = useMemo(() => {
    const start = Number(form.trip_log_start_nm)
    const distance = Number(form.distance_nm)
    if (!Number.isFinite(start)) return null
    return Math.round((start + (Number.isFinite(distance) ? distance : 0)) * 10) / 10
  }, [form.trip_log_start_nm, form.distance_nm])
  const summary = useMemo(
    () =>
      visibleVoyages.reduce(
        (acc, row) => {
          acc.totalNm += Number(row.distance_nm || 0)
          acc.totalHours += Number(row.engine_hours || 0)
          acc.totalFuel += Number(row.fuel_used || 0)
          return acc
        },
        { totalNm: 0, totalHours: 0, totalFuel: 0 },
      ),
    [visibleVoyages],
  )
  const suggestedTripLogStart = useMemo(() => {
    for (const voyage of visibleVoyages) {
      const { tripLogEnd } = tripLogRange(voyage)
      if (tripLogEnd !== null) return tripLogEnd
    }
    return null
  }, [visibleVoyages])

  const applyWeather = (w, options = {}) => {
    const { appendNotes = true } = options
    setWeather(w)
    setForm((prev) => {
      const weatherNote = `Weather at departure: Wind ${w.windKn ?? '-'} kn ${w.windDirCompass}, Waves ${w.waveHeightM ?? '-'}m, Swell ${w.swellHeightM ?? '-'}m ${w.swellDirCompass}`
      const nextForm = {
        ...prev,
        wind_kn: w.windKn ?? '',
        wind_direction_deg: w.windDirDeg ?? '',
        wave_height_m: w.waveHeightM ?? '',
        wave_direction_deg: w.waveDirDeg ?? '',
        swell_height_m: w.swellHeightM ?? '',
        notes: appendNotes
          ? upsertGeneratedLine(prev.notes, WEATHER_NOTE_PREFIX, weatherNote)
          : prev.notes,
      }
      persistDraft(nextForm, w)
      return nextForm
    })
  }

  const applyTransfer = (pending) => {
    const transferTime = String(pending.departureHour ?? 9).padStart(2, '0') + ':00'
    setForm((prev) => {
      const tripNoteParts = []
      if (pending.trip?.speedKnots) tripNoteParts.push(`planned speed ${pending.trip.speedKnots} kn`)
      if (pending.trip?.durationMinutes) {
        const hours = Math.floor(pending.trip.durationMinutes / 60)
        const minutes = pending.trip.durationMinutes % 60
        tripNoteParts.push(`ETA ${hours}h ${String(minutes).padStart(2, '0')}m`)
      }
      if (pending.trip?.estCost !== null && pending.trip?.estCost !== undefined) {
        tripNoteParts.push(`estimated fuel cost $${Number(pending.trip.estCost).toFixed(2)}`)
      }
      const tripNote = tripNoteParts.length ? `Passage plan: ${tripNoteParts.join(', ')}` : ''

      const nextForm = {
        ...prev,
        date: pending.departureDate || prev.date,
        departure_time: pending.departureHour !== undefined ? transferTime : prev.departure_time,
        departure_port: pending.trip?.departurePort || prev.departure_port,
        destination: pending.trip?.destination || prev.destination,
        distance_nm: pending.trip?.distanceNm ?? prev.distance_nm,
        fuel_used: pending.trip?.fuelUsedLitres ?? prev.fuel_used,
        conditions: pending.trip?.conditions || prev.conditions,
        notes: upsertGeneratedLine(prev.notes, TRIP_NOTE_PREFIX, tripNote),
      }
      persistDraft(nextForm, pending.weather || weather)
      return nextForm
    })

    if (pending.weather) {
      applyWeather(pending.weather)
    }
  }

  const importPassagePlan = () => {
    const pendingRaw =
      localStorage.getItem(PENDING_VOYAGE_TRANSFER_KEY) ||
      localStorage.getItem('amaroo_pending_weather')

    if (!pendingRaw) {
      window.alert('No passage planner transfer is waiting. Use the transfer button in Passage Planner first.')
      return
    }

    const pending = JSON.parse(pendingRaw)
    if (pending.trip || pending.departureDate || pending.departureHour !== undefined) {
      applyTransfer(pending)
      clearPendingTransfer()
      return
    }

    if (pending.weather) {
      applyWeather(pending.weather)
      clearPendingTransfer()
    }
  }

  const loadForEdit = (voyage) => {
    const weatherData = extractStoredWeather(voyage.notes) || {}
    const nextWeather =
      weatherData && Object.keys(weatherData).length
        ? {
            windKn: weatherData.wind_kn,
            windDirDeg: weatherData.wind_direction_deg,
            waveHeightM: weatherData.wave_height_m,
            waveDirDeg: weatherData.wave_direction_deg,
            swellHeightM: weatherData.swell_height_m,
          }
        : null
    const nextForm = {
      date: voyage.date || DEFAULT_FORM.date,
      departure_time: voyage.departure_time || DEFAULT_FORM.departure_time,
      departure_port: voyage.departure_port || '',
      destination: voyage.destination || '',
      trip_log_start_nm: String(weatherData.trip_log_start_nm ?? ''),
      distance_nm: String(voyage.distance_nm ?? ''),
      crew_count: String(voyage.crew_count ?? ''),
      conditions: voyage.conditions || '',
      fuel_used: String(voyage.fuel_used ?? ''),
      engine_hours: String(voyage.engine_hours ?? ''),
      wind_kn: String(weatherData.wind_kn ?? ''),
      wind_direction_deg: String(weatherData.wind_direction_deg ?? ''),
      wave_height_m: String(weatherData.wave_height_m ?? ''),
      wave_direction_deg: String(weatherData.wave_direction_deg ?? ''),
      swell_height_m: String(weatherData.swell_height_m ?? ''),
      notes: stripWeatherMeta(voyage.notes || ''),
    }

    setEditingId(voyage.id)
    setSaveMessage(`Editing voyage from ${voyage.date || 'unknown date'}. Save to update.`)
    setSaveError('')
    setForm(nextForm)
    setWeather(nextWeather)
    setExistingPhotos(Array.isArray(voyage.photos) ? voyage.photos : [])
    setPendingPhotos([])
    persistDraft(nextForm, nextWeather)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setSaveMessage('')
    setExistingPhotos([])
    setPendingPhotos([])
  }

  const handleAddPhotos = async (files) => {
    const newItems = files.map((f, i) => ({
      id: `new-${Date.now()}-${i}`,
      previewUrl: URL.createObjectURL(f),
      uploading: true,
      error: null,
      saved: false,
      _file: f,
    }))
    setPendingPhotos((prev) => [...prev, ...newItems])
    for (const item of newItems) {
      const err = validatePhoto(item._file)
      if (err) {
        setPendingPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, error: err } : p))
        continue
      }
      try {
        const storagePath = `voyages/${Date.now()}-${sanitizeFileName(item._file.name)}`
        const { url, path } = await uploadPhoto(item._file, storagePath)
        setPendingPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, url, path, saved: true } : p))
      } catch {
        setPendingPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, error: 'Upload failed' } : p))
      }
    }
  }

  const handleRemovePendingPhoto = async (index) => {
    const photo = pendingPhotos[index]
    if (photo.saved && photo.path) { try { await deletePhoto(photo.path) } catch {} }
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl)
    setPendingPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const handleRemoveExistingPhoto = async (index) => {
    const photo = existingPhotos[index]
    if (photo?.path) { try { await deletePhoto(photo.path) } catch {} }
    setExistingPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const deleteVoyage = async (voyageId) => {
    if (!window.confirm('Delete this voyage entry?')) return
    setDeletingId(voyageId)
    setSaveError('')
    setSaveMessage('')
    try {
      await db.remove('voyage_log', voyageId)
      if (editingId === voyageId) {
        setEditingId(null)
      }
      if (triggerRefresh) triggerRefresh('all')
      setSaveMessage('Voyage deleted.')
    } catch (error) {
      setSaveError(error.message || 'Unable to delete voyage.')
    } finally {
      setDeletingId(null)
    }
  }

  const fetchWeather = async () => {
    setLoadingWeather(true)
    try {
      let coords = { ...HOME_BERTH_COORDS }
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
          })
          coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        } catch {
          // Fallback to home berth coords.
        }
      }

      const { conditions: extracted, error } = await fetchCurrentConditions(coords.lat, coords.lng)
      if (error) throw new Error(error)
      if (!extracted) throw new Error('No weather data available')
      applyWeather(extracted)
    } finally {
      setLoadingWeather(false)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    setSaveMessage('')
    try {
      const photos = [
        ...existingPhotos,
        ...pendingPhotos.filter((p) => p.saved).map((p) => ({ url: p.url, path: p.path })),
      ]
      const departure_conditions = weather ? {
        wind_speed: weather.windKn,
        wind_direction: weather.windDirCompass,
        wind_direction_degrees: weather.windDirDeg,
        wave_height: weather.waveHeightM,
        swell_height: weather.swellHeightM,
        swell_direction: weather.swellDirCompass,
        swell_period: weather.swellPeriodS,
        comfort: (weather.windKn >= 30 || weather.waveHeightM >= 2) ? 'No-Go'
          : (weather.windKn >= 20 || weather.waveHeightM >= 1.5) ? 'Marginal' : 'Good',
        temperature: weather.temperatureC,
      } : null
      const baseNotes = buildStoredNotes(form.notes, {
        wind_kn: form.wind_kn,
        wind_direction_deg: form.wind_direction_deg,
        wave_height_m: form.wave_height_m,
        wave_direction_deg: form.wave_direction_deg,
        swell_height_m: form.swell_height_m,
        trip_log_start_nm: form.trip_log_start_nm,
      })
      const payload = {
        date: form.date,
        departure_port: form.departure_port,
        destination: form.destination,
        departure_time: form.departure_time,
        arrival_time: null,
        distance_nm: Number(form.distance_nm || 0),
        crew_count: Number(form.crew_count || 0),
        conditions: form.conditions,
        fuel_used: Number(form.fuel_used || 0),
        engine_hours: Number(form.engine_hours || 0),
        notes: appendDepartureConditions(baseNotes, departure_conditions),
        departure_conditions,
        photos,
        track_points: editingId ? undefined : [],
      }

      const doSave = async (p) => {
        if (editingId) return updateVoyageLogEntry(editingId, p)
        return addVoyageLogEntry(p)
      }
      try {
        await doSave(payload)
      } catch (err) {
        if (err.message?.includes('departure_conditions') || err.code === 'PGRST204') {
          const { departure_conditions: _dc, ...fallback } = payload
          await doSave(fallback)
        } else {
          throw err
        }
      }

      if (triggerRefresh) triggerRefresh('all')
      setSaveMessage(editingId ? 'Voyage updated.' : 'Voyage saved.')
      setEditingId(null)
      setForm(DEFAULT_FORM)
      setWeather(null)
      pendingPhotos.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl) })
      setPendingPhotos([])
      setExistingPhotos([])
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(VOYAGE_DRAFT_STORAGE_KEY)
      }
    } catch (error) {
      setSaveError(error.message || 'Unable to save voyage.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4">
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Voyage Log Entry</h3>
        {editingId ? (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Editing existing voyage entry. Saving will update this record.
          </div>
        ) : null}
        <div className="grid md:grid-cols-3 gap-2 text-sm">
          {[
            ['date', 'Date', 'date'],
            ['departure_time', 'Departure Time', 'time'],
            ['departure_port', 'Departure Port', 'text'],
            ['destination', 'Destination', 'text'],
            ['trip_log_start_nm', 'Trip Log Start (nm)', 'number'],
            ['distance_nm', 'Distance (nm)', 'number'],
            ['crew_count', 'Crew Count', 'number'],
            ['conditions', 'Conditions', 'text'],
            ['fuel_used', 'Fuel Used (L)', 'number'],
            ['engine_hours', 'Engine Hours', 'number'],
            ['wind_kn', 'Wind (kn)', 'number'],
            ['wind_direction_deg', 'Wind Dir (deg)', 'number'],
            ['wave_height_m', 'Wave Height (m)', 'number'],
            ['wave_direction_deg', 'Wave Dir (deg)', 'number'],
            ['swell_height_m', 'Swell Height (m)', 'number'],
          ].map(([key, label, type]) => (
            <label key={key}>
              {label}
              <input
                type={type}
                value={form[key]}
                onChange={(e) => setForm((prev) => {
                  const nextForm = { ...prev, [key]: e.target.value }
                  persistDraft(nextForm, weather)
                  return nextForm
                })}
                className="w-full mt-1 rounded-lg border border-slate-300 p-2"
              />
            </label>
          ))}
          <label className="md:col-span-3">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => {
                const nextForm = { ...prev, notes: e.target.value }
                persistDraft(nextForm, weather)
                return nextForm
              })}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
              rows={4}
            />
          </label>
          <div className="md:col-span-3">
            <div className="text-sm font-medium mb-1">Photos (optional)</div>
            {existingPhotos.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-2">
                {existingPhotos.map((p, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                    <button type="button" onClick={() => setGallery({ photos: existingPhotos, index: i })} className="w-full h-full">
                      <PhotoImg src={p.url} alt="" className="w-16 h-16" />
                    </button>
                    <button type="button" onClick={() => handleRemoveExistingPhoto(i)} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80">
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <PhotoUploader
              photos={pendingPhotos}
              onAdd={handleAddPhotos}
              onRemove={handleRemovePendingPhoto}
              onThumbnailClick={(i) => setGallery({
                photos: pendingPhotos.filter((p) => p.url || p.previewUrl).map((p) => ({ url: p.url || p.previewUrl })),
                index: i,
              })}
              maxPhotos={Math.max(0, 5 - existingPhotos.length)}
            />
          </div>
        </div>

        {loadingWeather ? (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-300 border-t-[#0A4A52] animate-spin" />
            Updating weather fields...
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setForm((prev) => {
              if (suggestedTripLogStart === null) return prev
              const nextForm = {
                ...prev,
                trip_log_start_nm: String(suggestedTripLogStart),
              }
              persistDraft(nextForm, weather)
              return nextForm
            })}
            disabled={suggestedTripLogStart === null}
            className="px-3 py-2 rounded-lg border border-[#0A4A52] text-[#0A4A52] bg-white disabled:opacity-60"
          >
            Use Last Trip Log End
          </button>
          {suggestedTripLogStart !== null ? (
            <div className="text-xs text-slate-500 self-center">
              Latest end reading: {suggestedTripLogStart.toFixed(1)} nm
            </div>
          ) : null}
        </div>

        {tripLogEndNm !== null ? (
          <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
            Trip Log End (nm): <strong>{tripLogEndNm}</strong>
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={importPassagePlan} className="px-4 py-2 rounded-lg border border-[#0A4A52] text-[#0A4A52] bg-white">
            Import Passage Plan
          </button>
          <button type="button" onClick={fetchWeather} className="px-4 py-2 rounded-lg bg-[#C4603A] text-white">
            {loadingWeather ? 'Fetching Weather...' : 'Fetch Weather'}
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-[#0A4A52] text-white disabled:opacity-60">{saving ? 'Saving...' : editingId ? 'Update Voyage' : 'Save Voyage'}</button>
          {editingId ? (
            <button type="button" onClick={cancelEdit} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700">Cancel Edit</button>
          ) : null}
        </div>

        {saveError ? <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{saveError}</div> : null}
        {saveMessage ? <div className="mt-3 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{saveMessage}</div> : null}

        {weather ? compactCard(weather) : null}
      </form>

      <div className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-serif text-xl text-[#0A4A52]">Saved Voyage Log</h3>
          <div className="text-sm text-slate-500">{visibleVoyages.length} entries</div>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Nm</div>
            <div className="mt-1 text-xl font-semibold text-[#0A4A52]">{summary.totalNm.toFixed(1)}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Hours</div>
            <div className="mt-1 text-xl font-semibold text-[#0A4A52]">{summary.totalHours.toFixed(1)}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Fuel (L)</div>
            <div className="mt-1 text-xl font-semibold text-[#0A4A52]">{summary.totalFuel.toFixed(1)}</div>
          </div>
        </div>

        {visibleVoyages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            No saved voyages yet. Save a voyage entry above and it will appear here.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleVoyages.map((voyage) => {
              const { startTripLog, tripLogEnd } = tripLogRange(voyage)
              const trackPoints = normalizeTrackPoints(voyage.track_points)
              return (
                <div key={voyage.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-base font-semibold text-slate-900">
                        {voyage.departure_port || 'Unknown departure'} to {voyage.destination || 'Unknown destination'}
                      </div>
                      <div className="text-sm text-slate-500">
                        {voyage.date || 'No date'} {voyage.departure_time ? `· ${voyage.departure_time}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-teal-50 px-3 py-1 text-[#0A4A52]">{Number(voyage.distance_nm || 0)} nm</span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">{Number(voyage.fuel_used || 0)} L fuel</span>
                      {tripLogEnd !== null ? (
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">
                          Trip Log {startTripLog.toFixed(1)} → {tripLogEnd.toFixed(1)} nm
                        </span>
                      ) : null}
                      {voyage.conditions ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{voyage.conditions}</span> : null}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadForEdit(voyage)}
                      className="rounded-lg border border-[#0A4A52] px-3 py-2 text-sm text-[#0A4A52]"
                    >
                      Edit Voyage
                    </button>
                    {trackPoints.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTrackModal({ voyage, points: trackPoints })}
                        className="rounded-lg border border-teal-700 px-3 py-2 text-sm text-teal-700"
                      >
                        View Track
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteVoyage(voyage.id)}
                      disabled={deletingId === voyage.id}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {deletingId === voyage.id ? 'Deleting...' : 'Delete Voyage'}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Crew</div>
                      <div className="mt-1 text-slate-700">{Number(voyage.crew_count || 0)} on board</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Engine Hours</div>
                      <div className="mt-1 text-slate-700">{Number(voyage.engine_hours || 0)} h</div>
                    </div>
                  </div>

                  {voyage.notes ? (
                    <div className="mt-3 rounded-lg bg-[#F7F3EE] p-3 text-sm text-slate-700 whitespace-pre-wrap">
                      {stripWeatherMeta(voyage.notes)}
                    </div>
                  ) : null}

                  {(() => {
                    const dc = (voyage.departure_conditions && Object.keys(voyage.departure_conditions).length > 0)
                      ? voyage.departure_conditions
                      : extractDepartureConditions(voyage.notes)
                    if (!dc) return null
                    return (
                      <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
                        <div className="text-sm font-semibold text-[#0A4A52] mb-2">📋 Conditions at Departure</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
                          <div>💨 Wind: <strong>{dc.wind_speed ?? '-'}kn</strong> {dc.wind_direction || ''}</div>
                          <div>🌊 Waves: <strong>{dc.wave_height ?? '-'}m</strong></div>
                          <div>🌀 Swell: <strong>{dc.swell_height ?? '-'}m</strong> {dc.swell_direction || ''}{dc.swell_period ? ` @ ${dc.swell_period}s` : ''}</div>
                          <div>🌡️ Temp: <strong>{dc.temperature ?? '-'}°C</strong></div>
                          <div>⭐ Comfort: <strong>{dc.comfort || '-'}</strong></div>
                        </div>
                      </div>
                    )
                  })()}

                  {(() => {
                    const vPhotos = Array.isArray(voyage.photos) ? voyage.photos : []
                    if (!vPhotos.length) return null
                    return (
                      <div className="mt-2 flex gap-2 flex-wrap items-center">
                        <Camera size={14} className="text-[#0A4A52]" />
                        {vPhotos.map((p, pi) => (
                          <button key={pi} type="button" onClick={() => setGallery({ photos: vPhotos, index: pi })}
                            className="w-14 h-14 rounded-lg overflow-hidden border border-slate-200">
                            <PhotoImg src={typeof p === 'string' ? p : p.url} alt="" className="w-14 h-14" />
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {trackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-serif text-xl text-[#0A4A52]">Recorded Track</h3>
              <button
                type="button"
                onClick={() => setTrackModal(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
              >
                Close
              </button>
            </div>

            <TrackMap points={trackModal.points} />

            {(() => {
              const stats = summarizeTrack(trackModal.points)
              return (
                <div className="grid md:grid-cols-4 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Total Distance</div>
                    <div className="mt-1 font-semibold text-[#0A4A52]">{stats.distanceNm.toFixed(2)} nm</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Duration</div>
                    <div className="mt-1 font-semibold text-[#0A4A52]">{stats.durationHours.toFixed(2)} h</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Max Speed</div>
                    <div className="mt-1 font-semibold text-[#0A4A52]">{stats.maxSpeed == null ? '—' : `${stats.maxSpeed.toFixed(1)} kn`}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Average Speed</div>
                    <div className="mt-1 font-semibold text-[#0A4A52]">{stats.avgSpeed.toFixed(1)} kn</div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {gallery && (
        <PhotoGallery photos={gallery.photos} initialIndex={gallery.index} onClose={() => setGallery(null)} />
      )}
    </div>
  )
}
