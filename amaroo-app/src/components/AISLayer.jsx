import L from 'leaflet'
import { Marker, Popup, useMapEvents } from 'react-leaflet'
import { useEffect, useRef, useState } from 'react'
import { useAIS } from '../hooks/useAIS'

function shipColor(shipType) {
  if (shipType == null) return '#6b7280'
  if (shipType >= 60 && shipType <= 69) return '#7c3aed' // passenger
  if (shipType >= 70 && shipType <= 79) return '#b45309' // cargo
  if (shipType >= 80 && shipType <= 89) return '#dc2626' // tanker
  if (shipType >= 30 && shipType <= 32) return '#0369a1' // fishing
  return '#0A4A52'
}

function makeAISIcon(vessel) {
  const cog = vessel.cog ?? vessel.heading ?? 0
  const color = shipColor(vessel.shipType)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
    <g transform="rotate(${cog}, 10, 10)">
      <polygon points="10,2 14,16 10,13 6,16" fill="${color}" stroke="white" stroke-width="1.5"/>
    </g>
  </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  })
}

// Round to 1 decimal place so minor pan/zoom doesn't trigger reconnection
function roundBound(v) { return Math.round(v * 10) / 10 }

function BoundsTracker({ onBoundsChange }) {
  const debounceRef = useRef(null)

  const update = (map) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onBoundsChange(map.getBounds()), 1500)
  }

  const map = useMapEvents({
    moveend: () => update(map),
    zoomend: () => update(map),
  })

  const firedRef = useRef(false)
  useEffect(() => {
    if (!firedRef.current) {
      firedRef.current = true
      onBoundsChange(map.getBounds())
    }
  }, [map, onBoundsChange])

  return null
}

export default function AISLayer({ enabled }) {
  const [bounds, setBounds] = useState(null)

  // Use map bounds but enforce a minimum 1.5° radius so zoomed-in views still get nearby vessels
  const south = bounds ? roundBound(Math.min(bounds.getSouth() - 0.5, bounds.getCenter().lat - 1.5)) : null
  const west  = bounds ? roundBound(Math.min(bounds.getWest()  - 0.5, bounds.getCenter().lng - 1.5)) : null
  const north = bounds ? roundBound(Math.max(bounds.getNorth() + 0.5, bounds.getCenter().lat + 1.5)) : null
  const east  = bounds ? roundBound(Math.max(bounds.getEast()  + 0.5, bounds.getCenter().lng + 1.5)) : null

  const { vessels, connected, error } = useAIS({ enabled, south, west, north, east })

  return (
    <>
      <BoundsTracker onBoundsChange={setBounds} />

      {enabled && vessels.map((v) => (
        <Marker key={v.mmsi} position={[v.lat, v.lng]} icon={makeAISIcon(v)}>
          <Popup>
            <div className="text-xs space-y-0.5 min-w-[140px]">
              <div className="font-bold text-sm">{v.name}</div>
              <div className="text-slate-500">MMSI: {v.mmsi}</div>
              {v.sog != null && <div>SOG: {v.sog.toFixed(1)} kn</div>}
              {v.cog != null && <div>COG: {Math.round(v.cog)}°</div>}
              {v.length != null && v.length > 0 && <div>Length: {v.length} m</div>}
            </div>
          </Popup>
        </Marker>
      ))}

      {enabled && (
        <div className="leaflet-bottom leaflet-left" style={{ pointerEvents: 'none' }}>
          <div
            className="leaflet-control m-2 px-2 py-1 rounded text-xs font-medium"
            style={{ background: connected ? '#16a34a' : error ? '#dc2626' : '#6b7280', color: 'white' }}
            title={error ?? undefined}
          >
            {connected
              ? `AIS ● ${vessels.length} vessel${vessels.length !== 1 ? 's' : ''}`
              : error
              ? `AIS: ${error}`
              : 'AIS connecting…'}
          </div>
        </div>
      )}
    </>
  )
}
