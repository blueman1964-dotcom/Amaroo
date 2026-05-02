import { CircleMarker, MapContainer, Popup, Polyline, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

function labelForWaypoint(index, total) {
  if (total === 1) return 'Start'
  if (index === 0) return 'Start'
  if (index === total - 1) return 'End'
  return `WP${index}`
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => onMapClick(e.latlng),
  })
  return null
}

export default function PassagePlannerMap({ waypoints, onMapClick, onClear }) {
  void onClear
  return (
    <MapContainer
      center={[-27.5, 153.4]}
      zoom={8}
      style={{ height: '450px', width: '100%' }}
      scrollWheelZoom
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap"
      />
      <TileLayer
        url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
        attribution="&copy; OpenSeaMap"
        opacity={0.7}
      />
      <MapClickHandler onMapClick={onMapClick} />

      {waypoints.map((point, index) => (
        <CircleMarker
          key={`${point.lat}-${point.lng}-${index}`}
          center={[point.lat, point.lng]}
          radius={8}
          color="#0A4A52"
          fillColor="#FFFFFF"
          fillOpacity={1}
          weight={2}
        >
          <Popup>{labelForWaypoint(index, waypoints.length)}</Popup>
        </CircleMarker>
      ))}

      {waypoints.length >= 2 && (
        <Polyline
          positions={waypoints.map((w) => [w.lat, w.lng])}
          pathOptions={{ color: '#0A4A52', weight: 2, dashArray: '8 6' }}
        />
      )}
    </MapContainer>
  )
}
