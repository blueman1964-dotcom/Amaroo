import { useEffect, useMemo, useState } from 'react'
import { db } from '../db/api'
import { extractHourlyWeather, fetchRouteWeather } from '../utils/weatherApi'

const DEFAULT_COORDS = { lat: -27.5, lng: 153.4 }
const PENDING_VOYAGE_TRANSFER_KEY = 'amaroo_pending_voyage_transfer'
const VOYAGE_DRAFT_STORAGE_KEY = 'amaroo_voyage_log_draft'
const WEATHER_META_PREFIX = '\n__AMAROO_WEATHER__'
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
  return normalizeGeneratedLines(clean)
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

function inferCoords(port) {
  const p = (port || '').toLowerCase()
  if (p.includes('moreton') || p.includes('brisbane')) return { lat: -27.5, lng: 153.4 }
  if (p.includes('gold coast')) return { lat: -28.0, lng: 153.4 }
  if (p.includes('sunshine') || p.includes('mooloolaba')) return { lat: -26.7, lng: 153.1 }
  if (p.includes('wide bay') || p.includes('tin can')) return { lat: -25.0, lng: 153.2 }
  return DEFAULT_COORDS
}

function tripLogRange(voyage) {
  const weatherData = extractStoredWeather(voyage.notes) || {}
  const startTripLog = Number(weatherData.trip_log_start_nm)
  const tripLogEnd = Number.isFinite(startTripLog)
    ? Math.round((startTripLog + Number(voyage.distance_nm || 0)) * 10) / 10
    : null
  return { startTripLog, tripLogEnd }
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
    persistDraft(nextForm, nextWeather)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setSaveMessage('')
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
      let coords = inferCoords(form.departure_port)
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          })
          coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        } catch {
          // Fallback to inferred/default coords.
        }
      }

      const { marineData, windData, error } = await fetchRouteWeather(coords.lat, coords.lng, form.date)
      if (error) throw new Error(error)
      const extracted = extractHourlyWeather(marineData, windData, departureHour)
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
        notes: buildStoredNotes(form.notes, {
          wind_kn: form.wind_kn,
          wind_direction_deg: form.wind_direction_deg,
          wave_height_m: form.wave_height_m,
          wave_direction_deg: form.wave_direction_deg,
          swell_height_m: form.swell_height_m,
          trip_log_start_nm: form.trip_log_start_nm,
        }),
      }

      if (editingId) {
        await db.update('voyage_log', editingId, payload)
      } else {
        await db.insert('voyage_log', payload)
      }

      if (triggerRefresh) triggerRefresh('all')
      setSaveMessage(editingId ? 'Voyage updated.' : 'Voyage saved.')
      setEditingId(null)
      setForm(DEFAULT_FORM)
      setWeather(null)
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
        </div>

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
              const weatherData = extractStoredWeather(voyage.notes) || {}
              const { startTripLog, tripLogEnd } = tripLogRange(voyage)
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
                    <button
                      type="button"
                      onClick={() => deleteVoyage(voyage.id)}
                      disabled={deletingId === voyage.id}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {deletingId === voyage.id ? 'Deleting...' : 'Delete Voyage'}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Crew / Hours</div>
                      <div className="mt-1 text-slate-700">Crew: {Number(voyage.crew_count || 0)}</div>
                      <div className="text-slate-700">Engine: {Number(voyage.engine_hours || 0)} h</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Wind</div>
                      <div className="mt-1 text-slate-700">{weatherData.wind_kn ?? '-'} kn</div>
                      <div className="text-slate-700">{weatherData.wind_direction_deg ?? '-'}°</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Waves</div>
                      <div className="mt-1 text-slate-700">{weatherData.wave_height_m ?? '-'} m</div>
                      <div className="text-slate-700">{weatherData.wave_direction_deg ?? '-'}°</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Swell</div>
                      <div className="mt-1 text-slate-700">{weatherData.swell_height_m ?? '-'} m</div>
                    </div>
                  </div>

                  {voyage.notes ? (
                    <div className="mt-3 rounded-lg bg-[#F7F3EE] p-3 text-sm text-slate-700 whitespace-pre-wrap">
                      {stripWeatherMeta(voyage.notes)}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
