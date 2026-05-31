import { useState, useEffect } from 'react'
import { Star, Loader, ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react'
import { getHistoricalRatings } from './GalleyUtils'

const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

function Stars({ value }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={12}
          className={n <= value ? 'text-amber-400' : 'text-slate-200'}
          fill={n <= value ? 'currentColor' : 'none'}
        />
      ))}
    </span>
  )
}

function avg(arr) {
  if (!arr.length) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

export default function GalleyReview({ voyageConfig }) {
  const [ratings, setRatings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getHistoricalRatings()
      .then(setRatings)
      .catch(() => setRatings([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
        <Loader size={16} className="animate-spin" /> Loading ratings…
      </div>
    )
  }

  if (!ratings.length) {
    return (
      <div className="text-center py-10 text-slate-400">
        <Star size={32} className="mx-auto mb-2 opacity-30" />
        <p>No meals rated yet.</p>
        <p className="text-xs mt-1">Rate meals in the Meal Plan tab as you cook them — the AI will learn your preferences for future voyages.</p>
      </div>
    )
  }

  const overallAvg = avg(ratings.map((r) => r.rating))
  const loved = ratings.filter((r) => r.rating >= 4)
  const avoided = ratings.filter((r) => r.rating <= 2)
  const withNotes = ratings.filter((r) => r.notes?.trim())

  const slotAvgs = ['breakfast', 'lunch', 'dinner'].map((slot) => {
    const slotRatings = ratings.filter((r) => r.meal_slot === slot).map((r) => r.rating)
    return { slot, avg: avg(slotRatings), count: slotRatings.length }
  })

  // Rating distribution
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratings.filter((r) => r.rating === star).length,
  }))

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-2xl font-bold text-[#0A4A52]">{ratings.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Meals rated</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-2xl font-bold text-amber-500">{overallAvg?.toFixed(1)}</p>
          <p className="text-xs text-slate-500 mt-0.5">Average rating</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{loved.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Loved (4–5★)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-2xl font-bold text-red-500">{avoided.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">To avoid (1–2★)</p>
        </div>
      </div>

      {/* Rating distribution */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-[#0A4A52] mb-3">Rating distribution</p>
        <div className="space-y-2">
          {dist.map(({ star, count }) => (
            <div key={star} className="flex items-center gap-3">
              <Stars value={star} />
              <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-400 transition-all"
                  style={{ width: ratings.length ? `${(count / ratings.length) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-xs text-slate-500 w-6 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By meal slot */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-[#0A4A52] mb-3">Average by meal slot</p>
        <div className="grid grid-cols-3 gap-3">
          {slotAvgs.map(({ slot, avg: a, count }) => (
            <div key={slot} className="text-center">
              <p className="text-xs text-[#C4603A] font-semibold mb-1">{SLOT_LABELS[slot]}</p>
              {a !== null ? (
                <>
                  <p className="text-lg font-bold text-slate-800">{a.toFixed(1)}</p>
                  <Stars value={Math.round(a)} />
                  <p className="text-xs text-slate-400 mt-1">{count} rated</p>
                </>
              ) : (
                <p className="text-xs text-slate-300">No ratings</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Top meals */}
      {loved.length > 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ThumbsUp size={15} className="text-green-600" />
            <p className="text-sm font-semibold text-green-800">Top meals — AI will suggest similar dishes</p>
          </div>
          <div className="space-y-1.5">
            {loved.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-slate-800 font-medium">{r.meal_name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {r.notes && (
                    <span className="text-xs text-slate-400 italic max-w-[160px] truncate">{r.notes}</span>
                  )}
                  <Stars value={r.rating} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meals to avoid */}
      {avoided.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ThumbsDown size={15} className="text-red-600" />
            <p className="text-sm font-semibold text-red-800">Meals to avoid — AI will skip these</p>
          </div>
          <div className="space-y-1.5">
            {avoided.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{r.meal_name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {r.notes && (
                    <span className="text-xs text-slate-400 italic max-w-[160px] truncate">{r.notes}</span>
                  )}
                  <Stars value={r.rating} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Crew notes */}
      {withNotes.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare size={15} className="text-[#0A4A52]" />
            <p className="text-sm font-semibold text-[#0A4A52]">Crew notes</p>
          </div>
          <div className="space-y-2">
            {withNotes.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <Stars value={r.rating} />
                <div>
                  <span className="font-medium text-slate-700">{r.meal_name}</span>
                  <span className="text-slate-500"> — {r.notes}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 text-center pb-2">
        Ratings from all voyages on Amaroo are used to inform future meal plan generation.
      </p>
    </div>
  )
}
