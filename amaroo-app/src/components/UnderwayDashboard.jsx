import { useEffect, useMemo, useRef, useState } from 'react'
import { getVesselSetting } from '../db/api'
import { computeSeaImpactWithFouling } from '../utils/physics'
import { foulingConditionLabel, foulingPenalty } from '../utils/hullFouling'
import { AMAROO, rpmToSTW, rpmToFuelBurnLhr } from '../utils/vesselConstants'
import { fetchCurrentConditions } from '../utils/weatherApi'
import { fetchOceanCurrentWithMeta, interpolateCurrent } from '../utils/oceanCurrent'

const NIGHT_KEY = 'underway_nightMode'
const RPM_KEY = 'underway_rpm'
const FUEL_CAPACITY_L = 2950
const PASSAGE_PLAN_KEY = 'amaroo_passage_plan_v2'
const LAST_WEATHER_KEY = 'amaroo_last_weather_snapshot'

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

function toCardinal(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return '—'
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round((Number(deg) % 360) / 45) % 8
  return `${Math.round(Number(deg))}° ${dirs[idx]}`
}

function fmtElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function totalDistanceNm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let meters = 0
  for (let i = 1; i < points.length; i += 1) {
    meters += haversineMeters(points[i - 1], points[i])
  }
  return meters / 1852
}

export default function UnderwayDashboard({
  isActive,
  timer,
  elapsedMs,
  trackPoints,
  isRecording,
  currentPosition,
  gpsSource,
  fuelBurnRate = 85,
  hullFouling,
  timerCalibration,
  onUpdateCalibration,
  onOpenSpeedSettings,
  onClose,
}) {
  const [nightMode, setNightMode] = useState(() => window.localStorage.getItem(NIGHT_KEY) === 'true')
  const [rpm, setRpm] = useState(() => {
    const saved = parseInt(window.localStorage.getItem(RPM_KEY), 10)
    return Number.isFinite(saved) ? saved : AMAROO.rpm0
  })
  const [physicsK, setPhysicsK] = useState(AMAROO.K)
  const [seaSnapshot, setSeaSnapshot] = useState({
    waveHeight: 0.8,
    swellHeight: 0.6,
    waveDirection: 90,
    swellDirection: 120,
    wavePeriod: 7,
    swellPeriod: 10,
  })
  const [currentSnapshot, setCurrentSnapshot] = useState({ speedKn: 0, dirDeg: 0 })
  const [weatherMeta, setWeatherMeta] = useState({ source: 'snapshot', updatedAt: null, error: null })
  const [calibrationForm, setCalibrationForm] = useState({
    startFuelL: timerCalibration?.startFuelL != null ? String(timerCalibration.startFuelL) : '',
    startEngineHoursTotal: timerCalibration?.startEngineHoursTotal != null ? String(timerCalibration.startEngineHoursTotal) : '',
  })
  const envRefreshRef = useRef(null)

  useEffect(() => {
    window.localStorage.setItem(NIGHT_KEY, String(nightMode))
  }, [nightMode])

  useEffect(() => {
    window.localStorage.setItem(RPM_KEY, String(rpm))
  }, [rpm])

  useEffect(() => {
    setCalibrationForm({
      startFuelL: timerCalibration?.startFuelL != null ? String(timerCalibration.startFuelL) : '',
      startEngineHoursTotal: timerCalibration?.startEngineHoursTotal != null ? String(timerCalibration.startEngineHoursTotal) : '',
    })
  }, [timerCalibration?.startFuelL, timerCalibration?.startEngineHoursTotal])

  useEffect(() => {
    let cancelled = false
    getVesselSetting('physics_k')
      .then((k) => {
        if (cancelled) return
        const parsed = k != null ? Number.parseFloat(k) : AMAROO.K
        if (Number.isFinite(parsed)) setPhysicsK(parsed)
      })
      .catch(() => {})

    try {
      const weatherRaw = localStorage.getItem(LAST_WEATHER_KEY)
      if (weatherRaw) {
        const weather = JSON.parse(weatherRaw)
        setSeaSnapshot({
          waveHeight: Number(weather.waveHeightM || 0),
          swellHeight: Number(weather.swellHeightM || 0),
          waveDirection: Number(weather.waveDirDeg || 0),
          swellDirection: Number(weather.swellDirDeg || 0),
          wavePeriod: Number(weather.wavePeriodS || 8),
          swellPeriod: Number(weather.swellPeriodS || 10),
        })
      } else {
        const raw = localStorage.getItem(PASSAGE_PLAN_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          const weather = parsed?.weather
          if (weather) {
            setSeaSnapshot({
              waveHeight: Number(weather.waveHeightM || 0),
              swellHeight: Number(weather.swellHeightM || 0),
              waveDirection: Number(weather.waveDirDeg || 0),
              swellDirection: Number(weather.swellDirDeg || 0),
              wavePeriod: Number(weather.wavePeriodS || 8),
              swellPeriod: Number(weather.swellPeriodS || 10),
            })
            if (weather.currentSpeedKn != null) {
              setCurrentSnapshot({
                speedKn: Number(weather.currentSpeedKn || 0),
                dirDeg: Number(weather.currentDirDeg || 0),
              })
            }
          }
        }
      }
    } catch {
      // Ignore malformed local storage values
    }

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isActive) return

    const refreshFromPosition = async () => {
      const lat = Number(currentPosition?.lat)
      const lng = Number(currentPosition?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

      try {
        const [{ conditions }, currentMeta] = await Promise.all([
          fetchCurrentConditions(lat, lng),
          fetchOceanCurrentWithMeta(lat, lng, 8, Date.now()),
        ])

        if (conditions) {
          setSeaSnapshot({
            waveHeight: Number(conditions.waveHeightM || 0),
            swellHeight: Number(conditions.swellHeightM || 0),
            waveDirection: Number(conditions.waveDirDeg || 0),
            swellDirection: Number(conditions.swellDirDeg || 0),
            wavePeriod: Number(conditions.wavePeriodS || 8),
            swellPeriod: Number(conditions.swellPeriodS || 10),
          })
          setWeatherMeta((prev) => ({ ...prev, source: 'gps_live', updatedAt: Date.now(), error: null }))
        }

        const currentNow = interpolateCurrent(currentMeta?.data, Date.now())
        if (currentNow) {
          setCurrentSnapshot({
            speedKn: Number(currentNow.currentSpeedKn || 0),
            dirDeg: Number(currentNow.currentDirectionDeg || 0),
          })
          setWeatherMeta((prev) => ({
            ...prev,
            source: currentMeta?.source || 'gps_live',
            updatedAt: Date.now(),
            error: currentMeta?.error || null,
          }))
        }
      } catch (err) {
        setWeatherMeta((prev) => ({ ...prev, error: err?.message || 'Live weather refresh failed' }))
      }
    }

    refreshFromPosition()
    envRefreshRef.current = setInterval(refreshFromPosition, 4 * 60 * 1000)

    return () => {
      if (envRefreshRef.current) clearInterval(envRefreshRef.current)
    }
  }, [isActive, currentPosition?.lat, currentPosition?.lng])

  useEffect(() => {
    let wakeLock = null
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen')
        }
      } catch (err) {
        console.warn('Wake lock failed:', err)
      }
    }

    if (isActive) {
      requestWakeLock()
    }

    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {})
      }
    }
  }, [isActive])

  const distanceNm = useMemo(() => totalDistanceNm(trackPoints), [trackPoints])
  const elapsedHours = elapsedMs / 3_600_000
  const avgSog = elapsedHours > 0 ? distanceNm / elapsedHours : 0
  const currentSog = currentPosition?.speedKnots == null ? null : currentPosition.speedKnots
  const maxSog = useMemo(() => {
    const speeds = (trackPoints || []).map((p) => Number(p.speed)).filter((v) => Number.isFinite(v))
    return speeds.length ? Math.max(...speeds) : null
  }, [trackPoints])

  const monthsSinceHaulout = Number(hullFouling?.monthsSinceHaulout || 0)
  const fouling = useMemo(() => foulingPenalty(monthsSinceHaulout), [monthsSinceHaulout])
  const hullLabel = useMemo(() => foulingConditionLabel(monthsSinceHaulout), [monthsSinceHaulout])

  const adjustedFuelBurnLhr = rpmToFuelBurnLhr(rpm) * fouling.fuelMultiplier
  const calibratedStartFuelL = Number(timerCalibration?.startFuelL)
  const calibratedStartEngineHours = Number(timerCalibration?.startEngineHoursTotal)
  const fuelTankStartL = Number.isFinite(calibratedStartFuelL) ? calibratedStartFuelL : FUEL_CAPACITY_L
  const fuelUsed = Math.max(0, elapsedHours * adjustedFuelBurnLhr)
  const fuelRemaining = Math.max(0, fuelTankStartL - fuelUsed)
  const engineHoursNow = Number.isFinite(calibratedStartEngineHours)
    ? calibratedStartEngineHours + elapsedHours
    : null

  const predictedSea = useMemo(() => {
    const heading = Number(currentPosition?.heading)
    const v0fromRpm = rpmToSTW(rpm)
    return computeSeaImpactWithFouling(
      v0fromRpm,
      AMAROO.loa,
      physicsK,
      seaSnapshot.waveHeight,
      seaSnapshot.swellHeight,
      0,
      'partition',
      seaSnapshot.waveDirection,
      Number.isFinite(heading) ? heading : 0,
      seaSnapshot.swellDirection,
      seaSnapshot.wavePeriod,
      seaSnapshot.swellPeriod,
      8,
      AMAROO.fmin,
      AMAROO.combineMode,
      AMAROO.gR0,
      AMAROO.gSigma,
      AMAROO.gGmin,
      AMAROO.gGmax,
      monthsSinceHaulout,
    )
  }, [currentPosition?.heading, physicsK, seaSnapshot, monthsSinceHaulout, rpm])

  // Predicted SOG = STW + component of ocean current along heading
  const predictedSOG = useMemo(() => {
    const heading = Number(currentPosition?.heading)
    const hdg = Number.isFinite(heading) ? heading : 0
    const angleDiff = ((currentSnapshot.dirDeg - hdg) * Math.PI) / 180
    const currentContribution = currentSnapshot.speedKn * Math.cos(angleDiff)
    return Math.max(0, predictedSea.predictedSTW + currentContribution)
  }, [predictedSea.predictedSTW, currentSnapshot, currentPosition?.heading])

  if (!isActive) return null

  return (
    <div
      className="rounded-xl shadow border border-teal-900 p-4"
      style={{
        background: nightMode ? '#0A1628' : '#0A4A52',
        color: nightMode ? '#FF4444' : '#FFFFFF',
        filter: nightMode ? 'brightness(0.6)' : 'none',
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold tracking-wide">🚢 AMAROO UNDERWAY</div>
        <div className="text-sm">{gpsSource === 'gps' ? '📍 GPS ✅' : '📍 Home Berth ⚠️'}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-sm">
        <Stat label="⏱ Elapsed" value={fmtElapsed(elapsedMs)} />
        <Stat label="📍 Distance" value={`${distanceNm.toFixed(1)} nm`} />
        <Stat label="⚡ Current SOG" value={currentSog == null ? '—' : `${currentSog.toFixed(1)} kn`} />
        <Stat label="📊 Avg SOG" value={`${avgSog.toFixed(1)} kn`} />
        <Stat label="⛽ Fuel Used" value={`${Math.round(fuelUsed)} L est`} />
        <Stat label="🛢 Fuel Left" value={`${Math.round(fuelRemaining)} L`} />
        <Stat label="🧮 Engine Hours (Trip)" value={`${elapsedHours.toFixed(2)} h`} />
        <Stat label="🧰 Engine Hours (Est Total)" value={engineHoursNow == null ? 'Set start gauge' : `${engineHoursNow.toFixed(1)} h`} />
        <Stat label="📍 Max SOG" value={maxSog == null ? '—' : `${maxSog.toFixed(1)} kn`} />
        <Stat label="🧭 Current HDG" value={toCardinal(currentPosition?.heading)} />
        <Stat
          label="🗺 GPS Position"
          value={currentPosition?.lat != null && currentPosition?.lng != null
            ? `${Number(currentPosition.lat).toFixed(5)}, ${Number(currentPosition.lng).toFixed(5)}`
            : '—'}
        />
        <Stat
          label="⏰ Trip Start"
          value={timer?.tripStart ? new Date(timer.tripStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
        />
      </div>

      <div className="mt-3 rounded-lg bg-white/10 p-3 border border-white/20 text-sm">
        <div className="text-xs uppercase tracking-wide opacity-60 mb-2">Gauge Sync (Recalibrate)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="text-xs opacity-90">
            Fuel at Trip Start (L)
            <input
              type="number"
              value={calibrationForm.startFuelL}
              onChange={(e) => setCalibrationForm((prev) => ({ ...prev, startFuelL: e.target.value }))}
              onBlur={() => {
                const n = Number(calibrationForm.startFuelL)
                onUpdateCalibration?.({ startFuelL: Number.isFinite(n) ? n : null })
              }}
              className="mt-1 w-full rounded border border-white/30 bg-white/10 px-2 py-1.5 text-white placeholder-white/50"
              placeholder="e.g. 2950"
            />
          </label>
          <label className="text-xs opacity-90">
            Engine Hours at Trip Start
            <input
              type="number"
              step="0.1"
              value={calibrationForm.startEngineHoursTotal}
              onChange={(e) => setCalibrationForm((prev) => ({ ...prev, startEngineHoursTotal: e.target.value }))}
              onBlur={() => {
                const n = Number(calibrationForm.startEngineHoursTotal)
                onUpdateCalibration?.({ startEngineHoursTotal: Number.isFinite(n) ? n : null })
              }}
              className="mt-1 w-full rounded border border-white/30 bg-white/10 px-2 py-1.5 text-white placeholder-white/50"
              placeholder="e.g. 1286.4"
            />
          </label>
        </div>
        <div className="mt-2 text-[11px] opacity-70">
          Set these from your gauges when you depart. Fuel and engine estimates use these values and remain synced through the trip.
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-white/10 p-3 border border-white/20 text-sm">
        <div className="text-xs uppercase tracking-wide opacity-60 mb-2">Engine RPM</div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setRpm((r) => Math.max(700, r - 50))}
            className="w-9 h-9 rounded-full bg-white/20 text-white font-bold text-lg flex items-center justify-center active:bg-white/40"
          >−</button>
          <div className="flex-1 text-center">
            <span className="text-2xl font-bold">{rpm}</span>
            <span className="text-sm opacity-70 ml-1">RPM</span>
            <div className="text-xs opacity-60">{rpmToSTW(rpm).toFixed(1)} kn calm-water STW</div>
          </div>
          <button
            type="button"
            onClick={() => setRpm((r) => Math.min(3000, r + 50))}
            className="w-9 h-9 rounded-full bg-white/20 text-white font-bold text-lg flex items-center justify-center active:bg-white/40"
          >+</button>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-white/10 p-3 border border-white/20 text-sm space-y-1">
        <div className="flex justify-between items-baseline">
          <span className="font-semibold">🎯 Predicted SOG</span>
          <span className="text-lg font-bold">{predictedSOG.toFixed(1)} kn</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="opacity-80">⚡ Actual SOG</span>
          <span className="font-semibold">{currentSog == null ? '—' : `${currentSog.toFixed(1)} kn`}</span>
        </div>
        {currentSog != null && (
          <div className="flex justify-between items-baseline border-t border-white/20 pt-1">
            <span className="opacity-80">Δ SOG</span>
            <span className={`font-semibold ${currentSog - predictedSOG > 0.5 ? 'text-green-300' : currentSog - predictedSOG < -0.5 ? 'text-red-300' : 'text-white'}`}>
              {currentSog - predictedSOG >= 0 ? '+' : ''}{(currentSog - predictedSOG).toFixed(1)} kn
            </span>
          </div>
        )}
        <div className="opacity-60 text-xs pt-0.5">STW {predictedSea.predictedSTW.toFixed(1)} kn · current {currentSnapshot.speedKn > 0 ? `${currentSnapshot.speedKn.toFixed(1)} kn @ ${Math.round(currentSnapshot.dirDeg)}°` : 'none'} · K={physicsK.toFixed(2)}</div>
        <div className="opacity-60 text-[11px]">
          Weather/current source: {weatherMeta.source}
          {weatherMeta.updatedAt ? ` · updated ${new Date(weatherMeta.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          {weatherMeta.error ? ` · ${weatherMeta.error}` : ''}
        </div>
      </div>

      {monthsSinceHaulout >= 3 && (
        <button
          type="button"
          onClick={() => onOpenSpeedSettings?.()}
          className="mt-3 w-full text-left rounded-lg bg-amber-50/20 border border-amber-300/40 p-3"
        >
          <div className="text-xs uppercase tracking-wide text-amber-200">Hull Status</div>
          <div className="text-sm font-semibold text-amber-100">
            {hullLabel.label} · {monthsSinceHaulout.toFixed(1)} months · -{fouling.penaltyPct}% speed / +{fouling.fuelIncreasePct}% fuel
          </div>
          <div className="text-xs text-amber-200 underline mt-0.5">Tap to open Speed Settings</div>
        </button>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap text-sm">
        <div>
          📍 Track: {trackPoints.length} points{' '}
          {isRecording ? <span className="inline-flex items-center gap-1"><span className="text-red-400 animate-pulse">●</span> recording</span> : 'stopped'}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setNightMode((v) => !v)}
            className="rounded-lg border border-white/40 px-3 py-1.5 text-xs"
          >
            🌙 Night
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/40 px-3 py-1.5 text-xs"
          >
            Hide
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-white/10 p-3 border border-white/20">
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
