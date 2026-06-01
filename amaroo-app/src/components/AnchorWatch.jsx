import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import { useGPS } from '../hooks/useGPS'
import { getVesselSettings, upsertVesselSettingsBulk } from '../db/api'

const STORAGE_KEYS = {
  active: 'anchorWatch_active',
  lat: 'anchorWatch_lat',
  lng: 'anchorWatch_lng',
  radius: 'anchorWatch_radius',
  deviceId: 'anchorWatch_device_id',
}

const SYNC_KEYS = {
  masterDeviceId: 'anchor_watch_master_device_id',
  latestPosition: 'anchor_watch_latest_position',
  anchorPoint: 'anchor_watch_anchor_point',
  radius: 'anchor_watch_radius',
  active: 'anchor_watch_active',
}

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(STORAGE_KEYS.deviceId)
  if (existing) return existing
  const next = `aw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  localStorage.setItem(STORAGE_KEYS.deviceId, next)
  return next
}

function metersBetween(a, b) {
  if (!a || !b) return 0
  const toRad = (deg) => (deg * Math.PI) / 180
  const R = 6_371_000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
  return R * c
}

function formatLatLng(p) {
  if (!p) return '—'
  const lat = `${Math.abs(p.lat).toFixed(3)}°${p.lat < 0 ? 'S' : 'N'}`
  const lng = `${Math.abs(p.lng).toFixed(3)}°${p.lng < 0 ? 'W' : 'E'}`
  return `${lat}, ${lng}`
}

// Re-fits the map whenever the anchorPoint object reference changes (e.g. Reset Anchor).
function AnchorMapUpdater({ anchorPoint, position, radius }) {
  const map = useMap()
  const prevAnchorRef = useRef(null)

  useEffect(() => {
    if (!anchorPoint) return
    if (prevAnchorRef.current === anchorPoint) return
    prevAnchorRef.current = anchorPoint

    const padDeg = Math.max((Number(radius) / 111_320) * 2.5, 0.001)
    const lats = [anchorPoint.lat]
    const lngs = [anchorPoint.lng]
    if (position) { lats.push(position.lat); lngs.push(position.lng) }

    map.fitBounds(
      [
        [Math.min(...lats) - padDeg, Math.min(...lngs) - padDeg],
        [Math.max(...lats) + padDeg, Math.max(...lngs) + padDeg],
      ],
      { maxZoom: 18, padding: [30, 30] },
    )
  }, [anchorPoint, position, radius, map])

  return null
}

function AnchorMap({ anchorPoint, position, positionHistory, radius, insideRadius }) {
  const [baseLayer, setBaseLayer] = useState('satellite')

  const center = anchorPoint
    ? [anchorPoint.lat, anchorPoint.lng]
    : position
      ? [position.lat, position.lng]
      : [-27.524, 153.43]

  const trailPositions = positionHistory.map((p) => [p.lat, p.lng])

  return (
    <div className="relative rounded-lg overflow-hidden border border-slate-200" style={{ height: 320 }}>
      <MapContainer center={center} zoom={16} style={{ height: '100%', width: '100%' }} zoomControl>
        {baseLayer === 'osm' ? (
          <TileLayer
            url={`https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY}`}
            attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={20}
          />
        ) : (
          <TileLayer
            url={`https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.jpg?api_key=${import.meta.env.VITE_STADIA_API_KEY}`}
            attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; CNES, Distribution Airbus DS'
            maxZoom={20}
          />
        )}

        {/* Nautical seamarks */}
        <TileLayer
          url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
          attribution='&copy; <a href="http://www.openseamap.org">OpenSeaMap</a>'
          maxZoom={18}
          opacity={0.7}
        />

        {/* Drag radius circle */}
        {anchorPoint && (
          <Circle
            center={[anchorPoint.lat, anchorPoint.lng]}
            radius={Number(radius)}
            pathOptions={{
              color: insideRadius ? '#16A34A' : '#DC2626',
              fillColor: insideRadius ? '#16A34A' : '#DC2626',
              fillOpacity: 0.08,
              weight: 2.5,
            }}
          />
        )}

        {/* Anchor marker */}
        {anchorPoint && (
          <CircleMarker
            center={[anchorPoint.lat, anchorPoint.lng]}
            radius={7}
            pathOptions={{ color: '#92400E', fillColor: '#B45309', fillOpacity: 1, weight: 2 }}
          />
        )}

        {/* Vessel trail */}
        {trailPositions.length > 1 && (
          <Polyline
            positions={trailPositions}
            pathOptions={{ color: '#3B82F6', weight: 2, opacity: 0.55 }}
          />
        )}
        {trailPositions.map((p, i) => (
          <CircleMarker
            key={i}
            center={p}
            radius={2}
            pathOptions={{ color: '#3B82F6', fillColor: '#3B82F6', fillOpacity: 0.5, weight: 0 }}
          />
        ))}

        {/* Current vessel position */}
        {position && (
          <CircleMarker
            center={[position.lat, position.lng]}
            radius={8}
            pathOptions={{ color: '#1D4ED8', fillColor: '#3B82F6', fillOpacity: 1, weight: 2 }}
          />
        )}

        <AnchorMapUpdater anchorPoint={anchorPoint} position={position} radius={radius} />
      </MapContainer>

      {/* Layer toggle */}
      <div className="absolute top-2 right-2 z-[1000] flex gap-1">
        {[{ key: 'satellite', label: 'Satellite' }, { key: 'osm', label: 'Map' }].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setBaseLayer(key)}
            className={`rounded px-2 py-1 text-xs font-medium shadow ${baseLayer === key ? 'bg-[#0A4A52] text-white' : 'bg-white text-slate-700 border border-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-2 z-[1000] bg-white/90 rounded px-2 py-1 text-xs space-y-0.5 pointer-events-none">
        <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full bg-blue-500" /> Vessel</div>
        <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full bg-amber-600" /> Anchor</div>
      </div>
    </div>
  )
}

function distanceVectorMeters(anchor, current) {
  if (!anchor || !current) return { dx: 0, dy: 0 }
  const latScale = 110_540
  const lngScale = 111_320 * Math.cos((anchor.lat * Math.PI) / 180)
  return {
    dx: (current.lng - anchor.lng) * lngScale,
    dy: (current.lat - anchor.lat) * latScale,
  }
}

export default function AnchorWatch() {
  const { position, source, startWatching, stopWatching } = useGPS({ maximumAge: 10_000, timeout: 15_000, updateInterval: 10_000 })
  const [status, setStatus] = useState('inactive')
  const [anchorPoint, setAnchorPoint] = useState(null)
  const [radius, setRadius] = useState(50)
  const [positionHistory, setPositionHistory] = useState([])
  const [silenced, setSilenced] = useState(false)
  const [deviceId] = useState(() => getOrCreateDeviceId())
  const [masterDeviceId, setMasterDeviceId] = useState(null)
  const [remoteBoatPosition, setRemoteBoatPosition] = useState(null)

  const audioCtxRef = useRef(null)
  const alarmLoopRef = useRef(null)
  const lastCloudSyncRef = useRef(0)

  const isRemoteClient = !!masterDeviceId && masterDeviceId !== deviceId
  const activePosition = isRemoteClient ? remoteBoatPosition : position

  const currentDistance = useMemo(() => {
    if (!anchorPoint || !activePosition) return 0
    return metersBetween(anchorPoint, activePosition)
  }, [anchorPoint, activePosition])

  const alarmActive = status === 'alarm'
  const insideRadius = currentDistance <= Number(radius || 0)
  const gpsReady = source === 'gps' && !!position && !isRemoteClient

  useEffect(() => {
    let alive = true

    const pullSyncState = async () => {
      try {
        const settings = await getVesselSettings()
        if (!alive) return
        const data = settings?.data || {}

        const remoteMaster = data?.[SYNC_KEYS.masterDeviceId] || null
        setMasterDeviceId(remoteMaster)

        const boatPos = data?.[SYNC_KEYS.latestPosition]
        if (boatPos && Number.isFinite(Number(boatPos.lat)) && Number.isFinite(Number(boatPos.lng))) {
          setRemoteBoatPosition({ lat: Number(boatPos.lat), lng: Number(boatPos.lng) })
        }

        const syncedAnchor = data?.[SYNC_KEYS.anchorPoint]
        if (syncedAnchor && Number.isFinite(Number(syncedAnchor.lat)) && Number.isFinite(Number(syncedAnchor.lng))) {
          setAnchorPoint({ lat: Number(syncedAnchor.lat), lng: Number(syncedAnchor.lng) })
        }

        const syncedRadius = Number(data?.[SYNC_KEYS.radius])
        if (Number.isFinite(syncedRadius) && syncedRadius > 0) {
          setRadius(syncedRadius)
        }

        const syncedActive = data?.[SYNC_KEYS.active] === true
        if (syncedActive && status === 'inactive') {
          setStatus('active')
        }
      } catch {
        // Keep local mode running even if sync read fails.
      }
    }

    pullSyncState()
    const timer = setInterval(pullSyncState, 12_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [status])

  useEffect(() => {
    if (!isRemoteClient) startWatching()
    return () => {
      if (!isRemoteClient) stopWatching()
    }
  }, [isRemoteClient, startWatching, stopWatching])

  const clearAlarmAudio = () => {
    if (alarmLoopRef.current) {
      clearInterval(alarmLoopRef.current)
      alarmLoopRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }

  const playAlarmAudio = async () => {
    clearAlarmAudio()
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return

    try {
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      const beep = () => {
        if (!audioCtxRef.current) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        gain.gain.setValueAtTime(0.2, ctx.currentTime)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.5)
      }
      beep()
      alarmLoopRef.current = setInterval(beep, 1000)
    } catch {
      clearAlarmAudio()
    }
  }

  useEffect(() => {
    const persisted = window.localStorage.getItem(STORAGE_KEYS.active) === 'true'
    if (!persisted) return

    const lat = Number(window.localStorage.getItem(STORAGE_KEYS.lat))
    const lng = Number(window.localStorage.getItem(STORAGE_KEYS.lng))
    const savedRadius = Number(window.localStorage.getItem(STORAGE_KEYS.radius))

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setAnchorPoint({ lat, lng })
      setRadius(Number.isFinite(savedRadius) && savedRadius > 0 ? savedRadius : 50)
      setStatus('active')
      if (!isRemoteClient) startWatching()
    }
  }, [startWatching, isRemoteClient])

  useEffect(() => {
    if (status === 'active' || status === 'alarm') {
      if (anchorPoint) {
        window.localStorage.setItem(STORAGE_KEYS.active, 'true')
        window.localStorage.setItem(STORAGE_KEYS.lat, String(anchorPoint.lat))
        window.localStorage.setItem(STORAGE_KEYS.lng, String(anchorPoint.lng))
        window.localStorage.setItem(STORAGE_KEYS.radius, String(radius))
      }
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.active)
      window.localStorage.removeItem(STORAGE_KEYS.lat)
      window.localStorage.removeItem(STORAGE_KEYS.lng)
      window.localStorage.removeItem(STORAGE_KEYS.radius)
    }
  }, [anchorPoint, radius, status])

  useEffect(() => {
    if (!anchorPoint || !activePosition || !(status === 'active' || status === 'alarm')) return

    const dragged = currentDistance > Number(radius || 0)
    if (dragged && status !== 'alarm') {
      setStatus('alarm')
      setSilenced(false)
      playAlarmAudio()
      if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 500])
      }
      return
    }

    if (!dragged && status === 'alarm') {
      setStatus('active')
      setSilenced(true)
      clearAlarmAudio()
    }
  }, [anchorPoint, currentDistance, activePosition, radius, status])

  useEffect(() => () => clearAlarmAudio(), [])

  // Accumulate vessel positions for the map trail while watch is active.
  useEffect(() => {
    if (!activePosition || !(status === 'active' || status === 'alarm')) return
    setPositionHistory((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.lat === activePosition.lat && last.lng === activePosition.lng) return prev
      const next = [...prev, { lat: activePosition.lat, lng: activePosition.lng }]
      return next.length > 600 ? next.slice(-600) : next
    })
  }, [activePosition, status])

  useEffect(() => {
    const syncingActive = status === 'active' || status === 'alarm'
    if (!syncingActive || isRemoteClient || !anchorPoint || !position) return

    const now = Date.now()
    if (now - lastCloudSyncRef.current < 12_000) return
    lastCloudSyncRef.current = now

    upsertVesselSettingsBulk({
      [SYNC_KEYS.masterDeviceId]: deviceId,
      [SYNC_KEYS.latestPosition]: {
        lat: position.lat,
        lng: position.lng,
        timestamp: new Date().toISOString(),
        deviceId,
      },
      [SYNC_KEYS.anchorPoint]: anchorPoint,
      [SYNC_KEYS.radius]: Number(radius),
      [SYNC_KEYS.active]: true,
    }).catch(() => {})
  }, [status, isRemoteClient, anchorPoint, position, radius, deviceId])

  const setAnchor = () => {
    if (!gpsReady) return
    startWatching()
    if (position) {
      setAnchorPoint({ lat: position.lat, lng: position.lng })
      setStatus('confirm')
      return
    }
    setStatus('confirm')
  }

  const confirm = async () => {
    if (!gpsReady) return
    setAnchorPoint({ lat: position.lat, lng: position.lng })
    setStatus('active')
    setSilenced(false)
    clearAlarmAudio()
    upsertVesselSettingsBulk({
      [SYNC_KEYS.masterDeviceId]: deviceId,
      [SYNC_KEYS.latestPosition]: {
        lat: position.lat,
        lng: position.lng,
        timestamp: new Date().toISOString(),
        deviceId,
      },
      [SYNC_KEYS.anchorPoint]: { lat: position.lat, lng: position.lng },
      [SYNC_KEYS.radius]: Number(radius),
      [SYNC_KEYS.active]: true,
    }).catch(() => {})
  }

  const cancelAll = () => {
    setStatus('inactive')
    setAnchorPoint(null)
    setSilenced(false)
    clearAlarmAudio()
    stopWatching()
    setPositionHistory([])
    if (!isRemoteClient) {
      upsertVesselSettingsBulk({
        [SYNC_KEYS.active]: false,
      }).catch(() => {})
    }
  }

  const resetAnchor = () => {
    if (!gpsReady) return
    setAnchorPoint({ lat: position.lat, lng: position.lng })
    setStatus('active')
    setSilenced(true)
    clearAlarmAudio()
    setPositionHistory([])
    upsertVesselSettingsBulk({
      [SYNC_KEYS.masterDeviceId]: deviceId,
      [SYNC_KEYS.anchorPoint]: { lat: position.lat, lng: position.lng },
      [SYNC_KEYS.radius]: Number(radius),
      [SYNC_KEYS.active]: true,
    }).catch(() => {})
  }

  const vector = distanceVectorMeters(anchorPoint, activePosition)
  const chartRadius = 70
  const maxDistance = Math.max(Number(radius || 1), currentDistance, 1)
  const scale = (chartRadius * 0.9) / maxDistance
  const vesselX = 100 + vector.dx * scale
  const vesselY = 100 - vector.dy * scale

  return (
    <div className="rounded-xl bg-white border border-slate-200 shadow p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Anchor Watch</div>
        <button
          type="button"
          onClick={setAnchor}
          disabled={status === 'active' || status === 'alarm' || !gpsReady}
          className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          ⚓ Set Anchor Watch
        </button>
      </div>

      {isRemoteClient && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 space-y-2">
          <div>📡 Boat position is synced from onboard tablet. This device is in read-only monitor mode.</div>
          <button
            type="button"
            onClick={() => {
              upsertVesselSettingsBulk({ [SYNC_KEYS.masterDeviceId]: deviceId }).catch(() => {})
              setMasterDeviceId(deviceId)
            }}
            className="rounded bg-[#0A4A52] text-white px-2 py-1 text-xs font-medium"
          >
            This is the onboard tablet — take control
          </button>
        </div>
      )}

      {!isRemoteClient && source === 'fallback' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          📍 Using home berth location — connect Garmin GLO 2 via GPS Connector for live position
        </div>
      )}

      {status === 'confirm' && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 space-y-2">
          <div className="font-semibold text-[#0A4A52]">⚓ Anchor Watch Active</div>
          <div className="text-sm text-slate-700">Anchor position: {formatLatLng(activePosition || anchorPoint)}</div>
          <label className="text-sm block">
            Drag radius (metres)
            <input
              type="number"
              min="10"
              value={radius}
              onChange={(e) => setRadius(Math.max(10, Number(e.target.value || 50)))}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={confirm} disabled={!gpsReady} className="rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm disabled:opacity-50">Confirm</button>
            <button type="button" onClick={cancelAll} className="rounded-lg border border-slate-300 text-slate-600 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {(status === 'active' || status === 'alarm') && (
        <div className={`rounded-lg border p-3 space-y-2 ${alarmActive ? 'bg-red-100 border-red-400 anchor-alarm-pulse' : 'bg-slate-50 border-slate-200'}`}>
          {alarmActive && (
            <style>{`
              @keyframes anchor-border-pulse {
                0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.45); }
                70% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
                100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
              }
              .anchor-alarm-pulse {
                animation: anchor-border-pulse 1s ease-in-out infinite;
              }
            `}</style>
          )}
          <div className="font-semibold text-[#0A4A52]">⚓ ANCHOR WATCH ACTIVE</div>
          <div className="text-sm">📍 Current position: {formatLatLng(activePosition)}</div>
          <div className="text-sm">Anchor point: {formatLatLng(anchorPoint)}</div>
          <div className="text-sm font-medium">
            Distance from anchor: {Math.round(currentDistance)}m {insideRadius ? '✅ Holding' : '🚨 Outside radius'}
          </div>
          <div className="text-sm">Drag radius: {radius}m</div>

          {alarmActive && (
            <div className="rounded-lg bg-red-600 text-white p-2 text-sm font-semibold">
              🚨 ANCHOR DRAGGING — {Math.round(currentDistance)}m from anchor point
            </div>
          )}

          <svg viewBox="0 0 200 200" className="w-full h-44 rounded-lg bg-white border border-slate-200">
            <circle cx="100" cy="100" r={chartRadius} fill="none" stroke={insideRadius ? '#16A34A' : '#DC2626'} strokeWidth="3" />
            <text x="100" y="20" textAnchor="middle" className="fill-slate-500 text-xs">{radius}m radius</text>
            <text x="100" y="104" textAnchor="middle" className="text-lg">⚓</text>
            <circle cx={Math.max(12, Math.min(188, vesselX))} cy={Math.max(12, Math.min(188, vesselY))} r="6" fill="#0A4A52" />
          </svg>

          <AnchorMap
            anchorPoint={anchorPoint}
            position={activePosition}
            positionHistory={positionHistory}
            radius={radius}
            insideRadius={insideRadius}
          />

          <div className="text-xs text-slate-500">
            Keep screen on and app open for continuous monitoring. Consider enabling Stay awake in Android Developer Options.
          </div>

          <div className="flex gap-2 flex-wrap">
            {alarmActive && (
              <button
                type="button"
                onClick={() => {
                  setSilenced(true)
                  clearAlarmAudio()
                }}
                className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-medium"
              >
                Silence Alarm
              </button>
            )}
            <button type="button" onClick={resetAnchor} disabled={isRemoteClient} className="rounded-lg border border-[#0A4A52] text-[#0A4A52] px-3 py-1.5 text-xs font-medium disabled:opacity-50">Reset Anchor Point</button>
            <button type="button" onClick={cancelAll} className="rounded-lg border border-slate-300 text-slate-600 px-3 py-1.5 text-xs">Cancel Anchor Watch</button>
          </div>
          {silenced && alarmActive && <div className="text-xs text-red-700">Alarm silenced. Monitoring is still active.</div>}
        </div>
      )}

      {status === 'inactive' && (
        <div className="text-xs text-slate-500">
          Set the watch at anchor to alert if the vessel moves beyond your drag radius.
        </div>
      )}
    </div>
  )
}
