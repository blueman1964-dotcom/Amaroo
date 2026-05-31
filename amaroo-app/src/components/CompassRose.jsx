const CX = 150
const CY = 150
const R = 112
const BOAT_CLEAR = 26
const FLAG_R = 70
const FLAG_HH = 10
const FLAG_P = 10
const MAX_KN = 5
const MIN_HW = 7
const MAX_HW = 28

function rad(d) { return d * Math.PI / 180 }

function bxy(bearing, dist) {
  return [CX + dist * Math.sin(rad(bearing)), CY - dist * Math.cos(rad(bearing))]
}

function hwFromKn(kn) {
  if (kn <= 0) return 0
  return Math.max(MIN_HW, Math.min(MAX_HW, (kn / MAX_KN) * MAX_HW))
}

function ForceFlag({ bearing, hw, text, color, fromOuter }) {
  if (hw <= 0) return null

  const [fx, fy] = bxy(bearing, FLAG_R)
  const pointDir = fromOuter ? (bearing + 180) % 360 : bearing
  const svgRot = pointDir - 90

  const pts = `${-hw},${-FLAG_HH} ${hw},${-FLAG_HH} ${hw + FLAG_P},0 ${hw},${FLAG_HH} ${-hw},${FLAG_HH}`

  const [sx1, sy1] = fromOuter ? bxy(bearing, R - 1) : bxy(bearing, BOAT_CLEAR)
  const [sx2, sy2] = fromOuter ? bxy(bearing, FLAG_R + hw + 2) : bxy(bearing, FLAG_R - hw - 2)

  return (
    <g>
      <line
        x1={sx1}
        y1={sy1}
        x2={sx2}
        y2={sy2}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={fromOuter ? '4,3' : undefined}
        strokeLinecap="round"
        opacity="0.7"
      />
      <g transform={`translate(${fx},${fy}) rotate(${svgRot})`}>
        <polygon points={pts} fill={color} stroke={color} strokeWidth="0.5" fillOpacity="0.88" />
        <text x={-2} y={0.5} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="bold" fill="white" fontFamily="sans-serif">
          {text}
        </text>
      </g>
    </g>
  )
}

const CARDINALS = [
  { label: 'N', bearing: 0 },
  { label: 'E', bearing: 90 },
  { label: 'S', bearing: 180 },
  { label: 'W', bearing: 270 },
]

const INTERCARDINALS = [
  { label: 'NE', bearing: 45 },
  { label: 'SE', bearing: 135 },
  { label: 'SW', bearing: 225 },
  { label: 'NW', bearing: 315 },
]

const TICK_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]

function LegendRow({ color, label, fromOuter, boat, dashed }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <svg width="26" height="12" viewBox="0 0 26 12" className="flex-shrink-0">
        {boat ? (
          <path d="M 13,0 C 17,2 17,8 16,10 L 13,11 L 10,10 C 9,8 9,2 13,0 Z" fill={color} />
        ) : dashed ? (
          <line x1="2" y1="6" x2="24" y2="6" stroke={color} strokeWidth="1.5" strokeDasharray="4,3" />
        ) : fromOuter ? (
          <polygon points="2,6 8,3 14,3 14,9 8,9" fill={color} fillOpacity="0.88" />
        ) : (
          <polygon points="24,6 18,3 12,3 12,9 18,9" fill={color} fillOpacity="0.88" />
        )}
      </svg>
      <span className="text-slate-500 truncate">{label}</span>
    </div>
  )
}

export default function CompassRose({
  heading,
  cog,
  sog,
  waveFrom,
  hsEff,
  swellFrom,
  hsSwell,
  showSwell,
  currentSet,
  currentKn,
  seaPenalty,
  ctsMode,
  desiredCOG,
}) {
  let wavePenalty = seaPenalty
  let swellPenalty = 0
  if (showSwell && hsEff > 0) {
    const hsw2 = Math.max(0, hsEff * hsEff - hsSwell * hsSwell)
    wavePenalty = seaPenalty * hsw2 / (hsEff * hsEff)
    swellPenalty = seaPenalty * hsSwell * hsSwell / (hsEff * hsEff)
  }

  const waveHW = hwFromKn(wavePenalty)
  const swellHW = hwFromKn(swellPenalty)
  const currentHW = hwFromKn(currentKn)
  const sogHW = hwFromKn(sog)

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width="300" height="300" viewBox="0 0 300 300">
        <circle cx={CX} cy={CY} r={R} fill="#F7F3EE" stroke="#93C5CA" strokeWidth="1.5" />
        <circle cx={CX} cy={CY} r={R * 0.45} fill="none" stroke="#C6D9DC" strokeWidth="1" strokeDasharray="3,5" />

        {TICK_BEARINGS.map((b) => {
          const isCard = b % 90 === 0
          const [ox, oy] = bxy(b, R)
          const [ix, iy] = bxy(b, R - (isCard ? 12 : 7))
          return <line key={b} x1={ox} y1={oy} x2={ix} y2={iy} stroke={isCard ? '#0A4A52' : '#7FA2A8'} strokeWidth={isCard ? 2 : 1} />
        })}

        {INTERCARDINALS.map(({ label, bearing }) => {
          const [x, y] = bxy(bearing, R + 12)
          return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="#4A6A6F" fontFamily="sans-serif">{label}</text>
        })}

        {CARDINALS.map(({ label, bearing }) => {
          const [x, y] = bxy(bearing, R + 15)
          return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="14" fontWeight="bold" fill={label === 'N' ? '#C4603A' : '#0A4A52'} fontFamily="sans-serif">{label}</text>
        })}

        {waveHW > 0 && <ForceFlag bearing={waveFrom} hw={waveHW} text={`${wavePenalty.toFixed(1)}kn`} color="#0A4A52" fromOuter />}
        {showSwell && swellHW > 0 && <ForceFlag bearing={swellFrom} hw={swellHW} text={`${swellPenalty.toFixed(1)}kn`} color="#4B8B92" fromOuter />}
        {currentHW > 0 && <ForceFlag bearing={currentSet} hw={currentHW} text={`${currentKn.toFixed(1)}kn`} color="#C4603A" />}
        {sogHW > 0 && <ForceFlag bearing={cog} hw={sogHW} text={`${sog.toFixed(1)}kn`} color="#2F855A" />}

        {ctsMode && (() => {
          const [dx, dy] = bxy(desiredCOG, R - 14)
          return <line x1={CX} y1={CY} x2={dx} y2={dy} stroke="#2F855A" strokeWidth={1} strokeDasharray="5,4" opacity="0.5" />
        })()}

        <g transform={`rotate(${heading}, ${CX}, ${CY})`}>
          <path
            d={`M ${CX},${CY - 19} C ${CX + 9},${CY - 8} ${CX + 9},${CY + 2} ${CX + 7},${CY + 9} L ${CX + 4},${CY + 14} L ${CX - 4},${CY + 14} L ${CX - 7},${CY + 9} C ${CX - 9},${CY + 2} ${CX - 9},${CY - 8} ${CX},${CY - 19} Z`}
            fill="#C4603A"
            stroke="#E7AE97"
            strokeWidth="1.2"
          />
          <circle cx={CX} cy={CY - 19} r="2.5" fill="#FCEAD5" />
        </g>
      </svg>

      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-xs w-full max-w-xs px-2">
        <LegendRow color="#0A4A52" label="Sea penalty (waves)" fromOuter />
        {showSwell ? <LegendRow color="#4B8B92" label="Sea penalty (swell)" fromOuter /> : <div />}
        {currentKn > 0 ? <LegendRow color="#C4603A" label={`Current ${currentKn.toFixed(1)} kn → ${currentSet}°T`} /> : <div />}
        <LegendRow color="#2F855A" label={`SOG ${sog.toFixed(1)} kn`} />
        <LegendRow color="#C4603A" label="Bow (heading)" boat />
        {ctsMode && <LegendRow color="#2F855A" label="Desired track" dashed />}
      </div>
    </div>
  )
}
