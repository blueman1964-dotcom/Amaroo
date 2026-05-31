import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from '@react-google-maps/api'
import { useGPS } from '../../hooks/useGPS'
import AISLayer from '../AISLayer'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

function createNumberedIcon(label, isStart, isEnd) {
  const bg = isStart ? '#16A34A' : isEnd ? '#C4603A' : '#0A4A52'
  const fs = String(label).length > 2 ? '9' : '11'
  return L.divIcon({
    html: `<div style="background:${bg};color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:${fs}px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${label}</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick && onMapClick(e.latlng) })
  return null
}

function LocationDot() {
  const { position, startWatching, stopWatching } = useGPS()

  useEffect(() => {
    startWatching()
    return () => stopWatching()
  }, [startWatching, stopWatching])

  if (!position) return null
  const icon = L.divIcon({
    className: '',
    html: `<div style="position:relative;width:16px;height:16px">
      <div class="gps-pulse-ring"></div>
      <div style="position:absolute;inset:3px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
  return (
    <Marker position={[position.lat, position.lng]} icon={icon}>
      <Popup>Your location{position.accuracy != null ? ` (±${Math.round(position.accuracy)} m)` : ''}</Popup>
    </Marker>
  )
}

function FitBounds({ waypoints, trigger }) {
  const map = useMap()
  const prevTrigger = useRef(0)

  useEffect(() => {
    if (!trigger || trigger === prevTrigger.current || waypoints.length < 2) return
    prevTrigger.current = trigger
    const bounds = L.latLngBounds(waypoints.map((w) => [w.lat, w.lng]))
    map.fitBounds(bounds, { padding: [40, 40] })
  }, [trigger, waypoints, map])

  return null
}

function LayerControl({ baseLayer, setBaseLayer, overlays, setOverlays, applyPreset, nonLeaflet = false }) {
  const divRef = useRef(null)
  useEffect(() => {
    if (!nonLeaflet && divRef.current) L.DomEvent.disableClickPropagation(divRef.current)
  }, [])

  const updateOverlay = (key, patch) => {
    setOverlays((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }))
  }

  return (
    <div className={nonLeaflet ? '' : 'leaflet-top leaflet-right'} style={nonLeaflet ? { position: 'absolute', top: 10, right: 10, zIndex: 1000, maxHeight: 'calc(100% - 20px)', display: 'flex', flexDirection: 'column' } : undefined}>
      <div
        ref={divRef}
        className="leaflet-control"
        style={{
          background: 'white',
          borderRadius: 6,
          padding: '7px 10px',
          marginTop: 10,
          marginRight: 10,
          boxShadow: '0 1px 5px rgba(0,0,0,0.35)',
          fontSize: 12,
          minWidth: 120,
          userSelect: 'none',
          overflowY: 'auto',
          maxHeight: '100%',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, color: '#222', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Base layer</div>
        {[
          { key: 'osm', label: 'Street map' },
          { key: 'satellite', label: 'Satellite' },
          { key: 'google', label: 'Google Earth satellite' },
          { key: 'bathy', label: 'Bathymetry base' },
        ].map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginBottom: 3, color: '#333' }}>
            <input type="radio" name="ppm-base" checked={baseLayer === key} onChange={() => setBaseLayer(key)} style={{ cursor: 'pointer' }} />
            {label}
          </label>
        ))}
        <div style={{ display: 'flex', gap: 6, margin: '6px 0 2px' }}>
          <button type="button" onClick={() => applyPreset('reef')} style={{ fontSize: 10, border: '1px solid #cbd5e1', borderRadius: 4, padding: '2px 5px', background: '#f8fafc', cursor: 'pointer' }}>Reef</button>
          <button type="button" onClick={() => applyPreset('passage')} style={{ fontSize: 10, border: '1px solid #cbd5e1', borderRadius: 4, padding: '2px 5px', background: '#f8fafc', cursor: 'pointer' }}>Passage</button>
          <button type="button" onClick={() => applyPreset('traffic')} style={{ fontSize: 10, border: '1px solid #cbd5e1', borderRadius: 4, padding: '2px 5px', background: '#f8fafc', cursor: 'pointer' }}>Traffic</button>
        </div>
        <div style={{ fontWeight: 700, margin: '7px 0 4px', color: '#222', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overlays</div>
        {[
          { key: 'seamark', label: 'Nautical marks', hasOpacity: true },
          { key: 'bathyContours', label: 'Depth contours', hasOpacity: true },
          { key: 'trafficLanes', label: 'Traffic lanes (static)', hasOpacity: true },
          { key: 'ais', label: '🔴 Live AIS vessels', hasOpacity: false },
        ].map(({ key, label, hasOpacity }) => (
          <div key={key} style={{ marginBottom: 5 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#333' }}>
              <input
                type="checkbox"
                checked={overlays[key].enabled}
                onChange={() => updateOverlay(key, { enabled: !overlays[key].enabled })}
                style={{ cursor: 'pointer' }}
              />
              {label}
            </label>
            {hasOpacity && (
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={overlays[key].opacity}
                onChange={(e) => updateOverlay(key, { opacity: Number(e.target.value) })}
                style={{ width: '100%', marginTop: 2 }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function FullscreenButton({ isFullscreen, onToggle, containerRef, nonLeaflet = false }) {
  const divRef = useRef(null)

  useEffect(() => {
    if (divRef.current) L.DomEvent.disableClickPropagation(divRef.current)
  }, [])

  return (
    <div className={nonLeaflet ? '' : 'leaflet-bottom leaflet-right'} style={nonLeaflet ? { position: 'absolute', right: 10, bottom: 10, zIndex: 1000 } : undefined}>
      <div ref={divRef} className="leaflet-control" style={nonLeaflet ? {} : { marginBottom: 30, marginRight: 10 }}>
        <button
          type="button"
          onClick={onToggle}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          style={{
            background: 'white',
            border: '2px solid rgba(0,0,0,0.2)',
            borderRadius: 4,
            width: 30,
            height: 30,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ lineHeight: 1 }}>⛶</span>
        </button>
      </div>
    </div>
  )
}

function GoogleSatelliteMap({ waypoints, onMapClick, onWaypointDrag, isFullscreen, position }) {
  const mapRef = useRef(null)

  const initialCenter = waypoints[0]
    ? { lat: waypoints[0].lat, lng: waypoints[0].lng }
    : { lat: -27.524, lng: 153.43 }

  const fitRoute = () => {
    if (!mapRef.current || waypoints.length < 2 || !window.google?.maps) return
    const bounds = new window.google.maps.LatLngBounds()
    waypoints.forEach((w) => bounds.extend({ lat: w.lat, lng: w.lng }))
    mapRef.current.fitBounds(bounds, 40)
  }

  useEffect(() => {
    fitRoute()
  }, [waypoints])

  useEffect(() => {
    const t = setTimeout(() => {
      if (mapRef.current && window.google?.maps) {
        window.google.maps.event.trigger(mapRef.current, 'resize')
        fitRoute()
      }
    }, 120)
    return () => clearTimeout(t)
  }, [isFullscreen])

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: isFullscreen ? '100dvh' : '400px' }}
      center={initialCenter}
      zoom={10}
      onLoad={(map) => {
        mapRef.current = map
        fitRoute()
      }}
      onClick={(e) => {
        if (!onMapClick || !e.latLng) return
        onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() })
      }}
      options={{
        mapTypeId: 'satellite',
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      }}
    >
      {waypoints.map((point, index) => {
        const isStart = index === 0
        const isEnd = index === waypoints.length - 1 && waypoints.length > 1
        const label = isStart ? 'S' : isEnd ? 'E' : String(index)
        return (
          <MarkerF
            key={point.id || `${point.lat}-${point.lng}-${index}`}
            position={{ lat: point.lat, lng: point.lng }}
            draggable={!!onWaypointDrag}
            label={{ text: label, color: '#fff', fontWeight: 'bold' }}
            onDragEnd={(ev) => {
              if (!onWaypointDrag || !ev.latLng) return
              onWaypointDrag(index, { lat: ev.latLng.lat(), lng: ev.latLng.lng() })
            }}
          />
        )
      })}
      {waypoints.length >= 2 && (
        <PolylineF
          path={waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))}
          options={{ strokeColor: '#0A4A52', strokeWeight: 3, strokeOpacity: 0.95 }}
        />
      )}
      {position && (
        <MarkerF
          position={{ lat: position.lat, lng: position.lng }}
          icon={{
            path: window.google?.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          }}
        />
      )}
    </GoogleMap>
  )
}

function FullscreenMapSync({ fullscreenState }) {
  const map = useMap()

  useEffect(() => {
    map.invalidateSize()
    const t = setTimeout(() => map.invalidateSize(), 120)
    return () => clearTimeout(t)
  }, [map, fullscreenState])

  return null
}

export default function PassagePlannerMap({ waypoints, onMapClick, onWaypointDrag, fitTrigger }) {
  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [baseLayer, setBaseLayer] = useState('osm')
  const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  const { isLoaded: googleLoaded, loadError: googleLoadError } = useJsApiLoader({ id: 'amaroo-google-maps', googleMapsApiKey: googleApiKey })
  const { position, startWatching, stopWatching } = useGPS()
  const [overlays, setOverlays] = useState({
    seamark: { enabled: true, opacity: 0.75 },
    bathyContours: { enabled: true, opacity: 0.8 },
    trafficLanes: { enabled: false, opacity: 0.65 },
    ais: { enabled: false },
  })

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement === containerRef.current) {
      document.exitFullscreen?.()
      return
    }
    containerRef.current?.requestFullscreen?.()
  }

  useEffect(() => {
    if (baseLayer !== 'google') return undefined
    startWatching()
    return () => stopWatching()
  }, [baseLayer, startWatching, stopWatching])

  const applyPreset = (preset) => {
    if (preset === 'reef') {
      setBaseLayer('satellite')
      setOverlays({
        seamark: { enabled: true, opacity: 0.85 },
        bathyContours: { enabled: true, opacity: 0.85 },
        trafficLanes: { enabled: false, opacity: 0.65 },
        ais: { enabled: false },
      })
      return
    }
    if (preset === 'traffic') {
      setBaseLayer('osm')
      setOverlays({
        seamark: { enabled: true, opacity: 0.6 },
        bathyContours: { enabled: false, opacity: 0.8 },
        trafficLanes: { enabled: true, opacity: 0.8 },
        ais: { enabled: true },
      })
      return
    }
    setBaseLayer('osm')
    setOverlays({
      seamark: { enabled: true, opacity: 0.75 },
      bathyContours: { enabled: true, opacity: 0.8 },
      trafficLanes: { enabled: false, opacity: 0.65 },
      ais: { enabled: false },
    })
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }} className="map-fullscreen-container">
      {baseLayer === 'google' ? (
        <>
          {!googleApiKey ? (
            <div style={{ height: isFullscreen ? '100dvh' : '400px', display: 'grid', placeItems: 'center', background: '#0b1720', color: '#e2e8f0', padding: 16, textAlign: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Google Satellite requires API key</div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>Set VITE_GOOGLE_MAPS_API_KEY in your .env file, then reload.</div>
              </div>
            </div>
          ) : googleLoadError ? (
            <div style={{ height: isFullscreen ? '100dvh' : '400px', display: 'grid', placeItems: 'center', background: '#0b1720', color: '#fecaca', padding: 16, textAlign: 'center' }}>
              Failed to load Google Maps API.
            </div>
          ) : googleLoaded ? (
            <GoogleSatelliteMap
              waypoints={waypoints}
              onMapClick={onMapClick}
              onWaypointDrag={onWaypointDrag}
              isFullscreen={isFullscreen}
              position={position}
            />
          ) : (
            <div style={{ height: isFullscreen ? '100dvh' : '400px', display: 'grid', placeItems: 'center', background: '#0b1720', color: '#e2e8f0' }}>
              Loading Google Satellite...
            </div>
          )}
        </>
      ) : (
        <MapContainer
        center={[-27.524, 153.43]}
        zoom={10}
        style={{ height: isFullscreen ? '100dvh' : '400px', width: '100%' }}
        scrollWheelZoom
      >
      {baseLayer === 'osm' ? (
        <TileLayer
          url={`https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY}`}
          attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={20}
        />
      ) : baseLayer === 'satellite' ? (
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics"
          maxZoom={19}
        />
      ) : (
        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="Bathymetry &copy; Esri"
          maxZoom={19}
        />
      )}

      {overlays.seamark.enabled && (
        <TileLayer
          url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>'
          opacity={overlays.seamark.opacity}
        />
      )}

      {overlays.bathyContours.enabled && (
        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}"
          attribution="Depth contours &copy; Esri"
          opacity={overlays.bathyContours.opacity}
          maxZoom={19}
        />
      )}

      {overlays.trafficLanes.enabled && (
        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}"
          attribution="Marine traffic lanes &copy; Esri"
          opacity={overlays.trafficLanes.opacity}
          maxZoom={19}
        />
      )}

      <AISLayer enabled={overlays.ais?.enabled ?? false} />
      <FullscreenMapSync fullscreenState={isFullscreen} />
      <LocationDot />
      <MapClickHandler onMapClick={onMapClick} />
      {fitTrigger > 0 && <FitBounds waypoints={waypoints} trigger={fitTrigger} />}

      {waypoints.map((point, index) => {
        const isStart = index === 0
        const isEnd = index === waypoints.length - 1 && waypoints.length > 1
        const label = isStart ? 'S' : isEnd ? 'E' : String(index)
        return (
          <Marker
            key={point.id || `${point.lat}-${point.lng}-${index}`}
            position={[point.lat, point.lng]}
            draggable={!!onWaypointDrag}
            icon={createNumberedIcon(label, isStart, isEnd)}
            eventHandlers={
              onWaypointDrag
                ? {
                    dragend: (e) => {
                      const ll = e.target.getLatLng()
                      onWaypointDrag(index, { lat: ll.lat, lng: ll.lng })
                    },
                  }
                : undefined
            }
          >
            <Popup>{point.name || (isStart ? 'Start' : isEnd ? 'End' : `WP ${index}`)}</Popup>
          </Marker>
        )
      })}

      {waypoints.length >= 2 && (
        <Polyline
          positions={waypoints.map((w) => [w.lat, w.lng])}
          pathOptions={{ color: '#0A4A52', weight: 2, dashArray: '8 6' }}
        />
      )}
        </MapContainer>
      )}
      <LayerControl baseLayer={baseLayer} setBaseLayer={setBaseLayer} overlays={overlays} setOverlays={setOverlays} applyPreset={applyPreset} nonLeaflet />
      <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} containerRef={containerRef} nonLeaflet />
    </div>
  )
}
