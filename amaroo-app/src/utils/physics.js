import { foulingPenalty } from './hullFouling'

const DEG = Math.PI / 180

export function toRad(deg) {
  return deg * DEG
}

export function relativeAngle(bearing1, bearing2) {
  let diff = Math.abs(bearing1 - bearing2) % 360
  if (diff > 180) diff = 360 - diff
  return diff
}

export function directionFactor(theta) {
  return 0.5 + 0.5 * Math.cos(toRad(theta))
}

export function wavelengthFromTp(tpSec) {
  if (!isFinite(tpSec) || tpSec <= 0) return 0
  return (9.81 * tpSec * tpSec) / (2 * Math.PI)
}

export function gMultiplier(r, r0, sigma, gMin, gMax) {
  if (!isFinite(r) || r <= 0) return 1
  const raw = gMin + (gMax - gMin) * Math.exp(-((r - r0) ** 2) / (2 * sigma ** 2))
  return Math.max(0.2, Math.min(2.5, raw))
}

export function directionFactorFmin(thetaDeg, fmin) {
  const f = Math.max(0, Math.min(0.35, fmin))
  return f + (1 - f) * (0.5 + 0.5 * Math.cos(toRad(thetaDeg)))
}

export function computeSeaImpact(
  v0,
  L,
  K,
  hsWave,
  hsSwell,
  hsTotal,
  heightMode,
  waveFrom,
  heading,
  swellFrom,
  tpWave,
  tpSwell,
  tpTotal,
  fmin,
  combineMode,
  gR0,
  gSigma,
  gGmin,
  gGmax,
) {
  let hsEff
  let theta
  let F
  let base
  let lambdaWave
  let lambdaSwell
  let gWave
  let gSwell

  if (heightMode === 'partition') {
    const thetaWave = relativeAngle(waveFrom, heading)
    const thetaSwell = relativeAngle(swellFrom, heading)

    lambdaWave = wavelengthFromTp(tpWave)
    lambdaSwell = wavelengthFromTp(tpSwell)
    const rWave = L > 0 ? lambdaWave / L : 0
    const rSwell = L > 0 ? lambdaSwell / L : 0

    gWave = gMultiplier(rWave, gR0, gSigma, gGmin, gGmax)
    gSwell = gMultiplier(rSwell, gR0, gSigma, gGmin, gGmax)

    const FWave = directionFactorFmin(thetaWave, fmin)
    const FSwell = directionFactorFmin(thetaSwell, fmin)

    const ratioWave = L > 0 ? hsWave / L : 0
    const ratioSwell = L > 0 ? hsSwell / L : 0

    const baseWave = v0 * Math.pow(ratioWave, 1.5) * FWave * gWave
    const baseSwell = v0 * Math.pow(ratioSwell, 1.5) * FSwell * gSwell

    if (combineMode === 'energyWeighted') {
      const denom = hsWave * hsWave + hsSwell * hsSwell
      base = denom > 0 ? (hsWave * hsWave * baseWave + hsSwell * hsSwell * baseSwell) / denom : 0
    } else {
      base = baseWave + baseSwell
    }

    hsEff = Math.sqrt(Math.max(0, hsWave * hsWave + hsSwell * hsSwell))
    theta = thetaWave
    F = FWave
  } else {
    theta = relativeAngle(waveFrom, heading)
    const lambdaTotal = wavelengthFromTp(tpTotal)
    const rTotal = L > 0 ? lambdaTotal / L : 0
    const gTotal = gMultiplier(rTotal, gR0, gSigma, gGmin, gGmax)
    const FTotal = directionFactorFmin(theta, fmin)
    const ratio = L > 0 ? hsTotal / L : 0
    base = v0 * Math.pow(ratio, 1.5) * FTotal * gTotal
    hsEff = Math.max(0, hsTotal)
    F = FTotal
    lambdaWave = lambdaTotal
    gWave = gTotal
    lambdaSwell = 0
    gSwell = 1
  }

  const penalty = K * base
  const predictedSTW = Math.max(0, v0 - penalty)

  return { hsEff, theta, F, base, penalty, predictedSTW, lambdaWave, lambdaSwell, gWave, gSwell }
}

/**
 * Wrapper around computeSeaImpact that applies hull fouling penalty.
 * monthsSinceHaulout is read from app state and passed in.
 */
export function computeSeaImpactWithFouling(
  v0,
  L,
  K,
  hsWave,
  hsSwell,
  hsTotal,
  heightMode,
  waveFrom,
  heading,
  swellFrom,
  tpWave,
  tpSwell,
  tpTotal,
  fmin,
  combineMode,
  gR0,
  gSigma,
  gGmin,
  gGmax,
  monthsSinceHaulout = 0,
) {
  const fp = foulingPenalty(monthsSinceHaulout)
  const v0Fouled = v0 * fp.speedMultiplier

  const result = computeSeaImpact(
    v0Fouled,
    L,
    K,
    hsWave,
    hsSwell,
    hsTotal,
    heightMode,
    waveFrom,
    heading,
    swellFrom,
    tpWave,
    tpSwell,
    tpTotal,
    fmin,
    combineMode,
    gR0,
    gSigma,
    gGmin,
    gGmax,
  )

  return {
    ...result,
    foulingMonths: monthsSinceHaulout,
    foulingSpeedMultiplier: fp.speedMultiplier,
    foulingFuelMultiplier: fp.fuelMultiplier,
    foulingPenaltyPct: fp.penaltyPct,
    v0Clean: v0,
    v0Fouled,
  }
}

export function computeCurrent(stw, heading, currentSet, currentKn) {
  const stwE = stw * Math.sin(toRad(heading))
  const stwN = stw * Math.cos(toRad(heading))

  const curE = currentKn * Math.sin(toRad(currentSet))
  const curN = currentKn * Math.cos(toRad(currentSet))

  const sogE = stwE + curE
  const sogN = stwN + curN

  const sog = Math.sqrt(sogE ** 2 + sogN ** 2)
  let cog = Math.atan2(sogE, sogN) / DEG
  if (cog < 0) cog += 360

  return { sog, cog }
}

export function computeCourseToSteer(
  v0,
  L,
  K,
  hsWave,
  hsSwell,
  hsTotal,
  heightMode,
  waveFrom,
  desiredCOG,
  currentSet,
  currentKn,
  swellFrom,
  tpWave,
  tpSwell,
  tpTotal,
  fmin,
  combineMode,
  gR0,
  gSigma,
  gGmin,
  gGmax,
  maxIter = 25,
  tol = 0.01,
) {
  const cPerp = currentKn * Math.sin(toRad(currentSet - desiredCOG))
  const cAlong = currentKn * Math.cos(toRad(currentSet - desiredCOG))

  let heading = desiredCOG
  let stw = v0
  let penalty = 0
  let feasible = true

  for (let i = 0; i < maxIter; i++) {
    const sea = computeSeaImpact(
      v0, L, K, hsWave, hsSwell, hsTotal, heightMode, waveFrom, heading,
      swellFrom, tpWave, tpSwell, tpTotal, fmin, combineMode,
      gR0, gSigma, gGmin, gGmax,
    )
    stw = sea.predictedSTW
    penalty = sea.penalty

    if (stw <= Math.abs(cPerp)) {
      feasible = false
      break
    }

    const sinFerry = Math.max(-1, Math.min(1, cPerp / stw))
    const newHeading = ((desiredCOG - (Math.asin(sinFerry) / DEG)) % 360 + 360) % 360

    if (Math.abs(newHeading - ((heading % 360 + 360) % 360)) < tol) {
      heading = newHeading
      break
    }
    heading = newHeading
  }

  const ferryAngle = ((heading - desiredCOG + 540) % 360) - 180
  const sog = feasible ? cAlong + Math.sqrt(Math.max(0, stw ** 2 - cPerp ** 2)) : 0

  return {
    heading: ((heading % 360) + 360) % 360,
    stw,
    sog: Math.max(0, sog),
    seaPenalty: penalty,
    ferryAngle,
    feasible,
  }
}

export function linearRegression(xs, ys) {
  const n = xs.length
  if (n < 2) return { a: 0, b: 0, r2: 0 }

  const xMean = xs.reduce((s, x) => s + x, 0) / n
  const yMean = ys.reduce((s, y) => s + y, 0) / n

  let ssXX = 0
  let ssXY = 0
  let ssYY = 0
  for (let i = 0; i < n; i++) {
    ssXX += (xs[i] - xMean) ** 2
    ssXY += (xs[i] - xMean) * (ys[i] - yMean)
    ssYY += (ys[i] - yMean) ** 2
  }

  if (ssXX === 0) return { a: yMean, b: 0, r2: 0 }

  const b = ssXY / ssXX
  const a = yMean - b * xMean
  const r2 = ssYY > 0 ? (ssXY ** 2) / (ssXX * ssYY) : 1

  return { a, b, r2 }
}

export function fmt(n, decimals = 2) {
  if (n == null || isNaN(n) || !isFinite(n)) return '—'
  return n.toFixed(decimals)
}
