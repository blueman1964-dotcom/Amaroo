/**
 * Hull Fouling Model for Amaroo
 *
 * Models the progressive speed and fuel efficiency penalty
 * from biological growth between haulouts.
 *
 * Penalty curves are empirical approximations for fibreglass
 * displacement hulls in subtropical conditions (Brisbane,
 * Moreton Bay). Still-water canal berth at Aquatic Paradise
 * accelerates growth versus open-water moorings.
 *
 * Sources: Schultz (2007) fouling resistance data,
 * Candries & Atlar (2003) antifouling performance studies.
 */

/**
 * Returns a resistance increase multiplier based on months since haulout.
 * 1.0 = clean hull, increases with fouling.
 *
 * Growth stages:
 *   0-0.5 months  - fresh antifoul, near-clean
 *   0.5-1 months  - biofilm/slime layer forming
 *   1-3 months    - light fouling, small organisms
 *   3-6 months    - moderate fouling
 *   6-9 months    - heavy fouling, barnacles beginning
 *   9-12 months   - severe fouling
 *   12+ months    - extreme, significant barnacle/weed growth
 */
export function foulingResistanceMultiplier(monthsSinceHaulout) {
  const m = Math.max(0, monthsSinceHaulout)
  if (m <= 0.5) return 1.0
  if (m <= 1.0) return 1.03
  if (m <= 2.0) return 1.06
  if (m <= 3.0) return 1.1
  if (m <= 4.0) return 1.14
  if (m <= 6.0) return 1.19
  if (m <= 9.0) return 1.27
  if (m <= 12.0) return 1.35
  return 1.42
}

/**
 * Returns the estimated speed penalty as a fraction of base speed.
 * For a displacement hull at fixed RPM (fixed power input):
 *   Resistance ~ V^2 -> V ~ Power^(1/3) at fixed power
 *   Speed ratio = resistanceMultiplier^(-0.5) approximately
 *
 * Returns: { speedMultiplier, fuelMultiplier, penaltyPct, fuelIncreasePct }
 */
export function foulingPenalty(monthsSinceHaulout) {
  const rm = foulingResistanceMultiplier(monthsSinceHaulout)

  // Speed reduces as resistance increases (fixed RPM = fixed power)
  const speedMultiplier = 1 / Math.pow(rm, 0.5)

  // Fuel burn to maintain target speed increases faster than resistance
  // Power ~ resistance x velocity, so fuel ~ rm^1.5 approximately
  const fuelMultiplier = Math.pow(rm, 1.5)

  return {
    speedMultiplier,
    fuelMultiplier,
    penaltyPct: Math.round((1 - speedMultiplier) * 100),
    fuelIncreasePct: Math.round((fuelMultiplier - 1) * 100),
  }
}

/**
 * Calculates months between two dates.
 */
export function monthsBetween(fromDate, toDate = new Date()) {
  const from = new Date(fromDate)
  const to = new Date(toDate)
  return (to - from) / (1000 * 60 * 60 * 24 * 30.44)
}

/**
 * Returns a human-readable fouling condition label.
 */
export function foulingConditionLabel(monthsSinceHaulout) {
  const m = Math.max(0, monthsSinceHaulout)
  if (m <= 0.5) return { label: 'Clean', colour: '#2ECC71' }
  if (m <= 1.5) return { label: 'Very Light', colour: '#27AE60' }
  if (m <= 3.0) return { label: 'Light', colour: '#F1C40F' }
  if (m <= 6.0) return { label: 'Moderate', colour: '#E67E22' }
  if (m <= 9.0) return { label: 'Heavy', colour: '#E74C3C' }
  return { label: 'Severe', colour: '#8E44AD' }
}

/**
 * Recommended action thresholds.
 */
export function foulingRecommendation(monthsSinceHaulout) {
  const m = Math.max(0, monthsSinceHaulout)
  if (m <= 6) return null
  if (m <= 9) return 'Consider a diver hull clean to restore efficiency'
  if (m <= 12) return 'Diver hull clean recommended - significant efficiency loss'
  return 'Haulout and antifoul overdue - severe efficiency impact'
}
