import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Navigation, X } from 'lucide-react'
import { useGPS } from '../hooks/useGPS'

function bearingTo(from, to) {
  const φ1 = (from.lat * Math.PI) / 180
  const φ2 = (to.lat * Math.PI) / 180
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function distanceNm(a, b) {
  const R = 3440.065
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function MOBAlert({ active, mobPosition, onDismiss, currentPosition }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) { setElapsed(0); return }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [active])

  if (!active || !mobPosition) return null

  const bearing = currentPosition ? bearingTo(currentPosition, mobPosition) : null
  const distance = currentPosition ? distanceNm(currentPosition, mobPosition) : null

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] bg-red-600 text-white shadow-2xl animate-pulse-once">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-4">
        <AlertTriangle size={28} className="shrink-0 animate-bounce" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-xl tracking-wider">MAN OVERBOARD</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mt-1">
            <span>⏱ Time in water: <strong>{formatElapsed(elapsed)}</strong></span>
            {bearing !== null && (
              <span>
                <Navigation size={13} className="inline mb-0.5" /> Bearing: <strong>{Math.round(bearing)}°T</strong>
              </span>
            )}
            {distance !== null && (
              <span>Distance: <strong>{distance < 0.1 ? `${Math.round(distance * 1852)}m` : `${distance.toFixed(2)} nm`}</strong></span>
            )}
            <span className="text-red-200">
              {mobPosition.lat.toFixed(5)}°, {mobPosition.lng.toFixed(5)}°
            </span>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 bg-red-800 hover:bg-red-900 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  )
}
