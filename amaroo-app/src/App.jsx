import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  ClipboardCheck,
  Cloud,
  Compass,
  ContactRound,
  Droplets,
  FileText,
  Fuel,
  Gauge,
  HardHat,
  Package,
  RefreshCw,
  Settings,
  Shield,
  Ship,
  Waves,
  Webcam,
  Wrench,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  addMonths,
  differenceInDays,
  differenceInWeeks,
  format,
  isBefore,
  parseISO,
  startOfDay,
  subWeeks,
} from 'date-fns'
import { db } from './db/api'
import { seedIfEmpty } from './db/seed'
import { suggestedDocuments } from './data/seedData'
import { useDataRefresh } from './context/DataRefreshContext'
import PassagePlanner from './tabs/PassagePlanner'
import VoyageLog from './tabs/VoyageLog'
import Weather from './tabs/Weather'
import { extractHourlyWeather, fetchRouteWeather } from './utils/weatherApi'

const TAB_DEFS = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'engine', label: 'Engine Hours', icon: Wrench },
  { id: 'maintenance', label: 'Maintenance', icon: HardHat },
  { id: 'fuel', label: 'Fuel Log', icon: Fuel },
  { id: 'fluids', label: 'Fluid Levels', icon: Droplets },
  { id: 'safety', label: 'Safety Gear', icon: Shield },
  { id: 'contacts', label: 'Contacts', icon: ContactRound },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'voyage', label: 'Passage Planner', icon: Compass },
  { id: 'voyagelog', label: 'Voyage Log', icon: Ship },
  { id: 'parts', label: 'Parts', icon: Package },
  { id: 'barcams', label: 'Bar Cams', icon: Webcam },
  { id: 'weather', label: 'Weather', icon: Cloud },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const TRAFFIC = {
  overdue: '#DC2626',
  soon: '#D97706',
  current: '#16A34A',
}

const CHECKLISTS = {
  'Pre-Departure': [
    'Muir 3500 windlass isolator switch ON, chain clear of gypsy, chain stopper seated',
    'Anchor properly seated, shackle moused (wire-locked)',
    'ADC rise and fall platform stowed and locked',
    'Zodiac tender secured and outboard fuel tank full',
    'All Bomar hatches and ports closed for sea',
    'Exalto wipers operational',
    'Radar and Starlink clear and operational',
    'Engine oil and coolant checked on both Cummins QSB 6.7',
    'Sea strainers clear and bilge dry',
    'DTS both helm stations responding',
    'Mastervolt normal LEDs, Rainman flush status verified',
    'Water exiting both exhausts within 30 seconds after start',
    'AIS transmitting with MMSI 503106120',
  ],
  'After Passage': [
    'Engines cooled and visual inspection complete',
    'Fuel and fluid usage logged',
    'Rinse down hull and deck saltwater',
    'Shore power and battery charging verified',
    'Bilges inspected and pumps tested',
  ],
  'Lay-Up': [
    'Freshwater flush all raw water systems',
    'Rainman pickled if required',
    'Fuel tanks treated with biocide',
    'Security check and seacocks reviewed',
    'Electronics firmware and backups complete',
  ],
  'Post Haul-Out': [
    'Antifouling and anode condition logged',
    'Shaft seals and propellers inspected',
    'Thruster tunnel antifoul verified',
    'Trim tabs tested after launch',
    'Sea trial and leak checks complete',
  ],
}

function latestByDate(rows) {
  if (!rows?.length) return null
  return rows.reduce((latest, row) => (new Date(row.date) > new Date(latest.date) ? row : latest))
}

function dueStatus(task, latestHours, warningDays = 30) {
  if (!task) return 'current'
  const now = startOfDay(new Date())

  if (task.due_date) {
    const due = startOfDay(parseISO(task.due_date))
    if (isBefore(due, now)) return 'overdue'
    const daysLeft = differenceInDays(due, now)
    return daysLeft <= Number(warningDays || 30) ? 'soon' : 'current'
  }

  if (task.hours_interval && latestHours != null) {
    const dueHours = Number(task.last_service_hours || 0) + Number(task.hours_interval || 0)
    const remain = dueHours - Number(latestHours)
    if (remain <= 0) return 'overdue'
    return remain <= Number(task.hours_warning || 25) ? 'soon' : 'current'
  }

  if (task.week_interval && task.last_done_date) {
    const weeks = differenceInWeeks(now, startOfDay(parseISO(task.last_done_date)))
    if (weeks >= Number(task.week_interval)) return 'overdue'
    return weeks >= Number(task.week_interval) - 1 ? 'soon' : 'current'
  }

  return 'current'
}

const cardClass = (extra = '') => `rounded-xl bg-white p-4 shadow ${extra}`

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dataset, setDataset] = useState({
    vesselSettings: {},
    engineHours: [],
    maintenanceTasks: [],
    maintenanceLogs: [],
    fuelLog: [],
    fluidChecks: [],
    safetyItems: [],
    contacts: [],
    documents: [],
    voyageLog: [],
    mooringLog: [],
    departureChecks: [],
    parts: [],
    watermakerLog: [],
  })

  const { refreshKeys, triggerRefresh } = useDataRefresh()

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [
        vesselSettings,
        engineHours,
        maintenanceTasks,
        maintenanceLogs,
        fuelLog,
        fluidChecks,
        safetyItems,
        contacts,
        documents,
        voyageLog,
        mooringLog,
        departureChecks,
        parts,
        watermakerLog,
      ] = await Promise.all([
        db.getOne('vessel_settings', 1),
        db.getAll('engine_hours', 'date', false),
        db.getAll('maintenance_tasks', 'created_at', false),
        db.getAll('maintenance_logs', 'completed_date', false),
        db.getAll('fuel_log', 'date', false),
        db.getAll('fluid_checks', 'date', false),
        db.getAll('safety_items', 'created_at', false),
        db.getAll('contacts', 'category', true),
        db.getAll('documents', 'created_at', false),
        db.getAll('voyage_log', 'date', false),
        db.getAll('mooring_log', 'date', false),
        db.getAll('departure_checks', 'date', false),
        db.getAll('parts', 'name', true),
        db.getAll('watermaker_log', 'date', false),
      ])

      setDataset({
        vesselSettings: vesselSettings || {},
        engineHours,
        maintenanceTasks,
        maintenanceLogs,
        fuelLog,
        fluidChecks,
        safetyItems,
        contacts,
        documents,
        voyageLog,
        mooringLog,
        departureChecks,
        parts,
        watermakerLog,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        await seedIfEmpty()
      } catch (e) {
        setError(e.message)
      }
      await loadAll()
    })()
  }, [])

  useEffect(() => {
    if (!loading) loadAll()
  }, [refreshKeys.all])

  const shared = {
    dataset,
    triggerRefresh,
    goTab: setActiveTab,
    reload: loadAll,
  }

  const tabBody = {
    dashboard: <DashboardTab {...shared} />,
    engine: <EngineTab {...shared} />,
    maintenance: <MaintenanceTab {...shared} />,
    fuel: <FuelTab {...shared} />,
    fluids: <FluidsTab {...shared} />,
    safety: <SafetyTab {...shared} />,
    contacts: <ContactsTab {...shared} />,
    documents: <DocumentsTab {...shared} />,
    voyage: <PassagePlanner {...shared} />,
    voyagelog: <VoyageLog {...shared} />,
    parts: <PartsTab {...shared} />,
    barcams: <BarCamsTab />,
    weather: <Weather />,
    reports: <ReportsTab {...shared} />,
    settings: <SettingsTab {...shared} />,
  }[activeTab]

  return (
    <div className="min-h-screen bg-[#F7F3EE] text-slate-900">
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="hidden md:flex w-64 min-h-screen flex-col bg-[#0A4A52] text-white p-4 sticky top-0">
          <img src="/Amaroo_Logo.png" alt="Amaroo" className="w-full object-contain mb-4 bg-white/95 rounded-lg p-2" />
          <div className="font-serif text-2xl">Amaroo</div>
          <div className="text-sm text-teal-100 mb-4">Clipper Explorer 50 PH</div>
          <nav className="space-y-1 overflow-y-auto pr-1">
            {TAB_DEFS.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition ${
                    activeTab === t.id ? 'bg-[#C4603A] text-white' : 'hover:bg-teal-700'
                  }`}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              )
            })}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 pb-24 md:pb-6">
          <header className="sticky top-0 z-10 bg-[#F7F3EE]/90 backdrop-blur border-b border-teal-100 px-4 py-3 flex items-center justify-between">
            <div>
              <h1 className="font-serif text-2xl text-[#0A4A52]">Amaroo Vessel Management</h1>
              <p className="text-sm text-slate-600">BZI70Q · MMSI 503106120 · Brisbane</p>
            </div>
            <button
              type="button"
              onClick={loadAll}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0A4A52] px-3 py-2 text-white"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </header>

          {loading ? (
            <div className="p-10 text-center">
              <img src="/Amaroo_Logo.png" alt="Amaroo" className="mx-auto h-40 object-contain animate-pulse" />
              <p className="mt-3 text-[#0A4A52]">Loading Amaroo systems...</p>
            </div>
          ) : error ? (
            <div className="m-4 p-4 rounded-lg bg-red-100 text-red-700">{error}</div>
          ) : (
            <div className="p-4">{tabBody}</div>
          )}
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#0A4A52] text-white grid grid-cols-5 gap-1 p-2">
        {TAB_DEFS.slice(0, 10).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`text-xs rounded-md py-2 px-1 ${activeTab === t.id ? 'bg-[#C4603A]' : 'bg-teal-800'}`}
            >
              <Icon size={14} className="mx-auto mb-1" />
              {t.label.split(' ')[0]}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function DashboardTab({ dataset, goTab, reload }) {
  const { engineHours, maintenanceTasks, maintenanceLogs, fuelLog, vesselSettings } = dataset
  const [homeWeather, setHomeWeather] = useState(null)
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null)
  const [loadingWeather, setLoadingWeather] = useState(false)

  const fetchHomeWeather = async (force = false) => {
    const now = Date.now()
    if (!force && weatherUpdatedAt && now - weatherUpdatedAt < 30 * 60 * 1000) {
      return
    }
    setLoadingWeather(true)
    const hour = new Date().getHours()
    const { marineData, windData, error } = await fetchRouteWeather(-27.524, 153.43)
    if (!error) {
      const extracted = extractHourlyWeather(marineData, windData, hour)
      setHomeWeather(extracted)
      setWeatherUpdatedAt(now)
    }
    setLoadingWeather(false)
  }

  useEffect(() => {
    fetchHomeWeather(false)
  }, [])
  const latest = latestByDate(engineHours)
  const avgHours = latest ? (Number(latest.port_engine || 0) + Number(latest.stbd_engine || 0)) / 2 : 0

  const tasks = maintenanceTasks
    .map((t) => ({ ...t, statusFlag: dueStatus(t, avgHours, vesselSettings.maintenance_warning_days || 30) }))
    .sort((a, b) => {
      const rank = { overdue: 0, soon: 1, current: 2 }
      return rank[a.statusFlag] - rank[b.statusFlag]
    })
    .slice(0, 10)

  const recent = [
    ...maintenanceLogs.map((r) => ({ date: r.completed_date, text: `Maintenance: ${r.task}` })),
    ...fuelLog.map((r) => ({ date: r.date, text: `Fuel fill: ${r.litres}L at ${r.location}` })),
    ...engineHours.map((r) => ({ date: r.date, text: `Hours logged: P ${r.port_engine} / S ${r.stbd_engine}` })),
  ]
    .filter((r) => r.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)

  const insuranceLeft = differenceInDays(parseISO(vesselSettings.insurance_expiry || '2026-05-19'), new Date())
  const regLeft = differenceInDays(parseISO(vesselSettings.registration_expiry || '2026-05-28'), new Date())
  const showAlert = tasks.some((t) => t.statusFlag !== 'current') || insuranceLeft <= 60 || regLeft <= 60

  const litresAdded = fuelLog.reduce((sum, r) => sum + Number(r.litres || 0), 0)
  const estOnBoard = Math.min(
    (vesselSettings.port_tank_capacity || 1475) + (vesselSettings.stbd_tank_capacity || 1475),
    litresAdded > 0 ? 1200 + (litresAdded % 1800) : 1200,
  )
  const burn = Number(vesselSettings.estimated_burn_rate_litres_per_hour || 60)
  const range = burn > 0 ? (estOnBoard / burn) * Number(vesselSettings.cruise_speed_knots || 12) : 0

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  return (
    <div className="space-y-4">
      {showAlert && (
        <div className="rounded-xl p-4 bg-red-100 text-red-800 border border-red-200 flex items-start gap-2">
          <AlertTriangle className="mt-0.5" size={18} />
          <div>
            <div className="font-semibold">Attention required</div>
            <div className="text-sm">Overdue tasks or compliance dates are inside warning windows.</div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Port Engine" value={latest?.port_engine || 0} suffix="hrs" />
        <Stat title="Stbd Engine" value={latest?.stbd_engine || 0} suffix="hrs" />
        <Stat title="Generator" value={latest?.generator || 0} suffix="hrs" />
        <Stat title="Days Since Last Maintenance" value={maintenanceLogs[0]?.completed_date ? differenceInDays(new Date(), parseISO(maintenanceLogs[0].completed_date)) : 'N/A'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${cardClass()} lg:col-span-2`}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Upcoming Maintenance</h3>
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <div className="font-medium">{t.task}</div>
                  <div className="text-xs text-slate-500">{t.system}</div>
                </div>
                <span className="text-xs text-white rounded-full px-2 py-1" style={{ background: TRAFFIC[t.statusFlag] }}>
                  {t.statusFlag}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Fuel Status</h3>
          <p>Total on board: {Math.round(estOnBoard)} L</p>
          <p>Estimated range: {Math.round(range)} nm</p>
          <p>Last fill: {fuelLog[0]?.date || 'N/A'}</p>
          <button type="button" className="mt-2 text-[#0A4A52] underline" onClick={() => goTab('fuel')}>
            Open Fuel Log
          </button>
        </div>
      </div>

      <div className={cardClass()}>
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl text-[#0A4A52]">Aquatic Paradise - Current Conditions</h3>
          <button type="button" className="text-sm px-3 py-1 bg-[#0A4A52] text-white rounded" onClick={() => fetchHomeWeather(true)}>
            {loadingWeather ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {homeWeather ? (
          <div className="text-sm mt-2 space-y-1">
            <div>Wind: {homeWeather.windKn ?? '-'} kn {homeWeather.windDirCompass} | Gusts: {homeWeather.windGustKn ?? '-'} kn</div>
            <div>Waves: {homeWeather.waveHeightM ?? '-'} m | Swell: {homeWeather.swellHeightM ?? '-'} m {homeWeather.swellDirCompass} - {homeWeather.swellPeriodS ?? '-'}s</div>
            <div className="text-xs text-slate-500">Last updated: {new Date(weatherUpdatedAt).toLocaleTimeString()}</div>
          </div>
        ) : (
          <div className="text-sm mt-2 text-slate-500">Weather unavailable right now.</div>
        )}
        <button type="button" className="mt-2 text-[#C4603A] text-sm underline" onClick={() => goTab('weather')}>
          View Full Forecast →
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Recent Activity</h3>
          <div className="space-y-2">
            {recent.map((r, idx) => (
              <div key={`${r.date}-${idx}`} className="text-sm">
                <span className="font-medium">{r.date}</span> - {r.text}
              </div>
            ))}
          </div>
        </div>
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Checklists</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(CHECKLISTS).map((name) => (
              <button key={name} type="button" className="rounded-lg bg-teal-50 p-2 text-sm" onClick={() => goTab('voyage')}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Quick Actions</h3>
          <div className="space-y-2 text-sm">
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2" onClick={() => goTab('engine')}>Log Engine Hours</button>
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2" onClick={() => goTab('fuel')}>Add Fuel</button>
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2" onClick={() => goTab('fluids')}>Record Fluid Check</button>
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2" onClick={() => goTab('maintenance')}>Add Maintenance Entry</button>
          </div>
        </div>
      </div>

      <a className={cardClass('block')} href="https://www.bom.gov.au/marine/" target="_blank" rel="noreferrer">
        <div className="font-semibold text-[#0A4A52]">BOM Marine Forecast (QLD)</div>
      </a>
    </div>
  )
}

function EngineTab({ dataset, triggerRefresh }) {
  const { engineHours, maintenanceTasks } = dataset
  const latest = latestByDate(engineHours)
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    port_engine: latest?.port_engine || 0,
    stbd_engine: latest?.stbd_engine || 0,
    generator: latest?.generator || 0,
    naiad: latest?.naiad || 0,
    watermaker: latest?.watermaker || 0,
    notes: '',
  })
  const [range, setRange] = useState('6m')

  const chartData = useMemo(() => {
    if (range === 'all') return engineHours
    const weeks = range === '3m' ? 13 : range === '6m' ? 26 : 52
    const cutoff = subWeeks(new Date(), weeks)
    return engineHours.filter((r) => new Date(r.date) >= cutoff)
  }, [engineHours, range])

  const balanceData = engineHours.map((r) => ({ date: r.date, diff: Number(r.port_engine) - Number(r.stbd_engine) }))
  const currentDiff = latest ? Math.abs(Number(latest.port_engine) - Number(latest.stbd_engine)) : 0

  const avgWeeklyHours = useMemo(() => {
    const cutoff = subWeeks(new Date(), 26)
    const recent = engineHours.filter((r) => new Date(r.date) >= cutoff)
    if (recent.length < 2) return 0
    const first = recent[0]
    const last = recent[recent.length - 1]
    const weeks = Math.max(1, differenceInWeeks(new Date(last.date), new Date(first.date)))
    const startAvg = (Number(first.port_engine) + Number(first.stbd_engine)) / 2
    const endAvg = (Number(last.port_engine) + Number(last.stbd_engine)) / 2
    return (endAvg - startAvg) / weeks
  }, [engineHours])

  const projections = maintenanceTasks
    .filter((t) => t.hours_interval)
    .map((t) => {
      const current = latest ? (Number(latest.port_engine) + Number(latest.stbd_engine)) / 2 : 0
      const lastDone = t.last_completed_hours === null ? 0 : Number(t.last_completed_hours)
      const dueAt = lastDone + Number(t.hours_interval)
      const hoursRemaining = dueAt - current
      const weeks = avgWeeklyHours > 0 ? Math.max(0, hoursRemaining / avgWeeklyHours) : 999
      return { task: t.task, system: t.system, dueAt, weeks }
    })
    .sort((a, b) => a.weeks - b.weeks)
    .slice(0, 3)

  const save = async (e) => {
    e.preventDefault()
    await db.insert('engine_hours', {
      date: form.date,
      port_engine: Number(form.port_engine),
      stbd_engine: Number(form.stbd_engine),
      generator: Number(form.generator),
      naiad: Number(form.naiad),
      watermaker: Number(form.watermaker),
      notes: form.notes,
    })
    triggerRefresh('engineHours')
  }

  return (
    <div className="space-y-4">
      <form className={cardClass()} onSubmit={save}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Hours Entry</h3>
        <div className="grid md:grid-cols-4 gap-3">
          <Input label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <Input label="Port Engine" value={form.port_engine} onChange={(v) => setForm({ ...form, port_engine: v })} />
          <Input label="Stbd Engine" value={form.stbd_engine} onChange={(v) => setForm({ ...form, stbd_engine: v })} />
          <Input label="Generator" value={form.generator} onChange={(v) => setForm({ ...form, generator: v })} />
          <Input label="Naiad" value={form.naiad} onChange={(v) => setForm({ ...form, naiad: v })} />
          <Input label="Watermaker" value={form.watermaker} onChange={(v) => setForm({ ...form, watermaker: v })} />
          <label className="md:col-span-2 text-sm">Notes
            <input className="w-full mt-1 rounded-lg border border-slate-300 p-2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <button className="mt-3 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save</button>
      </form>

      <div className="grid md:grid-cols-2 gap-4">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Engine Balance Tracker</h3>
          <p className="mb-2">Current Difference: <strong>{currentDiff.toFixed(1)} hrs</strong></p>
          <p className="text-sm" style={{ color: currentDiff > 100 ? TRAFFIC.overdue : currentDiff > 50 ? TRAFFIC.soon : TRAFFIC.current }}>
            {currentDiff > 100 ? 'High imbalance alert' : currentDiff > 50 ? 'Moderate imbalance alert' : 'Balanced'}
          </p>
          <div className="h-56 mt-2">
            <ResponsiveContainer>
              <LineChart data={balanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line dataKey="diff" stroke="#C4603A" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Service Projections</h3>
          <p className="text-sm mb-2">Average weekly hours (last 26 weeks): {avgWeeklyHours.toFixed(2)}</p>
          <div className="space-y-2 text-sm">
            {projections.map((p) => (
              <div key={p.task} className="border-b border-slate-100 pb-2">
                <div className="font-medium">{p.task}</div>
                <div>{p.system}</div>
                <div>Due at ~{Math.round(p.dueAt)}h, in ~{Math.round(p.weeks)} weeks</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={cardClass()}>
        <div className="flex items-center gap-2 mb-2">
          {['3m', '6m', '1y', 'all'].map((r) => (
            <button key={r} type="button" className={`px-2 py-1 rounded ${range === r ? 'bg-[#0A4A52] text-white' : 'bg-slate-100'}`} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line dataKey="port_engine" stroke="#0A4A52" dot={false} />
              <Line dataKey="stbd_engine" stroke="#C4603A" dot={false} />
              <Line dataKey="generator" stroke="#16A34A" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function MaintenanceTab({ dataset, triggerRefresh }) {
  const { maintenanceTasks, maintenanceLogs, engineHours } = dataset
  const latest = latestByDate(engineHours)
  const latestAvg = latest ? (Number(latest.port_engine) + Number(latest.stbd_engine)) / 2 : 0
  const [newTask, setNewTask] = useState({ system: '', task: '', priority: 'medium', due_date: '' })
  const [query, setQuery] = useState('')

  const upcoming = maintenanceTasks
    .map((t) => ({ ...t, statusFlag: dueStatus(t, latestAvg, 30) }))
    .filter((t) => t.status !== 'archived')
    .sort((a, b) => ({ overdue: 0, soon: 1, current: 2 }[a.statusFlag] - { overdue: 0, soon: 1, current: 2 }[b.statusFlag]))

  const complete = async (task) => {
    const completedDate = format(new Date(), 'yyyy-MM-dd')
    await db.insert('maintenance_logs', {
      task_id: task.id,
      system: task.system,
      task: task.task,
      completed_date: completedDate,
      engine_hours_at_completion: latestAvg,
      performed_by: 'Owner',
      parts_used: '',
      cost: 0,
      notes: '',
      data: {},
    })
    await db.update('maintenance_tasks', task.id, {
      last_completed_date: completedDate,
      last_completed_hours: latestAvg,
      status: 'active',
    })
    triggerRefresh('maintenanceTasks')
  }

  const add = async (e) => {
    e.preventDefault()
    await db.insert('maintenance_tasks', {
      system: newTask.system,
      task: newTask.task,
      status: 'active',
      due_date: newTask.due_date || null,
      due_hours: null,
      priority: newTask.priority,
      hours_interval: null,
      calendar_months: null,
      last_completed_date: null,
      last_completed_hours: null,
      job_type: 'ad-hoc',
      data: {},
    })
    setNewTask({ system: '', task: '', priority: 'medium', due_date: '' })
    triggerRefresh('maintenanceTasks')
  }

  const history = maintenanceLogs.filter((l) =>
    `${l.system} ${l.task} ${l.performed_by}`.toLowerCase().includes(query.toLowerCase()),
  )

  const spendBySystem = Object.entries(
    maintenanceLogs.reduce((acc, l) => {
      acc[l.system] = (acc[l.system] || 0) + Number(l.cost || 0)
      return acc
    }, {}),
  ).map(([name, value]) => ({ name, value }))

  const spendByQuarter = Object.entries(
    maintenanceLogs.reduce((acc, l) => {
      const d = l.completed_date ? parseISO(l.completed_date) : new Date()
      const q = `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`
      acc[q] = (acc[q] || 0) + Number(l.cost || 0)
      return acc
    }, {}),
  ).map(([quarter, cost]) => ({ quarter, cost }))

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Upcoming</h3>
          <div className="space-y-2 max-h-80 overflow-auto">
            {upcoming.slice(0, 25).map((t) => (
              <div key={t.id} className="border-b border-slate-100 pb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{t.task}</div>
                  <div className="text-xs text-slate-500">{t.system}</div>
                </div>
                <button type="button" onClick={() => complete(t)} className="rounded-lg bg-[#0A4A52] text-white text-xs px-2 py-1">
                  Mark Complete
                </button>
              </div>
            ))}
          </div>
        </div>

        <form className={cardClass()} onSubmit={add}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Add Job</h3>
          <div className="grid gap-2">
            <Input label="System" value={newTask.system} onChange={(v) => setNewTask({ ...newTask, system: v })} />
            <Input label="Task" value={newTask.task} onChange={(v) => setNewTask({ ...newTask, task: v })} />
            <label className="text-sm">Priority
              <select className="w-full mt-1 border rounded-lg p-2" value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}>
                <option>low</option><option>medium</option><option>high</option>
              </select>
            </label>
            <Input label="Due date" type="date" value={newTask.due_date} onChange={(v) => setNewTask({ ...newTask, due_date: v })} />
          </div>
          <button className="mt-3 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Job</button>
        </form>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className={`${cardClass()} lg:col-span-2`}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">History</h3>
          <input className="w-full border rounded-lg p-2 mb-2" placeholder="Search history" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="space-y-2 max-h-64 overflow-auto text-sm">
            {history.map((h) => (
              <div key={h.id} className="border-b border-slate-100 pb-2">
                <div className="font-medium">{h.task}</div>
                <div>{h.completed_date} · {h.system} · ${Number(h.cost || 0).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Calendar</h3>
          <div className="text-sm space-y-1 max-h-64 overflow-auto">
            {maintenanceTasks.filter((t) => t.due_date).map((t) => (
              <div key={t.id}>{t.due_date} - {t.task}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Cost by System</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={spendBySystem} dataKey="value" nameKey="name" outerRadius={100}>
                  {spendBySystem.map((_, i) => <Cell key={i} fill={['#0A4A52', '#C4603A', '#16A34A', '#D97706'][i % 4]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Spend by Quarter</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={spendByQuarter}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="quarter" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="cost" fill="#C4603A" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

function FuelTab({ dataset, triggerRefresh }) {
  const { vesselSettings, fuelLog, engineHours } = dataset
  const latest = latestByDate(engineHours)
  const [portOn, setPortOn] = useState(true)
  const [stbdOn, setStbdOn] = useState(true)
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    location: 'Aquatic Paradise',
    litres: 300,
    cost_per_litre: 2,
    total_cost: 600,
    engine_hours_at_fill: latest ? (Number(latest.port_engine) + Number(latest.stbd_engine)) / 2 : 0,
    tank_level_before: 45,
    fuel_filter_changed: false,
    fill_port: true,
    fill_stbd: true,
    notes: '',
  })

  useEffect(() => {
    setForm((f) => ({ ...f, total_cost: Number(f.litres) * Number(f.cost_per_litre) }))
  }, [form.litres, form.cost_per_litre])

  const enforceValve = (nextPort, nextStbd) => {
    if (!nextPort && !nextStbd) return
    setPortOn(nextPort)
    setStbdOn(nextStbd)
  }

  const totalCap = Number(vesselSettings.port_tank_capacity || 1475) + Number(vesselSettings.stbd_tank_capacity || 1475)
  const recent12 = fuelLog.slice(0, 12)
  const monthly = Object.entries(
    recent12.reduce((acc, row) => {
      const k = row.date?.slice(0, 7)
      acc[k] = (acc[k] || 0) + Number(row.total_cost || 0)
      return acc
    }, {}),
  ).map(([month, cost]) => ({ month, cost }))
  const marinas = Object.entries(
    fuelLog.reduce((acc, row) => {
      if (!acc[row.location]) acc[row.location] = { litres: 0, cost: 0, entries: 0 }
      acc[row.location].litres += Number(row.litres || 0)
      acc[row.location].cost += Number(row.total_cost || 0)
      acc[row.location].entries += 1
      return acc
    }, {}),
  ).map(([location, v]) => ({
    location,
    avg: v.litres ? v.cost / v.litres : 0,
    spend: v.cost,
  }))

  const totalFuel = fuelLog.reduce((s, f) => s + Number(f.litres || 0), 0)
  const estOnBoard = Math.min(totalCap, 1200 + (totalFuel % 1700))
  const burnRate = Number(vesselSettings.estimated_burn_rate_litres_per_hour || 60)
  const range = (estOnBoard / burnRate) * Number(vesselSettings.cruise_speed_knots || 12)
  const portPct = portOn && stbdOn ? 50 : portOn ? 100 : 0
  const stbdPct = portOn && stbdOn ? 50 : stbdOn ? 100 : 0

  const submit = async (e) => {
    e.preventDefault()
    const splits = []
    const activeTanks = [form.fill_port, form.fill_stbd].filter(Boolean).length
    const splitLitres = activeTanks ? Number(form.litres) / activeTanks : 0
    if (form.fill_port) splits.push({ tank: 'port', litres: Math.round(splitLitres) })
    if (form.fill_stbd) splits.push({ tank: 'stbd', litres: Number(form.litres) - Math.round(splitLitres) })

    await db.insert('fuel_log', {
      date: form.date,
      location: form.location,
      litres: Number(form.litres),
      cost_per_litre: Number(form.cost_per_litre),
      total_cost: Number(form.total_cost),
      engine_hours_at_fill: Number(form.engine_hours_at_fill),
      tank_level_before: Number(form.tank_level_before),
      fuel_filter_changed: form.fuel_filter_changed,
      tanks_filled_details: splits,
      notes: form.notes,
    })

    if (form.fuel_filter_changed) {
      await db.insert('maintenance_logs', {
        task_id: null,
        system: 'Fuel System',
        task: 'Fuel filter changed during refuel',
        completed_date: form.date,
        engine_hours_at_completion: Number(form.engine_hours_at_fill),
        performed_by: 'Owner',
        parts_used: 'Fuel filter',
        cost: 0,
        notes: form.notes,
        data: {},
      })
    }
    triggerRefresh('fuelLog')
  }

  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Fuel Status</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="text-sm">Port tank share</div>
            <div className="h-4 bg-slate-200 rounded-full mt-1"><div className="h-4 bg-[#0A4A52] rounded-full" style={{ width: `${portPct}%` }} /></div>
          </div>
          <div>
            <div className="text-sm">Stbd tank share</div>
            <div className="h-4 bg-slate-200 rounded-full mt-1"><div className="h-4 bg-[#C4603A] rounded-full" style={{ width: `${stbdPct}%` }} /></div>
          </div>
          <div className="text-sm">
            <div>Total on board: {Math.round(estOnBoard)} L</div>
            <div>Estimated range: {Math.round(range)} nm</div>
            <div>Last fill: {fuelLog[0]?.date || 'N/A'} @ {fuelLog[0]?.location || 'N/A'}</div>
          </div>
        </div>
      </div>

      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Tank Valve Control</h3>
        <div className="flex gap-2">
          <button type="button" className={`px-3 py-2 rounded ${portOn ? 'bg-[#16A34A] text-white' : 'bg-slate-200'}`} onClick={() => enforceValve(!portOn, stbdOn)}>Port {portOn ? 'ON' : 'OFF'}</button>
          <button type="button" className={`px-3 py-2 rounded ${stbdOn ? 'bg-[#16A34A] text-white' : 'bg-slate-200'}`} onClick={() => enforceValve(portOn, !stbdOn)}>Stbd {stbdOn ? 'ON' : 'OFF'}</button>
        </div>
      </div>

      <form className={cardClass()} onSubmit={submit}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Fuel Entry</h3>
        <div className="grid md:grid-cols-4 gap-2">
          <Input label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <Input label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
          <Input label="Litres added" value={form.litres} onChange={(v) => setForm({ ...form, litres: v })} />
          <Input label="Cost/L" value={form.cost_per_litre} onChange={(v) => setForm({ ...form, cost_per_litre: v })} />
          <Input label="Total cost" value={form.total_cost} onChange={(v) => setForm({ ...form, total_cost: v })} />
          <Input label="Engine hours" value={form.engine_hours_at_fill} onChange={(v) => setForm({ ...form, engine_hours_at_fill: v })} />
          <Input label="Tank level before %" value={form.tank_level_before} onChange={(v) => setForm({ ...form, tank_level_before: v })} />
          <label className="text-sm flex items-center gap-2 mt-5"><input type="checkbox" checked={form.fuel_filter_changed} onChange={(e) => setForm({ ...form, fuel_filter_changed: e.target.checked })} /> Fuel filter changed?</label>
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.fill_port} onChange={(e) => setForm({ ...form, fill_port: e.target.checked })} /> Fill Port</label>
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.fill_stbd} onChange={(e) => setForm({ ...form, fill_stbd: e.target.checked })} /> Fill Stbd</label>
          <label className="text-sm md:col-span-2">Notes
            <input className="w-full mt-1 rounded-lg border border-slate-300 p-2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Fuel Entry</button>
      </form>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Cost by Month</h3>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="cost" fill="#C4603A" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Marina Comparison</h3>
          <div className="text-sm space-y-1 max-h-56 overflow-auto">
            {marinas.map((m) => (
              <div key={m.location} className="flex justify-between border-b border-slate-100 pb-1">
                <span>{m.location}</span>
                <span>${m.avg.toFixed(2)}/L · ${m.spend.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FluidsTab({ dataset, triggerRefresh }) {
  const { fluidChecks, watermakerLog } = dataset
  const [subtab, setSubtab] = useState('fluids')
  const [fluidForm, setFluidForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    port_engine_oil: 'OK',
    stbd_engine_oil: 'OK',
    port_engine_coolant: 'OK',
    stbd_engine_coolant: 'OK',
    generator_oil: 'OK',
    generator_coolant: 'OK',
    wesmar_hydraulic_oil: 'OK',
    mastervolt_status: 'OK',
    notes: '',
  })
  const [wm, setWm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    duration_minutes: 90,
    litres_produced: 70,
    tds_reading: 250,
    pre_filter_pressure: 12,
    notes: '',
  })

  const saveFluid = async (e) => {
    e.preventDefault()
    await db.insert('fluid_checks', { date: fluidForm.date, data: fluidForm })
    triggerRefresh('all')
  }

  const saveWm = async (e) => {
    e.preventDefault()
    await db.insert('watermaker_log', {
      date: wm.date,
      duration_minutes: Number(wm.duration_minutes),
      litres_produced: Number(wm.litres_produced),
      tds_reading: Number(wm.tds_reading),
      pre_filter_pressure: Number(wm.pre_filter_pressure),
      notes: wm.notes,
    })
    triggerRefresh('all')
  }

  const outputData = watermakerLog.map((r) => ({
    date: r.date,
    tds: Number(r.tds_reading || 0),
    rate: Number(r.duration_minutes || 0) > 0 ? (Number(r.litres_produced || 0) / Number(r.duration_minutes)) * 60 : 0,
  }))
  const last5 = outputData.slice(-5)
  const first5 = outputData.slice(0, 5)
  const avgLast5Tds = last5.length ? last5.reduce((s, r) => s + r.tds, 0) / last5.length : 0
  const baselineRate = first5.length ? first5.reduce((s, r) => s + r.rate, 0) / first5.length : 0
  const recentRate = last5.length ? last5.reduce((s, r) => s + r.rate, 0) / last5.length : 0
  const dropPct = baselineRate ? ((baselineRate - recentRate) / baselineRate) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button type="button" className={`px-3 py-2 rounded ${subtab === 'fluids' ? 'bg-[#0A4A52] text-white' : 'bg-slate-200'}`} onClick={() => setSubtab('fluids')}>Fluid Checks</button>
        <button type="button" className={`px-3 py-2 rounded ${subtab === 'watermaker' ? 'bg-[#0A4A52] text-white' : 'bg-slate-200'}`} onClick={() => setSubtab('watermaker')}>Watermaker Log</button>
      </div>

      {subtab === 'fluids' ? (
        <>
          <form className={cardClass()} onSubmit={saveFluid}>
            <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Pre-Departure Fluid Check</h3>
            <div className="grid md:grid-cols-3 gap-2">
              <Input label="Date" type="date" value={fluidForm.date} onChange={(v) => setFluidForm({ ...fluidForm, date: v })} />
              {[
                'port_engine_oil',
                'stbd_engine_oil',
                'port_engine_coolant',
                'stbd_engine_coolant',
                'generator_oil',
                'generator_coolant',
                'wesmar_hydraulic_oil',
                'mastervolt_status',
              ].map((k) => (
                <label key={k} className="text-sm">
                  {k.replaceAll('_', ' ')}
                  <select className="w-full mt-1 border rounded-lg p-2" value={fluidForm[k]} onChange={(e) => setFluidForm({ ...fluidForm, [k]: e.target.value })}>
                    <option>OK</option><option>Low</option><option>Add</option><option>Change due</option><option>Check</option>
                  </select>
                </label>
              ))}
            </div>
            <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Check</button>
          </form>

          <div className={cardClass()}>
            <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Fluid Specs Reference</h3>
            <div className="text-sm space-y-1">
              <div>Cummins Engine Oil: API CK-4 / Cummins Premium Blue 15W-40 · 17L each · 250hrs/6 months</div>
              <div>Cummins Coolant: Fleetguard ES Compleat OAT 50/50 · 1000hrs/2 years</div>
              <div>Onan Generator Oil: Confirm in manual · 150hrs/annually</div>
              <div>Wesmar Hydraulic Oil: SAE 10W-30 · 4000hrs/3 years</div>
              <div>Seastar Fluid: Seastar dedicated fluid · check 6 months</div>
              <div>Mastervolt Inverter: no fluids, check LED indicators annually</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <form className={cardClass()} onSubmit={saveWm}>
            <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Watermaker Run Log</h3>
            <div className="grid md:grid-cols-3 gap-2">
              <Input label="Date" type="date" value={wm.date} onChange={(v) => setWm({ ...wm, date: v })} />
              <Input label="Duration (mins)" value={wm.duration_minutes} onChange={(v) => setWm({ ...wm, duration_minutes: v })} />
              <Input label="Litres produced" value={wm.litres_produced} onChange={(v) => setWm({ ...wm, litres_produced: v })} />
              <Input label="TDS (ppm)" value={wm.tds_reading} onChange={(v) => setWm({ ...wm, tds_reading: v })} />
              <Input label="Pre-filter PSI" value={wm.pre_filter_pressure} onChange={(v) => setWm({ ...wm, pre_filter_pressure: v })} />
            </div>
            <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Run</button>
          </form>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className={cardClass()}>
              <h3 className="font-serif text-xl text-[#0A4A52] mb-3">TDS Trend</h3>
              <p className="text-sm mb-2" style={{ color: avgLast5Tds > 500 ? TRAFFIC.overdue : TRAFFIC.current }}>
                Last 5-run avg TDS: {Math.round(avgLast5Tds)} ppm
              </p>
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={outputData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line dataKey="tds" stroke="#C4603A" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className={cardClass()}>
              <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Output Rate Trend</h3>
              <p className="text-sm mb-2" style={{ color: dropPct > 15 ? TRAFFIC.soon : TRAFFIC.current }}>
                Output drop from baseline: {Math.max(0, dropPct).toFixed(1)}%
              </p>
              <div className="h-56">
                <ResponsiveContainer>
                  <AreaChart data={outputData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Area dataKey="rate" stroke="#0A4A52" fill="#0A4A52" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SafetyTab({ dataset }) {
  const { safetyItems } = dataset
  const now = new Date()
  const statusFor = (item) => {
    if (!item.expiry_date) return 'current'
    const d = parseISO(item.expiry_date)
    const days = differenceInDays(d, now)
    let warning = 90
    if (item.name.includes('Insurance') || item.name.includes('Registration')) warning = 60
    if (item.name.includes('PLB') || item.name.includes('AIS MOB')) warning = 365
    return days < 0 ? 'overdue' : days <= warning ? 'soon' : 'current'
  }

  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Safety Register</h3>
        <div className="space-y-2 max-h-[30rem] overflow-auto text-sm">
          {safetyItems.map((s) => {
            const st = statusFor(s)
            return (
              <div key={s.id} className="border-b border-slate-100 pb-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{s.name}</div>
                  <span className="text-xs px-2 py-1 rounded-full text-white" style={{ background: TRAFFIC[st] }}>{st}</span>
                </div>
                <div>{s.make_model}</div>
                <div>Serial: {s.serial_number} · Expiry/Service: {s.expiry_date || 'TBC'}</div>
              </div>
            )
          })}
        </div>
      </div>
      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">QLD Offshore Safety Requirements (Summary)</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Range</th><th>Minimum Equipment</th></tr></thead>
          <tbody>
            <tr><td>Partially smooth waters</td><td>PFDs, EPIRB where required, flares, VHF recommended</td></tr>
            <tr><td>Smooth waters</td><td>PFDs, signaling gear, anchor and line</td></tr>
            <tr><td>Beyond smooth waters</td><td>EPIRB, flares, VHF, life raft and offshore comms strongly recommended</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ContactsTab({ dataset, triggerRefresh }) {
  const { contacts } = dataset
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState({ category: '', name: '', phone: '', email: '', website: '', notes: '' })
  const add = async (e) => {
    e.preventDefault()
    await db.insert('contacts', { ...form, is_favourite: false, data: {} })
    setForm({ category: '', name: '', phone: '', email: '', website: '', notes: '' })
    triggerRefresh('all')
  }
  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <input className="w-full border rounded-lg p-2 mb-2" placeholder="Filter contacts" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="grid md:grid-cols-2 gap-2 text-sm">
          {contacts.filter((c) => `${c.category} ${c.name}`.toLowerCase().includes(filter.toLowerCase())).map((c) => (
            <div key={c.id} className="rounded-lg bg-slate-50 p-3">
              <div className="font-medium">{c.name}</div>
              <div>{c.category}</div>
              <div>{c.phone || 'No phone'} {c.email ? `· ${c.email}` : ''}</div>
              <div className="text-slate-500">{c.notes}</div>
            </div>
          ))}
        </div>
      </div>
      <form className={cardClass()} onSubmit={add}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Add Contact</h3>
        <div className="grid md:grid-cols-3 gap-2">
          <Input label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Input label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} />
          <Input label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
        </div>
        <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Contact</button>
      </form>
    </div>
  )
}

function DocumentsTab({ dataset, triggerRefresh }) {
  const { documents } = dataset
  const [meta, setMeta] = useState({ name: '', category: '', system: '', date: format(new Date(), 'yyyy-MM-dd'), tags: '', notes: '' })
  const [file, setFile] = useState(null)
  const [categoryDrafts, setCategoryDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    setCategoryDrafts(
      Object.fromEntries(documents.map((doc) => [doc.id, doc.category || ''])),
    )
  }, [documents])

  const upload = async (e) => {
    e.preventDefault()
    if (!file) return
    const fileData = await toBase64(file)
    await db.insert('documents', {
      ...meta,
      file_data: fileData,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
    })
    setMeta({ name: '', category: '', system: '', date: format(new Date(), 'yyyy-MM-dd'), tags: '', notes: '' })
    setFile(null)
    triggerRefresh('all')
  }

  const openDocument = (doc) => {
    if (!doc?.file_data) return
    const source = String(doc.file_data)
    const hasMimePrefix = source.startsWith('data:')
    const href = hasMimePrefix
      ? source
      : `data:${doc.file_type || 'application/octet-stream'};base64,${source}`
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const updateCategory = async (id, category) => {
    setSavingId(id)
    try {
      await db.update('documents', id, { category })
      triggerRefresh('all')
    } finally {
      setSavingId(null)
    }
  }

  const deleteDocument = async (id) => {
    setDeletingId(id)
    try {
      await db.remove('documents', id)
      triggerRefresh('all')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {documents.length === 0 && (
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Suggested Documents</h3>
          <ul className="list-disc pl-6 text-sm space-y-1">
            {suggestedDocuments.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      )}
      <form className={cardClass()} onSubmit={upload}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Upload Document</h3>
        <div className="grid md:grid-cols-3 gap-2">
          <Input label="Name" value={meta.name} onChange={(v) => setMeta({ ...meta, name: v })} />
          <Input label="Category" value={meta.category} onChange={(v) => setMeta({ ...meta, category: v })} />
          <Input label="System" value={meta.system} onChange={(v) => setMeta({ ...meta, system: v })} />
          <Input label="Date" type="date" value={meta.date} onChange={(v) => setMeta({ ...meta, date: v })} />
          <Input label="Tags" value={meta.tags} onChange={(v) => setMeta({ ...meta, tags: v })} />
          <Input label="Notes" value={meta.notes} onChange={(v) => setMeta({ ...meta, notes: v })} />
        </div>
        <input className="mt-2" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Document</button>
      </form>

      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Documents</h3>
        <div className="space-y-2 text-sm">
          {documents.map((d) => (
            <div key={d.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <div className="font-medium text-base text-slate-900">{d.name || 'Untitled document'}</div>
                  <div className="text-slate-600">
                    {d.system || 'General'} · {d.date || 'No date'} · {(Number(d.file_size || 0) / 1024).toFixed(1)} KB
                  </div>
                  <div className="text-slate-500">
                    File: {d.file_name || d.name || 'Attached file'}
                  </div>
                  {d.tags ? <div className="text-slate-500">Tags: {d.tags}</div> : null}
                  {d.notes ? <div className="text-slate-500">{d.notes}</div> : null}
                </div>

                <div className="flex flex-col gap-2 lg:min-w-72">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Category
                    <input
                      type="text"
                      value={categoryDrafts[d.id] ?? ''}
                      onChange={(e) => setCategoryDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openDocument(d)}
                      className="rounded-lg bg-[#0A4A52] px-3 py-2 text-sm text-white"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCategory(d.id, categoryDrafts[d.id] ?? '')}
                      disabled={savingId === d.id}
                      className="rounded-lg border border-[#0A4A52] px-3 py-2 text-sm text-[#0A4A52] disabled:opacity-60"
                    >
                      {savingId === d.id ? 'Saving...' : 'Save Category'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDocument(d.id)}
                      disabled={deletingId === d.id}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {deletingId === d.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function VoyageTab({ dataset, triggerRefresh }) {
  const { voyageLog, mooringLog, departureChecks } = dataset
  const [v, setV] = useState({ date: format(new Date(), 'yyyy-MM-dd'), departure_port: '', destination: '', departure_time: '', arrival_time: '', distance_nm: 0, crew_count: 0, conditions: '', fuel_used: 0, engine_hours: 0, notes: '' })
  const [m, setM] = useState({ date: format(new Date(), 'yyyy-MM-dd'), marina: '', nights: 1, cost_per_night: 0, total_cost: 0, notes: '' })
  const [checklistType, setChecklistType] = useState('Pre-Departure')

  const saveVoyage = async (e) => {
    e.preventDefault()
    await db.insert('voyage_log', { ...v, distance_nm: Number(v.distance_nm), crew_count: Number(v.crew_count), fuel_used: Number(v.fuel_used), engine_hours: Number(v.engine_hours) })
    triggerRefresh('all')
  }
  const saveMooring = async (e) => {
    e.preventDefault()
    await db.insert('mooring_log', { ...m, nights: Number(m.nights), cost_per_night: Number(m.cost_per_night), total_cost: Number(m.total_cost) })
    triggerRefresh('all')
  }
  const saveChecklist = async () => {
    const items = CHECKLISTS[checklistType] || []
    await db.insert('departure_checks', { date: format(new Date(), 'yyyy-MM-dd'), checklist_type: checklistType, items_checked: items.length, total_items: items.length, data: { items } })
    triggerRefresh('all')
  }

  useEffect(() => {
    setM((prev) => ({ ...prev, total_cost: Number(prev.nights) * Number(prev.cost_per_night) }))
  }, [m.nights, m.cost_per_night])

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <form className={cardClass()} onSubmit={saveVoyage}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Voyage Log</h3>
          <div className="grid md:grid-cols-2 gap-2">
            {Object.keys(v).map((k) => (
              <Input key={k} label={k.replaceAll('_', ' ')} type={k === 'date' ? 'date' : 'text'} value={v[k]} onChange={(val) => setV({ ...v, [k]: val })} />
            ))}
          </div>
          <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Voyage</button>
        </form>

        <form className={cardClass()} onSubmit={saveMooring}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Mooring & Berthing Costs</h3>
          <div className="grid md:grid-cols-2 gap-2">
            {Object.keys(m).map((k) => (
              <Input key={k} label={k.replaceAll('_', ' ')} type={k === 'date' ? 'date' : 'text'} value={m[k]} onChange={(val) => setM({ ...m, [k]: val })} />
            ))}
          </div>
          <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Mooring</button>
        </form>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Departure Checks</h3>
          <select className="w-full border rounded-lg p-2" value={checklistType} onChange={(e) => setChecklistType(e.target.value)}>
            {Object.keys(CHECKLISTS).map((k) => <option key={k}>{k}</option>)}
          </select>
          <button type="button" className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2" onClick={saveChecklist}>Record Checklist</button>
        </div>
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Departure Check History</h3>
          <div className="text-sm space-y-1 max-h-48 overflow-auto">
            {departureChecks.map((d) => <div key={d.id}>{d.date} · {d.checklist_type} ({d.items_checked}/{d.total_items})</div>)}
          </div>
        </div>
      </div>

      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Recent Voyages</h3>
        <div className="text-sm space-y-1 max-h-48 overflow-auto">
          {voyageLog.map((row) => <div key={row.id}>{row.date} · {row.departure_port} to {row.destination} · {row.distance_nm} nm</div>)}
          {mooringLog.map((row) => <div key={`m-${row.id}`}>{row.date} · {row.marina} · ${row.total_cost}</div>)}
        </div>
      </div>
    </div>
  )
}

function PartsTab({ dataset, triggerRefresh }) {
  const { parts } = dataset
  const [form, setForm] = useState({ name: '', category: '', quantity: 0, min_quantity: 1, unit: 'ea', location: '', part_number: '', supplier: '', notes: '' })
  const add = async (e) => {
    e.preventDefault()
    await db.insert('parts', { ...form, quantity: Number(form.quantity), min_quantity: Number(form.min_quantity) })
    setForm({ name: '', category: '', quantity: 0, min_quantity: 1, unit: 'ea', location: '', part_number: '', supplier: '', notes: '' })
    triggerRefresh('all')
  }
  const adjust = async (part, delta) => {
    await db.update('parts', part.id, { quantity: Number(part.quantity) + delta })
    triggerRefresh('all')
  }
  return (
    <div className="space-y-4">
      <form className={cardClass()} onSubmit={add}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Add Part</h3>
        <div className="grid md:grid-cols-3 gap-2">
          {Object.keys(form).map((k) => <Input key={k} label={k.replaceAll('_', ' ')} value={form[k]} onChange={(v) => setForm({ ...form, [k]: v })} />)}
        </div>
        <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Part</button>
      </form>
      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Inventory</h3>
        <div className="space-y-1 text-sm max-h-[32rem] overflow-auto">
          {parts.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-slate-100 pb-1">
              <div>
                <div className="font-medium">{p.name}</div>
                <div>{p.category} · {p.quantity} {p.unit} {Number(p.quantity) <= Number(p.min_quantity) ? '· LOW' : ''}</div>
              </div>
              <div className="flex gap-1">
                <button type="button" className="px-2 py-1 bg-slate-200 rounded" onClick={() => adjust(p, -1)}>-</button>
                <button type="button" className="px-2 py-1 bg-slate-200 rounded" onClick={() => adjust(p, 1)}>+</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function BarCamsTab() {
  const cams = [
    { id: 'gc_seaway', name: 'Gold Coast Seaway', state: 'QLD', region: 'Gold Coast', embedUrl: null, pageUrl: 'https://www.vmrsouthport.com.au/surfcam/', notes: 'Gold Coast Seaway - The Spit. Busiest bar in QLD.' },
    { id: 'tweed', name: 'Tweed Heads Bar', state: 'NSW', region: 'Far North Coast', embedUrl: 'https://widget.coastalcoms.com/video/ebe03351-5116-4987-9e59-52776a7b3af2', weatherUrl: 'https://widget.coastalcoms.com/weather/95bdd0d0-085e-4179-b4e8-d3035cba1644', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/tweed-heads', notes: 'Tweed River entrance offshore view.' },
    { id: 'tweed_entrance', name: 'Tweed Heads - Entrance Channel', state: 'NSW', region: 'Far North Coast', embedUrl: 'https://widget.coastalcoms.com/video/6321b2c5-7545-49d1-83b3-a10fd2c8926b', weatherUrl: 'https://widget.coastalcoms.com/weather/95bdd0d0-085e-4179-b4e8-d3035cba1644', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/tweed-heads-entrance', notes: 'Tweed entrance channel inside breakwaters.' },
    { id: 'brunswick', name: 'Brunswick Heads Bar', state: 'NSW', region: 'Far North Coast', embedUrl: 'https://widget.coastalcoms.com/video/db6bcca9-545e-4575-95ee-a5b1d4786f63', weatherUrl: 'https://widget.coastalcoms.com/weather/813f8b90-af0d-4b32-8030-8c7d483c0c1e', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/brunswick-heads', notes: 'Brunswick River entrance.' },
    { id: 'ballina', name: 'Ballina Bar - Richmond River', state: 'NSW', region: 'North Coast', embedUrl: 'https://widget.coastalcoms.com/video/76818de6-1bc6-44d2-943a-3a905ee9c132', weatherUrl: 'https://widget.coastalcoms.com/weather/3ac2399b-e987-479a-81f3-c739d59dc898', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/ballina', notes: 'Richmond River entrance at Ballina.' },
    { id: 'evans_head', name: 'Evans Head Bar', state: 'NSW', region: 'North Coast', embedUrl: 'https://widget.coastalcoms.com/video/a7e20076-4e9e-4239-8529-ee3389a718ad', weatherUrl: 'https://widget.coastalcoms.com/weather/ed82be35-632f-4ecf-8a47-ba64560a526d', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/evans-head', notes: 'Evans River entrance.' },
    { id: 'yamba', name: 'Iluka / Yamba - Clarence River', state: 'NSW', region: 'North Coast', embedUrl: 'https://widget.coastalcoms.com/video/26f42761-cece-45f3-94c8-5edb9508dee1', weatherUrl: 'https://widget.coastalcoms.com/weather/8b928bd5-2fc2-4d60-bb51-a3c2f819154b', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/iluka/yamba', notes: 'Clarence River entrance.' },
    { id: 'nambucca', name: 'Nambucca Heads Bar', state: 'NSW', region: 'Mid North Coast', embedUrl: 'https://widget.coastalcoms.com/video/1dbb0315-6607-4e07-9aed-00a6bd269915', weatherUrl: 'https://widget.coastalcoms.com/weather/763ffb17-1705-47d9-a533-ee288b138b2e', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/nambucca-heads', notes: 'Nambucca River entrance.' },
    { id: 'coffs', name: 'Coffs Harbour', state: 'NSW', region: 'Mid North Coast', embedUrl: 'https://widget.coastalcoms.com/video/c84385c2-10bb-499b-9c23-0542bff3210c', weatherUrl: 'https://widget.coastalcoms.com/weather/4b768baa-b0c5-445f-94c8-6df87ee470ce', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/coffs-harbour', notes: 'Coffs Harbour all-weather reference.' },
    { id: 'sw_rocks', name: 'South West Rocks / Macleay River', state: 'NSW', region: 'Mid North Coast', embedUrl: 'https://widget.coastalcoms.com/video/ea2bf350-48d7-4017-b8d9-29a24da1785f', weatherUrl: 'https://widget.coastalcoms.com/weather/4e2dd297-2397-4488-a71c-2b0d74bd3b93', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/south-west-rocks-and-macleay-river', notes: 'Macleay River entrance.' },
    { id: 'camden_haven', name: 'Camden Haven Bar', state: 'NSW', region: 'Mid North Coast', embedUrl: 'https://widget.coastalcoms.com/video/f4dfde16-760e-4a34-b455-43519186eeeb', weatherUrl: 'https://widget.coastalcoms.com/weather/66bb1a19-a595-45fd-bcdb-0820937995bb', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/camden-haven', notes: 'Camden Haven entrance.' },
    { id: 'port_macquarie', name: 'Port Macquarie - Hastings River', state: 'NSW', region: 'Mid North Coast', embedUrl: 'https://widget.coastalcoms.com/video/7c3cc779-daa6-48e6-9eed-c102efd59038', weatherUrl: 'https://widget.coastalcoms.com/weather/bf830d2f-3986-487f-bf8f-a86684a8f183', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/port-macquarie', notes: 'Hastings River entrance.' },
    { id: 'forster', name: 'Forster Bar - Wallis Lake', state: 'NSW', region: 'Mid North Coast', embedUrl: 'https://widget.coastalcoms.com/video/2bb39d41-38bd-4808-9c52-d4fee1525d0b', weatherUrl: 'https://widget.coastalcoms.com/weather/66bb1a19-a595-45fd-bcdb-0820937995bb', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/forster', notes: 'Wallis Lake entrance.' },
    { id: 'cudgen', name: 'Cudgen Bar', state: 'NSW', region: 'Far North Coast', embedUrl: 'https://widget.coastalcoms.com/video/73a52fac-d291-42be-a1f1-dd859c5dd28f', weatherUrl: 'https://widget.coastalcoms.com/weather/95bdd0d0-085e-4179-b4e8-d3035cba1644', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/cudgen', notes: 'Cudgen Creek entrance.' },
    { id: 'port_stephens', name: 'Shoal Bay - Port Stephens', state: 'NSW', region: 'Hunter', embedUrl: 'https://widget.coastalcoms.com/video/364ee26f-ad27-4713-93dd-fcf0f849541e', weatherUrl: 'https://widget.coastalcoms.com/weather/3ba05feb-bf6a-4979-acb3-a929c034cfc2', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/shoal-bay-port-stephens', notes: 'Port Stephens entrance.' },
    { id: 'swansea', name: 'Swansea Channel - Lake Macquarie', state: 'NSW', region: 'Hunter', embedUrl: 'https://widget.coastalcoms.com/video/5bb0d918-2423-4b5c-9840-c6599108523e', weatherUrl: 'https://widget.coastalcoms.com/weather/095ef688-725a-4a0a-b7d6-d065249a8bb1', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/swansea', notes: 'Swansea channel entrance.' },
    { id: 'sussex', name: 'Sussex Inlet Bar', state: 'NSW', region: 'South Coast', embedUrl: 'https://widget.coastalcoms.com/video/fd63fb0e-1846-457f-9594-90f54b037b99', weatherUrl: 'https://widget.coastalcoms.com/weather/46d78831-9017-4e4c-9713-c02ae0f61655', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/sussex-inlet', notes: 'Sussex Inlet entrance.' },
    { id: 'batemans', name: 'Batemans Bay - Clyde River', state: 'NSW', region: 'South Coast', embedUrl: 'https://widget.coastalcoms.com/video/4497b0d4-769e-4084-9e18-0bf1a46203bd', weatherUrl: 'https://widget.coastalcoms.com/weather/4d79c0f2-27af-47ae-bf22-893bad73cb69', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/batemans-bay', notes: 'Clyde River entrance at Batemans Bay.' },
    { id: 'moruya', name: 'Moruya Bar', state: 'NSW', region: 'South Coast', embedUrl: 'https://widget.coastalcoms.com/video/4fca2d26-c6af-493a-9f22-b2b2dac9b803', weatherUrl: 'https://widget.coastalcoms.com/weather/c86cbe7a-75cb-4e45-95f8-8fc765fea7f8', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/moruya', notes: 'Moruya River entrance.' },
    { id: 'narooma', name: 'Narooma Bar', state: 'NSW', region: 'South Coast', embedUrl: 'https://widget.coastalcoms.com/video/fe86b545-d2c7-480d-9842-1f0e8f31dab8', weatherUrl: 'https://widget.coastalcoms.com/weather/dd277b08-0bfe-4180-8f31-49cb25f36564', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/narooma', notes: 'Narooma south coast entrance.' },
    { id: 'bermagui', name: 'Bermagui Harbour', state: 'NSW', region: 'South Coast', embedUrl: 'https://widget.coastalcoms.com/video/afdc038f-b8f6-466d-be38-a561260a45cb', weatherUrl: 'https://widget.coastalcoms.com/weather/2353a40c-323b-4b16-927f-0a5bffd7899f', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/bermagui', notes: 'Bermagui harbour entrance.' },
    { id: 'merimbula', name: 'Merimbula Bar', state: 'NSW', region: 'South Coast', embedUrl: 'https://widget.coastalcoms.com/video/3d3a9ea9-8000-4d4e-9e87-5de98f2a15e0', weatherUrl: 'https://widget.coastalcoms.com/weather/8e0bab57-fab6-4097-a956-9ac5acc66c58', pageUrl: 'https://www.nsw.gov.au/driving-boating-and-transport/using-waterways-boating-and-transport-information/conditions-weather-and-tides/webcams/merimbula', notes: 'Merimbula lake entrance.' },
    { id: 'port_phillip', name: 'Port Phillip Heads', state: 'VIC', region: 'Victoria', embedUrl: null, pageUrl: 'https://transportsafety.vic.gov.au/', notes: 'Refer to local authority channels for current camera and notice links.' },
  ]

  const [state, setState] = useState('NSW')
  const [selectedId, setSelectedId] = useState('tweed')
  const [embedFailed, setEmbedFailed] = useState(false)

  const filtered = useMemo(() => (state === 'ALL' ? cams : cams.filter((cam) => cam.state === state)), [state])
  const selectedCam = useMemo(() => filtered.find((cam) => cam.id === selectedId) || filtered[0] || cams[0], [filtered, selectedId])
  const quickAccessGroups = useMemo(() => {
    const quickIds = {
      QLD: ['gc_seaway'],
      NSW: ['tweed', 'ballina', 'brunswick', 'port_macquarie', 'batemans'],
    }

    const build = (targetState) =>
      (quickIds[targetState] || [])
        .map((id) => cams.find((cam) => cam.id === id))
        .filter(Boolean)
        .filter((cam) => state === 'ALL' || cam.state === state)

    if (state === 'ALL') {
      return ['QLD', 'NSW'].map((targetState) => ({ state: targetState, cams: build(targetState) }))
    }

    return [{ state, cams: build(state) }]
  }, [state])

  useEffect(() => {
    const existing = document.querySelector('script[src*="coastalcoms.com/loader"]')
    if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://widget.coastalcoms.com/loader.js'
      script.async = true
      document.head.appendChild(script)
    }
  }, [])

  useEffect(() => {
    setEmbedFailed(false)
  }, [selectedCam?.id])

  useEffect(() => {
    if (!selectedCam) return
    if (!filtered.some((cam) => cam.id === selectedCam.id)) {
      setSelectedId(filtered[0]?.id || cams[0]?.id)
    }
  }, [filtered, selectedCam])

  const showEmbed = Boolean(selectedCam?.embedUrl) && !embedFailed

  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <div className="flex gap-2 mb-3">
          {['ALL', 'QLD', 'NSW', 'VIC'].map((s) => <button key={s} type="button" onClick={() => setState(s)} className={`px-3 py-2 rounded ${state === s ? 'bg-[#0A4A52] text-white' : 'bg-slate-200'}`}>{s}</button>)}
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          {filtered.map((cam) => (
            <button key={cam.id} type="button" onClick={() => setSelectedId(cam.id)} className={`rounded-lg p-3 text-left ${selectedCam?.id === cam.id ? 'bg-teal-100 border border-teal-300' : 'bg-slate-50 hover:bg-slate-100'}`}>
              <div className="font-medium">{cam.name}</div>
              <div className="text-xs text-slate-500">{cam.region} · {cam.state}</div>
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          {quickAccessGroups.map((group) => (
            <div key={group.state} className="space-y-2">
              {state === 'ALL' ? <div className="text-xs font-semibold text-slate-500">{group.state} quick access</div> : null}
              <div className="flex flex-wrap gap-2">
                {group.cams.map((cam) => (
                  <button
                    key={`${group.state}-${cam.id}`}
                    type="button"
                    onClick={() => {
                      setState(cam.state)
                      setSelectedId(cam.id)
                    }}
                    className={`px-3 py-2 rounded-full text-sm ${selectedCam?.id === cam.id ? 'bg-[#0A4A52] text-white' : 'bg-white border border-slate-300 text-slate-700'}`}
                  >
                    {cam.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden bg-white">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="font-medium text-slate-800">{selectedCam?.name || 'Camera Viewer'}</div>
            {selectedCam ? (
              <a href={selectedCam.pageUrl} target="_blank" rel="noreferrer" className="text-sm text-[#0A4A52] underline">
                Open source page
              </a>
            ) : null}
          </div>
          {selectedCam ? <div className="p-3 text-sm bg-slate-50 border-b border-slate-200">{selectedCam.notes}</div> : null}
          {selectedCam && showEmbed ? (
            <div>
              <iframe
                key={`${state}-${selectedCam.id}`}
                src={selectedCam.embedUrl}
                title={`${selectedCam.name} camera`}
                style={{ width: '100%', height: '540px', border: 'none' }}
                onError={() => setEmbedFailed(true)}
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              />
              {selectedCam.weatherUrl ? (
                <iframe
                  key={`${state}-${selectedCam.id}-weather`}
                  src={selectedCam.weatherUrl}
                  title={`${selectedCam.name} weather`}
                  style={{ width: '100%', height: '260px', border: 'none', borderTop: '1px solid #e2e8f0' }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                />
              ) : null}
            </div>
          ) : null}
          {selectedCam && !showEmbed ? (
            <div className="p-6 text-center bg-[#0F2240] text-slate-200">
              <div className="font-semibold text-lg">In-app embed unavailable for this camera</div>
              <div className="text-sm mt-2">Use the official source page for this feed.</div>
            </div>
          ) : null}
        </div>
        <div className="text-xs text-slate-500 mt-2">
          NSW CoastalComs feeds open directly in-app when embeddable, matching the Wyllaway pattern.
        </div>
      </div>
      <div className="rounded-xl p-4 bg-red-100 text-red-700">
        Safety reminder: bar crossings require current local advice, weather, tide and VMR check-ins before departure.
      </div>
    </div>
  )
}

function ReportsTab({ dataset }) {
  const { maintenanceTasks, maintenanceLogs, engineHours, fuelLog, safetyItems } = dataset

  const makeReport = (title, rows) => {
    const doc = new jsPDF()
    doc.setFillColor(10, 74, 82)
    doc.rect(0, 0, 210, 24, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14)
    doc.text(`Amaroo | BZI70Q | ${title}`, 14, 14)
    doc.setFontSize(10)
    doc.text(`Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 20)
    autoTable(doc, {
      startY: 30,
      head: [Object.keys(rows[0] || { item: '', value: '' })],
      body: rows.map((r) => Object.values(r)),
      headStyles: { fillColor: [10, 74, 82] },
    })
    doc.save(`Amaroo_${title.replaceAll(' ', '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`)
  }

  const annualCost = maintenanceLogs.reduce((s, l) => s + Number(l.cost || 0), 0) + fuelLog.reduce((s, f) => s + Number(f.total_cost || 0), 0)
  const latest = latestByDate(engineHours)
  const costPerHour = latest ? annualCost / ((Number(latest.port_engine) + Number(latest.stbd_engine)) / 2 || 1) : 0

  const pieData = [
    { name: 'Maintenance', value: maintenanceLogs.reduce((s, l) => s + Number(l.cost || 0), 0) },
    { name: 'Fuel', value: fuelLog.reduce((s, f) => s + Number(f.total_cost || 0), 0) },
  ]

  const serviceEmail = maintenanceTasks
    .slice(0, 10)
    .map((t) => `- ${t.task} (${t.system})`)
    .join('\n')

  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">PDF Reports</h3>
        <div className="grid md:grid-cols-3 gap-2 text-sm">
          <button type="button" className="btn" onClick={() => makeReport('Upcoming Maintenance Report', maintenanceTasks.map((t) => ({ task: t.task, system: t.system, due: t.due_date || t.hours_interval || 'TBC' })))}>Upcoming Maintenance</button>
          <button type="button" className="btn" onClick={() => makeReport('Maintenance History Report', maintenanceLogs.map((l) => ({ date: l.completed_date, task: l.task, cost: l.cost || 0 })))}>Maintenance History</button>
          <button type="button" className="btn" onClick={() => makeReport('Engine Hours Report', engineHours.slice(-40).map((e) => ({ date: e.date, port: e.port_engine, stbd: e.stbd_engine, generator: e.generator })))}>Engine Hours</button>
          <button type="button" className="btn" onClick={() => makeReport('Fuel Performance Report', fuelLog.slice(-40).map((f) => ({ date: f.date, location: f.location, litres: f.litres, total_cost: f.total_cost })))}>Fuel Performance</button>
          <button type="button" className="btn" onClick={() => makeReport('Safety Gear Status Report', safetyItems.map((s) => ({ item: s.name, expiry: s.expiry_date || 'TBC', serial: s.serial_number })))}>Safety Gear</button>
          <button type="button" className="btn" onClick={() => makeReport('Annual Vessel Status Report', [{ annual_cost: annualCost.toFixed(2), cost_per_engine_hour: costPerHour.toFixed(2), entries_engine_hours: engineHours.length, entries_maintenance: maintenanceLogs.length }])}>Annual Vessel Status</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Cost Dashboard</h3>
          <div className="h-56">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" outerRadius={90}>
                  <Cell fill="#0A4A52" /><Cell fill="#C4603A" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="text-sm">Cost per engine hour: ${costPerHour.toFixed(2)}</p>
        </div>
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Service Summary Email Generator</h3>
          <textarea className="w-full h-56 border rounded-lg p-2 text-sm" value={`Subject: Amaroo upcoming service work\n\nHi team,\n\nCan you quote and schedule the following work for Amaroo:\n${serviceEmail}\n\nRegards,\nStuart McDonald`} readOnly />
        </div>
      </div>
    </div>
  )
}

function SettingsTab({ dataset, triggerRefresh, reload }) {
  const [settings, setSettings] = useState(dataset.vesselSettings)

  useEffect(() => {
    setSettings(dataset.vesselSettings)
  }, [dataset.vesselSettings])

  const save = async (e) => {
    e.preventDefault()
    await db.saveVesselSettings(settings)
    triggerRefresh('vesselSettings')
  }

  const downloadBackup = () => {
    const backup = {
      vessel: 'Amaroo',
      generated_at: new Date().toISOString(),
      dataset,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Amaroo_Backup_${format(new Date(), 'yyyy-MM-dd')}.json`
    a.click()
  }

  const restoreBackup = async (file) => {
    if (!file) return
    const txt = await file.text()
    const data = JSON.parse(txt)
    if (data.vessel !== 'Amaroo') {
      alert('Invalid backup: expected vessel Amaroo')
      return
    }
    await db.saveVesselSettings(data.dataset?.vesselSettings || settings)
    triggerRefresh('all')
  }

  const clearAll = async () => {
    const pass = prompt('Type AMAROO to confirm data clear')
    if (pass !== 'AMAROO') return
    await db.clearAll()
    await reload()
  }

  return (
    <div className="space-y-4">
      <form className={cardClass()} onSubmit={save}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Vessel Details</h3>
        <div className="grid md:grid-cols-3 gap-2">
          {Object.keys(settings || {}).map((k) => (
            <Input key={k} label={k.replaceAll('_', ' ')} value={settings[k]} onChange={(v) => setSettings({ ...settings, [k]: v })} />
          ))}
        </div>
        <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Settings</button>
      </form>

      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Data Backup & Recovery</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={downloadBackup}>Download Backup Now</button>
          <label className="btn cursor-pointer">Restore from Backup<input type="file" className="hidden" accept="application/json" onChange={(e) => restoreBackup(e.target.files?.[0])} /></label>
          <button type="button" className="btn" onClick={clearAll}>Clear All Data</button>
          <button type="button" className="btn" onClick={() => location.reload()}>Check for App Updates</button>
        </div>
      </div>
    </div>
  )
}

function Stat({ title, value, suffix = '' }) {
  return (
    <div className={cardClass()}>
      <div className="text-sm text-slate-600">{title}</div>
      <div className="text-2xl font-semibold text-[#0A4A52]">{value} {suffix}</div>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }) {
  return (
    <label className="text-sm">
      {label}
      <input type={type} className="w-full mt-1 rounded-lg border border-slate-300 p-2" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default App
