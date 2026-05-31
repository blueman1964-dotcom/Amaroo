const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const south = Number(url.searchParams.get('south') ?? -28.5)
    const west  = Number(url.searchParams.get('west')  ?? 152.5)
    const north = Number(url.searchParams.get('north') ?? -26.5)
    const east  = Number(url.searchParams.get('east')  ?? 154.5)

    const apiKey = Deno.env.get('aisstream_api_key')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'aisstream_api_key secret not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const vessels = new Map<string, Record<string, unknown>>()

    await new Promise<void>((resolve) => {
      // Collect AIS messages for 8 seconds then return
      let ws: WebSocket

      const done = () => {
        clearTimeout(timer)
        try { ws?.close() } catch { /* ignore */ }
        resolve()
      }

      const timer = setTimeout(done, 8_000)

      ws = new WebSocket('wss://stream.aisstream.io/v0/stream')

      ws.onopen = () => {
        ws.send(JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [[[south, west], [north, east]]],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }))
      }

      ws.onmessage = (evt) => {
        try {
          const raw = typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer)
          const msg = JSON.parse(raw)

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
            name:     (stat?.Name?.trim() || (meta.ShipName as string)?.trim() || (existing.name as string) || mmsi),
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

          if (updated.lat != null && updated.lng != null) {
            vessels.set(mmsi, updated)
          }
        } catch { /* ignore malformed */ }
      }

      ws.onerror = () => done()
      ws.onclose = () => done()
    })

    return new Response(JSON.stringify(Array.from(vessels.values())), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
