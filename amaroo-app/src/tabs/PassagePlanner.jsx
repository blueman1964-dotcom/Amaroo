import { useEffect, useMemo, useRef, useState } from 'react'
import PassagePlannerMap from '../components/common/PassagePlannerMap'
import { haversineNm, totalRouteNm } from '../utils/calculations'
import { getFuelLog, getVesselSettings } from '../db/api'
import {
  extractHourlyWeather,
  fetchRouteWeather,
  routeMidpoint,
} from '../utils/weatherApi'

const PASSAGE_PLANNER_STORAGE_KEY = 'amaroo_passage_plan'
const PENDING_VOYAGE_TRANSFER_KEY = 'amaroo_pending_voyage_transfer'

function loadStoredPlan() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PASSAGE_PLANNER_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function calculateLifetimeLph(fuelLog) {
  if (!fuelLog?.length || fuelLog.length < 2) return null
  const sorted = [...fuelLog]
    .filter((e) => e.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  let totalLitres = 0
  let totalHours = 0

  for (let i = 1; i < sorted.length; i += 1) {
    const curr = sorted[i]
    const prev = sorted[i - 1]
    const litres = Number(curr.litres || 0)
    const currHours = Number(curr.engine_hours_at_fill)
    const prevHours = Number(prev.engine_hours_at_fill)
    const delta = currHours - prevHours

    if (litres > 0 && Number.isFinite(delta) && delta > 0) {
      totalLitres += litres
      totalHours += delta
    }
  }

  if (totalHours <= 0) return null
  return Math.round((totalLitres / totalHours) * 10) / 10
}

function calculateLifetimeLpnm(fuelLog, cruiseSpeed = 12) {
  const lifetimeLph = calculateLifetimeLph(fuelLog)
  if (!lifetimeLph || cruiseSpeed <= 0) return null
  return Math.round((lifetimeLph / cruiseSpeed) * 100) / 100
}

function getFuelOnBoard(vesselSettings, fuelLog) {
  const fuelLevels = vesselSettings?.fuelLevels
  if (fuelLevels && typeof fuelLevels === 'object') {
    const levels = Object.values(fuelLevels).filter((v) => v !== null && v !== undefined)
    if (levels.length > 0) {
      return Math.round(levels.reduce((a, b) => Number(a) + Number(b), 0))
    }
  }

  const latest = [...(fuelLog || [])]
    .filter((e) => e.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .at(-1)

  if (latest?.tank_level_before !== null && latest?.tank_level_before !== undefined) {
    const pct = Number(latest.tank_level_before)
    if (Number.isFinite(pct) && pct >= 0) {
      return Math.round((2950 * pct) / 100)
    }
  }

  return null
}

function ResultsCard({ results, resultsRef }) {
  return (
    <div
      ref={resultsRef}
      className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4"
    >
      <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Trip Results</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between border-b border-slate-100 pb-1"><span>Distance</span><strong>{results.distNm} nm</strong></div>
        <div className="flex justify-between border-b border-slate-100 pb-1"><span>Speed</span><strong>{results.spd} kn</strong></div>
        <div className="flex justify-between border-b border-slate-100 pb-1"><span>Est. Travel Time</span><strong>{results.durH}h {results.durM.toString().padStart(2, '0')}m</strong></div>
        <div className="flex justify-between border-b border-slate-100 pb-1">
          <span>Fuel Used</span>
          <div className="text-right"><strong>{results.fuelUsed} L</strong><div className="text-xs text-slate-500">{results.fuelMethod}</div></div>
        </div>
        <div className="flex justify-between border-b border-slate-100 pb-1">
          <span>Est. Cost</span>
          <div className="text-right"><strong>{results.estCost !== null ? `$${results.estCost.toFixed(2)}` : 'N/A'}</strong><div className="text-xs text-slate-500">{results.priceSource || 'no price data'}</div></div>
        </div>
        <div className="flex justify-between border-b border-slate-100 pb-1"><span>Fuel on Board</span><strong>{results.currentFuel !== null ? `${results.currentFuel} L` : 'N/A'}</strong></div>
        <div className="flex justify-between"><span>Fuel Remaining after trip</span><strong>{results.remaining !== null ? `${results.remaining} L` : 'N/A'}</strong></div>
      </div>

      {results.currentFuel === null ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-100 text-slate-600 p-3 text-sm">
          Log tank readings in the Fuel Log to see fuel remaining.
        </div>
      ) : results.belowReserve ? (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-100 text-red-700 p-3 text-sm">
          ⚠ Warning: Fuel remaining ({results.remaining} L) is below the 10% reserve ({results.reserve} L). Refuel before departure or shorten the route.
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-green-300 bg-green-100 text-green-700 p-3 text-sm">
          ✓ Fuel margin: {results.remaining - results.reserve} L above reserve.
        </div>
      )}
    </div>
  )
}

export default function PassagePlanner({ goTab }) {
  const [mounted, setMounted] = useState(false)
  const [waypoints, setWaypoints] = useState([])
  const [departurePort, setDeparturePort] = useState('Aquatic Paradise')
  const [destination, setDestination] = useState('')
  const [speed, setSpeed] = useState(12)
  const [burnRateLph, setBurnRateLph] = useState('')
  const [efficiencyLpnm, setEfficiencyLpnm] = useState('')
  const [fuelPriceOverride, setFuelPriceOverride] = useState('')
  const [departureDate, setDepartureDate] = useState(new Date().toISOString().split('T')[0])
  const [departureHour, setDepartureHour] = useState(9)
  const [results, setResults] = useState(null)
  const [weather, setWeather] = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState(null)
  const [weatherMidpoint, setWeatherMidpoint] = useState({ lat: -27.5, lng: 153.4 })
  const [fuelLog, setFuelLog] = useState([])
  const [vesselSettings, setVesselSettings] = useState(null)
  const resultsRef = useRef(null)

  useEffect(() => {
    setMounted(true)
    const stored = loadStoredPlan()
    if (!stored) return
    setWaypoints(stored.waypoints || [])
    setDeparturePort(stored.departurePort || 'Aquatic Paradise')
    setDestination(stored.destination || '')
    setSpeed(stored.speed ?? 12)
    setBurnRateLph(stored.burnRateLph ?? '')
    setEfficiencyLpnm(stored.efficiencyLpnm ?? '')
    setFuelPriceOverride(stored.fuelPriceOverride ?? '')
    setDepartureDate(stored.departureDate || new Date().toISOString().split('T')[0])
    setDepartureHour(stored.departureHour ?? 9)
    setResults(stored.results || null)
    setWeather(stored.weather || null)
    setWeatherMidpoint(stored.weatherMidpoint || { lat: -27.5, lng: 153.4 })
  }, [])

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    window.localStorage.setItem(
      PASSAGE_PLANNER_STORAGE_KEY,
      JSON.stringify({
        waypoints,
        departurePort,
        destination,
        speed,
        burnRateLph,
        efficiencyLpnm,
        fuelPriceOverride,
        departureDate,
        departureHour,
        results,
        weather,
        weatherMidpoint,
      }),
    )
  }, [
    mounted,
    waypoints,
    departurePort,
    destination,
    speed,
    burnRateLph,
    efficiencyLpnm,
    fuelPriceOverride,
    departureDate,
    departureHour,
    results,
    weather,
    weatherMidpoint,
  ])

  useEffect(() => {
    async function loadData() {
      const [fuelRows, settingsRow] = await Promise.all([getFuelLog(), getVesselSettings()])
      setFuelLog(fuelRows || [])
      setVesselSettings(settingsRow?.data || settingsRow || null)
    }
    loadData()
  }, [])

  useEffect(() => {
    if (results) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [results])

  const distNm = useMemo(() => totalRouteNm(waypoints), [waypoints])

  const waypointCountText = useMemo(() => {
    if (waypoints.length === 0) return 'No waypoints yet — click the map to start'
    if (waypoints.length === 1) return '1 waypoint — click to add more'
    return `${waypoints.length} waypoints | Distance:`
  }, [waypoints.length])

  const handleMapClick = (latlng) => {
    setWaypoints((prev) => [...prev, { lat: latlng.lat, lng: latlng.lng }])
  }

  const handleRemoveLast = () => {
    setWaypoints((prev) => prev.slice(0, -1))
  }

  const handleClear = () => {
    setWaypoints([])
    setResults(null)
    setWeather(null)
    setWeatherError(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PASSAGE_PLANNER_STORAGE_KEY)
    }
  }

  const handleCalculate = () => {
    const routeNm = totalRouteNm(waypoints)
    if (!routeNm) return
    const firstLeg =
      waypoints.length >= 2
        ? haversineNm(waypoints[0].lat, waypoints[0].lng, waypoints[1].lat, waypoints[1].lng)
        : null
    void firstLeg

    const spd = parseFloat(speed) || 12
    const durHrs = routeNm / spd
    const durH = Math.floor(durHrs)
    const durM = Math.round((durHrs - durH) * 60)

    const lifetimeLph = calculateLifetimeLph(fuelLog)
    const lifetimeLpnm = calculateLifetimeLpnm(
      fuelLog,
      Number(vesselSettings?.cruise_speed_knots || 12),
    )

    let fuelUsed
    let fuelMethod
    const manualLph = parseFloat(burnRateLph)
    const manualLpnm = parseFloat(efficiencyLpnm)

    if (manualLph > 0) {
      fuelUsed = Math.round(manualLph * durHrs * 10) / 10
      fuelMethod = `${manualLph} L/hr (manual)`
    } else if (manualLpnm > 0) {
      fuelUsed = Math.round(manualLpnm * routeNm * 10) / 10
      fuelMethod = `${manualLpnm} L/nm (manual)`
    } else if (lifetimeLph) {
      fuelUsed = Math.round(lifetimeLph * durHrs * 10) / 10
      fuelMethod = `${lifetimeLph} L/hr (lifetime avg)`
    } else if (lifetimeLpnm) {
      fuelUsed = Math.round(lifetimeLpnm * routeNm * 10) / 10
      fuelMethod = `${lifetimeLpnm} L/nm (lifetime avg)`
    } else {
      fuelUsed = Math.round(60 * durHrs * 10) / 10
      fuelMethod = '60 L/hr (default - Cummins QSB 6.7 480HP est.)'
    }

    const prices = fuelLog.filter((e) => Number(e.cost_per_litre) > 0).map((e) => Number(e.cost_per_litre))
    const recentPrice = prices.length > 0 ? prices[prices.length - 1] : null
    const price = parseFloat(fuelPriceOverride) > 0 ? parseFloat(fuelPriceOverride) : recentPrice
    const priceSource = parseFloat(fuelPriceOverride) > 0 ? 'manual' : recentPrice ? 'most recent fill' : null
    const estCost = price ? Math.round(fuelUsed * price * 100) / 100 : null

    const TOTAL_CAPACITY = 2950
    const RESERVE = Math.round(TOTAL_CAPACITY * 0.1)

    const currentFuel = getFuelOnBoard(vesselSettings, fuelLog)
    const remaining = currentFuel !== null ? Math.round(currentFuel - fuelUsed) : null
    const belowReserve = remaining !== null && remaining < RESERVE

    setResults({
      distNm: routeNm,
      spd,
      durH,
      durM,
      fuelUsed,
      fuelMethod,
      estCost,
      priceSource,
      currentFuel,
      remaining,
      belowReserve,
      reserve: RESERVE,
    })
  }

  const handleFetchRouteWeather = async () => {
    if (waypoints.length < 2) return
    setWeatherLoading(true)
    setWeatherError(null)
    try {
      const midpoint = routeMidpoint(waypoints)
      setWeatherMidpoint(midpoint)
      const { marineData, windData, error } = await fetchRouteWeather(
        midpoint.lat,
        midpoint.lng,
        departureDate,
      )
      if (error) throw new Error(error)
      console.log('Open-Meteo route weather response:', { marineData, windData })
      const extracted = extractHourlyWeather(marineData, windData, Number(departureHour))
      setWeather(extracted)
    } catch (err) {
      setWeatherError(err.message)
    } finally {
      setWeatherLoading(false)
    }
  }

  const handleUseWeatherConditions = () => {
    if (!weather) return
    const durationMinutes = results ? results.durH * 60 + results.durM : null
    localStorage.setItem(
      PENDING_VOYAGE_TRANSFER_KEY,
      JSON.stringify({
        weather,
        departureDate,
        departureHour,
        midpoint: weatherMidpoint,
        trip: {
          waypoints,
          departurePort,
          destination,
          distanceNm: results?.distNm ?? distNm ?? null,
          speedKnots: results?.spd ?? Number(speed) ?? null,
          durationMinutes,
          fuelUsedLitres: results?.fuelUsed ?? null,
          estCost: results?.estCost ?? null,
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
    if (goTab) {
      goTab('voyagelog')
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className="lg:w-2/3">
        <div className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4">
          <h3 className="font-serif text-xl text-[#0A4A52]">Route Planner</h3>
          <p className="text-sm text-slate-500 mb-3">
            Click the map to add waypoints along your route. OpenSeaMap seamarks are layered for real marine planning.
          </p>
          <div style={{ height: '450px' }} className="rounded overflow-hidden border border-slate-200">
            {mounted ? (
              <PassagePlannerMap
                waypoints={waypoints}
                onMapClick={handleMapClick}
                onClear={handleClear}
              />
            ) : (
              <div className="h-full grid place-items-center text-slate-500">Loading map...</div>
            )}
          </div>

          <div className="flex justify-between items-center mt-3 gap-2 flex-wrap">
            <div>
              <span className="text-sm text-slate-500">{waypointCountText}</span>
              {distNm ? <span className="text-lg font-bold text-[#0A4A52] ml-2">{distNm} nm</span> : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRemoveLast}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
              >
                ↩ Remove Last
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-2 rounded-lg bg-[#C4603A] text-white hover:bg-[#b25532]"
              >
                Clear Route
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:w-1/3 flex flex-col gap-4">
        <div className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4">
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Passage Parameters</h3>

          <label className="text-sm block mb-2">
            Departure Port
            <input
              type="text"
              value={departurePort}
              onChange={(e) => setDeparturePort(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
            />
          </label>

          <label className="text-sm block mb-2">
            Destination
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
            />
          </label>

          <label className="text-sm block mb-2">
            Average Speed (knots)
            <input
              type="number"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
            />
          </label>

          <label className="text-sm block mb-2">
            Departure Date
            <input
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
            />
          </label>

          <label className="text-sm block mb-2">
            Departure Time
            <select
              value={departureHour}
              onChange={(e) => setDepartureHour(Number(e.target.value))}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
            >
              {[6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((hour) => (
                <option key={hour} value={hour}>{`${hour}:00`}</option>
              ))}
            </select>
          </label>

          <label className="text-sm block mb-2">
            Burn Rate (L/hr)
            <input
              type="number"
              value={burnRateLph}
              onChange={(e) => setBurnRateLph(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
              placeholder="Leave blank for lifetime average"
            />
            <div className="text-xs text-slate-500 mt-1">Cummins QSB 6.7 480HP - estimated 60 L/hr at cruise</div>
          </label>

          <label className="text-sm block mb-2">
            Efficiency (L/nm)
            <input
              type="number"
              value={efficiencyLpnm}
              onChange={(e) => setEfficiencyLpnm(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
              placeholder="Leave blank for lifetime average"
            />
          </label>

          <label className="text-sm block mb-3">
            Fuel Price ($/L)
            <input
              type="number"
              value={fuelPriceOverride}
              onChange={(e) => setFuelPriceOverride(e.target.value)}
              className="w-full mt-1 rounded-lg border border-slate-300 p-2"
              placeholder="Optional"
            />
            <div className="text-xs text-slate-500 mt-1">Leave blank to use most recent price from your fuel log</div>
          </label>

          <button
            type="button"
            onClick={handleCalculate}
            className="w-full px-4 py-2 rounded-lg bg-[#0A4A52] text-white hover:bg-[#083b42]"
          >
            Calculate Trip
          </button>
          <button
            type="button"
            onClick={handleFetchRouteWeather}
            disabled={waypoints.length < 2 || weatherLoading}
            className="w-full mt-2 px-4 py-2 rounded-lg bg-[#C4603A] text-white hover:bg-[#b25532] disabled:opacity-50"
          >
            {weatherLoading ? 'Fetching Weather...' : 'Fetch Route Weather'}
          </button>
          {weatherError ? <div className="text-xs text-red-600 mt-2">{weatherError}</div> : null}
        </div>

        {results ? <ResultsCard results={results} resultsRef={resultsRef} /> : null}
        {weather ? (
          <div className="bg-white rounded-lg shadow border-t-4 border-[#0A4A52] p-4">
            <h3 className="font-bold text-[#0A4A52] mb-3">
              Route Weather - {departureDate} at {departureHour}:00
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Based on midpoint of route ({weatherMidpoint.lat.toFixed(2)}°, {weatherMidpoint.lng.toFixed(2)}°)
            </p>

            <div className="mb-3">
              <div className="text-xs font-bold text-gray-500 uppercase mb-1">Wind</div>
              <div className="flex justify-between">
                <span className="text-lg font-bold text-[#0A4A52]">{weather.windKn ?? '-'} kn</span>
                <span className="text-gray-600">{weather.windDirCompass} ({weather.windDirDeg ?? '-'}°)</span>
              </div>
              <div className="text-sm text-gray-500">Gusts to {weather.windGustKn ?? '-'} kn</div>
            </div>

            <div className="mb-3">
              <div className="text-xs font-bold text-gray-500 uppercase mb-1">Waves</div>
              <div className="flex justify-between">
                <span className="text-lg font-bold text-[#0A4A52]">{weather.waveHeightM ?? '-'} m</span>
                <span className="text-gray-600">{weather.waveDirCompass} · {weather.wavePeriodS ?? '-'}s period</span>
              </div>
            </div>

            <div className="mb-3">
              <div className="text-xs font-bold text-gray-500 uppercase mb-1">Swell</div>
              <div className="flex justify-between">
                <span className="text-lg font-bold text-[#0A4A52]">{weather.swellHeightM ?? '-'} m</span>
                <span className="text-gray-600">{weather.swellDirCompass} · {weather.swellPeriodS ?? '-'}s period</span>
              </div>
            </div>

            <div className="text-sm mb-2">
              Comfort: {weather.windKn >= 30 || weather.waveHeightM >= 2 ? 'No-Go' : weather.windKn >= 20 || weather.waveHeightM >= 1.5 ? 'Marginal' : 'Comfortable'}
            </div>

            {weather.windKn >= 20 && (
              <div className="bg-amber-50 border border-amber-300 rounded p-2 text-sm text-amber-800 mt-2">
                ⚠ Wind {weather.windKn} kn - marginal conditions for Amaroo. Review forecast carefully.
              </div>
            )}
            {weather.windKn >= 30 && (
              <div className="bg-red-50 border border-red-300 rounded p-2 text-sm text-red-800 mt-2">
                🚨 Wind {weather.windKn} kn - consider delaying departure.
              </div>
            )}
            {weather.waveHeightM >= 1.5 && (
              <div className="bg-amber-50 border border-amber-300 rounded p-2 text-sm text-amber-800 mt-2">
                ⚠ Waves {weather.waveHeightM} m - will be uncomfortable. Check crew and vessel readiness.
              </div>
            )}

            <div className="text-xs text-gray-400 mt-3">
              Source: Open-Meteo Marine API (GFS model) - free, no API key required
            </div>

            <button
              onClick={handleUseWeatherConditions}
              className="w-full mt-3 py-2 bg-[#0A4A52] text-white rounded text-sm font-medium"
              type="button"
            >
              Send Trip & Weather to Voyage Log
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
