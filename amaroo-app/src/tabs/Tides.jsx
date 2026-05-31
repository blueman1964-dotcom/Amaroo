import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import {
  getAllStationsWithDistance,
  getCurrentTideHeight,
  getMinDepthOverPeriod,
  getNextHighTides,
  getNextLowTides,
  getNextTides,
  getTideCurvePoints,
  getTidesForDate,
  getTidesForRange,
  SECONDARY_PORTS,
  STANDARD_PORTS,
  toAESTDateStr,
  timeToMinutes,
} from '../utils/tideCalculator'
import { db } from '../db/api'

// Home berth fallback coordinates
const HOME_LAT = -27.524
const HOME_LNG = 153.430
const DEFAULT_KEEL = 1.65

// ── Utilities ────────────────────────────────────────────────────────────────

function nowAEST() {
  return new Date()
}

function toAESTDate(date) {
  return toAESTDateStr(date)
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  const ny = dt.getUTCFullYear()
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const nd = String(dt.getUTCDate()).padStart(2, '0')
  return `${ny}-${nm}-${nd}`
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function formatDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' })
}

function minutesUntil(dateStr, timeStr) {
  const now = nowAEST()
  const todayStr = toAESTDate(now)
  const nowMins = (((now.getTime() + 10 * 3600 * 1000) % (24 * 3600 * 1000)) + (24 * 3600 * 1000)) % (24 * 3600 * 1000) / 60000

  const [y, m, d] = dateStr.split('-').map(Number)
  const [ty, tm, td] = todayStr.split('-').map(Number)
  const dayDiff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / (24 * 3600 * 1000))
  return dayDiff * 1440 + timeToMinutes(timeStr) - nowMins
}

function fmtCountdown(mins) {
  if (Math.abs(mins) < 2) return '▶ Now'
  const absM = Math.abs(Math.round(mins))
  const h = Math.floor(absM / 60)
  const m = absM % 60
  const str = h > 0 ? `${h}h ${m}m` : `${m}m`
  return mins > 0 ? `in ${str}` : `${str} ago`
}

function fmtTimeAgo(mins) {
  if (Math.abs(mins) < 2) return '▶ Now'
  const absM = Math.abs(Math.round(mins))
  const h = Math.floor(absM / 60)
  const m = absM % 60
  const str = h > 0 ? `${h}h ${m}m` : `${m}m`
  return mins > 0 ? `in ${str}` : `${str} ago`
}

function getStationName(stationId) {
  if (STANDARD_PORTS[stationId]) return STANDARD_PORTS[stationId].name
  const sec = SECONDARY_PORTS.find((p) => p.id === stationId)
  return sec?.name ?? stationId
}

function getStationPortType(stationId) {
  return STANDARD_PORTS[stationId] ? 'Standard Port' : 'Secondary Port'
}

// ── Tide Gauge SVG ────────────────────────────────────────────────────────────

function TideGauge({ current, min, max }) {
  if (current === null || max === min) return null
  const pct = Math.min(1, Math.max(0, (current - min) / (max - min)))
  return (
    <div className="flex items-center gap-3">
      <svg width="100%" height="18" viewBox="0 0 200 18" className="flex-1 max-w-[220px]">
        <rect x="0" y="3" width="200" height="12" rx="6" fill="#D1E8ED" />
        <rect
          x="0"
          y="3"
          width={pct * 200}
          height="12"
          rx="6"
          fill="#0A4A52"
          style={{ transition: 'width 1s ease' }}
        />
      </svg>
      <span className="text-2xl font-bold text-[#0A4A52] tabular-nums">{current.toFixed(2)}m</span>
    </div>
  )
}

// ── Station Selector ──────────────────────────────────────────────────────────

function StationSelector({ stationId, onSelect, userLat, userLng, gpsSource }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const allStations = useMemo(
    () => getAllStationsWithDistance(userLat, userLng),
    [userLat, userLng],
  )

  const filtered = useMemo(() => {
    if (!search.trim()) return allStations
    const q = search.toLowerCase()
    return allStations.filter((s) => s.name.toLowerCase().includes(q))
  }, [allStations, search])

  // Group: standard ports first, then secondary under their standard port
  const groups = useMemo(() => {
    const standards = filtered.filter((s) => s.type === 'standard')
    const grouped = {}
    for (const s of standards) grouped[s.id] = { station: s, secondaries: [] }

    for (const s of filtered) {
      if (s.type === 'secondary' && grouped[s.standardPort]) {
        grouped[s.standardPort].secondaries.push(s)
      }
    }

    return Object.values(grouped)
  }, [filtered])

  const selectedName = getStationName(stationId)

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-[#0A4A52]/10 rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 mb-0.5">{gpsSource === 'gps' ? '📡 GPS detected' : '🏠 Home berth'}</div>
          <div className="font-semibold text-[#0A4A52]">{selectedName}</div>
          <div className="text-xs text-slate-500">{getStationPortType(stationId)}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="px-3 py-2 rounded-xl bg-[#0A4A52] text-white text-sm font-medium"
        >
          Change
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-teal-200 rounded-xl shadow-xl max-h-96 overflow-hidden flex flex-col">
          <div className="p-2 border-b">
            <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search stations..."
                className="bg-transparent flex-1 text-sm outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} type="button">
                  <X size={14} className="text-slate-400" />
                </button>
              )}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {groups.map(({ station: std, secondaries }) => (
              <div key={std.id}>
                <button
                  type="button"
                  onClick={() => { onSelect(std.id); setOpen(false); setSearch('') }}
                  className={`w-full text-left px-4 py-2 hover:bg-teal-50 border-b border-slate-100 ${stationId === std.id ? 'bg-teal-50' : ''}`}
                >
                  <div className="font-semibold text-[#0A4A52]">{std.name}</div>
                  <div className="text-xs text-slate-500">Standard Port · {std.distanceNm.toFixed(1)} nm</div>
                </button>
                {secondaries.map((sec) => (
                  <button
                    type="button"
                    key={sec.id}
                    onClick={() => { onSelect(sec.id); setOpen(false); setSearch('') }}
                    className={`w-full text-left px-4 py-2 pl-8 hover:bg-teal-50 border-b border-slate-100 text-sm ${stationId === sec.id ? 'bg-teal-50' : ''}`}
                  >
                    <div className="text-slate-700">{sec.name}</div>
                    <div className="text-xs text-slate-400">{sec.distanceNm.toFixed(1)} nm</div>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="p-4 text-slate-500 text-sm text-center">No stations found</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Next Tides Grid ───────────────────────────────────────────────────────────

function NextTidesGrid({ stationId, now }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const highs = getNextHighTides(stationId, now, 2)
  const lows = getNextLowTides(stationId, now, 2)

  function TideCard({ tide, isHigh }) {
    if (!tide) return <div className="rounded-xl p-4 bg-slate-100 opacity-40 h-24" />
    const mins = minutesUntil(tide.date, tide.time)
    const isToday = tide.date === toAESTDate(nowAEST())
    const dateLabel = isToday ? 'Today' : formatDay(tide.date) + ' ' + formatDate(tide.date)
    return (
      <div className={`rounded-xl p-4 ${isHigh ? 'bg-[#0A4A52] text-white' : 'bg-[#E8F4F8] text-slate-800'}`}>
        <div className="text-xs font-semibold opacity-70 mb-1">{isHigh ? '🔺 HIGH TIDE' : '🔻 LOW TIDE'}</div>
        <div className="text-2xl font-bold mb-0.5">{tide.height.toFixed(2)}m</div>
        <div className="text-xs opacity-80">{dateLabel} {tide.time}</div>
        <div className={`text-xs font-semibold mt-1 ${isHigh ? 'text-teal-200' : 'text-slate-500'}`}>{fmtCountdown(mins)}</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <TideCard tide={highs[0]} isHigh={true} />
      <TideCard tide={lows[0]} isHigh={false} />
      <TideCard tide={highs[1]} isHigh={true} />
      <TideCard tide={lows[1]} isHigh={false} />
    </div>
  )
}

// ── Tide Curve Chart ──────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-teal-200 rounded-lg px-3 py-2 text-sm shadow">
      <div className="font-semibold text-[#0A4A52]">{payload[0]?.payload?.time}</div>
      <div className="text-slate-600">{payload[0]?.value?.toFixed(2)}m</div>
    </div>
  )
}

function TideCurveChart({ stationId, dateStr, minSafeDepth }) {
  const points = useMemo(() => getTideCurvePoints(stationId, dateStr, 30), [stationId, dateStr])
  const tides = useMemo(() => getTidesForDate(stationId, dateStr), [stationId, dateStr])
  const now = nowAEST()
  const nowMins = toAESTDate(now) === dateStr
    ? (((now.getTime() + 10 * 3600 * 1000) % (24 * 3600 * 1000)) + (24 * 3600 * 1000)) % (24 * 3600 * 1000) / 60000
    : null

  const maxH = useMemo(() => {
    if (!points.length) return 3
    return Math.max(...points.map((p) => p.height)) + 0.2
  }, [points])

  const xTicks = [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200, 1320, 1440]

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={points} margin={{ top: 20, right: 15, bottom: 5, left: 35 }}>
        <defs>
          <linearGradient id="tideGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0A4A52" stopOpacity={0.6} />
            <stop offset="95%" stopColor="#B8D8E8" stopOpacity={0.6} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ebe8" />
        <XAxis
          dataKey="timeMinutes"
          type="number"
          domain={[0, 1440]}
          ticks={xTicks}
          tickFormatter={(v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:00`}
          tick={{ fontSize: 10 }}
        />
        <YAxis
          domain={[0, maxH]}
          tickFormatter={(v) => `${v.toFixed(1)}`}
          tick={{ fontSize: 10 }}
          label={{ value: 'Height (m)', angle: -90, position: 'insideLeft', offset: -20, style: { fontSize: 10 } }}
        />
        <Tooltip content={<CustomTooltip />} />

        <Area
          type="monotone"
          dataKey="height"
          stroke="#0A4A52"
          strokeWidth={2}
          fill="url(#tideGrad)"
          dot={false}
        />

        {/* Now line */}
        {nowMins !== null && (
          <ReferenceLine
            x={nowMins}
            stroke="#DC2626"
            strokeDasharray="4 2"
            label={{ value: 'Now', position: 'top', fill: '#DC2626', fontSize: 10 }}
          />
        )}

        {/* Tide event lines */}
        {tides.map((tide, i) => (
          <ReferenceLine
            key={i}
            x={timeToMinutes(tide.time)}
            stroke={tide.type === 'high' ? '#0A4A52' : '#94A3B8'}
            strokeDasharray="2 2"
            label={{
              value: `${tide.type === 'high' ? '▲' : '▼'} ${tide.height.toFixed(2)}m\n${tide.time}`,
              position: tide.type === 'high' ? 'top' : 'insideTopLeft',
              fill: tide.type === 'high' ? '#0A4A52' : '#64748B',
              fontSize: 9,
            }}
          />
        ))}

        {/* Min safe depth line */}
        {minSafeDepth != null && (
          <ReferenceLine
            y={minSafeDepth}
            stroke="#DC2626"
            strokeDasharray="4 3"
            label={{ value: 'Min safe', position: 'right', fill: '#DC2626', fontSize: 9 }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── 7-Day Table ───────────────────────────────────────────────────────────────

function SevenDayTable({ stationId, onDaySelect }) {
  const tableRef = useRef(null)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const todayStr = toAESTDate(nowAEST())
  const endStr = addDays(todayStr, 6)

  const tides = useMemo(() => getTidesForRange(stationId, todayStr, endStr), [stationId, todayStr, endStr])

  const now = nowAEST()
  const nowMins = (((now.getTime() + 10 * 3600 * 1000) % (24 * 3600 * 1000)) + (24 * 3600 * 1000)) % (24 * 3600 * 1000) / 60000

  // Find "current" event (nearest future event)
  const nextEventIdx = useMemo(() => {
    for (let i = 0; i < tides.length; i++) {
      const t = tides[i]
      const dayDiff = Math.round((new Date(`${t.date}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) / (86400000))
      const absMins = dayDiff * 1440 + timeToMinutes(t.time)
      if (absMins >= nowMins) return i
    }
    return tides.length - 1
  }, [tides, nowMins, todayStr])

  // Auto-scroll to current event
  useEffect(() => {
    if (tableRef.current && nextEventIdx >= 0) {
      const rows = tableRef.current.querySelectorAll('[data-row]')
      if (rows[nextEventIdx]) {
        rows[nextEventIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [nextEventIdx, stationId])

  let lastDate = null

  return (
    <div ref={tableRef} className="overflow-y-auto max-h-[400px] rounded-xl border border-teal-100">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#0A4A52] text-white">
            <th className="py-2 px-3 text-left font-semibold">Date</th>
            <th className="py-2 px-2 text-left font-semibold">Day</th>
            <th className="py-2 px-3 text-left font-semibold">Time</th>
            <th className="py-2 px-2 text-center font-semibold">Type</th>
            <th className="py-2 px-3 text-right font-semibold">Height</th>
            <th className="py-2 px-3 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {tides.map((tide, i) => {
            const dayDiff = Math.round(
              (new Date(`${tide.date}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) / 86400000,
            )
            const absMins = dayDiff * 1440 + timeToMinutes(tide.time)
            const diffMins = absMins - nowMins

            const isPast = diffMins < -2
            const isCurrent = i === nextEventIdx
            const showDate = tide.date !== lastDate
            if (showDate) lastDate = tide.date

            const rowBg = isCurrent
              ? 'bg-[#0A4A52] text-white'
              : isPast
                ? 'bg-white text-slate-400 italic'
                : tide.type === 'high'
                  ? 'bg-white border-l-2 border-[#0A4A52]'
                  : 'bg-[#F5F5F5]'

            return (
              <tr key={`${tide.date}-${tide.time}`} data-row={i} className={rowBg}>
                <td className="py-1.5 px-3 font-medium text-xs">
                  {showDate ? (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => onDaySelect?.(tide.date)}
                    >
                      {formatDate(tide.date)}
                    </button>
                  ) : null}
                </td>
                <td className="py-1.5 px-2 text-xs">{showDate ? formatDay(tide.date) : null}</td>
                <td className="py-1.5 px-3 tabular-nums">{tide.time}</td>
                <td className="py-1.5 px-2 text-center">
                  {tide.type === 'high' ? (
                    <span className={isCurrent ? 'text-teal-200' : 'text-[#0A4A52]'}>🔺</span>
                  ) : (
                    <span className="text-slate-400">🔻</span>
                  )}
                </td>
                <td className="py-1.5 px-3 tabular-nums text-right font-mono">{tide.height.toFixed(2)}m</td>
                <td className="py-1.5 px-3 text-right text-xs tabular-nums">
                  {isCurrent ? '▶ Now' : fmtTimeAgo(diffMins)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 7-Day Overview Strip ──────────────────────────────────────────────────────

function SevenDayStrip({ stationId, onDaySelect, selectedDay }) {
  const todayStr = toAESTDate(nowAEST())

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const dateStr = addDays(todayStr, i)
      const tides = getTidesForDate(stationId, dateStr)
      if (!tides.length) return { dateStr, maxH: 0, minH: 0, range: 0 }
      const maxH = Math.max(...tides.filter((t) => t.type === 'high').map((t) => t.height))
      const minH = Math.min(...tides.filter((t) => t.type === 'low').map((t) => t.height))
      const absoluteMax = Math.max(...tides.map((t) => t.height))
      const absoluteMin = Math.min(...tides.map((t) => t.height))
      const range = absoluteMax - absoluteMin
      return { dateStr, maxH, minH, range, absoluteMax, absoluteMin }
    })
  }, [stationId, todayStr])

  const maxRange = Math.max(...days.map((d) => d.range), 0.1)

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
      {days.map(({ dateStr, maxH, minH, range }) => {
        const isToday = dateStr === todayStr
        const isSelected = dateStr === selectedDay
        const barPct = Math.min(1, range / maxRange)
        return (
          <button
            type="button"
            key={dateStr}
            onClick={() => onDaySelect?.(dateStr)}
            className={`flex-none rounded-xl border-2 p-2 text-center min-w-[72px] transition ${
              isSelected
                ? 'border-[#C4603A] bg-[#C4603A]/10'
                : isToday
                  ? 'border-[#0A4A52] bg-[#0A4A52]/5'
                  : 'border-slate-200 bg-white hover:border-teal-300'
            }`}
          >
            <div className="text-xs font-bold text-slate-600">{formatDay(dateStr)}</div>
            <div className="text-xs text-slate-500">{formatDate(dateStr)}</div>
            <div className="text-xs font-semibold text-[#0A4A52] mt-1">▲ {maxH.toFixed(2)}m</div>
            <div className="text-xs text-slate-500">▼ {minH.toFixed(2)}m</div>
            <div className="mt-1.5 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#0A4A52]"
                style={{ width: `${Math.round(barPct * 100)}%` }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Depth Calculator ──────────────────────────────────────────────────────────

function DepthCalculator({ stationId, initialDepth }) {
  const [open, setOpen] = useState(false)
  const [chartDepth, setChartDepth] = useState(initialDepth != null ? String(initialDepth) : '')
  const [keel, setKeel] = useState(String(DEFAULT_KEEL))
  const [duration, setDuration] = useState('6')
  const [result, setResult] = useState(null)

  // Auto-expand when initialDepth is set externally
  useEffect(() => {
    if (initialDepth != null) {
      setOpen(true)
      setChartDepth(String(initialDepth))
    }
  }, [initialDepth])

  const minSafeLevel = result ? parseFloat(chartDepth) - parseFloat(keel) : null

  function calculate() {
    const cd = parseFloat(chartDepth)
    const k = parseFloat(keel)
    const d = parseFloat(duration)
    if (isNaN(cd) || isNaN(k) || isNaN(d) || d <= 0) return

    const r = getMinDepthOverPeriod(stationId, cd, k, new Date(), d)
    setResult({ ...r, chartDepth: cd, keel: k })
  }

  const depthCurveData = result
    ? result.curvePoints.map((p, i) => ({
        time: p.time,
        idx: i,
        depth: Math.round(p.availableDepth * 100) / 100,
      }))
    : []

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-teal-100 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4"
      >
        <span className="font-semibold text-[#0A4A52]">⚓ Depth Under Keel Calculator</span>
        {open ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-teal-50">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Chart depth at location (m)</span>
              <input
                type="number"
                step="0.1"
                value={chartDepth}
                onChange={(e) => setChartDepth(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                placeholder="e.g. 3.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Vessel draught / keel (m)</span>
              <input
                type="number"
                step="0.05"
                value={keel}
                onChange={(e) => setKeel(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Check over next (hours)</span>
              <input
                type="number"
                step="1"
                min="1"
                max="24"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={calculate}
            className="mt-3 w-full bg-[#0A4A52] text-white rounded-xl py-2.5 font-semibold text-sm hover:bg-teal-800"
          >
            Calculate Minimum Depth
          </button>

          {result && (
            <div className={`mt-4 rounded-xl p-4 border-2 ${result.isSafe ? 'border-teal-400 bg-teal-50' : 'border-red-400 bg-red-50'}`}>
              <div className="font-bold text-lg mb-1">
                {result.isSafe ? '✅ SAFE TO PROCEED' : '⚠️ INSUFFICIENT DEPTH'}
              </div>
              <div className="text-sm text-slate-700 space-y-0.5">
                <div>Minimum water depth: <strong>{(result.chartDepth + result.minTideHeight).toFixed(2)}m</strong></div>
                {result.minDepthTime && (
                  <div>
                    Occurs at:{' '}
                    <strong>
                      {toAESTDate(result.minDepthTime) === toAESTDate(nowAEST()) ? 'Today' : formatDay(toAESTDate(result.minDepthTime))}
                      {' '}
                      {(() => {
                        const aestMs = result.minDepthTime.getTime() + 10 * 3600 * 1000
                        const mins = (aestMs % (24 * 3600 * 1000)) / 60000
                        const h = Math.floor(mins / 60)
                        const m = Math.floor(mins % 60)
                        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                      })()}
                    </strong>
                    {' '}(Tide: {result.minTideHeight?.toFixed(2)}m)
                  </div>
                )}
                {result.isSafe ? (
                  <div className="text-teal-700 font-semibold">
                    Available clearance: {result.clearance.toFixed(2)}m above keel
                  </div>
                ) : (
                  <div className="text-red-700 font-semibold">
                    Shortfall: {Math.abs(result.clearance).toFixed(2)}m — vessel may ground
                  </div>
                )}
              </div>
            </div>
          )}

          {result && depthCurveData.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-slate-500 mb-1">Available water depth over period</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={depthCurveData} margin={{ top: 10, right: 10, bottom: 5, left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9 }}
                    interval={Math.floor(depthCurveData.length / 6)}
                  />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${v.toFixed(1)}m`} />
                  <Tooltip
                    formatter={(v) => [`${v.toFixed(2)}m`, 'Available depth']}
                    labelFormatter={(l) => `Time: ${l}`}
                  />
                  <ReferenceLine y={0} stroke="#1f2937" strokeDasharray="4 2" label={{ value: 'Keel', position: 'right', fontSize: 9 }} />
                  <ReferenceLine y={0.5} stroke="#D97706" strokeDasharray="4 2" label={{ value: '0.5m margin', position: 'right', fontSize: 9 }} />
                  <Area
                    type="monotone"
                    dataKey="depth"
                    stroke="#16A34A"
                    fill="#bbf7d0"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Current Tide Status Card ──────────────────────────────────────────────────

function CurrentTideCard({ stationId, now }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const dateStr = toAESTDate(now)
  const tides = useMemo(() => getTidesForDate(stationId, dateStr), [stationId, dateStr])

  const current = getCurrentTideHeight(stationId, now)

  // Trend: compare now vs 20 minutes ago
  const twentyAgo = new Date(now.getTime() - 20 * 60 * 1000)
  const prevHeight = getCurrentTideHeight(stationId, twentyAgo)
  const diff = current !== null && prevHeight !== null ? current - prevHeight : 0
  const trend = Math.abs(diff) < 0.02 ? 'Slack' : diff > 0 ? 'Rising' : 'Falling'
  const trendIcon = trend === 'Rising' ? '↑' : trend === 'Falling' ? '↓' : '→'
  const trendColor = trend === 'Rising' ? 'text-teal-600' : trend === 'Falling' ? 'text-blue-600' : 'text-slate-500'

  // Day range
  const allHeights = tides.map((t) => t.height)
  const dayMin = allHeights.length ? Math.min(...allHeights) : 0
  const dayMax = allHeights.length ? Math.max(...allHeights) : 3

  // Find last and next tides
  const nowMins = (((now.getTime() + 10 * 3600 * 1000) % (24 * 3600 * 1000)) + 24 * 3600 * 1000) % (24 * 3600 * 1000) / 60000
  const lastTide = tides.filter((t) => timeToMinutes(t.time) <= nowMins).pop()
  const nextTide = tides.find((t) => timeToMinutes(t.time) > nowMins)

  const lastMins = lastTide ? minutesUntil(dateStr, lastTide.time) : null
  const nextMins = nextTide ? minutesUntil(dateStr, nextTide.time) : null

  const updatedAt = (() => {
    const h = now.getHours()
    const m = now.getMinutes()
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  })()

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xl font-bold text-[#0A4A52]">{getStationName(stationId)}</div>
          <div className="text-xs text-slate-400">{getStationPortType(stationId)} · Updated {updatedAt}</div>
        </div>
      </div>

      <div className="mb-1">
        <div className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wide">Current Tide</div>
        <TideGauge current={current} min={dayMin} max={dayMax} />
        <div className={`text-sm font-semibold mt-1 ${trendColor}`}>{trendIcon} {trend}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        {lastTide && (
          <div className="bg-slate-50 rounded-lg px-3 py-2">
            <div className="text-slate-400">Last {lastTide.type === 'high' ? 'High' : 'Low'}</div>
            <div className="font-semibold text-slate-700">{lastTide.height.toFixed(2)}m at {lastTide.time}</div>
            <div className="text-slate-400">{lastMins != null ? fmtTimeAgo(lastMins) : ''}</div>
          </div>
        )}
        {nextTide && (
          <div className="bg-slate-50 rounded-lg px-3 py-2">
            <div className="text-slate-400">Next {nextTide.type === 'high' ? 'High' : 'Low'}</div>
            <div className="font-semibold text-slate-700">{nextTide.height.toFixed(2)}m at {nextTide.time}</div>
            <div className="text-slate-400">{nextMins != null ? fmtTimeAgo(nextMins) : ''}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Tides({ tideContext }) {
  const { preselectedStation, prefilledChartDepth, midLat, midLng } = tideContext ?? {}

  const [stationId, setStationId] = useState(null)
  const [userLat, setUserLat] = useState(HOME_LAT)
  const [userLng, setUserLng] = useState(HOME_LNG)
  const [gpsSource, setGpsSource] = useState('home')
  const [chartDay, setChartDay] = useState(null)
  const [, setTick] = useState(0)

  const now = useMemo(() => nowAEST(), [])  // stable ref, updates via tick
  const todayStr = useMemo(() => toAESTDate(new Date()), [])

  // Minute ticker for countdowns
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60000)
    return () => clearInterval(t)
  }, [])

  // Load preferred station from Supabase
  useEffect(() => {
    async function loadPreferred() {
      try {
        const settings = await db.getVesselSettings()
        const saved = settings?.data?.preferred_tide_station
        if (saved && (STANDARD_PORTS[saved] || SECONDARY_PORTS.find((p) => p.id === saved))) {
          setStationId(saved)
          return
        }
      } catch (_) { /* ignore */ }
    }
    loadPreferred()
  }, [])

  // GPS detection
  useEffect(() => {
    if (preselectedStation) {
      setStationId(preselectedStation)
      return
    }

    // If we have route midpoint coords from PassagePlanner, use those to find nearest
    const searchLat = midLat ?? null
    const searchLng = midLng ?? null

    if ('geolocation' in navigator && !searchLat) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLat(pos.coords.latitude)
          setUserLng(pos.coords.longitude)
          setGpsSource('gps')
        },
        () => setGpsSource('home'),
        { timeout: 10000 },
      )
    } else if (searchLat) {
      setUserLat(searchLat)
      setUserLng(searchLng)
    }
  }, [preselectedStation])

  // Auto-nearest station once we have coordinates (and no saved preference)
  useEffect(() => {
    if (stationId) return
    const all = getAllStationsWithDistance(userLat, userLng)
    if (all.length) setStationId(all[0].id)
  }, [userLat, userLng, stationId])

  // When user selects a station, save preference
  async function handleSelectStation(id) {
    setStationId(id)
    try {
      const settings = await db.getVesselSettings()
      const existing = settings?.data ?? {}
      await db.saveVesselSettings({ ...existing, preferred_tide_station: id })
    } catch (_) { /* ignore */ }
  }

  const displayDay = chartDay ?? todayStr
  const tomorrowStr = addDays(todayStr, 1)

  if (!stationId) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="text-2xl mb-2">🌊</div>
        Detecting nearest tide station...
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Station selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-4">
        <StationSelector
          stationId={stationId}
          onSelect={handleSelectStation}
          userLat={userLat}
          userLng={userLng}
          gpsSource={gpsSource}
        />
      </div>

      {/* Current tide hero */}
      <CurrentTideCard stationId={stationId} now={new Date()} />

      {/* Next high/low grid */}
      <NextTidesGrid stationId={stationId} now={new Date()} />

      {/* Tide curve chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-slate-600">
            Tide Curve — {getStationName(stationId)} — {formatDate(displayDay)}
          </div>
          <div className="flex gap-1">
            {[{ label: 'Today', date: todayStr }, { label: 'Tomorrow', date: tomorrowStr }].map(({ label, date }) => (
              <button
                key={date}
                type="button"
                onClick={() => setChartDay(date)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  displayDay === date
                    ? 'bg-[#0A4A52] text-white'
                    : 'border border-slate-300 text-slate-600 hover:border-teal-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <TideCurveChart
          stationId={stationId}
          dateStr={displayDay}
          minSafeDepth={prefilledChartDepth != null ? prefilledChartDepth - DEFAULT_KEEL : null}
        />
      </div>

      {/* 7-day overview strip */}
      <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-4">
        <div className="text-sm font-semibold text-slate-600 mb-3">7-Day Overview</div>
        <SevenDayStrip stationId={stationId} onDaySelect={setChartDay} selectedDay={displayDay} />
      </div>

      {/* 7-day table */}
      <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-4">
        <div className="text-sm font-semibold text-slate-600 mb-3">7-Day Tide Table</div>
        <SevenDayTable stationId={stationId} onDaySelect={setChartDay} />
      </div>

      {/* Depth calculator */}
      <DepthCalculator stationId={stationId} initialDepth={prefilledChartDepth ?? null} />
    </div>
  )
}
