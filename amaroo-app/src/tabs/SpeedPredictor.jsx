import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import CompassRose from '../components/CompassRose'
import {
  addSpeedLog,
  deleteSpeedLog,
  saveManualHullCleanDate,
  getSpeedLogs,
  getVesselSetting,
  seedSpeedLogsIfEmpty,
  upsertVesselSetting,
} from '../db/api'
import {
  computeCourseToSteer,
  computeCurrent,
  computeSeaImpactWithFouling,
  directionFactorFmin,
  fmt,
  linearRegression,
  relativeAngle,
} from '../utils/physics'
import { AMAROO, AMAROO_RPM_CURVE } from '../utils/vesselConstants'
import { foulingConditionLabel, foulingPenalty, foulingRecommendation } from '../utils/hullFouling'
import { fetchOceanCurrent, interpolateCurrent } from '../utils/oceanCurrent'

const PASSAGE_PLAN_KEY = 'amaroo_passage_plan_v2'
const SPEED_SUBTAB_KEY = 'amaroo_speed_subtab'

function card(extra = '') {
  return `rounded-xl bg-white p-4 shadow border border-teal-100 ${extra}`
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function toCardinal(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return '—'
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round((((Number(deg) % 360) + 360) % 360) / 22.5) % 16]
}

function bearingBetween(a, b) {
  if (!a || !b) return 0
  const lat1 = (num(a.lat) * Math.PI) / 180
  const lat2 = (num(b.lat) * Math.PI) / 180
  const dLon = ((num(b.lng) - num(a.lng)) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

function csvEscape(value) {
  const s = String(value ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function midpointOfWaypoints(waypoints) {
  if (!Array.isArray(waypoints) || !waypoints.length) return null
  const lat = waypoints.reduce((sum, wp) => sum + num(wp.lat), 0) / waypoints.length
  const lng = waypoints.reduce((sum, wp) => sum + num(wp.lng), 0) / waypoints.length
  return { lat, lng }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { timeout: 10000 },
    )
  })
}

export default function SpeedPredictor({ hullFouling, onHullFoulingUpdated }) {
  const [subTab, setSubTab] = useState('predictor')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('heading')
  const [lastAutofill, setLastAutofill] = useState('')
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState('')

  const [vessel, setVessel] = useState({ ...AMAROO })
  const [env, setEnv] = useState({
    heading: 135,
    desiredCOG: 135,
    waveFrom: 90,
    swellFrom: 90,
    hsWave: 2.3,
    hsSwell: 1.2,
    hsTotal: 2.6,
    tpWave: 6,
    tpSwell: 10,
    tpTotal: 8,
    currentSet: 180,
    currentKn: 1,
    heightMode: AMAROO.heightMode,
    combineMode: AMAROO.combineMode,
  })

  const [newEntry, setNewEntry] = useState({ tag: 'calm', rpm: 1550, stw: 8.0, sog: 8.0, notes: '' })
  const [customCleanDate, setCustomCleanDate] = useState('')
  const [curveAdj, setCurveAdj] = useState(() => {
    try { return JSON.parse(localStorage.getItem('amaroo_rpm_curve_adj') || '{}') } catch { return {} }
  })
  const [curveMode, setCurveMode] = useState('stw')
  const [chartFoulingMonths, setChartFoulingMonths] = useState(0)
  const [hoverRpm, setHoverRpm] = useState(null)

  const monthsSinceHaulout = Number(hullFouling?.monthsSinceHaulout || 0)
  const fouling = useMemo(() => foulingPenalty(monthsSinceHaulout), [monthsSinceHaulout])
  const foulingLabel = useMemo(() => foulingConditionLabel(monthsSinceHaulout), [monthsSinceHaulout])
  const foulingAdvice = useMemo(() => foulingRecommendation(monthsSinceHaulout), [monthsSinceHaulout])

  useEffect(() => {
    const forcedSubtab = localStorage.getItem(SPEED_SUBTAB_KEY)
    if (forcedSubtab) {
      setSubTab(forcedSubtab)
      localStorage.removeItem(SPEED_SUBTAB_KEY)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await seedSpeedLogsIfEmpty().catch(() => {})
        const [rows, kSetting, profileRaw] = await Promise.all([
          getSpeedLogs().catch(() => []),
          getVesselSetting('physics_k').catch(() => null),
          getVesselSetting('speed_vessel_profile').catch(() => null),
        ])
        if (cancelled) return
        const loadedK = kSetting != null ? Number.parseFloat(kSetting) : AMAROO.K
        const parsedProfile = profileRaw ? JSON.parse(profileRaw) : null
        setVessel((prev) => ({ ...prev, ...(parsedProfile || {}), K: Number.isFinite(loadedK) ? loadedK : prev.K }))
        setLogs(rows || [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const seaResult = useMemo(() => computeSeaImpactWithFouling(
    vessel.v0,
    vessel.loa,
    vessel.K,
    env.hsWave,
    env.hsSwell,
    env.hsTotal,
    env.heightMode,
    env.waveFrom,
    mode === 'heading' ? env.heading : env.desiredCOG,
    env.swellFrom,
    env.tpWave,
    env.tpSwell,
    env.tpTotal,
    vessel.fmin,
    env.combineMode,
    vessel.gR0,
    vessel.gSigma,
    vessel.gGmin,
    vessel.gGmax,
    monthsSinceHaulout,
  ), [env, mode, vessel, monthsSinceHaulout])

  const currentResult = useMemo(() => computeCurrent(
    seaResult.predictedSTW,
    env.heading,
    env.currentSet,
    env.currentKn,
  ), [seaResult, env])

  const ctsResult = useMemo(() => computeCourseToSteer(
    vessel.v0 * fouling.speedMultiplier,
    vessel.loa,
    vessel.K,
    env.hsWave,
    env.hsSwell,
    env.hsTotal,
    env.heightMode,
    env.waveFrom,
    env.desiredCOG,
    env.currentSet,
    env.currentKn,
    env.swellFrom,
    env.tpWave,
    env.tpSwell,
    env.tpTotal,
    vessel.fmin,
    env.combineMode,
    vessel.gR0,
    vessel.gSigma,
    vessel.gGmin,
    vessel.gGmax,
  ), [env, vessel, fouling.speedMultiplier])

  const calmLogs = useMemo(() => logs.filter((l) => l.tag === 'calm'), [logs])
  const seaLogs = useMemo(() => logs.filter((l) => l.tag === 'sea'), [logs])
  const regression = useMemo(() => (
    calmLogs.length >= 2
      ? linearRegression(calmLogs.map((l) => num(l.rpm)), calmLogs.map((l) => num(l.stw)))
      : null
  ), [calmLogs])

  const seaRows = useMemo(() => {
    return seaLogs.map((row) => {
      const expectedCalm = regression ? regression.a + regression.b * num(row.rpm) : null
      const speedLoss = expectedCalm != null ? Math.max(0, expectedCalm - num(row.stw)) : null
      const base = computeSeaImpactWithFouling(
        vessel.v0,
        vessel.loa,
        1,
        num(row.hs_wave_m, env.hsWave),
        num(row.hs_swell_m, env.hsSwell),
        num(row.hs_total_m, env.hsTotal),
        row.wave_mode || env.heightMode,
        num(row.wave_from_deg, env.waveFrom),
        num(row.heading_deg, env.heading),
        num(row.swell_from_deg, env.swellFrom),
        num(row.tp_wave_s, env.tpWave),
        num(row.tp_swell_s, env.tpSwell),
        num(row.tp_total_s, env.tpTotal),
        num(row.fmin_used, vessel.fmin),
        row.combine_mode || env.combineMode,
        num(row.g_r0, vessel.gR0),
        num(row.g_sigma, vessel.gSigma),
        num(row.g_gmin, vessel.gGmin),
        num(row.g_gmax, vessel.gGmax),
        monthsSinceHaulout,
      ).base
      const kEst = speedLoss != null && base > 0.0001 ? speedLoss / base : null
      return { ...row, expectedCalm, speedLoss, kEst }
    })
  }, [env, regression, seaLogs, vessel, monthsSinceHaulout])

  const kValues = useMemo(() => seaRows.map((row) => row.kEst).filter((k) => k != null && Number.isFinite(k)), [seaRows])
  const kMean = useMemo(() => (kValues.length ? kValues.reduce((sum, k) => sum + k, 0) / kValues.length : null), [kValues])

  async function setKAndPersist(newK) {
    const safeK = Number(newK)
    if (!Number.isFinite(safeK)) return
    setVessel((prev) => ({ ...prev, K: safeK }))
    await upsertVesselSetting('physics_k', String(safeK))
  }

  async function persistVesselProfile(next) {
    setVessel(next)
    await upsertVesselSetting('speed_vessel_profile', JSON.stringify(next))
  }

  function updateEnv(key, value) {
    setEnv((prev) => ({ ...prev, [key]: value }))
  }

  async function setHullCleanDate(dateString) {
    if (!dateString) return
    await saveManualHullCleanDate(dateString)
    await onHullFoulingUpdated?.()
  }

  async function markDiverCleanToday() {
    const today = new Date().toISOString().slice(0, 10)
    await setHullCleanDate(today)
    setCustomCleanDate('')
  }

  async function addEntry() {
    const payload = {
      tag: newEntry.tag,
      rpm: num(newEntry.rpm),
      stw: num(newEntry.stw),
      sog: num(newEntry.sog),
      notes: newEntry.notes || '',
      wave_mode: newEntry.tag === 'sea' ? env.heightMode : null,
      combine_mode: newEntry.tag === 'sea' ? env.combineMode : null,
      heading_deg: newEntry.tag === 'sea' ? (mode === 'heading' ? env.heading : ctsResult.heading) : null,
      wave_from_deg: newEntry.tag === 'sea' ? env.waveFrom : null,
      swell_from_deg: newEntry.tag === 'sea' ? env.swellFrom : null,
      hs_wave_m: newEntry.tag === 'sea' ? env.hsWave : null,
      hs_swell_m: newEntry.tag === 'sea' ? env.hsSwell : null,
      hs_total_m: newEntry.tag === 'sea' ? env.hsTotal : null,
      tp_wave_s: newEntry.tag === 'sea' ? env.tpWave : null,
      tp_swell_s: newEntry.tag === 'sea' ? env.tpSwell : null,
      tp_total_s: newEntry.tag === 'sea' ? env.tpTotal : null,
      fmin_used: newEntry.tag === 'sea' ? vessel.fmin : null,
      g_r0: newEntry.tag === 'sea' ? vessel.gR0 : null,
      g_sigma: newEntry.tag === 'sea' ? vessel.gSigma : null,
      g_gmin: newEntry.tag === 'sea' ? vessel.gGmin : null,
      g_gmax: newEntry.tag === 'sea' ? vessel.gGmax : null,
    }
    const inserted = await addSpeedLog(payload)
    setLogs((prev) => [inserted, ...prev])
    setNewEntry((prev) => ({ ...prev, notes: '' }))
  }

  async function removeEntry(id) {
    await deleteSpeedLog(id)
    setLogs((prev) => prev.filter((row) => row.id !== id))
  }

  function exportCsv() {
    const headers = ['tag', 'rpm', 'stw', 'sog', 'notes', 'created_at']
    const rows = logs.map((row) => headers.map((h) => csvEscape(row[h])).join(','))
    const csv = `${headers.join(',')}\n${rows.join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `amaroo-speed-logs-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function autofillFromPassagePlanner() {
    try {
      const raw = localStorage.getItem(PASSAGE_PLAN_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const weather = parsed?.weather
      if (!weather) return

      let heading = env.heading
      let note = 'Weather snapshot'
      const waypoints = parsed?.waypoints
      if (Array.isArray(waypoints) && waypoints.length > 1) {
        heading = Math.round(bearingBetween(waypoints[0], waypoints[1]))
        note = `Leg 1 heading ${heading}°T`
      }

      setEnv((prev) => ({
        ...prev,
        heading,
        desiredCOG: heading,
        waveFrom: num(weather.waveDirDeg, prev.waveFrom),
        swellFrom: num(weather.swellDirDeg, prev.swellFrom),
        hsWave: num(weather.waveHeightM, prev.hsWave),
        hsSwell: num(weather.swellHeightM, prev.hsSwell),
        tpWave: num(weather.wavePeriodS, prev.tpWave),
        tpSwell: num(weather.swellPeriodS, prev.tpSwell),
      }))

      let sourceCoords = null
      if (Array.isArray(waypoints) && waypoints.length > 1) {
        sourceCoords = midpointOfWaypoints(waypoints)
      } else {
        sourceCoords = await getCurrentPosition().catch(() => null)
      }

      // Use current already fetched by Passage Planner if available
      if (weather.currentAvailable && weather.currentSpeedKn != null && weather.currentDirDeg != null) {
        setEnv((prev) => ({
          ...prev,
          currentSet: num(weather.currentDirDeg, prev.currentSet),
          currentKn: num(weather.currentSpeedKn, prev.currentKn),
        }))
        const stamp = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
        setCurrentUpdatedAt(stamp)
      } else if (sourceCoords) {
        // Fall back to a live fetch if no current in snapshot
        const currentSeries = await fetchOceanCurrent(sourceCoords.lat, sourceCoords.lng, 6)
        const currentPoint = interpolateCurrent(currentSeries, Date.now())
        if (currentPoint) {
          setEnv((prev) => ({
            ...prev,
            currentSet: num(currentPoint.currentDirectionDeg, prev.currentSet),
            currentKn: num(currentPoint.currentSpeedKn, prev.currentKn),
          }))
          const stamp = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
          setCurrentUpdatedAt(stamp)
        }
      }

      setLastAutofill(note)
    } catch {
      setLastAutofill('Unable to read Passage Planner snapshot')
    }
  }

  if (loading) {
    return <div className={card()}>Loading speed tools...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'predictor', label: 'Predictor' },
          { id: 'logbook', label: 'Logbook' },
          { id: 'calibration', label: 'Calibration' },
          { id: 'settings', label: 'Settings' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`px-3 py-2 rounded-full text-sm ${subTab === tab.id ? 'bg-[#0A4A52] text-white' : 'bg-white border border-teal-200 text-[#0A4A52]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'predictor' && (
        <div className="space-y-4">
          <div className={card()}>
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => setMode('heading')} className={`px-3 py-2 rounded-lg text-sm ${mode === 'heading' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Know Heading</button>
              <button type="button" onClick={() => setMode('cts')} className={`px-3 py-2 rounded-lg text-sm ${mode === 'cts' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Course to Steer</button>
              <button type="button" onClick={autofillFromPassagePlanner} className="ml-auto px-3 py-2 rounded-lg text-sm bg-[#C4603A] text-white">Auto-fill from Passage Planner</button>
            </div>
            {lastAutofill && <div className="text-xs text-teal-700 mb-2">{lastAutofill}</div>}
            {currentUpdatedAt && <div className="text-xs text-teal-700 mb-2">Current from Stormglass — updated {currentUpdatedAt}</div>}

            <div className="grid md:grid-cols-2 gap-3">
              {mode === 'heading' ? (
                <label className="text-sm">Heading (deg true)
                  <input type="number" min="0" max="360" value={env.heading} onChange={(e) => updateEnv('heading', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                </label>
              ) : (
                <label className="text-sm">Desired COG (deg true)
                  <input type="number" min="0" max="360" value={env.desiredCOG} onChange={(e) => updateEnv('desiredCOG', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                </label>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => updateEnv('heightMode', 'partition')} className={`rounded-lg p-2 text-sm ${env.heightMode === 'partition' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Two partitions</button>
                <button type="button" onClick={() => updateEnv('heightMode', 'total')} className={`rounded-lg p-2 text-sm ${env.heightMode === 'total' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Total Hs</button>
              </div>

              {env.heightMode === 'partition' ? (
                <>
                  <label className="text-sm">Wave Hs (m)
                    <input type="number" step="0.1" value={env.hsWave} onChange={(e) => updateEnv('hsWave', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-sm">Wave from (deg)
                    <input type="number" step="1" value={env.waveFrom} onChange={(e) => updateEnv('waveFrom', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-sm">Wave Tp (s)
                    <input type="number" step="0.1" value={env.tpWave} onChange={(e) => updateEnv('tpWave', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-sm">Swell Hs (m)
                    <input type="number" step="0.1" value={env.hsSwell} onChange={(e) => updateEnv('hsSwell', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-sm">Swell from (deg)
                    <input type="number" step="1" value={env.swellFrom} onChange={(e) => updateEnv('swellFrom', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-sm">Swell Tp (s)
                    <input type="number" step="0.1" value={env.tpSwell} onChange={(e) => updateEnv('tpSwell', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                </>
              ) : (
                <>
                  <label className="text-sm">Total Hs (m)
                    <input type="number" step="0.1" value={env.hsTotal} onChange={(e) => updateEnv('hsTotal', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-sm">Wave from (deg)
                    <input type="number" step="1" value={env.waveFrom} onChange={(e) => updateEnv('waveFrom', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-sm">Total Tp (s)
                    <input type="number" step="0.1" value={env.tpTotal} onChange={(e) => updateEnv('tpTotal', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
                  </label>
                </>
              )}

              <div className="grid grid-cols-2 gap-2 md:col-span-2">
                <button type="button" onClick={() => updateEnv('combineMode', 'sum')} className={`rounded-lg p-2 text-sm ${env.combineMode === 'sum' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Sum</button>
                <button type="button" onClick={() => updateEnv('combineMode', 'energyWeighted')} className={`rounded-lg p-2 text-sm ${env.combineMode === 'energyWeighted' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Energy-weighted</button>
              </div>

              <label className="text-sm">Current set (deg true)
                <input type="number" value={env.currentSet} onChange={(e) => updateEnv('currentSet', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-sm">Current speed (kn)
                <input type="number" step="0.1" value={env.currentKn} onChange={(e) => updateEnv('currentKn', num(e.target.value, 0))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
              </label>
            </div>
          </div>

          <div className={card()}>
            {mode === 'heading' ? (
              <>
                <div className="font-semibold text-[#0A4A52] mb-2">Sea State Impact</div>
                <div className="text-sm space-y-1">
                  <div>Hs_eff: {fmt(seaResult.hsEff)}m | θ: {fmt(seaResult.theta, 1)}° | F(θ): {fmt(seaResult.F, 3)}</div>
                  <div>λ wave: {fmt(seaResult.lambdaWave, 1)}m | λ/L: {fmt(vessel.loa > 0 ? seaResult.lambdaWave / vessel.loa : 0, 2)}</div>
                  <div>λ swell: {fmt(seaResult.lambdaSwell, 1)}m | λ/L: {fmt(vessel.loa > 0 ? seaResult.lambdaSwell / vessel.loa : 0, 2)}</div>
                  <div className="pt-2">Penalty: {fmt(seaResult.penalty)} kn</div>
                  <div>STW: {fmt(seaResult.predictedSTW)} kn</div>
                  <div>Hull fouling: {foulingLabel.label} ({monthsSinceHaulout.toFixed(1)} mo) | -{fouling.penaltyPct}% speed</div>
                  <div className="pt-2">With current:</div>
                  <div>SOG: {fmt(currentResult.sog)} kn</div>
                  <div>COG: {fmt(currentResult.cog, 1)}° ({toCardinal(currentResult.cog)})</div>
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold text-[#0A4A52] mb-2">Course to Steer</div>
                <div className="text-sm space-y-1">
                  <div>Desired COG: {fmt(env.desiredCOG, 1)}°</div>
                  <div>Steer: {ctsResult.feasible ? fmt(ctsResult.heading, 1) : '—'}° ({ctsResult.feasible ? `${fmt(Math.abs(ctsResult.ferryAngle), 1)}° ${ctsResult.ferryAngle < 0 ? 'left' : 'right'} of track` : 'n/a'})</div>
                  <div>STW: {fmt(ctsResult.stw)} kn</div>
                  <div>SOG: {fmt(ctsResult.sog)} kn along track</div>
                  <div>{ctsResult.feasible ? 'Feasible' : '⚠ Current cross-track component exceeds STW — vessel cannot maintain this COG'}</div>
                </div>
              </>
            )}
          </div>

          <div className={card()}>
            <CompassRose
              heading={mode === 'heading' ? env.heading : (ctsResult.feasible ? ctsResult.heading : env.desiredCOG)}
              cog={mode === 'heading' ? currentResult.cog : env.desiredCOG}
              sog={mode === 'heading' ? currentResult.sog : ctsResult.sog}
              waveFrom={env.waveFrom}
              hsEff={seaResult.hsEff}
              swellFrom={env.swellFrom}
              hsSwell={env.hsSwell}
              showSwell={env.heightMode === 'partition'}
              currentSet={env.currentSet}
              currentKn={env.currentKn}
              seaPenalty={mode === 'heading' ? seaResult.penalty : ctsResult.seaPenalty}
              ctsMode={mode === 'cts'}
              desiredCOG={env.desiredCOG}
            />
          </div>
        </div>
      )}

      {subTab === 'logbook' && (
        <div className="space-y-4">

          {/* ── RPM vs Speed / Fuel Curve ──────────────────────────── */}
          {(() => {
            // Fuel law: Cummins QSB 6.7 twin, prop-cube law anchored at user data
            // 1550 RPM = 21 L/hr combined (clean hull, calm water, both engines)
            const ANCHOR_RPM = 1550
            const ANCHOR_LPH = 21
            // Exponent 3.4 fitted to match: 1550 RPM = 21 L/hr AND 3000 RPM ≈ 195 L/hr (WOT, user-confirmed)
            function rpmToLPH(rpm) {
              return ANCHOR_LPH * Math.pow(rpm / ANCHOR_RPM, 3.4)
            }

            // Build adjusted STW curve points
            const adjCurve = AMAROO_RPM_CURVE.map((pt) => ({
              rpm: pt.rpm,
              stwKn: Math.max(0, pt.stwKn + (curveAdj[pt.rpm] || 0)),
              lph: rpmToLPH(pt.rpm),
            }))

            // Local linear interpolator for adjusted STW curve
            function interpAdj(curve, rpm) {
              if (rpm <= curve[0].rpm) return curve[0].stwKn
              if (rpm >= curve[curve.length - 1].rpm) return curve[curve.length - 1].stwKn
              for (let i = 1; i < curve.length; i++) {
                if (rpm <= curve[i].rpm) {
                  const lo = curve[i - 1]; const hi = curve[i]
                  const f = (rpm - lo.rpm) / (hi.rpm - lo.rpm)
                  return lo.stwKn + f * (hi.stwKn - lo.stwKn)
                }
              }
              return curve[curve.length - 1].stwKn
            }

            // Chart layout
            const SVG_W = 560; const SVG_H = 270
            const PAD_L = 46; const PAD_R = 16; const PAD_T = 16; const PAD_B = 36
            const CW = SVG_W - PAD_L - PAD_R; const CH = SVG_H - PAD_T - PAD_B
            const RPM_MIN = 700; const RPM_MAX = 3000
            const fp = foulingPenalty(chartFoulingMonths)

            // Mode-dependent Y axis
            const isLPH = curveMode === 'lph'
            const Y_MAX = isLPH ? 220 : 22
            const yTicks = isLPH ? [25, 50, 75, 100, 125, 150, 175, 200] : [4, 8, 12, 16, 20]
            const yLabel = isLPH ? 'L/hr (both engines)' : 'STW (kn)'

            function xOf(rpm) { return PAD_L + ((rpm - RPM_MIN) / (RPM_MAX - RPM_MIN)) * CW }
            function yOf(val) { return PAD_T + CH - (Math.max(0, val) / Y_MAX) * CH }

            const steps = []
            for (let r = RPM_MIN; r <= RPM_MAX; r += 25) steps.push(r)

            // Clean curve
            const cleanPts = steps.map((r) => {
              const v = isLPH ? rpmToLPH(r) : interpAdj(adjCurve, r)
              return `${xOf(r).toFixed(1)},${yOf(v).toFixed(1)}`
            }).join(' ')

            // Fouled curve — speed drops, but fuel stays same (hull drag = same fuel for less speed)
            const fouledPts = steps.map((r) => {
              const v = isLPH
                ? rpmToLPH(r) * fp.fuelMultiplier   // more fuel for same RPM due to hull drag
                : interpAdj(adjCurve, r) * fp.speedMultiplier
              return `${xOf(r).toFixed(1)},${yOf(v).toFixed(1)}`
            }).join(' ')

            const xTicks = [700, 1100, 1550, 2000, 2500, 3000]

            // Logbook dots (STW mode only)
            const calmDots = logs.filter((l) => l.tag === 'calm' && l.rpm && l.stw)
            const seaDots  = logs.filter((l) => l.tag === 'sea'  && l.rpm && l.stw)

            function updateAdj(rpm, delta) {
              setCurveAdj((prev) => {
                const next = { ...prev, [rpm]: parseFloat(delta) }
                try { localStorage.setItem('amaroo_rpm_curve_adj', JSON.stringify(next)) } catch { /* ignore */ }
                return next
              })
            }

            return (
              <div className={card()}>
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-[#0A4A52]">RPM Curve</div>
                  {/* Mode toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-[#0A4A52] text-sm">
                    {[{ id: 'stw', label: 'Speed (kn)' }, { id: 'lph', label: 'Fuel (L/hr)' }].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setCurveMode(m.id)}
                        className={`px-3 py-1.5 ${curveMode === m.id ? 'bg-[#0A4A52] text-white' : 'text-[#0A4A52]'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fouling slider */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-sm text-slate-600 whitespace-nowrap">Hull age:</span>
                  <input
                    type="range" min="0" max="36" step="1" value={chartFoulingMonths}
                    onChange={(e) => setChartFoulingMonths(Number(e.target.value))}
                    className="flex-1 accent-[#C4603A]"
                  />
                  <span className="text-sm font-semibold text-[#C4603A] w-28 text-right">
                    {chartFoulingMonths} mo
                    {isLPH ? ` · +${Math.round((fp.fuelMultiplier - 1) * 100)}% fuel` : ` · -${Math.round((1 - fp.speedMultiplier) * 100)}% speed`}
                  </span>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-4 mb-2 text-xs">
                  <span className="flex items-center gap-1">
                    <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#0A4A52" strokeWidth="2.5"/></svg>
                    {isLPH ? 'Clean hull L/hr' : 'Clean hull STW'}
                  </span>
                  <span className="flex items-center gap-1">
                    <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#C4603A" strokeWidth="2" strokeDasharray="4 2"/></svg>
                    {isLPH ? `Fouled L/hr (${chartFoulingMonths} mo)` : `Fouled speed (${chartFoulingMonths} mo)`}
                  </span>
                  {!isLPH && <span className="flex items-center gap-1"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#0A4A52" opacity="0.8"/></svg>Calm log</span>}
                  {!isLPH && <span className="flex items-center gap-1"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#C4603A" opacity="0.8"/></svg>Sea log</span>}
                  {isLPH && <span className="text-slate-400">Cummins QSB 6.7 twin · fitted to 1550 RPM = 21 L/hr &amp; 3000 RPM ≈ 195 L/hr</span>}
                </div>

                {/* SVG Chart */}
                <svg
                  viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                  className="w-full border border-slate-100 rounded-lg bg-slate-50"
                  style={{ cursor: 'crosshair' }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const scaleX = SVG_W / rect.width
                    const svgX = (e.clientX - rect.left) * scaleX
                    const rpm = Math.round(RPM_MIN + ((svgX - PAD_L) / CW) * (RPM_MAX - RPM_MIN))
                    setHoverRpm(Math.max(RPM_MIN, Math.min(RPM_MAX, rpm)))
                  }}
                  onMouseLeave={() => setHoverRpm(null)}
                >
                  {yTicks.map((v) => (
                    <g key={v}>
                      <line x1={PAD_L} y1={yOf(v)} x2={SVG_W - PAD_R} y2={yOf(v)} stroke="#e2e8f0" strokeWidth="1"/>
                      <text x={PAD_L - 4} y={yOf(v) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
                    </g>
                  ))}
                  {xTicks.map((rpm) => (
                    <g key={rpm}>
                      <line x1={xOf(rpm)} y1={PAD_T} x2={xOf(rpm)} y2={PAD_T + CH} stroke="#e2e8f0" strokeWidth="1"/>
                      <text x={xOf(rpm)} y={SVG_H - PAD_B + 14} textAnchor="middle" fontSize="9" fill="#94a3b8">{rpm}</text>
                    </g>
                  ))}
                  <text x={PAD_L + CW / 2} y={SVG_H - 2} textAnchor="middle" fontSize="10" fill="#64748b">RPM</text>
                  <text x={10} y={PAD_T + CH / 2} textAnchor="middle" fontSize="10" fill="#64748b" transform={`rotate(-90, 10, ${PAD_T + CH / 2})`}>{yLabel}</text>
                  {/* Fouled curve */}
                  <polyline points={fouledPts} fill="none" stroke="#C4603A" strokeWidth="2" strokeDasharray="5 3" opacity="0.9"/>
                  {/* Clean curve */}
                  <polyline points={cleanPts} fill="none" stroke="#0A4A52" strokeWidth="2.5"/>
                  {/* Curve control dots (STW mode only) */}
                  {!isLPH && adjCurve.map((pt) => (
                    <circle key={pt.rpm} cx={xOf(pt.rpm)} cy={yOf(pt.stwKn)} r="4" fill="#0A4A52" stroke="white" strokeWidth="1.5"/>
                  ))}
                  {/* LPH mode: anchor dot */}
                  {isLPH && (
                    <circle cx={xOf(ANCHOR_RPM)} cy={yOf(ANCHOR_LPH)} r="5" fill="#0A4A52" stroke="white" strokeWidth="1.5">
                      <title>1550 RPM = 21 L/hr (user-confirmed)</title>
                    </circle>
                  )}
                  {/* Logbook dots (STW mode) */}
                  {!isLPH && calmDots.map((l) => (
                    <circle key={l.id} cx={xOf(l.rpm)} cy={yOf(l.stw)} r="5" fill="#0A4A52" opacity="0.75" stroke="white" strokeWidth="1">
                      <title>{l.rpm} RPM → {l.stw} kn</title>
                    </circle>
                  ))}
                  {!isLPH && seaDots.map((l) => (
                    <circle key={l.id} cx={xOf(l.rpm)} cy={yOf(l.stw)} r="5" fill="#C4603A" opacity="0.75" stroke="white" strokeWidth="1">
                      <title>{l.rpm} RPM → {l.stw} kn (sea)</title>
                    </circle>
                  ))}
                  {/* LPH mode: reference table labels at key RPMs */}
                  {isLPH && [1100, 1550, 2000, 2700, 3000].map((r) => {
                    const lph = rpmToLPH(r)
                    return (
                      <text key={r} x={xOf(r)} y={yOf(lph) - 8} textAnchor="middle" fontSize="9" fill="#0A4A52" fontWeight="600">
                        {lph.toFixed(0)}
                      </text>
                    )
                  })}
                  {/* Hover crosshair */}
                  {hoverRpm != null && (() => {
                    const hx = xOf(hoverRpm)
                    const cleanVal = isLPH ? rpmToLPH(hoverRpm) : interpAdj(adjCurve, hoverRpm)
                    const fouledVal = isLPH ? rpmToLPH(hoverRpm) * fp.fuelMultiplier : interpAdj(adjCurve, hoverRpm) * fp.speedMultiplier
                    const hClean = yOf(cleanVal)
                    const hFouled = yOf(fouledVal)
                    const unit = isLPH ? 'L/hr' : 'kn'
                    // Position tooltip: flip to left if too close to right edge
                    const tooltipX = hx + 8 > SVG_W - 120 ? hx - 120 : hx + 8
                    return (
                      <g>
                        {/* Vertical crosshair line */}
                        <line x1={hx} y1={PAD_T} x2={hx} y2={PAD_T + CH} stroke="#64748b" strokeWidth="1" strokeDasharray="3 2" opacity="0.7"/>
                        {/* Clean value dot */}
                        <circle cx={hx} cy={hClean} r="4" fill="#0A4A52" stroke="white" strokeWidth="1.5"/>
                        {/* Fouled value dot */}
                        <circle cx={hx} cy={hFouled} r="4" fill="#C4603A" stroke="white" strokeWidth="1.5"/>
                        {/* Tooltip box */}
                        <rect x={tooltipX} y={PAD_T + 4} width="112" height={chartFoulingMonths > 0 ? 52 : 38} rx="4" fill="white" stroke="#e2e8f0" strokeWidth="1" opacity="0.95"/>
                        <text x={tooltipX + 8} y={PAD_T + 18} fontSize="10" fontWeight="600" fill="#0A4A52">{hoverRpm} RPM</text>
                        <text x={tooltipX + 8} y={PAD_T + 32} fontSize="10" fill="#0A4A52">Clean: {cleanVal.toFixed(isLPH ? 1 : 2)} {unit}</text>
                        {chartFoulingMonths > 0 && (
                          <text x={tooltipX + 8} y={PAD_T + 46} fontSize="10" fill="#C4603A">Fouled: {fouledVal.toFixed(isLPH ? 1 : 2)} {unit}</text>
                        )}
                      </g>
                    )
                  })()}
                </svg>

                {/* LPH reference table */}
                {isLPH && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs text-center">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="p-1.5 text-slate-500">RPM</th>
                          {adjCurve.map((pt) => <th key={pt.rpm} className="p-1.5 text-slate-500">{pt.rpm}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="p-1.5 font-medium text-[#0A4A52]">Clean L/hr</td>
                          {adjCurve.map((pt) => <td key={pt.rpm} className="p-1.5">{rpmToLPH(pt.rpm).toFixed(1)}</td>)}
                        </tr>
                        <tr className="text-[#C4603A]">
                          <td className="p-1.5 font-medium">Fouled L/hr</td>
                          {adjCurve.map((pt) => <td key={pt.rpm} className="p-1.5">{(rpmToLPH(pt.rpm) * fp.fuelMultiplier).toFixed(1)}</td>)}
                        </tr>
                        <tr className="text-slate-500">
                          <td className="p-1.5 font-medium">STW (kn)</td>
                          {adjCurve.map((pt) => <td key={pt.rpm} className="p-1.5">{pt.stwKn.toFixed(1)}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Per-point sliders (STW mode only) */}
                {!isLPH && (
                  <div className="mt-4">
                    <div className="text-xs text-slate-500 mb-2">Drag sliders to adjust each RPM point's clean-hull STW:</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {adjCurve.map((pt) => (
                        <div key={pt.rpm} className="flex items-center gap-2">
                          <span className="text-xs font-mono w-16 text-[#0A4A52]">{pt.rpm} RPM</span>
                          <input
                            type="range" min="-2" max="2" step="0.05"
                            value={curveAdj[pt.rpm] || 0}
                            onChange={(e) => updateAdj(pt.rpm, e.target.value)}
                            className="flex-1 accent-[#0A4A52]"
                          />
                          <span className="text-xs font-semibold text-[#0A4A52] w-12 text-right">{pt.stwKn.toFixed(2)} kn</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setCurveAdj({}); localStorage.removeItem('amaroo_rpm_curve_adj') }}
                      className="mt-3 text-xs text-slate-500 underline"
                    >
                      Reset all adjustments
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          <div className={card()}>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1">Tag</div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setNewEntry((e) => ({ ...e, tag: 'calm' }))} className={`px-3 py-2 rounded-lg text-sm ${newEntry.tag === 'calm' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Calm</button>
                  <button type="button" onClick={() => setNewEntry((e) => ({ ...e, tag: 'sea' }))} className={`px-3 py-2 rounded-lg text-sm ${newEntry.tag === 'sea' ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`}>Sea</button>
                </div>
              </div>
              <label className="text-sm">RPM
                <input type="number" value={newEntry.rpm} onChange={(e) => setNewEntry((prev) => ({ ...prev, rpm: num(e.target.value, 0) }))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-sm">STW (kn)
                <input type="number" step="0.1" value={newEntry.stw} onChange={(e) => setNewEntry((prev) => ({ ...prev, stw: num(e.target.value, 0) }))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-sm">SOG (kn)
                <input type="number" step="0.1" value={newEntry.sog} onChange={(e) => setNewEntry((prev) => ({ ...prev, sog: num(e.target.value, 0) }))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-sm md:col-span-2">Notes
                <input type="text" value={newEntry.notes} onChange={(e) => setNewEntry((prev) => ({ ...prev, notes: e.target.value }))} className="w-full mt-1 rounded-lg border border-slate-300 p-2" />
              </label>
              {newEntry.tag === 'sea' && (
                <div className="md:col-span-2 text-xs text-teal-700 bg-teal-50 rounded-lg p-2 border border-teal-200">
                  Sea snapshot will be saved from current Predictor inputs.
                </div>
              )}
              <button type="button" onClick={addEntry} className="md:col-span-2 rounded-lg bg-[#C4603A] text-white px-4 py-2">Add Entry</button>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={exportCsv} className="rounded-lg border border-[#0A4A52] text-[#0A4A52] px-3 py-2 text-sm">Export CSV</button>
          </div>

          <div className={card('p-0 overflow-hidden')}>
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left p-2">Tag</th>
                  <th className="text-right p-2">RPM</th>
                  <th className="text-right p-2">STW</th>
                  <th className="text-right p-2">SOG</th>
                  <th className="text-left p-2">Notes</th>
                  <th className="text-right p-2">Date</th>
                  <th className="text-right p-2">Delete</th>
                </tr>
              </thead>
              <tbody>
                {!logs.length && (
                  <tr><td className="p-4 text-center text-slate-500" colSpan={7}>No speed log entries yet.</td></tr>
                )}
                {logs.map((row) => (
                  <tr key={row.id} className={row.tag === 'sea' ? 'bg-teal-50/60 border-t border-teal-100' : 'bg-white border-t border-slate-100'}>
                    <td className="p-2">{row.tag}</td>
                    <td className="p-2 text-right">{row.rpm}</td>
                    <td className="p-2 text-right">{row.stw}</td>
                    <td className="p-2 text-right">{row.sog}</td>
                    <td className="p-2">{row.notes}</td>
                    <td className="p-2 text-right">{new Date(row.created_at || row.timestamp || Date.now()).toLocaleDateString('en-AU')}</td>
                    <td className="p-2 text-right">
                      <button type="button" onClick={() => removeEntry(row.id)} className="text-[#C4603A]"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'calibration' && (
        <div className="space-y-4">
          <div className={card()}>
            <div className="font-semibold text-[#0A4A52] mb-2">Hull fouling adjustment note</div>
            <div className="text-sm text-slate-600">
              Sea-state estimates are adjusted for current hull condition. Present estimate: <span className="font-semibold text-[#0A4A52]">{foulingLabel.label}</span> ({monthsSinceHaulout.toFixed(1)} months).
            </div>
          </div>

          <div className={card()}>
            <div className="font-semibold text-[#0A4A52] mb-2">Calm-water fit</div>
            {regression ? (
              <div className="text-sm space-y-1">
                <div>STW = {fmt(regression.a, 4)} + {fmt(regression.b, 6)} × RPM</div>
                <div>R² = {fmt(regression.r2, 4)}</div>
                <div className="text-slate-600">Based on {calmLogs.length} calm-water log entries.</div>
                <div className="pt-2 text-slate-700">Fouling-adjusted baseline @1550 rpm: {fmt((regression.a + regression.b * 1550) * fouling.speedMultiplier)} kn (clean fit {fmt(regression.a + regression.b * 1550)} kn)</div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">Add at least 2 calm-water log entries to fit the curve.</div>
            )}
          </div>

          <div className={card()}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-[#0A4A52]">Sea log K estimates</div>
              {kMean != null && (
                <button type="button" onClick={() => setKAndPersist(Number(kMean.toFixed(4)))} className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5 text-sm">Use K̄ ({fmt(kMean, 4)})</button>
              )}
            </div>
            {!seaRows.length ? (
              <div className="text-sm text-slate-600">No sea log entries yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-600">
                  <tr>
                    <th className="text-right p-1">RPM</th>
                    <th className="text-right p-1">STW</th>
                    <th className="text-right p-1">Expected calm</th>
                    <th className="text-right p-1">Loss</th>
                    <th className="text-right p-1">K est</th>
                  </tr>
                </thead>
                <tbody>
                  {seaRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="text-right p-1">{row.rpm}</td>
                      <td className="text-right p-1">{fmt(row.stw)}</td>
                      <td className="text-right p-1">{fmt(row.expectedCalm)}</td>
                      <td className="text-right p-1">{fmt(row.speedLoss)}</td>
                      <td className="text-right p-1 text-[#0A4A52] font-semibold">{fmt(row.kEst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className={card()}>
            <div className="font-semibold text-[#0A4A52] mb-2">Manual K override</div>
            <div className="text-sm text-slate-600 mb-2">Active K coefficient: {fmt(vessel.K, 4)}</div>
            <input
              type="number"
              step="0.0001"
              value={vessel.K}
              onChange={(e) => setKAndPersist(num(e.target.value, vessel.K))}
              className="w-full rounded-lg border border-slate-300 p-2"
            />
          </div>
        </div>
      )}

      {subTab === 'settings' && (
        <div className="space-y-4">
          <div className={card()}>
            <div className="font-semibold text-[#0A4A52] mb-2">Vessel parameters</div>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                ['loa', 'LOA (m)'],
                ['beam', 'Beam (m)'],
                ['draft', 'Draft (m)'],
                ['displacement', 'Displacement (t)'],
                ['v0', 'Baseline v0 (kn)'],
                ['rpm0', 'Baseline rpm0'],
                ['fuelBurnLhr', 'Fuel L/hr (combined)'],
              ].map(([key, label]) => (
                <label key={key} className="text-sm">{label}
                  <input
                    type="number"
                    step="0.01"
                    value={vessel[key]}
                    onChange={(e) => persistVesselProfile({ ...vessel, [key]: num(e.target.value, vessel[key]) })}
                    className="w-full mt-1 rounded-lg border border-slate-300 p-2"
                  />
                </label>
              ))}
              <label className="text-sm flex items-center gap-2 mt-6">
                <input type="checkbox" checked={Boolean(vessel.stabilisers)} onChange={(e) => persistVesselProfile({ ...vessel, stabilisers: e.target.checked })} />
                Stabilisers fitted
              </label>
            </div>
          </div>

          <div className={card()}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="font-semibold text-[#0A4A52]">Hull condition</div>
              <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: `${foulingLabel.colour}22`, color: foulingLabel.colour }}>
                {foulingLabel.label}
              </span>
            </div>

            {hullFouling?.lastCleanDate ? (
              <div className="text-sm text-slate-600 mb-3">
                Last clean: {new Date(hullFouling.lastCleanDate).toLocaleDateString('en-AU')} ({hullFouling.source || 'Unknown source'})
              </div>
            ) : (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                No hull clean baseline date set. Add one to enable realistic speed/fuel correction.
              </div>
            )}

            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <span>{monthsSinceHaulout.toFixed(1)} months since clean</span>
              <span>-{fouling.penaltyPct}% speed · +{fouling.fuelIncreasePct}% fuel</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden mb-3">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (monthsSinceHaulout / 12) * 100)}%`, backgroundColor: foulingLabel.colour }} />
            </div>

            <div className="text-sm text-slate-700 mb-3">
              @1550 rpm clean: {fmt(vessel.v0)} kn · current: {fmt(vessel.v0 * fouling.speedMultiplier)} kn
            </div>
            <div className="text-sm text-slate-700 mb-3">
              Fuel estimate clean: {fmt(vessel.fuelBurnLhr)} L/hr · current: {fmt(vessel.fuelBurnLhr * fouling.fuelMultiplier)} L/hr
            </div>

            {foulingAdvice && <div className="text-sm text-[#C4603A] mb-3">{foulingAdvice}</div>}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={markDiverCleanToday} className="rounded-lg bg-[#0A4A52] text-white px-3 py-2 text-sm">
                Mark Diver Clean Done Today
              </button>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customCleanDate}
                  onChange={(e) => setCustomCleanDate(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={!customCleanDate}
                  onClick={() => setHullCleanDate(customCleanDate)}
                  className="rounded-lg border border-[#0A4A52] text-[#0A4A52] px-3 py-2 text-sm disabled:opacity-50"
                >
                  Set Custom Clean Date
                </button>
              </div>
            </div>
          </div>

          <details className={card()}>
            <summary className="cursor-pointer font-semibold text-[#0A4A52]">Advanced physics parameters</summary>
            <p className="text-xs text-slate-600 mt-2 mb-3">These advanced parameters control the hull resonance model. Leave at defaults unless you have calibrated values for your specific vessel.</p>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                ['fmin', 'fmin (0..0.35)', 0.01],
                ['gR0', 'gR0', 0.01],
                ['gSigma', 'gSigma', 0.01],
                ['gGmin', 'gGmin', 0.01],
                ['gGmax', 'gGmax', 0.01],
              ].map(([key, label, step]) => (
                <label key={key} className="text-sm">{label}
                  <input
                    type="number"
                    step={step}
                    value={vessel[key]}
                    onChange={(e) => persistVesselProfile({ ...vessel, [key]: num(e.target.value, vessel[key]) })}
                    className="w-full mt-1 rounded-lg border border-slate-300 p-2"
                  />
                </label>
              ))}
            </div>
          </details>
        </div>
      )}

      <div className="hidden">
        {directionFactorFmin(relativeAngle(env.waveFrom, env.heading), vessel.fmin)}
      </div>
    </div>
  )
}
