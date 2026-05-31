import { useState, useEffect } from 'react'
import { differenceInDays, parseISO } from 'date-fns'
import { upsertVoyageConfig } from './GalleyUtils'

export default function VoyageSetup({ voyageConfig, onSaved }) {
  const [form, setForm] = useState({
    voyage_name: '',
    start_date: '',
    end_date: '',
    num_crew: 2,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (voyageConfig) {
      setForm({
        voyage_name: voyageConfig.voyage_name || '',
        start_date: voyageConfig.start_date || '',
        end_date: voyageConfig.end_date || '',
        num_crew: voyageConfig.num_crew ?? 2,
      })
    }
  }, [voyageConfig])

  const numDays =
    form.start_date && form.end_date
      ? Math.max(1, differenceInDays(parseISO(form.end_date), parseISO(form.start_date)) + 1)
      : null

  async function handleSave(e) {
    e.preventDefault()
    if (!form.voyage_name.trim()) { setError('Voyage name is required.'); return }
    if (!form.start_date || !form.end_date) { setError('Start and end dates are required.'); return }
    if (form.end_date < form.start_date) { setError('End date must be on or after start date.'); return }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await upsertVoyageConfig(form)
      setMessage('Voyage configuration saved.')
      onSaved()
    } catch (err) {
      setError(err.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold text-[#0A4A52] mb-4">Voyage Setup</h2>

      {voyageConfig && (
        <div className="mb-4 rounded-xl bg-teal-50 border border-teal-200 p-4 text-sm text-[#0A4A52]">
          <p className="font-semibold mb-1">Current voyage: {voyageConfig.voyage_name}</p>
          <p>{voyageConfig.start_date} → {voyageConfig.end_date}</p>
          <p>{voyageConfig.num_crew} crew · {numDays} day{numDays !== 1 ? 's' : ''}</p>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Voyage name</label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A52]"
            value={form.voyage_name}
            onChange={(e) => setForm((f) => ({ ...f, voyage_name: e.target.value }))}
            placeholder="e.g. Whitsundays 2026"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Start date</label>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A52]"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">End date</label>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A52]"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
            />
          </div>
        </div>

        {numDays !== null && (
          <p className="text-sm text-teal-700 font-medium">
            Duration: {numDays} day{numDays !== 1 ? 's' : ''}
          </p>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Number of crew</label>
          <input
            type="number"
            min={1}
            max={20}
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A52]"
            value={form.num_crew}
            onChange={(e) => setForm((f) => ({ ...f, num_crew: Number(e.target.value) }))}
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {message && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{message}</div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0A4A52] px-4 py-2 text-sm text-white hover:bg-[#083b42] disabled:opacity-50 transition"
        >
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
      </form>
    </div>
  )
}
