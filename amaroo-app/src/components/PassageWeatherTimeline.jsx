// Utility: get last element of array
function getLast(arr) {
  return arr && arr.length ? arr[arr.length - 1] : undefined;
}

import { memo, useEffect, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getVesselSetting, getVesselSettings } from '../db/api'
import { findNearestStation, getTideCurvePoints } from '../utils/tideCalculator'
import { routeMidpoint } from '../utils/weatherApi'
import { fetchOceanCurrentWithMeta, formatCurrent, interpolateCurrent } from '../utils/oceanCurrent'
import { computeCourseToSteer, computeCurrent, computeSeaImpactWithFouling } from '../utils/physics'
import { AMAROO } from '../utils/vesselConstants'
import { foulingConditionLabel, foulingPenalty } from '../utils/hullFouling'

const GOOD_COLOR = '#2ECC71'
const MODERATE_COLOR = '#F39C12'
const POOR_COLOR = '#E74C3C'
const SPEED_COLOR = '#7C3AED'
const WAVE_COLOR = '#2563EB'
const CURRENT_COLOR = '#8B5CF6'

function haversineNm(lat1, lng1, lat2, lng2) {
  const R = 3440.065
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function degreesToCardinal(degrees) {
  if (degrees == null || Number.isNaN(Number(degrees))) return '—'
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round((((Number(degrees) % 360) + 360) % 360) / 22.5) % 16]
}

function headingBetweenWaypoints(wp1, wp2) {
  if (!wp1 || !wp2) return 0
  const lat1 = (Number(wp1.lat) * Math.PI) / 180
  const lat2 = (Number(wp2.lat) * Math.PI) / 180
  const dLon = ((Number(wp2.lng) - Number(wp1.lng)) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

function calculateComfortScore(windKn, waveHeightM, swellHeightM, currentKn) {
  const reasons = []
  let score = 'good'

  if (Number(windKn) > 25) {
    score = 'poor'
    reasons.push(`Wind ${Math.round(Number(windKn))}kn`)
  } else if (Number(windKn) > 15) {
    score = 'moderate'
    reasons.push(`Wind ${Math.round(Number(windKn))}kn`)
  }

  if (Number(waveHeightM) > 2) {
    score = 'poor'
    reasons.push(`Waves ${Number(waveHeightM).toFixed(1)}m`)
  } else if (Number(waveHeightM) > 1) {
    if (score !== 'poor') score = 'moderate'
    reasons.push(`Waves ${Number(waveHeightM).toFixed(1)}m`)
  }

  if (Number(swellHeightM) > 2.5) {
    score = 'poor'
    reasons.push(`Swell ${Number(swellHeightM).toFixed(1)}m`)
  } else if (Number(swellHeightM) > 1.5) {
    if (score !== 'poor') score = 'moderate'
    reasons.push(`Swell ${Number(swellHeightM).toFixed(1)}m`)
  }

  if (Number(currentKn) > 2.5) {
    if (score !== 'poor') score = 'moderate'
    reasons.push(`Current ${Number(currentKn).toFixed(1)}kn`)
  }

  return { score, reasons }
}

function calculatePassageSummary(dataPoints, totalDistanceNm, baseSpeedKn, fuelCapacityL, fuelBurnBaseLhr) {
  if (!dataPoints?.length) return null
  const avgSOG = dataPoints.reduce((sum, point) => sum + Number(point.speedOverGround || 0), 0) / dataPoints.length
  const predictedDurationHrs = totalDistanceNm > 0 ? totalDistanceNm / Math.max(avgSOG, 0.1) : 0
  const predictedDurationMins = Math.round(predictedDurationHrs * 60)
  const baselineDurationHrs = totalDistanceNm > 0 ? totalDistanceNm / Math.max(baseSpeedKn, 0.1) : 0
  const etaDeltaMins = Math.round((predictedDurationHrs - baselineDurationHrs) * 60)
  const avgFuelBurnLhr = dataPoints.reduce((sum, point) => sum + Number(point.fuelBurnLhr || fuelBurnBaseLhr), 0) / dataPoints.length
  const totalFuelL = Math.round(avgFuelBurnLhr * predictedDurationHrs)
  const baselineFuelL = Math.round(Number(fuelBurnBaseLhr || 0) * baselineDurationHrs)
  const additionalFuelL = totalFuelL - baselineFuelL
  const fuelRemainingL = Math.round(Number(fuelCapacityL || 0) - totalFuelL)
  const fuelRemainingPct = Math.round((fuelRemainingL / Math.max(Number(fuelCapacityL || 1), 1)) * 100)

  const avgSeaPenaltyPct = Math.round((dataPoints.reduce((sum, point) => sum + Number(point.seaPenaltyPct || 0), 0) / dataPoints.length) || 0)
  const avgCurrentEffect = Math.round((dataPoints.reduce((sum, point) => sum + Number(point.currentEffectKn || 0), 0) / dataPoints.length) * 10) / 10

  return {
    avgSOG: Math.round(avgSOG * 10) / 10,
    predictedDurationHrs,
    predictedDurationMins,
    etaDeltaMins,
    totalFuelL,
    baselineFuelL,
    additionalFuelL,
    fuelRemainingL,
    fuelRemainingPct,
    avgFuelBurnLhr: Math.round(avgFuelBurnLhr * 10) / 10,
    avgWindPenalty: 0,
    avgWavePenalty: avgSeaPenaltyPct,
    avgSwellPenalty: 0,
    avgCurrentEffect,
    goodPct: Math.round((dataPoints.filter((point) => point.comfort?.score === 'good').length / dataPoints.length) * 100),
    moderatePct: Math.round((dataPoints.filter((point) => point.comfort?.score === 'moderate').length / dataPoints.length) * 100),
    poorPct: Math.round((dataPoints.filter((point) => point.comfort?.score === 'poor').length / dataPoints.length) * 100),
  }
}

function parsePlannerDateTime(value) {
  if (!value) return null
  if (value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value)) return new Date(value)
  return new Date(`${value}:00+10:00`)
}

function toAESTDateStr(ms) {
  const d = new Date(ms + 10 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function formatAESTTime(ms) {
  const d = new Date(ms + 10 * 3600 * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function formatAESTDateTime(ms) {
  const d = new Date(ms + 10 * 3600 * 1000)
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${weekdays[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function formatDurationMins(totalMins) {
  const hours = Math.floor(Math.abs(totalMins) / 60)
  const mins = Math.abs(totalMins) % 60
  return `${hours}h ${String(mins).padStart(2, '0')}m`
}

function formatLocalInput(ms) {
  const d = new Date(ms + 10 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function parseOpenMeteoTime(timeStr) {
  return new Date(`${timeStr}:00+10:00`).getTime()
}

function buildHourlyMap(hourly, mapper) {
  const map = new Map()
  if (!hourly?.time?.length) return map
  for (let i = 0; i < hourly.time.length; i++) {
    map.set(parseOpenMeteoTime(hourly.time[i]), mapper(i))
  }
  return map
}

function nearestHourly(timestamp, map) {
  const hour = Math.floor(timestamp / 3600000) * 3600000
  return map.get(hour) || null
}

function interpolateTide(timestamp, tideCurvePoints) {
  if (!tideCurvePoints.length) return null
  if (timestamp <= tideCurvePoints[0].timestamp) return tideCurvePoints[0].height
  if (timestamp >= tideCurvePoints[tideCurvePoints.length - 1].timestamp) return tideCurvePoints[tideCurvePoints.length - 1].height
  for (let i = 1; i < tideCurvePoints.length; i++) {
    const prev = tideCurvePoints[i - 1]
    const next = tideCurvePoints[i]
    if (timestamp <= next.timestamp) {
      const span = next.timestamp - prev.timestamp
      const ratio = span > 0 ? (timestamp - prev.timestamp) / span : 0
      return Math.round((prev.height + (next.height - prev.height) * ratio) * 100) / 100
    }
  }
  return tideCurvePoints[tideCurvePoints.length - 1].height
}

function buildTideCurve(stationId, startMs, endMs) {
  console.log('[PassageWeatherTimeline] ENTER buildTideCurve', { stationId, startMs, endMs });
  const points = [];
  // Ensure we cover all days from startMs to endMs (inclusive)
  let cursorMs = startMs;
  const MAX_DAYS = 30;
  let dayCount = 0;
  while (cursorMs <= endMs && dayCount < MAX_DAYS) {
    const cursorDate = toAESTDateStr(cursorMs);
    const dayStartMs = new Date(`${cursorDate}T00:00:00+10:00`).getTime();
    const dayPoints = getTideCurvePoints(stationId, cursorDate, 30);
    for (const point of dayPoints) {
      const absTimestamp = dayStartMs + point.timeMinutes * 60000;
      if (absTimestamp >= startMs && absTimestamp <= endMs + 24 * 3600000) {
        points.push({
          timestamp: absTimestamp,
          height: point.height,
        });
      }
    }
    dayCount++;
    cursorMs += 24 * 3600000;
  }
  console.log('[PassageWeatherTimeline] EXIT buildTideCurve', { pointsLen: points.length, dayCount });
  return points.sort((a, b) => a.timestamp - b.timestamp);
}

function buildLegs(waypoints) {
  if (!waypoints?.length || waypoints.length < 2) return []
  let cumulative = 0
  return waypoints.slice(0, -1).map((wp, index) => {
    const next = waypoints[index + 1]
    const distanceNm = haversineNm(wp.lat, wp.lng, next.lat, next.lng)
    const heading = headingBetweenWaypoints(wp, next)
    const leg = {
      start: wp,
      end: next,
      distanceNm,
      heading,
      startNm: cumulative,
      endNm: cumulative + distanceNm,
    }
    cumulative += distanceNm
    return leg
  })
}

function headingAtDistance(progressNm, legs) {
  if (!legs.length) return 0
  const leg = legs.find((item) => progressNm <= item.endNm) || legs[legs.length - 1]
  return leg.heading
}

function groupComfortBands(points) {
  if (!points.length) return []
  const bands = []
  let start = points[0]
  let current = points[0].comfort.score
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || points[i].comfort.score !== current) {
      const end = points[Math.max(0, i - 1)]
      bands.push({ start: start.timestamp, end: end.timestamp + 30 * 60000, score: current })
      if (i < points.length) {
        start = points[i]
        current = points[i].comfort.score
      }
    }
  }
  return bands
}

function colorForComfort(score) {
  if (score === 'poor') return POOR_COLOR
  if (score === 'moderate') return MODERATE_COLOR
  return GOOD_COLOR
}

function labelForComfort(score) {
  if (score === 'poor') return 'Poor'
  if (score === 'moderate') return 'Moderate'
  return 'Good'
}

function buildTimeTicks(startMs, endMs) {
  const ticks = []
  const startHour = Math.floor(startMs / 3600000) * 3600000
  for (let ts = startHour; ts <= endMs; ts += 3600000) {
    if (ts >= startMs) ticks.push(ts)
  }
  if (!ticks.includes(startMs)) ticks.unshift(startMs)
  if (!ticks.includes(endMs)) ticks.push(endMs)
  return [...new Set(ticks)].sort((a, b) => a - b)
}

function pickSelectedPoint(points, selectedTimestamp, departureMs) {
  if (!points.length) return null
  if (selectedTimestamp != null) {
    return points.reduce((best, point) =>
      Math.abs(point.timestamp - selectedTimestamp) < Math.abs(best.timestamp - selectedTimestamp) ? point : best,
    points[0])
  }
  const now = Date.now()
  const target = now >= departureMs && now <= points[points.length - 1].timestamp ? now : departureMs
  return points.reduce((best, point) =>
    Math.abs(point.timestamp - target) < Math.abs(best.timestamp - target) ? point : best,
  points[0])
}

function buildStackedImpact(points, baseSpeed) {
  return points.map((point) => ({
    timestamp: point.timestamp,
    actualSOG: point.speedOverGround != null ? Number(point.speedOverGround).toFixed(1) * 1 : null,
    foulingLoss: point.foulingLossKn != null ? Number(Math.max(0, point.foulingLossKn).toFixed(1)) : null,
    swellLoss: 0,
    waveLoss: point.seaPenaltyKn != null ? Number(Math.max(0, point.seaPenaltyKn).toFixed(1)) : null,
    windLoss: 0,
    currentGain: point.currentEffectKn != null ? Number(Math.max(0, point.currentEffectKn).toFixed(1)) : null,
    currentLoss: point.currentEffectKn != null ? Number(Math.min(0, point.currentEffectKn).toFixed(1)) : null,
  }))
}

function getPoorPeriods(points) {
  const poor = points.filter((point) => point.comfort.score === 'poor')
  if (!poor.length) return []
  const ranges = []
  let start = poor[0]
  let prev = poor[0]
  for (let i = 1; i < poor.length; i++) {
    if (poor[i].timestamp - prev.timestamp > 30 * 60000 + 1000) {
      ranges.push({ start, end: prev })
      start = poor[i]
    }
    prev = poor[i]
  }
  ranges.push({ start, end: prev })
  return ranges
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-teal-100 bg-slate-50 p-4 animate-pulse">
          <div className="h-3 w-24 bg-slate-200 rounded mb-3" />
          <div className="h-8 w-20 bg-slate-200 rounded mb-2" />
          <div className="h-3 w-28 bg-slate-200 rounded" />
        </div>
      ))}
    </div>
  )
}

function SummaryCard({ title, value, sub, accentClass = 'text-[#0A4A52]', children }) {
  return (
    <div className="rounded-xl border border-teal-100 bg-[#F7F3EE] p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{title}</div>
      <div className={`text-2xl font-bold ${accentClass}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      {children}
    </div>
  )
}

function CompassRose({ label, value, direction }) {
  const radians = (((direction ?? 0) - 90) * Math.PI) / 180
  const x2 = 28 + 18 * Math.cos(radians)
  const y2 = 28 + 18 * Math.sin(radians)
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center min-w-[120px]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-[#0A4A52]">{value}</div>
      <div className="text-xs text-slate-500 mb-1">{degreesToCardinal(direction)}</div>
      <svg width="56" height="56" viewBox="0 0 56 56" className="mx-auto">
        <circle cx="28" cy="28" r="22" fill="none" stroke="#CBD5E1" />
        <text x="28" y="10" textAnchor="middle" fontSize="8" fill="#64748B">N</text>
        <text x="28" y="52" textAnchor="middle" fontSize="8" fill="#64748B">S</text>
        <text x="6" y="31" textAnchor="middle" fontSize="8" fill="#64748B">W</text>
        <text x="50" y="31" textAnchor="middle" fontSize="8" fill="#64748B">E</text>
        <line x1="28" y1="28" x2={x2} y2={y2} stroke="#0A4A52" strokeWidth="2" />
        <circle cx="28" cy="28" r="3" fill="#0A4A52" />
      </svg>
    </div>
  )
}

function DirectionArrowDot({ cx, cy, payload, type, color }) {
  const directionKey = `${type}Direction`
  const magnitudeKey = type === 'wave' || type === 'swell' ? `${type}Height` : `${type}Speed`
  const direction = payload?.[directionKey]
  if (direction == null || !payload?.[magnitudeKey]) return null
  if (payload.timestamp % 3600000 !== 0) return null
  // Wind/wave/swell: arrow points to direction of effect (opposite to environmental direction)
  // Current: arrow points in the direction of the current (same as environmental direction)
  let radians;
  if (type === 'current') {
    radians = ((direction - 90) * Math.PI) / 180;
  } else {
    radians = ((direction + 180 - 90) * Math.PI) / 180;
  }
  const length = 10;
  const x2 = cx + length * Math.cos(radians);
  const y2 = cy + length * Math.sin(radians);
  return (
    <g>
      <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={color} strokeWidth={1.8} markerEnd={`url(#${type}-arrowhead)`} />
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
    </g>
  )
}

function RichTooltip({ active, payload, baseSpeedKn }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[270px]">
      <div className="font-semibold text-slate-800">{formatAESTTime(point.timestamp)}</div>
      <div className="border-t border-slate-100 my-2" />
      <div>🌊 Tide: {point.tideHeight?.toFixed(2) ?? '—'}m {point.tideRising == null ? '' : point.tideRising ? '↑ Rising' : '↓ Falling'}</div>
      <div>⚡ SOG: {point.speedOverGround?.toFixed(1) ?? '—'} kn</div>
      <div className="pl-4 text-slate-500">vs {baseSpeedKn.toFixed(1)}kn planned ({Math.round(((point.speedOverGround - baseSpeedKn) / baseSpeedKn) * 100)}%)</div>
      <div className="border-t border-slate-100 my-2" />
      <div>💨 Wind: {Math.round(point.windSpeed ?? 0)}kn {degreesToCardinal(point.windDirection)} ({-point.windPenaltyPct}%)</div>
      <div className="pl-4 text-slate-500">Gusts: {Math.round(point.windGusts ?? 0)}kn</div>
      <div>🌊 Waves: {(point.waveHeight ?? 0).toFixed(1)}m {degreesToCardinal(point.waveDirection)} ({-point.wavePenaltyPct}%)</div>
      <div className="pl-4 text-slate-500">Period: {(point.wavePeriod ?? 0).toFixed(0)}s</div>
      <div>🌀 Swell: {(point.swellHeight ?? 0).toFixed(1)}m {degreesToCardinal(point.swellDirection)} ({-point.swellPenaltyPct}%)</div>
      <div className="pl-4 text-slate-500">Period: {(point.swellPeriod ?? 0).toFixed(0)}s</div>
      <div>↔ Current: {(point.currentSpeed ?? 0).toFixed(1)}kn {degreesToCardinal(point.currentDirection)} ({point.currentEffectKn >= 0 ? '+' : ''}{point.currentEffectKn.toFixed(1)}kn)</div>
      <div>🧭 Heading to steer: {point.headingToSteer?.toFixed(1) ?? '—'}°T (track {point.legHeading?.toFixed(1) ?? '—'}°T, ferry {point.ferryAngle?.toFixed(1) ?? '—'}°)</div>
      <div className="border-t border-slate-100 my-2" />
      <div>⛽ Fuel burn: {point.fuelBurnLhr?.toFixed(1) ?? '—'} L/hr</div>
      <div style={{ color: colorForComfort(point.comfort.score) }} className="font-semibold">
        {point.comfort.score === 'good' ? '✅' : point.comfort.score === 'moderate' ? '⚠️' : '🔴'} Conditions: {labelForComfort(point.comfort.score)}
      </div>
      {!!point.comfort.reasons.length && <div className="text-slate-500">Reason: {point.comfort.reasons.join(', ')}</div>}
    </div>
  )
}

function preparePassageData({ departureMs, totalDistanceNm, baseSpeedKn, burnRateLhr, legs, tideCurvePoints, windMap, marineMap, currentData, kCoefficient, endMs, monthsSinceHaulout = 0 }) {
    console.log('[PassageWeatherTimeline] ENTER preparePassageData', { departureMs, totalDistanceNm, baseSpeedKn, legsLen: legs?.length, endMs });
  if (!departureMs || !totalDistanceNm || !legs.length || !Number.isFinite(departureMs) || !Number.isFinite(totalDistanceNm) || !Number.isFinite(baseSpeedKn) || baseSpeedKn <= 0) {
    return { points: [], summary: { error: 'Invalid route or vessel data. Please check your waypoints and vessel speed.' }, plannedEtaMs: null, predictedEtaMs: null }
  }

  // Calculate planned ETA and add guards/logging
  const plannedDurationHrs = totalDistanceNm / baseSpeedKn;
  const plannedEtaMs = departureMs + plannedDurationHrs * 3600000;
  if (!Number.isFinite(plannedEtaMs) || plannedEtaMs <= departureMs) {
    console.error('[PassageWeatherTimeline] Invalid plannedEtaMs', { departureMs, totalDistanceNm, baseSpeedKn, plannedDurationHrs, plannedEtaMs });
    return { points: [], summary: { error: 'Invalid ETA calculation. Please check your vessel speed and route distance.' }, plannedEtaMs: null, predictedEtaMs: null }
  }

  // Diagnostic log before building points
  console.log('[PassageWeatherTimeline] About to buildPoints', { departureMs, plannedEtaMs, totalDistanceNm, baseSpeedKn });

  const MAX_POINTS = 1000;
  // Use endMs if provided, otherwise plannedEtaMs
  const finalEndMs = typeof endMs === 'number' ? endMs : plannedEtaMs;
  const buildPoints = (endMs) => {
    console.log('[PassageWeatherTimeline] ENTER buildPoints', { departureMs, endMs });
    const points = []
    let steps = 0;
    for (let timestamp = departureMs; timestamp <= endMs; timestamp += 30 * 60000) {
      if (++steps > MAX_POINTS) {
        console.warn('[PassageWeatherTimeline] buildPoints: MAX_POINTS cap hit', { steps, departureMs, endMs, baseSpeedKn, totalDistanceNm, timestamp });
        break;
      }
      if (steps === 1) {
        console.log('[PassageWeatherTimeline] buildPoints: first iteration', { timestamp });
      }
      const progressRatio = Math.min(1, Math.max(0, (timestamp - departureMs) / Math.max(endMs - departureMs, 1)))
      const progressNm = totalDistanceNm * progressRatio
      console.log('[PassageWeatherTimeline] buildPoints: before headingAtDistance', { progressNm });
      const heading = headingAtDistance(progressNm, legs)
      const windPoint = nearestHourly(timestamp, windMap) || {}
      const marinePoint = nearestHourly(timestamp, marineMap) || {}
      const sea = computeSeaImpactWithFouling(
        AMAROO.v0,
        AMAROO.loa,
        Number(kCoefficient || AMAROO.K),
        marinePoint.waveHeight ?? 0,
        marinePoint.swellHeight ?? 0,
        0,
        'partition',
        marinePoint.waveDirection ?? 0,
        heading,
        marinePoint.swellDirection ?? 0,
        marinePoint.wavePeriod ?? 8,
        marinePoint.swellPeriod ?? 10,
        8,
        AMAROO.fmin,
        AMAROO.combineMode,
        AMAROO.gR0,
        AMAROO.gSigma,
        AMAROO.gGmin,
        AMAROO.gGmax,
        monthsSinceHaulout,
      )

      const fp = foulingPenalty(monthsSinceHaulout)

      const currentPoint = interpolateCurrent(currentData, timestamp)
      const currentSpeedKn = currentPoint?.currentSpeedKn ?? 0
      const currentDirectionDeg = currentPoint?.currentDirectionDeg ?? 0

      const current = computeCurrent(
        sea.predictedSTW,
        heading,
        currentDirectionDeg,
        currentSpeedKn,
      )

      const cts = computeCourseToSteer(
        AMAROO.v0 * fp.speedMultiplier,
        AMAROO.loa,
        Number(kCoefficient || AMAROO.K),
        marinePoint.waveHeight ?? 0,
        marinePoint.swellHeight ?? 0,
        0,
        'partition',
        marinePoint.waveDirection ?? 0,
        heading,
        currentDirectionDeg,
        currentSpeedKn,
        marinePoint.swellDirection ?? 0,
        marinePoint.wavePeriod ?? 8,
        marinePoint.swellPeriod ?? 10,
        8,
        AMAROO.fmin,
        AMAROO.combineMode,
        AMAROO.gR0,
        AMAROO.gSigma,
        AMAROO.gGmin,
        AMAROO.gGmax,
      )

      const currentEffectKn = Number(current.sog) - Number(sea.predictedSTW)
      const seaPenaltyPct = baseSpeedKn > 0 ? Math.max(0, (Number(sea.penalty) / baseSpeedKn) * 100) : 0
      const comfort = calculateComfortScore(
        windPoint.windSpeed ?? 0,
        marinePoint.waveHeight ?? 0,
        marinePoint.swellHeight ?? 0,
        currentSpeedKn,
      )

      const performance = {
        windFactor: 1,
        waveFactor: Math.max(0, 1 - seaPenaltyPct / 100),
        swellFactor: 1,
        speedThroughWater: Math.round(Number(sea.predictedSTW) * 10) / 10,
        speedOverGround: Math.round(Number(current.sog) * 10) / 10,
        fuelBurnLhr: Number(burnRateLhr || AMAROO.fuelBurnLhr) * sea.foulingFuelMultiplier,
        combinedResistanceFactor: Math.max(0, 1 - seaPenaltyPct / 100),
        windPenaltyPct: 0,
        wavePenaltyPct: Math.round(seaPenaltyPct),
        swellPenaltyPct: 0,
        currentEffectKn: Math.round(currentEffectKn * 10) / 10,
        seaPenaltyKn: Number(sea.penalty),
        seaPenaltyPct,
        foulingPenaltyPct: sea.foulingPenaltyPct,
        foulingLossKn: Math.max(0, AMAROO.v0 - sea.v0Fouled),
        headingToSteer: cts.heading,
        ferryAngle: cts.ferryAngle,
        ctsFeasible: cts.feasible,
        comfort,
      }

      const tideHeight = interpolateTide(timestamp, tideCurvePoints)
      const nextTideHeight = interpolateTide(timestamp + 30 * 60000, tideCurvePoints)
      points.push({
        time: formatAESTTime(timestamp),
        timestamp,
        tideHeight,
        tideRising: tideHeight != null && nextTideHeight != null ? nextTideHeight > tideHeight : null,
        windSpeed: windPoint.windSpeed ?? null,
        windDirection: windPoint.windDirection ?? null,
        windGusts: windPoint.windGusts ?? null,
        waveHeight: marinePoint.waveHeight ?? null,
        waveDirection: marinePoint.waveDirection ?? null,
        wavePeriod: marinePoint.wavePeriod ?? null,
        swellHeight: marinePoint.swellHeight ?? null,
        swellDirection: marinePoint.swellDirection ?? null,
        swellPeriod: marinePoint.swellPeriod ?? null,
        currentSpeed: currentPoint?.currentSpeedKn ?? null,
        currentDirection: currentPoint?.currentDirectionDeg ?? null,
        legHeading: heading,
        windArrowRow: 4,
        waveArrowRow: 3,
        swellArrowRow: 2,
        currentArrowRow: 1,
        ...performance,
      })
    }
    return points
  }

  // Build points up to finalEndMs
  const points = buildPoints(finalEndMs);
  let summary = calculatePassageSummary(points, totalDistanceNm, baseSpeedKn, AMAROO.fuelCapacityL, burnRateLhr);
  let predictedEtaMs = departureMs + (summary?.predictedDurationHrs ?? 0) * 3600000;

  return { points, summary, plannedEtaMs, predictedEtaMs };
}

function DepartureOptimiser({ rows, selectedValue, onSelect }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-separate border-spacing-y-1">
        <thead>
          <tr className="text-slate-500 text-xs">
            <th className="text-left pr-3">Date</th>
            {['06:00', '07:00', '08:00', '09:00', '10:00'].map((hour) => (
              <th key={hour} className="px-2 py-1">{hour}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <td className="pr-3 whitespace-nowrap text-slate-700">{row.label}</td>
              {row.cells.map((cell) => (
                <td key={cell.value}>
                  <button
                    type="button"
                    disabled={!cell.available}
                    onClick={() => cell.available && onSelect(cell.value)}
                    className={`w-full rounded-md px-2 py-1.5 text-xs font-medium ${!cell.available ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : selectedValue === cell.value ? 'ring-2 ring-[#0A4A52]' : ''}`}
                    style={{ backgroundColor: cell.available ? colorForComfort(cell.score) : undefined, color: cell.available ? '#fff' : undefined }}
                    title={cell.available ? `${labelForComfort(cell.score)} · ETA ${cell.predictedEta}` : 'Forecast unavailable'}
                  >
                    {cell.available ? (cell.score === 'good' ? '🟢' : cell.score === 'moderate' ? '🟡' : '🔴') : '—'}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PassageWeatherTimeline({ waypoints, departureTime, totalDistanceNm, vesselSpeedKnots, departurePort, destination, onDepartureTimeChange, monthsSinceHaulout = 0 }) {
    console.log('[PassageWeatherTimeline] ENTER component', { waypointsLen: waypoints?.length, departureTime, totalDistanceNm, vesselSpeedKnots });
  // Runtime prop guards
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return <div className="text-red-600 p-4">Error: At least two waypoints are required to show the weather timeline.</div>;
  }
  if (!departureTime || isNaN(new Date(departureTime).getTime())) {
    return <div className="text-red-600 p-4">Error: Invalid or missing departure time.</div>;
  }
  if (!Number.isFinite(Number(totalDistanceNm)) || Number(totalDistanceNm) <= 0) {
    return <div className="text-red-600 p-4">Error: Invalid or missing total distance.</div>;
  }
  if (!Number.isFinite(Number(vesselSpeedKnots)) || Number(vesselSpeedKnots) <= 0) {
    return <div className="text-red-600 p-4">Error: Invalid or missing vessel speed.</div>;
  }

  // All hooks must be at the top level
  const [windData, setWindData] = useState(null)
  const [marineData, setMarineData] = useState(null)
  const [currentData, setCurrentData] = useState(null)
  const [windError, setWindError] = useState(null)
  const [marineError, setMarineError] = useState(null)
  const [currentError, setCurrentError] = useState(null)
  const [currentSourceLabel, setCurrentSourceLabel] = useState('')
  const [loadingState, setLoadingState] = useState({ wind: 'idle', current: 'idle' })
  const [loading, setLoading] = useState(false)
  const [selectedTimestamp, setSelectedTimestamp] = useState(null)
  const [showOptimiser, setShowOptimiser] = useState(false)
  const [vesselSettings, setVesselSettings] = useState(null)
  const [physicsK, setPhysicsK] = useState(AMAROO.K)

  const departureDate = parsePlannerDateTime(departureTime)
  const departureMs = departureDate?.getTime() ?? null
  console.log('[PassageWeatherTimeline] before routeMidpoint', { waypoints });
  const midpoint = useMemo(() => {
    console.log('[PassageWeatherTimeline] ENTER routeMidpoint useMemo', { waypoints });
    return routeMidpoint(waypoints);
  }, [waypoints]);
  console.log('[PassageWeatherTimeline] after routeMidpoint', { midpoint });
  const nearestStation = useMemo(() => {
    console.log('[PassageWeatherTimeline] ENTER nearestStation useMemo', { midpoint, waypoints });
    if (!waypoints?.length || waypoints.length < 2) return null
    return findNearestStation(midpoint.lat, midpoint.lng)
  }, [midpoint, waypoints])
  console.log('[PassageWeatherTimeline] after nearestStation', { nearestStation });
  const legs = useMemo(() => {
    console.log('[PassageWeatherTimeline] ENTER buildLegs useMemo', { waypoints });
    return buildLegs(waypoints);
  }, [waypoints]);
  console.log('[PassageWeatherTimeline] after buildLegs', { legs });
  console.log('[PassageWeatherTimeline] after buildLegs', { legs });
  const baseSpeedKn = Number(vesselSpeedKnots) > 0 ? Number(vesselSpeedKnots) : AMAROO.v0
  const hullState = useMemo(() => foulingPenalty(monthsSinceHaulout), [monthsSinceHaulout])
  const hullLabel = useMemo(() => foulingConditionLabel(monthsSinceHaulout), [monthsSinceHaulout])
  console.log('[PassageWeatherTimeline] before fuelBurnBaseLhr useMemo', { vesselSettings });
  const fuelBurnBaseLhr = useMemo(() => {
    console.log('[PassageWeatherTimeline] ENTER fuelBurnBaseLhr useMemo', { vesselSettings });
    const fromSettings = Number(vesselSettings?.estimated_burn_rate_litres_per_hour)
    return Number.isFinite(fromSettings) && fromSettings > 0 ? fromSettings : AMAROO.fuelBurnLhr
  }, [vesselSettings]);
  console.log('[PassageWeatherTimeline] after fuelBurnBaseLhr', { fuelBurnBaseLhr });

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getVesselSettings().catch(() => null),
      getVesselSetting('physics_k').catch(() => null),
    ]).then(([settingsResult, kSetting]) => {
      if (!cancelled) {
        setVesselSettings(settingsResult?.data || settingsResult || null)
        const parsed = kSetting != null ? Number.parseFloat(kSetting) : AMAROO.K
        setPhysicsK(Number.isFinite(parsed) ? parsed : AMAROO.K)
      }
    }).catch(() => {
      if (!cancelled) {
        setVesselSettings(null)
        setPhysicsK(AMAROO.K)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!midpoint || !departureMs) return
    let cancelled = false
    setLoading(true)
    setWindError(null)
    setMarineError(null)
    setCurrentError(null)
    setCurrentSourceLabel('')
    setLoadingState({ wind: 'loading', current: 'loading' })


    // Calculate start and end dates for the passage
    const passageStartDate = new Date(departureMs)
    const passageDurationHrs = totalDistanceNm && baseSpeedKn > 0 ? totalDistanceNm / baseSpeedKn : 24
    const passageEndDate = new Date(departureMs + passageDurationHrs * 3600000)
    const startDateStr = toAESTDateStr(passageStartDate.getTime())
    const endDateStr = toAESTDateStr(passageEndDate.getTime())

    const windUrl = new URL('https://api.open-meteo.com/v1/forecast')
    windUrl.searchParams.set('latitude', midpoint.lat.toFixed(4))
    windUrl.searchParams.set('longitude', midpoint.lng.toFixed(4))
    windUrl.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,wind_gusts_10m')
    windUrl.searchParams.set('wind_speed_unit', 'kn')
    windUrl.searchParams.set('timezone', 'Australia/Brisbane')
    windUrl.searchParams.set('start_date', startDateStr)
    windUrl.searchParams.set('end_date', endDateStr)

    const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine')
    marineUrl.searchParams.set('latitude', midpoint.lat.toFixed(4))
    marineUrl.searchParams.set('longitude', midpoint.lng.toFixed(4))
    marineUrl.searchParams.set('hourly', 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height')
    marineUrl.searchParams.set('timezone', 'Australia/Brisbane')
    marineUrl.searchParams.set('start_date', startDateStr)
    marineUrl.searchParams.set('end_date', endDateStr)

    Promise.allSettled([
      fetch(windUrl.toString()),
      fetch(marineUrl.toString()),
      fetchOceanCurrentWithMeta(midpoint.lat, midpoint.lng, Math.ceil(passageDurationHrs) + 2, departureMs),
    ]).then(async ([windRes, marineRes, currentRes]) => {
      if (cancelled) return
      if (windRes.status === 'fulfilled' && windRes.value.ok) {
        setWindData(await windRes.value.json())
        setLoadingState((prev) => ({ ...prev, wind: 'ok' }))
      } else {
        setWindData(null)
        setWindError('Wind forecast unavailable — check connection')
        setLoadingState((prev) => ({ ...prev, wind: 'error' }))
      }
      if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
        setMarineData(await marineRes.value.json())
      } else {
        setMarineData(null)
        setMarineError('Marine forecast unavailable — check connection')
      }

      if (currentRes.status === 'fulfilled') {
        const result = currentRes.value
        const rows = Array.isArray(result?.data) ? result.data : null
        if (rows?.length) {
          setCurrentData(rows)
          if (result.cached) {
            setCurrentSourceLabel('⚠️ Ocean current: using cached data (live feed unavailable)')
            setCurrentError(result.error ? `Live current feed issue: ${result.error}` : null)
          } else {
            setCurrentSourceLabel(`✅ Ocean current source: ${result.source || 'live feed'}`)
            setCurrentError(null)
          }
          setLoadingState((prev) => ({ ...prev, current: 'ok' }))
        } else {
          setCurrentData(null)
          const reason = result?.error ? ` (${result.error})` : ''
          setCurrentError(`⚠️ Ocean current unavailable${reason} — passage calculated without current data`)
          setLoadingState((prev) => ({ ...prev, current: 'error' }))
        }
      } else {
        setCurrentData(null)
        setCurrentError('⚠️ Ocean current unavailable — passage calculated without current data')
        setLoadingState((prev) => ({ ...prev, current: 'error' }))
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [midpoint, departureMs, totalDistanceNm, baseSpeedKn])

  const windMap = useMemo(() => buildHourlyMap(windData?.hourly, (i) => ({
    windSpeed: windData.hourly.wind_speed_10m?.[i] ?? null,
    windDirection: windData.hourly.wind_direction_10m?.[i] ?? null,
    windGusts: windData.hourly.wind_gusts_10m?.[i] ?? null,
  })), [windData])

  const marineMap = useMemo(() => buildHourlyMap(marineData?.hourly, (i) => ({
    waveHeight: marineData.hourly.wave_height?.[i] ?? null,
    waveDirection: marineData.hourly.wave_direction?.[i] ?? null,
    wavePeriod: marineData.hourly.wave_period?.[i] ?? null,
    swellHeight: marineData.hourly.swell_wave_height?.[i] ?? null,
    swellDirection: marineData.hourly.swell_wave_direction?.[i] ?? null,
    swellPeriod: marineData.hourly.swell_wave_period?.[i] ?? null,
  })), [marineData])

  console.log('[PassageWeatherTimeline] before tideCurvePoints useMemo', { nearestStation, departureMs, totalDistanceNm, baseSpeedKn });
  const tideCurvePoints = useMemo(() => {
    console.log('[PassageWeatherTimeline] ENTER tideCurvePoints useMemo', { nearestStation, departureMs, totalDistanceNm, baseSpeedKn });
    if (!nearestStation?.id || !departureMs || !totalDistanceNm) return []
    const provisionalEnd = departureMs + (totalDistanceNm / Math.max(baseSpeedKn, 0.1)) * 3600000 + 24 * 3600000
    return buildTideCurve(nearestStation.id, departureMs, provisionalEnd)
  }, [nearestStation, departureMs, totalDistanceNm, baseSpeedKn]);
  console.log('[PassageWeatherTimeline] after tideCurvePoints', { tideCurvePointsLen: tideCurvePoints.length });

  console.log('[PassageWeatherTimeline] before preparePassageData useMemo', { departureMs, totalDistanceNm, baseSpeedKn, fuelBurnBaseLhr, legsLen: legs.length, tideCurvePointsLen: tideCurvePoints.length });
  // Calculate planned/predicted ETA and chartEndMs first
  const plannedEtaMs = useMemo(() => {
    if (!totalDistanceNm || !baseSpeedKn) return 0;
    return departureMs + (totalDistanceNm / baseSpeedKn) * 3600000;
  }, [departureMs, totalDistanceNm, baseSpeedKn]);
  // Use a dummy summary to get predictedEtaMs for initial xTicks calculation
  const dummyPrepared = useMemo(() => {
    return preparePassageData({
      departureMs,
      totalDistanceNm,
      baseSpeedKn,
      burnRateLhr: fuelBurnBaseLhr,
      legs,
      tideCurvePoints,
      windMap,
      marineMap,
      currentData,
      kCoefficient: physicsK,
      monthsSinceHaulout,
    });
  }, [departureMs, totalDistanceNm, baseSpeedKn, fuelBurnBaseLhr, legs, tideCurvePoints, windMap, marineMap, currentData, physicsK, monthsSinceHaulout]);
  const predictedEtaMs = dummyPrepared.predictedEtaMs;
  const chartEndMs = Math.max(plannedEtaMs || 0, predictedEtaMs || 0);
  const xTicks = useMemo(() => buildTimeTicks(departureMs || 0, chartEndMs || 0), [departureMs, chartEndMs]);
  const trueEndMs = getLast(xTicks) ?? chartEndMs;
  // Now generate the real prepared data up to trueEndMs
  const prepared = useMemo(() => {
    return preparePassageData({
      departureMs,
      totalDistanceNm,
      baseSpeedKn,
      burnRateLhr: fuelBurnBaseLhr,
      legs,
      tideCurvePoints,
      windMap,
      marineMap,
      currentData,
      kCoefficient: physicsK,
      endMs: trueEndMs,
      monthsSinceHaulout,
    });
  }, [departureMs, totalDistanceNm, baseSpeedKn, fuelBurnBaseLhr, legs, tideCurvePoints, windMap, marineMap, currentData, physicsK, trueEndMs, monthsSinceHaulout]);
  console.log('[PassageWeatherTimeline] after preparePassageData', { prepared });

  console.log('[PassageWeatherTimeline] before render return', { prepared });
  const mergedData = prepared.points
  const summary = prepared.summary
  if (summary?.error) {
    return <div className="text-red-600 p-4">{summary.error}</div>;
  }

  const comfortBands = useMemo(() => groupComfortBands(mergedData), [mergedData])
  const stackedImpactData = useMemo(() => buildStackedImpact(mergedData, baseSpeedKn), [mergedData, baseSpeedKn])
  const poorRanges = useMemo(() => getPoorPeriods(mergedData), [mergedData])
  // Always reflect the selected timeline point, default to start of voyage if none selected
  const selectedPoint = useMemo(() => {
    if (!mergedData.length) return null;
    if (selectedTimestamp != null) return pickSelectedPoint(mergedData, selectedTimestamp, departureMs || 0);
    // If no selection, default to the first point (start of voyage)
    return mergedData[0];
  }, [mergedData, selectedTimestamp, departureMs]);

  useEffect(() => {
    if (mergedData.length && selectedTimestamp == null) {
      setSelectedTimestamp(pickSelectedPoint(mergedData, null, departureMs || 0)?.timestamp ?? null)
    }
  }, [mergedData, selectedTimestamp, departureMs])

  const optimiserRows = useMemo(() => {
    if (!departureMs || !totalDistanceNm || !legs.length) return []
    const lastWindTs = Math.max(...Array.from(windMap.keys()), 0)
    const lastMarineTs = Math.max(...Array.from(marineMap.keys()), 0)
    const rows = []
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const baseDate = new Date(departureMs + dayOffset * 24 * 3600000)
      const rowDate = new Date(`${toAESTDateStr(baseDate.getTime())}T00:00:00+10:00`).getTime()
      const label = formatAESTDateTime(rowDate).slice(0, -6)
      const cells = [6, 7, 8, 9, 10].map((hour) => {
        const slot = rowDate + hour * 3600000
        const plannedEnd = slot + (totalDistanceNm / Math.max(baseSpeedKn, 0.1)) * 3600000
        const available = (!windMap.size || plannedEnd <= lastWindTs + 3600000) && (!marineMap.size || plannedEnd <= lastMarineTs + 3600000)
        if (!available) return { value: formatLocalInput(slot), available: false }
        const sim = preparePassageData({
          departureMs: slot,
          totalDistanceNm,
          baseSpeedKn,
          burnRateLhr: fuelBurnBaseLhr,
          legs,
          tideCurvePoints,
          windMap,
          marineMap,
          currentData,
          kCoefficient: physicsK,
          monthsSinceHaulout,
        })
        const score = sim.summary?.poorPct ? 'poor' : sim.summary?.moderatePct ? 'moderate' : 'good'
        return {
          value: formatLocalInput(slot),
          available: true,
          score,
          predictedEta: sim.predictedEtaMs ? formatAESTTime(sim.predictedEtaMs) : '—',
        }
      })
      rows.push({ date: rowDate, label, cells })
    }
    return rows
  }, [departureMs, totalDistanceNm, legs, windMap, marineMap, currentData, baseSpeedKn, fuelBurnBaseLhr, tideCurvePoints, physicsK, monthsSinceHaulout])

  const delayRecommendation = useMemo(() => {
    if (!poorRanges.length || !departureMs || !totalDistanceNm || !legs.length) return null
    for (const hours of [1, 2, 3]) {
      const shifted = preparePassageData({
        departureMs: departureMs + hours * 3600000,
        totalDistanceNm,
        baseSpeedKn,
        burnRateLhr: fuelBurnBaseLhr,
        legs,
        tideCurvePoints,
        windMap,
        marineMap,
        currentData,
        kCoefficient: physicsK,
        monthsSinceHaulout,
      })
      if (!shifted.points.some((point) => point.comfort.score === 'poor')) {
        return `Consider delaying departure by ${hours} hour${hours > 1 ? 's' : ''} to avoid the worst conditions.`
      }
    }
    return null
  }, [poorRanges, departureMs, totalDistanceNm, baseSpeedKn, fuelBurnBaseLhr, legs, tideCurvePoints, windMap, marineMap, currentData, physicsK, monthsSinceHaulout])

  const maxTide = useMemo(() => Math.max(3, ...mergedData.map((point) => point.tideHeight || 0)) + 0.3, [mergedData])
  const maxSpeed = useMemo(() => Math.max(baseSpeedKn + 2, ...mergedData.map((point) => point.speedOverGround || 0)) + 1, [mergedData, baseSpeedKn])
  const maxWind = useMemo(() => Math.max(20, ...mergedData.map((point) => point.windGusts || point.windSpeed || 0)) + 4, [mergedData])
  const maxWave = useMemo(() => Math.max(2.5, ...mergedData.map((point) => Math.max(point.waveHeight || 0, point.swellHeight || 0))) + 0.5, [mergedData])

  if (!waypoints?.length || waypoints.length < 2 || !departureMs || !totalDistanceNm) return null

  return (
    <div className="bg-white rounded-xl shadow border-t-4 border-[#0A4A52] p-4 mt-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-serif text-xl text-[#0A4A52]">🌦 Passage Weather Timeline</div>
          <div className="text-sm text-slate-600 mt-1">
            {departurePort || 'Start'} → {destination || waypoints[waypoints.length - 1]?.name || 'Destination'} | {totalDistanceNm}nm | Depart {formatAESTDateTime(departureMs)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Nearest tide station: {nearestStation?.station?.name || nearestStation?.name || '—'}{nearestStation?.distanceNm != null ? ` (${nearestStation.distanceNm.toFixed(1)}nm)` : ''}
          </div>
        </div>
      </div>

      {loading && (
        <>
          <LoadingCards />
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
            <div>✅ Tide data loaded (local)</div>
            <div>{loadingState.wind === 'ok' ? '✅ Wind forecast loaded' : '⏳ Fetching wind forecast...'}</div>
            <div>{loadingState.current === 'ok' ? '✅ Ocean current loaded' : '⏳ Fetching ocean current...'}</div>
          </div>
        </>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <SummaryCard title="🕐 Predicted ETA" value={predictedEtaMs ? formatAESTTime(predictedEtaMs) : '—'} sub={`${summary.etaDeltaMins >= 0 ? '+' : ''}${summary.etaDeltaMins} min vs planned`} accentClass={summary.etaDeltaMins > 0 ? 'text-[#C4603A]' : 'text-green-700'} />
          <SummaryCard title="⚡ Avg Speed" value={`${summary.avgSOG.toFixed(1)} kn SOG`} sub={`vs ${baseSpeedKn.toFixed(1)} kn planned`} accentClass="text-[#7C3AED]" />
          <SummaryCard title="⛽ Fuel Required" value={`${summary.totalFuelL} L total`} sub={`${summary.additionalFuelL >= 0 ? '+' : ''}${summary.additionalFuelL} L vs calm conditions`} accentClass={summary.additionalFuelL > summary.baselineFuelL * 0.1 ? 'text-[#C4603A]' : 'text-[#0A4A52]'} />
          <SummaryCard title="🛢 Fuel After" value={`${summary.fuelRemainingL.toLocaleString()} L`} sub={`${summary.fuelRemainingPct}% of capacity`} accentClass={summary.fuelRemainingPct < 30 ? 'text-red-600' : summary.fuelRemainingPct < 50 ? 'text-amber-600' : 'text-[#0A4A52]'} />
          <SummaryCard title="🌊 Conditions" value={`${summary.goodPct}% good`} sub={`${summary.moderatePct}% moderate · ${summary.poorPct}% poor`}>
            <div className="mt-2 h-3 rounded-full overflow-hidden bg-slate-200 flex">
              <div style={{ width: `${summary.goodPct}%`, backgroundColor: GOOD_COLOR }} />
              <div style={{ width: `${summary.moderatePct}%`, backgroundColor: MODERATE_COLOR }} />
              <div style={{ width: `${summary.poorPct}%`, backgroundColor: POOR_COLOR }} />
            </div>
          </SummaryCard>
          <SummaryCard title="📊 Biggest Impact" value={`${summary.avgWavePenalty >= summary.avgWindPenalty && summary.avgWavePenalty >= summary.avgSwellPenalty ? '🌊 Waves' : summary.avgWindPenalty >= summary.avgSwellPenalty ? '💨 Wind' : '🌀 Swell'}`} sub="Average speed penalties">
            <div className="text-xs text-slate-600 mt-2 space-y-0.5">
              <div>🌊 Waves: -{summary.avgWavePenalty}%</div>
              <div>💨 Wind: -{summary.avgWindPenalty}%</div>
              <div>🌀 Swell: -{summary.avgSwellPenalty}%</div>
              <div>🧫 Hull fouling: -{hullState.penaltyPct}%</div>
              <div>↔ Current: {summary.avgCurrentEffect >= 0 ? '+' : ''}{summary.avgCurrentEffect}kn</div>
            </div>
          </SummaryCard>
          <SummaryCard title="🧫 Hull Condition" value={hullLabel.label} sub={`${monthsSinceHaulout.toFixed(1)} months since clean`} accentClass="text-[#8E44AD]">
            <div className="text-xs text-slate-600 mt-2">Estimated impact: -{hullState.penaltyPct}% speed, +{hullState.fuelIncreasePct}% fuel</div>
          </SummaryCard>
        </div>
      )}

      {windError && <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">⚠ {windError}</div>}
      {marineError && <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">⚠ {marineError}</div>}
      {currentSourceLabel && <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{currentSourceLabel}</div>}
      {currentError && <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{currentError}</div>}

      <div className="mb-4">
        <div className="text-sm font-semibold text-[#0A4A52] mb-2">Composite Passage View</div>
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart
            data={mergedData}
            margin={{ top: 28, right: 74, left: 14, bottom: 18 }}
            onMouseMove={(state) => {
              const point = state?.activePayload?.[0]?.payload;
              if (point) setSelectedTimestamp(point.timestamp);
              else setSelectedTimestamp(null);
            }}
            onClick={(state) => {
              const point = state?.activePayload?.[0]?.payload;
              if (point) setSelectedTimestamp(point.timestamp);
            }}
            onMouseLeave={() => setSelectedTimestamp(null)}
          >
            <defs>
              <linearGradient id="timeline-tide-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0A4A52" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#B8D8E8" stopOpacity={0.2} />
              </linearGradient>
              <marker id="wind-arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#C4603A" /></marker>
              <marker id="wave-arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#2563EB" /></marker>
              <marker id="swell-arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#0A4A52" /></marker>
              <marker id="current-arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#8B5CF6" /></marker>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="timestamp" type="number" domain={[departureMs, chartEndMs]} ticks={xTicks} tickFormatter={formatAESTTime} tick={{ fontSize: 11, fill: '#6B7280' }} />
            <YAxis yAxisId="tide" domain={[0, maxTide]} tick={{ fontSize: 10 }} label={{ value: 'Tide (m)', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
            <YAxis yAxisId="speed" orientation="right" domain={[0, maxSpeed]} tick={{ fontSize: 10 }} width={44} label={{ value: 'SOG', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: SPEED_COLOR } }} />
            <YAxis yAxisId="wind" orientation="right" domain={[0, maxWind]} hide />
            <YAxis yAxisId="wave" orientation="right" domain={[0, maxWave]} hide />
            <YAxis yAxisId="arrows" domain={[0, 5]} hide />
            <Tooltip content={<RichTooltip baseSpeedKn={baseSpeedKn} />} />

            {comfortBands.map((band, index) => (
              <ReferenceArea key={`${band.start}-${index}`} x1={band.start} x2={band.end} yAxisId="tide" y1={maxTide - 0.25} y2={maxTide} fill={colorForComfort(band.score)} fillOpacity={0.8} label={band.end - band.start >= 60 * 60000 ? { value: labelForComfort(band.score), position: 'insideTop', fill: '#fff', fontSize: 9 } : undefined} />
            ))}

            <Area yAxisId="tide" type="monotone" dataKey="tideHeight" stroke="#0A4A52" fill="url(#timeline-tide-gradient)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="speed" type="monotone" dataKey="speedOverGround" stroke={SPEED_COLOR} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <ReferenceLine yAxisId="speed" y={baseSpeedKn} stroke="#94A3B8" strokeDasharray="4 3" label={{ value: `Planned ${baseSpeedKn.toFixed(0)}kn`, position: 'insideTopRight', fontSize: 9, fill: '#64748B' }} />
            {!windError && <Line yAxisId="wind" type="monotone" dataKey="windSpeed" stroke="#C4603A" strokeDasharray="5 5" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            {!marineError && <Line yAxisId="wave" type="monotone" dataKey="waveHeight" stroke={WAVE_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            {!marineError && <Line yAxisId="wave" type="monotone" dataKey="swellHeight" stroke="#0A4A52" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            {!marineError && <Line yAxisId="wind" type="monotone" dataKey="currentSpeed" stroke={CURRENT_COLOR} strokeWidth={1} dot={false} isAnimationActive={false} />}

            <ReferenceLine yAxisId="arrows" y={4.5} stroke="transparent" label={{ value: 'Wind', position: 'left', fontSize: 9, fill: '#64748B' }} />
            <ReferenceLine yAxisId="arrows" y={3.5} stroke="transparent" label={{ value: 'Wave', position: 'left', fontSize: 9, fill: '#64748B' }} />
            <ReferenceLine yAxisId="arrows" y={2.5} stroke="transparent" label={{ value: 'Swell', position: 'left', fontSize: 9, fill: '#64748B' }} />
            <ReferenceLine yAxisId="arrows" y={1.5} stroke="transparent" label={{ value: 'Current', position: 'left', fontSize: 9, fill: '#64748B' }} />

            {!windError && <Line yAxisId="arrows" type="monotone" dataKey="windArrowRow" stroke="transparent" dot={<DirectionArrowDot type="wind" color="#C4603A" />} isAnimationActive={false} />}
            {!marineError && <Line yAxisId="arrows" type="monotone" dataKey="waveArrowRow" stroke="transparent" dot={<DirectionArrowDot type="wave" color={WAVE_COLOR} />} isAnimationActive={false} />}
            {!marineError && <Line yAxisId="arrows" type="monotone" dataKey="swellArrowRow" stroke="transparent" dot={<DirectionArrowDot type="swell" color="#0A4A52" />} isAnimationActive={false} />}
            {!marineError && <Line yAxisId="arrows" type="monotone" dataKey="currentArrowRow" stroke="transparent" dot={<DirectionArrowDot type="current" color={CURRENT_COLOR} />} isAnimationActive={false} />}

            <ReferenceLine x={departureMs} stroke={GOOD_COLOR} strokeDasharray="4 3" label={{ value: 'Depart', position: 'top', fill: GOOD_COLOR, fontSize: 10 }} />
            {plannedEtaMs && <ReferenceLine x={plannedEtaMs} stroke="#94A3B8" strokeDasharray="4 3" label={{ value: 'Planned ETA', position: 'top', fill: '#64748B', fontSize: 10 }} />}
            {predictedEtaMs && <ReferenceLine x={predictedEtaMs} stroke="#C4603A" strokeWidth={2} label={{ value: 'Predicted ETA', position: 'top', fill: '#C4603A', fontSize: 10 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-4">
        <div className="text-sm font-semibold text-[#0A4A52] mb-2">Cumulative Speed Impact — tap bars to see breakdown</div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={stackedImpactData} margin={{ top: 20, right: 20, left: 10, bottom: 16 }} onMouseMove={(state) => {
            const point = state?.activePayload?.[0]?.payload
            if (point) setSelectedTimestamp(point.timestamp)
          }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="timestamp" type="number" domain={[departureMs, chartEndMs]} ticks={xTicks} tickFormatter={formatAESTTime} tick={{ fontSize: 11, fill: '#6B7280' }} />
            <YAxis domain={[Math.min(-1, ...stackedImpactData.map((point) => point.currentLoss || 0)), baseSpeedKn + 2]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey="actualSOG" stackId="speed" stroke={SPEED_COLOR} fill={SPEED_COLOR} fillOpacity={0.2} isAnimationActive={false} />
            <Area type="monotone" dataKey="foulingLoss" stackId="speed" stroke="#8E44AD" fill="#8E44AD" fillOpacity={0.35} isAnimationActive={false} />
            <Area type="monotone" dataKey="swellLoss" stackId="speed" stroke="#0A4A52" fill="#0A4A52" fillOpacity={0.4} isAnimationActive={false} />
            <Area type="monotone" dataKey="waveLoss" stackId="speed" stroke={WAVE_COLOR} fill={WAVE_COLOR} fillOpacity={0.35} isAnimationActive={false} />
            <Area type="monotone" dataKey="windLoss" stackId="speed" stroke="#C4603A" fill="#C4603A" fillOpacity={0.35} isAnimationActive={false} />
            <Area type="monotone" dataKey="currentGain" stroke={GOOD_COLOR} fill={GOOD_COLOR} fillOpacity={0.25} isAnimationActive={false} />
            <Area type="monotone" dataKey="currentLoss" stroke={POOR_COLOR} fill={POOR_COLOR} fillOpacity={0.25} isAnimationActive={false} />
            <ReferenceLine y={baseSpeedKn} stroke="#94A3B8" strokeDasharray="4 3" label={{ value: `Baseline ${baseSpeedKn.toFixed(0)}kn`, position: 'insideTopRight', fontSize: 9 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {selectedPoint && (
        <div className="mb-4">
          <div className="text-sm font-semibold text-[#0A4A52] mb-2">Conditions at {formatAESTTime(selectedPoint.timestamp)}</div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            <CompassRose label={`Wind ${(selectedPoint.windSpeed ?? 0).toFixed(0)}kn`} value={degreesToCardinal(selectedPoint.windDirection)} direction={selectedPoint.windDirection} />
            <CompassRose label={`Waves ${(selectedPoint.waveHeight ?? 0).toFixed(1)}m`} value={degreesToCardinal(selectedPoint.waveDirection)} direction={selectedPoint.waveDirection} />
            <CompassRose label={`Swell ${(selectedPoint.swellHeight ?? 0).toFixed(1)}m`} value={degreesToCardinal(selectedPoint.swellDirection)} direction={selectedPoint.swellDirection} />
            <CompassRose label={`Current ${(selectedPoint.currentSpeed ?? 0).toFixed(1)}kn`} value={degreesToCardinal(selectedPoint.currentDirection)} direction={selectedPoint.currentDirection} />
          </div>
          <div className="mt-2 text-xs text-slate-600">Current now: {formatCurrent(selectedPoint.currentSpeed, selectedPoint.currentDirection)}</div>
        </div>
      )}

      {!!poorRanges.length && selectedPoint && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="font-semibold text-red-700 mb-1">⚠️ Poor Conditions Expected</div>
          <div className="text-sm text-red-700">Between {formatAESTTime(poorRanges[0].start.timestamp)} and {formatAESTTime(poorRanges[0].end.timestamp + 30 * 60000)} ({formatDurationMins(((poorRanges[0].end.timestamp + 30 * 60000) - poorRanges[0].start.timestamp) / 60000)})</div>
          <div className="text-sm text-red-700 mt-1">Wind {Math.round(selectedPoint.windSpeed ?? 0)}kn {degreesToCardinal(selectedPoint.windDirection)}, Waves {(selectedPoint.waveHeight ?? 0).toFixed(1)}m, Swell {(selectedPoint.swellHeight ?? 0).toFixed(1)}m {degreesToCardinal(selectedPoint.swellDirection)}</div>
          <div className="text-sm text-red-700 mt-1">Predicted SOG: {selectedPoint.speedOverGround?.toFixed(1) ?? '—'} kn — {selectedPoint.speedOverGround && baseSpeedKn ? Math.round(Math.max(0, (baseSpeedKn - selectedPoint.speedOverGround) / baseSpeedKn * 100)) : '--'}% below cruise speed (at selected point)</div>
          <div className="text-sm text-red-700 mt-1">Fuel burn: {selectedPoint.fuelBurnLhr?.toFixed(1) ?? '—'} L/hr</div>
          {hullState.penaltyPct > 15 && (
            <div className="text-sm text-red-700 mt-1">⚠ Hull fouling is adding an estimated {hullState.penaltyPct}% speed loss. Consider diver clean before passage.</div>
          )}
          {delayRecommendation && <div className="text-sm font-medium text-red-800 mt-2">{delayRecommendation}</div>}
        </div>
      )}

      <details className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3" open={showOptimiser}>
        <summary className="cursor-pointer text-sm font-semibold text-[#0A4A52]" onClick={(event) => {
          event.preventDefault()
          setShowOptimiser((value) => !value)
        }}>📅 Find Best Departure Time</summary>
        {showOptimiser && (
          <div className="mt-3">
            <DepartureOptimiser rows={optimiserRows} selectedValue={formatLocalInput(departureMs)} onSelect={(value) => onDepartureTimeChange?.(value)} />
          </div>
        )}
      </details>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="inline-block w-8 border-t-2" style={{ borderColor: SPEED_COLOR }} />SOG predicted</span>
        <span className="flex items-center gap-1"><span className="inline-block w-8 border-t-2 border-dashed border-slate-400" />Baseline speed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-8 border-t-2 border-dashed" style={{ borderColor: '#C4603A' }} />Wind speed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-8 border-t-2" style={{ borderColor: WAVE_COLOR }} />Wave height</span>
        <span className="flex items-center gap-1"><span className="inline-block w-8 border-t-2 border-dashed" style={{ borderColor: '#0A4A52' }} />Swell height</span>
        <span className="flex items-center gap-1"><span className="inline-block w-8 border-t-2" style={{ borderColor: CURRENT_COLOR }} />Current speed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: '#C4603A', opacity: 0.5 }} />Wind loss</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: WAVE_COLOR, opacity: 0.5 }} />Wave loss</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: '#0A4A52', opacity: 0.5 }} />Swell loss</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: '#8E44AD', opacity: 0.5 }} />Fouling loss</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: GOOD_COLOR, opacity: 0.5 }} />Current gain</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: POOR_COLOR, opacity: 0.5 }} />Current loss</span>
        <span className="flex items-center gap-1">↗ Wind dir</span>
        <span className="flex items-center gap-1">↘ Wave dir</span>
        <span className="flex items-center gap-1">→ Swell dir</span>
        <span className="flex items-center gap-1">↗ Current dir</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: GOOD_COLOR }} />Good</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: MODERATE_COLOR }} />Moderate</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3" style={{ backgroundColor: POOR_COLOR }} />Poor conditions</span>
      </div>

      <p className="mt-3 text-[11px] italic text-slate-500">Ocean current data comes from the configured provider (live or cached fallback). Accuracy in enclosed bays including Moreton Bay may be limited. Weather forecasts beyond 48 hours have reduced accuracy. All performance figures are estimates — always exercise seamanship judgement.</p>
    </div>
  )
}

export default memo(PassageWeatherTimeline)