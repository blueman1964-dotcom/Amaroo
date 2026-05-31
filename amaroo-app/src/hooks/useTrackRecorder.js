import { useEffect, useRef, useState } from 'react'

const TRACK_DRAFT_KEY = 'amaroo_track_draft'

function saveDraft(points) {
  try {
    localStorage.setItem(TRACK_DRAFT_KEY, JSON.stringify(points))
  } catch { /* storage full — silently ignore */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(TRACK_DRAFT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function clearDraft() {
  localStorage.removeItem(TRACK_DRAFT_KEY)
}

export function useTrackRecorder() {
  const [trackPoints, setTrackPoints] = useState([])
  const [isRecording, setIsRecording] = useState(false)
  const watchIdRef = useRef(null)
  const pointsRef = useRef([])
  const lastPointRef = useRef(null)
  const lastWriteTimeRef = useRef(0)

  // On mount, restore any in-progress track that survived a page refresh.
  // App.jsx will call startRecording() when it sees timer.status === 'running' && !isRecording,
  // so we pass { resume: true } via a ref to tell startRecording not to wipe the draft.
  const hasDraftRef = useRef(false)
  useEffect(() => {
    const draft = loadDraft()
    if (draft.length > 0) {
      hasDraftRef.current = true
      pointsRef.current = draft
      setTrackPoints(draft)
      if (draft.length > 0) {
        lastPointRef.current = draft[draft.length - 1]
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const haversineMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6_371_000 // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  const pushPoint = (point) => {
    const now = Date.now()
    const last = lastPointRef.current

    // Write rules:
    // 1. Must be at least 8 seconds since last write
    // 2. OR must be at least 15 meters from last point
    // 3. Ignore fixes with accuracy > 100m (too poor quality)
    const timeSinceLastWrite = now - lastWriteTimeRef.current
    const metersFromLast = last ? haversineMeters(last.lat, last.lng, point.lat, point.lng) : 999
    const acceptableAccuracy = point.accuracy == null || point.accuracy <= 100

    const shouldWrite =
      acceptableAccuracy &&
      (timeSinceLastWrite >= 8_000 || metersFromLast >= 15)

    if (!shouldWrite) {
      // Still update lastPointRef so if next sample is better, we use the freshest position
      lastPointRef.current = point
      return
    }

    lastPointRef.current = point
    lastWriteTimeRef.current = now
    pointsRef.current = [...pointsRef.current, point]
    setTrackPoints(pointsRef.current)
    saveDraft(pointsRef.current)
  }

  const startRecording = ({ resume = false } = {}) => {
    // If called after a page refresh and we already restored a draft, don't wipe it.
    const isDraft = resume || hasDraftRef.current
    hasDraftRef.current = false
    if (!isDraft) {
      clearDraft()
      pointsRef.current = []
      setTrackPoints([])
      lastPointRef.current = null
      lastWriteTimeRef.current = 0
    }
    setIsRecording(true)

    if (!navigator.geolocation) return

    if (watchIdRef.current !== null) {
      return // Already watching
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        pushPoint({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed == null ? null : pos.coords.speed * 1.94384,
          heading: pos.coords.heading == null ? null : pos.coords.heading,
          accuracy: pos.coords.accuracy,
          timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
        })
      },
      (err) => {
        // Keep recording active even if GPS fails.
        console.warn('Track recording GPS error:', err)
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    )
  }

  const stopRecording = () => {
    setIsRecording(false)
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    return [...pointsRef.current]
  }

  const clearTrack = () => {
    clearDraft()
    pointsRef.current = []
    setTrackPoints([])
    lastPointRef.current = null
    lastWriteTimeRef.current = 0
  }

  useEffect(
    () => () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    },
    [],
  )

  return { trackPoints, isRecording, startRecording, stopRecording, clearTrack }
}
