export function haversineNm(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const dPhi = ((lat2 - lat1) * Math.PI) / 180
  const dLambda = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(((R * c) / 1852) * 10) / 10
}

export function totalRouteNm(waypoints) {
  if (!waypoints || waypoints.length < 2) return null
  let total = 0
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    total += haversineNm(
      waypoints[i].lat,
      waypoints[i].lng,
      waypoints[i + 1].lat,
      waypoints[i + 1].lng,
    )
  }
  return Math.round(total * 10) / 10
}
