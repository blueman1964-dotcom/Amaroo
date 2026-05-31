export const AMAROO = {
  name: 'Amaroo',
  type: 'Clipper Explorer 50 PH',
  loa: 15.24,
  beam: 4.67,
  draft: 1.65,
  displacement: 25,
  stabilisers: true,
  v0: 8.0,
  rpm0: 1550,
  // Confirmed vessel burn: 21 L/hr combined for both engines at 8 kn and 1550 rpm.
  fuelBurnLhr: 21,
  fuelCapacityL: 2950,
  K: 1.0,
  fmin: 0.15,
  gR0: 1.0,
  gSigma: 0.6,
  gGmin: 0.6,
  gGmax: 1.4,
  heightMode: 'partition',
  combineMode: 'sum',
}

/**
 * Amaroo RPM → calm-water STW curve.
 * Anchored by: user-confirmed 1550 RPM = 8.0 kn clean hull slack water.
 * Mid-range points from in-app speed log seed data.
 * Below 1450 and above 1750 extrapolated from displacement hull physics:
 *   - Hull speed ≈ 1.34 × √(LWL_ft) = 1.34 × √(44.9) ≈ 9.0 kn
 *   - Speed flattens sharply as hull speed is approached.
 * Clipper Explorer 50 PH: twin diesels, displacement hull, 25t, LOA 15.24m.
 */
export const AMAROO_RPM_CURVE = [
  { rpm: 700,  stwKn: 2.0 },   // dead slow / harbour manoeuvring
  { rpm: 900,  stwKn: 3.5 },   // slow ahead
  { rpm: 1100, stwKn: 5.2 },   // slow cruise
  { rpm: 1250, stwKn: 6.3 },   // below cruise
  { rpm: 1350, stwKn: 6.9 },   // below cruise
  { rpm: 1450, stwKn: 7.4 },   // speed log data
  { rpm: 1550, stwKn: 8.0 },   // user-confirmed, speed log data
  { rpm: 1650, stwKn: 8.45 },  // speed log data
  { rpm: 1750, stwKn: 8.85 },  // speed log data
  { rpm: 1900, stwKn: 9.1 },   // approaching hull speed
  { rpm: 2000, stwKn: 9.25 },  // near hull speed plateau
  { rpm: 2200, stwKn: 9.4 },   // diminishing returns
  { rpm: 2400, stwKn: 9.5 },   // hump / hull speed
  // Semi-planing / planing regime (Clipper Explorer 50 PH climbs over the hump)
  { rpm: 2500, stwKn: 11.0 },  // breaking over the hump
  { rpm: 2600, stwKn: 13.0 },  // planing
  { rpm: 2700, stwKn: 15.5 },  // planing, building speed
  { rpm: 2800, stwKn: 17.5 },  // fast cruise
  { rpm: 2900, stwKn: 19.0 },  // approaching WOT
  { rpm: 3000, stwKn: 20.0 },  // WOT, user-confirmed clean hull
]

/**
 * Interpolates STW from RPM using the AMAROO_RPM_CURVE.
 * Clamps to the min/max of the curve.
 * @param {number} rpm
 * @returns {number} stwKn
 */
export function rpmToSTW(rpm) {
  const curve = AMAROO_RPM_CURVE
  if (rpm <= curve[0].rpm) return curve[0].stwKn
  if (rpm >= curve[curve.length - 1].rpm) return curve[curve.length - 1].stwKn
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i].rpm) {
      const lo = curve[i - 1]
      const hi = curve[i]
      const frac = (rpm - lo.rpm) / (hi.rpm - lo.rpm)
      return lo.stwKn + frac * (hi.stwKn - lo.stwKn)
    }
  }
  return curve[curve.length - 1].stwKn
}

/**
 * Inverts the adjusted RPM curve to find RPM for a given STW.
 * curveAdj is a map of { [rpm]: deltaKn } matching the Speed tab's localStorage format.
 * @param {number} speedKn target speed through water
 * @param {Object} curveAdj optional user adjustments from Speed tab
 * @returns {number} estimated RPM
 */
export function stwToRpm(speedKn, curveAdj = {}) {
  const curve = AMAROO_RPM_CURVE.map((pt) => ({
    rpm: pt.rpm,
    stwKn: Math.max(0, pt.stwKn + (Number(curveAdj[pt.rpm]) || 0)),
  }))
  if (speedKn <= curve[0].stwKn) return curve[0].rpm
  if (speedKn >= curve[curve.length - 1].stwKn) return curve[curve.length - 1].rpm
  for (let i = 1; i < curve.length; i++) {
    if (speedKn <= curve[i].stwKn) {
      const lo = curve[i - 1]
      const hi = curve[i]
      const frac = (speedKn - lo.stwKn) / (hi.stwKn - lo.stwKn)
      return lo.rpm + frac * (hi.rpm - lo.rpm)
    }
  }
  return curve[curve.length - 1].rpm
}

/**
 * Amaroo RPM → fuel burn (L/hr combined for both engines).
 * Fitted power law anchored at user-confirmed data:
 *   - 1550 RPM = 21 L/hr (clean hull, calm water)
 *   - 3000 RPM ≈ 195 L/hr (WOT, user-confirmed)
 * Exponent 3.4 from propeller cube law and engine efficiency curve.
 * @param {number} rpm
 * @returns {number} L/hr combined
 */
export function rpmToFuelBurnLhr(rpm) {
  const ANCHOR_RPM = 1550
  const ANCHOR_LPH = 21
  return ANCHOR_LPH * Math.pow(rpm / ANCHOR_RPM, 3.4)
}

export const SPEED_LOG_SEED = [
  { tag: 'calm', rpm: 1450, stw: 7.4, sog: 7.5, notes: '', created_at: new Date(Date.now() - 6 * 86400000).toISOString() },
  { tag: 'calm', rpm: 1550, stw: 8.0, sog: 8.0, notes: '', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
  { tag: 'calm', rpm: 1650, stw: 8.45, sog: 8.4, notes: '', created_at: new Date(Date.now() - 4 * 86400000).toISOString() },
  { tag: 'calm', rpm: 1750, stw: 8.85, sog: 8.9, notes: '', created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
]
