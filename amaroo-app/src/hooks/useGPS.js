import { useCallback, useEffect, useRef, useState } from 'react'

const HOME_BERTH = { lat: -27.524, lng: 153.43 }

export { HOME_BERTH }

export function useGPS(options = {}) {
  const {
    enableHighAccuracy = true,
    maximumAge = 30_000,
    timeout = 15_000,
    updateInterval = 10_000,
  } = options

  const [position, setPosition] = useState(null)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const watchIdRef = useRef(null)
  const lastUpdateTsRef = useRef(0)

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
  }, [])

  const startWatching = useCallback(() => {
    if (!navigator.geolocation) {
      setPosition({ ...HOME_BERTH, speedKnots: null, heading: null, accuracy: null, timestamp: new Date().toISOString() })
      setSource('fallback')
      setError('Geolocation not supported')
      return
    }

    if (watchIdRef.current !== null) {
      return
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (lastUpdateTsRef.current && now - lastUpdateTsRef.current < updateInterval) {
          return
        }
        lastUpdateTsRef.current = now
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedKnots: pos.coords.speed == null ? null : pos.coords.speed * 1.94384,
          heading: pos.coords.heading == null ? null : pos.coords.heading,
          accuracy: pos.coords.accuracy,
          timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
        })
        setSource('gps')
        setError(null)
      },
      (err) => {
        setError(err.message)
        lastUpdateTsRef.current = Date.now()
        setPosition({ ...HOME_BERTH, speedKnots: null, heading: null, accuracy: null, timestamp: new Date().toISOString() })
        setSource('fallback')
      },
      { enableHighAccuracy, maximumAge, timeout },
    )
  }, [enableHighAccuracy, maximumAge, timeout, updateInterval])

  useEffect(() => () => stopWatching(), [stopWatching])

  return { position, error, source, startWatching, stopWatching }
}
