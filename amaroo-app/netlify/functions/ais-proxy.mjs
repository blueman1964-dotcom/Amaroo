import WebSocket from 'ws'

export default async (req) => {
  const url = new URL(req.url)
  const south = Number(url.searchParams.get('south') ?? -28.5)
  const west  = Number(url.searchParams.get('west')  ?? 152.5)
  const north = Number(url.searchParams.get('north') ?? -26.5)
  const east  = Number(url.searchParams.get('east')  ?? 154.5)

  const apiKey = process.env.AISSTREAM_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AISSTREAM_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const vessels = new Map()

  await new Promise((resolve) => {
    const done = () => { clearTimeout(timer); try { ws.close() } catch {} resolve() }
    const timer = setTimeout(done, 9_000)

    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream')

    ws.on('open', () => {
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[south, west], [north, east]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      }))
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.Error) { done(); return }

        const mmsi = String(msg.MetaData?.MMSI ?? '')
        if (!mmsi) return

        const pos  = msg.Message?.PositionReport
        const stat = msg.Message?.ShipStaticData
        const meta = msg.MetaData ?? {}

        const existing = vessels.get(mmsi) ?? {}
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
        }
        if (updated.lat != null && updated.lng != null) vessels.set(mmsi, updated)
      } catch { /* ignore malformed */ }
    })

    ws.on('error', done)
    ws.on('close', done)
  })

  return new Response(JSON.stringify(Array.from(vessels.values())), {
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/ais-proxy' }
