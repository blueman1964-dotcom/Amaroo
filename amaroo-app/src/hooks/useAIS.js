import { useEffect, useRef, useState } from 'react'

const STALE_MS = 10 * 60_000   // drop vessels not heard in 10 minutes
const STALE_CHECK_MS = 60_000  // prune stale vessels every 60 seconds

export function useAIS({ enabled = false, south, west, north, east } = {}) {
  const [vessels, setVessels] = useState([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const cacheRef = useRef({})   // mmsi -> { ...vessel, seenAt }
  const wsRef = useRef(null)
  const pruneRef = useRef(null)

  useEffect(() => {
    if (!enabled || south == null) {
      wsRef.current?.close()
      cacheRef.current = {}
      setVessels([])
      setConnected(false)
      setError(null)
      return
    }

    const flush = () => setVessels(Object.values(cacheRef.current))

    const prune = () => {
      const now = Date.now()
      let changed = false
      Object.keys(cacheRef.current).forEach((mmsi) => {
        if (now - cacheRef.current[mmsi].seenAt > STALE_MS) {
          delete cacheRef.current[mmsi]
          changed = true
        }
      })
      if (changed) flush()
    }

    const connect = () => {
      wsRef.current?.close()

      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ais-ws`)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({
          APIKey: import.meta.env.VITE_AISSTREAM_API_KEY,
          BoundingBoxes: [[[south, west], [north, east]]],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }))
        setConnected(true)
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.Error) { setError(msg.Error); return }

          const mmsi = String(msg.MetaData?.MMSI ?? '')
          if (!mmsi) return

          const pos  = msg.Message?.PositionReport
          const stat = msg.Message?.ShipStaticData
          const meta = msg.MetaData ?? {}

          const existing = cacheRef.current[mmsi] ?? {}
          const updated = {
            ...existing,
            mmsi,
            name:     stat?.Name?.trim() || meta.ShipName?.trim() || existing.name || mmsi,
            lat:      pos?.Latitude  ?? existing.lat,
            lng:      pos?.Longitude ?? existing.lng,
            cog:      pos?.Cog       ?? existing.cog,
            sog:      pos?.Sog       ?? existing.sog,
            heading:  pos?.TrueHeading ?? existing.heading,
            shipType: stat?.Type     ?? existing.shipType,
            length:   stat?.Dimension?.A != null
                        ? (stat.Dimension.A + stat.Dimension.B)
                        : existing.length,
            seenAt:   Date.now(),
          }
          if (updated.lat != null && updated.lng != null) {
            cacheRef.current[mmsi] = updated
            flush()
          }
        } catch { /* ignore malformed */ }
      }

      ws.onerror = () => {
        setConnected(false)
        setError('Connection error')
      }

      ws.onclose = (e) => {
        if (e.code === 1000) return  // clean close, we're tearing down
        setConnected(false)
        // reconnect after 5s on unexpected close
        setTimeout(connect, 5_000)
      }
    }

    connect()
    pruneRef.current = setInterval(prune, STALE_CHECK_MS)

    return () => {
      clearInterval(pruneRef.current)
      const ws = wsRef.current
      wsRef.current = null
      ws?.close(1000)
      cacheRef.current = {}
      setVessels([])
      setConnected(false)
      setError(null)
    }
  }, [enabled, south, west, north, east])

  return { vessels, connected, error }
}
