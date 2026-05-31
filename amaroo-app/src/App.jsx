import { useCallback, useEffect, useMemo, useRef, useState, Component } from 'react'
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calendar,
  Camera,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Cloud,
  ContactRound,
  DollarSign,
  Droplets,
  FileText,
  Fuel,
  Gauge,
  HardHat,
  Inbox,
  Map as MapIcon,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Ship,
  Trash2,
  UtensilsCrossed,
  UserX,
  Waves,
  Webcam,
  Wrench,
  X,
} from 'lucide-react'
import MOBAlert from './components/MOBAlert'
import GalleyTab from './components/galley/GalleyTab'
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
import {
  db,
  addCustomChecklistItem,
  deleteCustomChecklistItem,
  getCustomChecklistItems,
  updateEngineHours,
  getFirstAidInventory,
  getAedTracking,
  updateFirstAidItem,
  upsertAedTracking,
  addVoyageLogEntry,
  getPendingReceipts,
  markPendingReceiptReviewed,
  discardPendingReceipt,
  updatePendingReceipt,
  getLastHauloutDate,
  getManualHullCleanDate,
  updateScheduledTask,
  setEngineHoursTotal,
} from './db/api'
import { seedIfEmpty } from './db/seed'
import { suggestedDocuments } from './data/seedData'
import { useDataRefresh } from './context/DataRefreshContext'
import PassagePlanner from './tabs/PassagePlanner'
import VoyageLog from './tabs/VoyageLog'
import Weather from './tabs/Weather'
import Tides from './tabs/Tides'
import SpeedPredictor from './tabs/SpeedPredictor'
import UserGuide from './tabs/UserGuide'
import EmergencyCard from './tabs/EmergencyCard'
import PhotoGallery, { PhotoImg } from './components/PhotoGallery'
import PhotoUploader from './components/PhotoUploader'
import AnchorWatch from './components/AnchorWatch'
import UnderwayDashboard from './components/UnderwayDashboard'
import InvoiceTaskMatcher from './components/InvoiceTaskMatcher'
import { uploadPhoto, validatePhoto, deletePhoto, sanitizeFileName, uploadDocument, downloadStoredFile, deleteStoredFile, parseStorageReference, makeStorageReference } from './db/storage'
import { extractHourlyWeather, fetchCurrentConditions, fetchRouteWeather } from './utils/weatherApi'
import { scanReceiptImage, categoriseReceiptType } from './utils/receiptScanner'
import { useGPS } from './hooks/useGPS'
import { useTrackRecorder } from './hooks/useTrackRecorder'
import { foulingConditionLabel, foulingPenalty, monthsBetween } from './utils/hullFouling'
import { AMAROO_RPM_CURVE } from './utils/vesselConstants'

const HOME_WEATHER_CACHE_KEY = 'amaroo_home_weather_cache'

// Flat list used for tab body lookup and bottom nav
const TAB_DEFS = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'weather', label: 'Weather', icon: Cloud },
  { id: 'tides', label: 'Tides', icon: Waves },
  { id: 'barcams', label: 'Bar Cams', icon: Webcam },
  { id: 'speed', label: 'Speed', icon: Gauge },
  { id: 'voyage', label: 'Passage Planner', icon: MapIcon },
  { id: 'voyagelog', label: 'Voyage Log', icon: Ship },
  { id: 'galley', label: 'Galley', icon: UtensilsCrossed },
  { id: 'engine', label: 'Engine Hours', icon: Wrench },
  { id: 'maintenance', label: 'Maintenance', icon: HardHat },
  { id: 'fuel', label: 'Fuel Log', icon: Fuel },
  { id: 'fluids', label: 'Fluid Levels', icon: Droplets },
  { id: 'safety', label: 'Safety Gear', icon: Shield },
  { id: 'parts', label: 'Parts', icon: Package },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'receipts', label: 'Receipts', icon: Inbox },
  { id: 'expenses', label: 'Expenses', icon: DollarSign },
  { id: 'contacts', label: 'Contacts', icon: ContactRound },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'guide', label: 'User Guide', icon: BookOpen },
  { id: 'emergency', label: 'Emergency Card', icon: ShieldAlert },
]

// Grouped sidebar nav definition
const NAV_GROUPS = [
  {
    id: 'realtime',
    label: 'Underway',
    color: 'border-teal-400',
    labelColor: 'text-teal-300',
    collapsible: false,
    tabs: ['dashboard', 'weather', 'tides', 'barcams', 'speed'],
  },
  {
    id: 'voyage',
    label: 'Voyage Planning',
    color: 'border-blue-400',
    labelColor: 'text-blue-300',
    collapsible: false,
    tabs: ['voyage', 'voyagelog', 'galley'],
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    color: 'border-amber-400',
    labelColor: 'text-amber-300',
    collapsible: true,
    tabs: ['engine', 'maintenance', 'fuel', 'fluids', 'safety', 'parts'],
  },
  {
    id: 'admin',
    label: 'Admin',
    color: 'border-slate-400',
    labelColor: 'text-slate-400',
    collapsible: true,
    tabs: ['reports', 'receipts', 'expenses', 'contacts', 'documents', 'settings', 'guide', 'emergency'],
  },
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

const cardClass = (extra = '') => `app-card rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_8px_24px_rgba(10,74,82,0.08)] ${extra}`

class TabErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch() {}
  render() {
    if (this.state.error) {
      return (
        <div className="m-4 p-6 rounded-2xl bg-red-50 border border-red-200 text-red-800 space-y-2">
          <div className="font-semibold text-lg">Something went wrong in this tab</div>
          <div className="text-sm font-mono bg-red-100 rounded p-2">{this.state.error.message}</div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded-lg bg-red-700 text-white px-4 py-2 text-sm"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function SidebarGroup({ group, tabs, activeTab, setActiveTab, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`border-l-2 ${group.color} pl-2`}>
      {group.collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`w-full flex items-center justify-between text-xs font-semibold uppercase tracking-widest mb-1 px-1 ${group.labelColor} hover:text-white transition`}
        >
          <span>{group.label}</span>
          <span className="text-[10px] opacity-60">{open ? '▲' : '▼'}</span>
        </button>
      ) : (
        <div className={`text-xs font-semibold uppercase tracking-widest mb-1 px-1 ${group.labelColor}`}>{group.label}</div>
      )}
      {open && (
        <div className="space-y-0.5">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition ${
                  activeTab === t.id
                    ? 'bg-[#C4603A] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]'
                    : 'hover:bg-teal-700/80 text-white/90'
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    return t && TAB_DEFS.some((td) => td.id === t) ? t : 'dashboard'
  })
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
    firstAidItems: [],
    aedData: null,
    pendingReceipts: [],
    expensesLog: [],
  })
  const [appToast, setAppToast] = useState(null)
  const appToastTimerRef = useRef(null)
  const pendingReceiptCountRef = useRef(null)

  const { refreshKeys, triggerRefresh } = useDataRefresh()
  const [hullFouling, setHullFouling] = useState({
    monthsSinceHaulout: 0,
    lastCleanDate: null,
    source: null,
    loaded: false,
  })

  const loadHullFouling = async () => {
    try {
      const [manualDate, logDate] = await Promise.all([
        getManualHullCleanDate().catch(() => null),
        getLastHauloutDate().catch(() => null),
      ])

      const manualTs = manualDate ? new Date(manualDate).getTime() : 0
      const logTs = logDate ? new Date(logDate).getTime() : 0

      let selectedDate = null
      let source = null
      if (manualTs && manualTs >= logTs) {
        selectedDate = manualDate
        source = 'Manual clean date'
      } else if (logTs) {
        selectedDate = logDate
        source = 'Maintenance log'
      }

      setHullFouling({
        monthsSinceHaulout: selectedDate ? Math.max(0, monthsBetween(selectedDate)) : 0,
        lastCleanDate: selectedDate,
        source,
        loaded: true,
      })
    } catch {
      setHullFouling({ monthsSinceHaulout: 0, lastCleanDate: null, source: null, loaded: true })
    }
  }

  const showAppToast = useCallback((message) => {
    setAppToast(message)
    if (appToastTimerRef.current) {
      clearTimeout(appToastTimerRef.current)
    }
    appToastTimerRef.current = setTimeout(() => {
      setAppToast(null)
      appToastTimerRef.current = null
    }, 4500)
  }, [])

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const safe = (p, fallback = []) => p.catch(() => fallback)
      const [
        vesselSettingsRow,
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
        firstAidItems,
        aedData,
        pendingReceipts,
        expensesLog,
      ] = await Promise.all([
        safe(db.getVesselSettings(), null),
        safe(db.getAll('engine_hours', 'date', false, 500)),
        safe(db.getAll('maintenance_tasks', 'created_at', false)),
        safe(db.getAll('maintenance_logs', 'completed_date', false, 300)),
        safe(db.getAll('fuel_log', 'date', false, 300)),
        safe(db.getAll('fluid_checks', 'date', false, 200)),
        safe(db.getAll('safety_items', 'created_at', false)),
        safe(db.getAll('contacts', 'category', true)),
        safe(db.getAll('documents', 'created_at', false, 200)),
        safe(db.getAll('voyage_log', 'date', false, 200)),
        safe(db.getAll('mooring_log', 'date', false, 200)),
        safe(db.getAll('departure_checks', 'date', false, 100)),
        safe(db.getAll('parts', 'name', true)),
        safe(db.getAll('watermaker_log', 'date', false, 300)),
        safe(getFirstAidInventory()),
        safe(getAedTracking(), null),
        safe(getPendingReceipts()),
        safe(db.getAll('expenses_log', 'date', false)),
      ])

      const nextPendingCount = (pendingReceipts || []).filter((r) => r.status === 'pending').length
      const prevPendingCount = pendingReceiptCountRef.current
      if (prevPendingCount != null && nextPendingCount > prevPendingCount) {
        showAppToast(`📬 New receipt received (${nextPendingCount} pending)`)
      }
      pendingReceiptCountRef.current = nextPendingCount

      setDataset({
        vesselSettings: vesselSettingsRow?.data || {},
        engineHours,
        maintenanceTasks,
        maintenanceLogs,
        fuelLog,
        fluidChecks,
        safetyItems,
        contacts: contacts || [],
        documents,
        voyageLog,
        mooringLog,
        departureChecks,
        parts,
        watermakerLog,
        firstAidItems: firstAidItems || [],
        aedData: aedData || null,
        pendingReceipts: pendingReceipts || [],
        expensesLog: expensesLog || [],
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => () => {
    if (appToastTimerRef.current) {
      clearTimeout(appToastTimerRef.current)
      appToastTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await seedIfEmpty()
      } catch (e) {
        setError(e.message)
      }
      await Promise.all([loadAll(), loadHullFouling()])
    })()
  }, [])

  useEffect(() => {
    if (!loading) {
      loadAll()
      loadHullFouling()
    }
  }, [refreshKeys.all])

  const [maintPrefill, setMaintPrefill] = useState(null)
  const [fuelPrefill, setFuelPrefill] = useState(null)
  const [partsReceiptPrefill, setPartsReceiptPrefill] = useState(null)
  const [expensesPrefill, setExpensesPrefill] = useState(null)
  const [tideContext, setTideContext] = useState(null)
  const [invoiceMatcherProps, setInvoiceMatcherProps] = useState(null)
  const [mobActive, setMobActive] = useState(false)
  const [mobPosition, setMobPosition] = useState(null)
  const { position: gpsPosition, startWatching: startGPS, stopWatching: stopGPS } = useGPS()
  useEffect(() => { startGPS(); return () => stopGPS() }, [startGPS, stopGPS])
  const activateMOB = useCallback(() => {
    if (!gpsPosition) { alert('No GPS fix — cannot mark MOB position.'); return }
    setMobPosition({ lat: gpsPosition.lat, lng: gpsPosition.lng })
    setMobActive(true)
  }, [gpsPosition])
  const openInvoiceMatcher = useCallback((props) => setInvoiceMatcherProps(props), [])
  const closeInvoiceMatcher = useCallback(() => setInvoiceMatcherProps(null), [])

  const openSpeedSettings = () => {
    localStorage.setItem('amaroo_speed_subtab', 'settings')
    setActiveTab('speed')
  }

  const shared = {
    dataset,
    triggerRefresh,
    goTab: setActiveTab,
    reload: loadAll,
    maintPrefill,
    setMaintPrefill,
    fuelPrefill,
    setFuelPrefill,
    partsReceiptPrefill,
    setPartsReceiptPrefill,
    onLogService: (task) => { setMaintPrefill(task); setActiveTab('maintenance') },
    onCheckTides: (ctx) => { setTideContext(ctx); setActiveTab('tides') },
    hullFouling,
    loadHullFouling,
    openSpeedSettings,
    openInvoiceMatcher,
    expensesPrefill,
    setExpensesPrefill,
  }

  const tabBody = {
    dashboard: <DashboardTab {...shared} />,
    engine: <EngineTab {...shared} />,
    maintenance: <MaintenanceTab {...shared} />,
    fuel: <FuelTab {...shared} />,
    fluids: <FluidsTab {...shared} />,
    safety: <SafetyTab {...shared} />,
    receipts: <PendingReceiptsTab {...shared} setActiveTab={setActiveTab} />,
    expenses: <ExpensesTab {...shared} />,
    contacts: <ContactsTab {...shared} />,
    documents: <DocumentsTab {...shared} />,
    voyage: <PassagePlanner {...shared} />,
    voyagelog: <VoyageLog {...shared} />,
    galley: <GalleyTab />,
    parts: <PartsTab {...shared} />,
    barcams: <BarCamsTab />,
    weather: <Weather />,
    tides: <Tides tideContext={tideContext} />,
    speed: <SpeedPredictor hullFouling={hullFouling} onHullFoulingUpdated={loadHullFouling} />,
    reports: <ReportsTab {...shared} />,
    settings: <SettingsTab {...shared} />,
    guide: <UserGuide />,
    emergency: <EmergencyCard />,
  }[activeTab]

  return (
    <div className="min-h-screen bg-[#F7F3EE] text-slate-900">
      <MOBAlert
        active={mobActive}
        mobPosition={mobPosition}
        currentPosition={gpsPosition}
        onDismiss={() => { setMobActive(false); setMobPosition(null) }}
      />
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="hidden md:flex w-64 min-h-screen flex-col bg-[#0A4A52] text-white p-4 sticky top-0">
          <img src="/Amaroo_Logo.png" alt="Amaroo" className="w-full object-contain mb-4 bg-white/95 rounded-lg p-2" />
          <div className="font-serif text-2xl">Amaroo</div>
          <div className="text-sm text-teal-100 mb-4">Clipper Explorer 50 PH</div>
          <nav className="overflow-y-auto pr-1 space-y-3">
            {NAV_GROUPS.map((group) => {
              const groupTabs = TAB_DEFS.filter((t) => group.tabs.includes(t.id))
                .sort((a, b) => group.tabs.indexOf(a.id) - group.tabs.indexOf(b.id))
              const isGroupActive = groupTabs.some((t) => t.id === activeTab)
              return (
                <SidebarGroup
                  key={group.id}
                  group={group}
                  tabs={groupTabs}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  defaultOpen={!group.collapsible || isGroupActive}
                />
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={activateMOB}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 active:scale-95 px-3 py-2 text-white font-bold tracking-wide shadow-md transition-all"
                title="Man Overboard — tap immediately if someone falls overboard"
              >
                <UserX size={16} /> MOB
              </button>
              <button
                type="button"
                onClick={loadAll}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0A4A52] px-3 py-2 text-white"
              >
                <RefreshCw size={16} /> Refresh
              </button>
            </div>
          </header>

          {loading ? (
            <div className="p-10 text-center">
              <img src="/Amaroo_Logo.png" alt="Amaroo" className="mx-auto h-40 object-contain animate-pulse" />
              <p className="mt-3 text-[#0A4A52]">Loading Amaroo systems...</p>
            </div>
          ) : error ? (
            <div className="m-4 p-4 rounded-lg bg-red-100 text-red-700">{error}</div>
          ) : (
            <div className="p-4"><TabErrorBoundary key={activeTab}>{tabBody}</TabErrorBoundary></div>
          )}
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#0A4A52] text-white border-t border-teal-800">
        <div className="flex gap-1 overflow-x-auto px-2 py-2 no-scrollbar">
        {TAB_DEFS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`text-xs rounded-md py-2 px-1.5 flex flex-col items-center min-w-[74px] shrink-0 border transition-colors ${activeTab === t.id ? 'bg-[#C4603A] border-[#e8a58f]' : 'bg-teal-800 border-teal-700'}`}
            >
              <Icon size={16} className="mb-1" />
              <span>{t.label.split(' ')[0]}</span>
            </button>
          )
        })}
        </div>
      </nav>

      {appToast && (
        <div className="fixed z-50 right-4 bottom-24 md:bottom-4 rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm shadow-lg">
          {appToast}
        </div>
      )}

      {invoiceMatcherProps && (
        <InvoiceTaskMatcher
          {...invoiceMatcherProps}
          onConfirm={() => { closeInvoiceMatcher(); triggerRefresh('all') }}
          onCancel={closeInvoiceMatcher}
        />
      )}
    </div>
  )
}

const TIMER_KEY = 'amaroo_trip_timer'
const DEFAULT_TIMER_CALIBRATION = {
  startFuelL: 2950,
  startEngineHoursTotal: null,
}

function normalizeTimerState(raw) {
  const base = {
    status: 'stopped',
    startTs: null,
    accumulated: 0,
    tripStart: null,
    calibration: { ...DEFAULT_TIMER_CALIBRATION },
  }
  if (!raw || typeof raw !== 'object') return base
  return {
    ...base,
    ...raw,
    calibration: {
      ...DEFAULT_TIMER_CALIBRATION,
      ...(raw.calibration || {}),
    },
  }
}

function fmtMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function TripTimer({ triggerRefresh, fuelBurnRate = 85, hullFouling, onOpenSpeedSettings }) {
  const [timer, setTimer] = useState(() => {
    try {
      return normalizeTimerState(JSON.parse(localStorage.getItem(TIMER_KEY)))
    } catch {
      return normalizeTimerState(null)
    }
  })
  const [tickMs, setTickMs] = useState(Date.now())
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [underwayVisible, setUnderwayVisible] = useState(() => timer.status === 'running')
  const intervalRef = useRef(null)
  const departureConditionsRef = useRef(null)
  const { position, source, startWatching, stopWatching } = useGPS({ maximumAge: 10_000, timeout: 15_000 })
  const { trackPoints, isRecording, startRecording, stopRecording, clearTrack } = useTrackRecorder()

  useEffect(() => {
    clearInterval(intervalRef.current)
    if (timer.status === 'running') {
      intervalRef.current = setInterval(() => setTickMs(Date.now()), 1000)
    }
    return () => clearInterval(intervalRef.current)
  }, [timer.status])

  useEffect(() => {
    if (timer.status === 'running' || underwayVisible) {
      startWatching()
    } else {
      stopWatching()
    }
  }, [startWatching, stopWatching, timer.status, underwayVisible])

  useEffect(() => {
    if (timer.status === 'running') {
      setUnderwayVisible(true)
    }
  }, [timer.status])

  useEffect(() => {
    if (timer.status === 'running' && !isRecording) {
      startRecording()
    }
  }, [isRecording, startRecording, timer.status])

  const elapsed =
    timer.status === 'running' && timer.startTs != null
      ? Math.max(0, (timer.accumulated || 0) + (tickMs - timer.startTs))
      : Math.max(0, timer.accumulated || 0)

  const persist = (t) => {
    const normalized = normalizeTimerState(t)
    localStorage.setItem(TIMER_KEY, JSON.stringify(normalized))
    setTimer(normalized)
  }

  const updateCalibration = (patch) => {
    persist({
      ...timer,
      calibration: {
        ...(timer.calibration || DEFAULT_TIMER_CALIBRATION),
        ...patch,
      },
    })
  }

  const start = () => {
    const now = Date.now()
    persist({ ...timer, status: 'running', startTs: now, accumulated: 0, tripStart: now })
    clearTrack()
  }

  const pause = () => {
    const ms =
      timer.status === 'running' && timer.startTs != null
        ? (timer.accumulated || 0) + (Date.now() - timer.startTs)
        : timer.accumulated || 0
    persist({ ...timer, status: 'paused', startTs: null, accumulated: ms })
  }

  const resume = () => {
    persist({ ...timer, status: 'running', startTs: Date.now() })
  }

  const handleStop = () => {
    const ms =
      timer.status === 'running' && timer.startTs != null
        ? (timer.accumulated || 0) + (Date.now() - timer.startTs)
        : timer.accumulated || 0
    const finalTrack = isRecording ? stopRecording() : [...trackPoints]
    setModal({
      elapsedMs: ms,
      showForm: false,
      weatherStatus: 'fetching',
      departureConditions: null,
      trackPoints: finalTrack,
      form: {
        name: `Trip — ${format(new Date(), 'd MMM yyyy')}`,
        departure_port: 'Aquatic Paradise',
        destination: '',
        engine_hours: String(+(ms / 3_600_000).toFixed(2)),
        fuel_used: '',
        notes: '',
      },
      calibration: timer.calibration || DEFAULT_TIMER_CALIBRATION,
    })
    // Fetch weather in background while modal shows
    ;(async () => {
      let lat = -27.524, lng = 153.430, gpsUsed = false
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }),
        )
        lat = pos.coords.latitude; lng = pos.coords.longitude; gpsUsed = true
      } catch { /* fall back to home berth */ }
      try {
        const { conditions: w, error } = await fetchCurrentConditions(lat, lng)
        if (error || !w) throw new Error(error || 'No weather data available')
        const conditions = {
          wind_speed: w.windKn,
          wind_direction: w.windDirCompass,
          wind_direction_degrees: w.windDirDeg,
          wave_height: w.waveHeightM,
          swell_height: w.swellHeightM,
          swell_direction: w.swellDirCompass,
          swell_period: w.swellPeriodS,
          comfort:
            w.windKn >= 30 || w.waveHeightM >= 2
              ? 'No-Go'
              : w.windKn >= 20 || w.waveHeightM >= 1.5
                ? 'Marginal'
                : 'Good',
          temperature: w.temperatureC,
        }
        departureConditionsRef.current = conditions
        setModal((m) => (m ? { ...m, weatherStatus: gpsUsed ? 'gps' : 'home_berth', departureConditions: conditions } : null))
        return
      } catch { /* ignore */ }
      setModal((m) => m ? { ...m, weatherStatus: 'failed' } : null)
    })()
  }

  const stopNoLog = () => {
    localStorage.removeItem(TIMER_KEY)
    setTimer(normalizeTimerState(null))
    setModal(null)
    departureConditionsRef.current = null
    clearTrack()
    setUnderwayVisible(false)
  }

  const stopWithLog = async () => {
    const { form } = modal
    // Use ref to get the latest fetched conditions regardless of render timing
    const departureConditions = departureConditionsRef.current || modal.departureConditions
    if (!form.destination.trim()) { alert('Please enter a destination.'); return }
    try {
      const baseNotes = [form.name, form.notes].filter(Boolean).join(' — ')
      const weatherNote = departureConditions
        ? `\n__AMAROO_DEPARTURE_CONDITIONS__${JSON.stringify(departureConditions)}`
        : ''
      const notes = baseNotes + weatherNote
      const insertPayload = {
        date: format(new Date(), 'yyyy-MM-dd'),
        departure_port: form.departure_port,
        destination: form.destination.trim(),
        departure_time: timer.tripStart ? format(new Date(timer.tripStart), 'HH:mm') : '',
        arrival_time: format(new Date(), 'HH:mm'),
        distance_nm: 0,
        crew_count: 0,
        conditions: '',
        fuel_used: Number(form.fuel_used) || 0,
        engine_hours: Number(form.engine_hours) || 0,
        notes,
        departure_conditions: departureConditions || null,
        track_points: Array.isArray(modal.trackPoints) ? modal.trackPoints : [],
      }
      try {
        await addVoyageLogEntry(insertPayload)
      } catch (colErr) {
        if (colErr.message?.includes('departure_conditions') || colErr.code === 'PGRST204') {
          const { departure_conditions: _dc, ...fallback } = insertPayload
          await addVoyageLogEntry(fallback)
        } else {
          throw colErr
        }
      }
      try {
        const tripHours = Number(form.engine_hours) || 0
        const startEngineTotal = Number(modal?.calibration?.startEngineHoursTotal)
        if (Number.isFinite(startEngineTotal)) {
          await setEngineHoursTotal(+(startEngineTotal + tripHours).toFixed(1))
        } else {
          await updateEngineHours(tripHours)
        }
      } catch { /* ignore */ }
      localStorage.removeItem(TIMER_KEY)
      setTimer(normalizeTimerState(null))
      setModal(null)
      departureConditionsRef.current = null
      clearTrack()
      setUnderwayVisible(false)
      triggerRefresh('all')
      setToast(`Voyage logged — ${form.name}`)
      setTimeout(() => setToast(null), 4000)
    } catch (err) {
      alert(err?.message || 'Failed to save voyage log.')
    }
  }

  const reset = () => {
    localStorage.removeItem(TIMER_KEY)
    setTimer(normalizeTimerState(null))
    clearTrack()
    setUnderwayVisible(false)
  }

  const setModalForm = (updater) => setModal((m) => ({ ...m, form: updater(m.form) }))

  return (
    <>
      <div className="rounded-xl bg-white shadow border border-slate-200 px-4 py-2.5">
        {toast && (
          <div className="mb-2 rounded-lg bg-green-100 border border-green-200 text-green-800 px-3 py-1.5 text-xs font-medium">
            {toast}
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide shrink-0">Trip Timer</span>
          <span className="text-2xl font-mono font-bold text-[#0A4A52] tracking-widest tabular-nums">
            {fmtMs(elapsed)}
          </span>
          {isRecording && (
            <span className="text-xs text-teal-700 font-medium">📍 Track recording — {trackPoints.length} points captured</span>
          )}
          {position?.lat != null && position?.lng != null && (
            <span className="text-xs text-slate-500">
              GPS {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </span>
          )}
          {timer.tripStart && timer.status !== 'stopped' && (
            <span className="text-xs text-slate-400">
              {format(new Date(timer.tripStart), 'EEE d MMM, HH:mm')}
              {timer.status === 'paused' && ' · paused'}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            {timer.status === 'stopped' && (
              <button type="button" onClick={start}
                className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5 text-xs font-medium">
                Start
              </button>
            )}
            {timer.status === 'running' && (<>
              <button type="button" onClick={pause}
                className="rounded-lg bg-amber-500 text-white px-3 py-1.5 text-xs font-medium">
                Pause
              </button>
              <button type="button" onClick={handleStop}
                className="rounded-lg bg-[#C4603A] text-white px-3 py-1.5 text-xs font-medium">
                Stop
              </button>
            </>)}
            {timer.status === 'paused' && (<>
              <button type="button" onClick={resume}
                className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5 text-xs font-medium">
                Resume
              </button>
              <button type="button" onClick={handleStop}
                className="rounded-lg bg-[#C4603A] text-white px-3 py-1.5 text-xs font-medium">
                Stop
              </button>
            </>)}
            {timer.status === 'stopped' && timer.accumulated > 0 && (
              <button type="button" onClick={reset}
                className="rounded-lg border border-slate-300 text-slate-600 px-3 py-1.5 text-xs">
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => setUnderwayVisible((v) => !v)}
              className="rounded-lg border border-[#0A4A52] text-[#0A4A52] px-3 py-1.5 text-xs font-medium"
            >
              📊 {underwayVisible ? 'Hide Underway' : 'Underway Dashboard'}
            </button>
          </div>
        </div>
      </div>

      <UnderwayDashboard
        isActive={underwayVisible}
        timer={timer}
        elapsedMs={elapsed}
        trackPoints={trackPoints}
        isRecording={isRecording}
        currentPosition={position}
        gpsSource={source}
        fuelBurnRate={fuelBurnRate}
        hullFouling={hullFouling}
        timerCalibration={timer.calibration}
        onUpdateCalibration={updateCalibration}
        onOpenSpeedSettings={onOpenSpeedSettings}
        onClose={() => setUnderwayVisible(false)}
      />

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-serif text-xl text-[#0A4A52]">Trip Complete</h3>
            <div className="text-4xl font-mono font-bold text-[#0A4A52] text-center py-2 tabular-nums">
              {fmtMs(modal.elapsedMs)}
            </div>
            <div className="text-xs text-slate-500 text-center">
              📍 Track captured: {Array.isArray(modal.trackPoints) ? modal.trackPoints.length : 0} points
            </div>
            {modal.weatherStatus === 'fetching' && (
              <div className="text-xs text-slate-500 text-center">🔍 Fetching weather conditions…</div>
            )}
            {modal.weatherStatus === 'gps' && (
              <div className="text-xs text-teal-700 text-center">📍 Weather captured at current position</div>
            )}
            {modal.weatherStatus === 'home_berth' && (
              <div className="text-xs text-amber-700 text-center">📍 Weather captured at home berth (no GPS)</div>
            )}
            {!modal.showForm ? (
              <>
                <p className="text-center text-slate-600">Create a voyage log entry?</p>
                <div className="flex gap-3 justify-center">
                  <button type="button"
                    onClick={() => setModal((m) => ({ ...m, showForm: true }))}
                    className="rounded-lg bg-[#0A4A52] text-white px-6 py-2">
                    Yes
                  </button>
                  <button type="button" onClick={stopNoLog}
                    className="rounded-lg border border-slate-300 text-slate-600 px-6 py-2">
                    No
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Input label="Trip Name" value={modal.form.name}
                  onChange={(v) => setModalForm((f) => ({ ...f, name: v }))} />
                <Input label="From" value={modal.form.departure_port}
                  onChange={(v) => setModalForm((f) => ({ ...f, departure_port: v }))} />
                <Input label="To *" value={modal.form.destination}
                  onChange={(v) => setModalForm((f) => ({ ...f, destination: v }))} />
                <Input label="Engine Hours (decimal)" type="number" value={modal.form.engine_hours}
                  onChange={(v) => setModalForm((f) => ({ ...f, engine_hours: v }))} />
                <Input label="Fuel Used (L)" type="number" value={modal.form.fuel_used}
                  onChange={(v) => setModalForm((f) => ({ ...f, fuel_used: v }))} />
                <label className="text-sm block">Notes
                  <textarea
                    className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                    rows={2}
                    value={modal.form.notes}
                    onChange={(e) => setModalForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </label>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={stopWithLog}
                    className="flex-1 rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm">
                    Confirm &amp; Save
                  </button>
                  <button type="button"
                    onClick={() => setModal((m) => ({ ...m, showForm: false }))}
                    className="rounded-lg border border-slate-300 text-slate-600 px-4 py-2 text-sm">
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const VESSEL_SYSTEMS = [
  'Engines', 'Generator', 'Watermaker', 'Stabilisers', 'Electrical',
  'Plumbing', 'Deck & Anchor', 'Safety', 'Navigation', 'Fuel System',
  'A/C', 'Bilge', 'Tenders & Outboards', 'Other',
]

function FuelTank({ label, litres, capacity }) {
  const pct = Math.min(100, Math.max(0, capacity > 0 ? (litres / capacity) * 100 : 0))
  const fillColor = pct > 40 ? '#0A4A52' : pct > 20 ? '#D97706' : '#DC2626'
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="relative w-14 h-28 rounded-b-lg border-2 border-slate-400 bg-slate-100 overflow-hidden flex flex-col justify-end">
        <div className="w-full transition-all duration-700 ease-out" style={{ height: `${pct}%`, backgroundColor: fillColor }} />
        {[25, 50, 75].map((tick) => (
          <div key={tick} className="absolute left-0 right-0 border-t border-slate-300" style={{ bottom: `${tick}%` }} />
        ))}
        <div className="absolute inset-x-0 top-0 h-2 bg-slate-200 border-b border-slate-400" />
      </div>
      <div className="text-sm font-bold" style={{ color: fillColor }}>{Math.round(pct)}%</div>
      <div className="text-xs text-slate-500">{Math.round(litres)} L</div>
    </div>
  )
}

function DashboardTab({ dataset, goTab, reload, triggerRefresh, onLogService, hullFouling, openSpeedSettings }) {
  const { engineHours, maintenanceTasks, maintenanceLogs, fuelLog, vesselSettings, firstAidItems = [], aedData, voyageLog = [], pendingReceipts = [] } = dataset
  const [homeWeather, setHomeWeather] = useState(null)
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null)
  const [loadingWeather, setLoadingWeather] = useState(false)
  const [activeChecklist, setActiveChecklist] = useState(null)
  const [checkedItems, setCheckedItems] = useState({})
  const [customItems, setCustomItems] = useState([])
  const [addingItem, setAddingItem] = useState(false)
  const [newItemText, setNewItemText] = useState('')
  const [savingCustom, setSavingCustom] = useState(false)

  useEffect(() => {
    if (!activeChecklist) { setCustomItems([]); return }
    getCustomChecklistItems(activeChecklist)
      .then((items) => setCustomItems(items || []))
      .catch(() => setCustomItems([]))
  }, [activeChecklist])

  const handleAddItem = async () => {
    if (!newItemText.trim()) return
    setSavingCustom(true)
    try {
      await addCustomChecklistItem(activeChecklist, newItemText.trim())
      const items = await getCustomChecklistItems(activeChecklist)
      setCustomItems(items || [])
      setNewItemText('')
      setAddingItem(false)
    } catch (err) {
      alert(err?.message || 'Failed to add item.')
    } finally {
      setSavingCustom(false)
    }
  }

  const handleDeleteCustomItem = async (id) => {
    try {
      await deleteCustomChecklistItem(id)
      setCustomItems((prev) => prev.filter((i) => i.id !== id))
    } catch (err) {
      alert(err?.message || 'Failed to delete item.')
    }
  }

  const fetchHomeWeather = async (force = false) => {
    const now = Date.now()
    if (!force && weatherUpdatedAt && now - weatherUpdatedAt < 30 * 60 * 1000) {
      return
    }
    setLoadingWeather(true)
    try {
      const hour = new Date().getHours()
      const { marineData, windData, error } = await fetchRouteWeather(-27.524, 153.43)
      if (!error) {
        const extracted = extractHourlyWeather(marineData, windData, hour)
        if (extracted) {
          setHomeWeather(extracted)
          setWeatherUpdatedAt(now)
          localStorage.setItem(HOME_WEATHER_CACHE_KEY, JSON.stringify({ weather: extracted, ts: now }))
          return
        }
      }

      // Fallback to current conditions endpoint when hourly route data is unavailable.
      const { conditions, error: currentErr } = await fetchCurrentConditions(-27.524, 153.43)
      if (!currentErr && conditions) {
        setHomeWeather(conditions)
        setWeatherUpdatedAt(now)
        localStorage.setItem(HOME_WEATHER_CACHE_KEY, JSON.stringify({ weather: conditions, ts: now }))
        return
      }

      // Last fallback: use cached weather so Dashboard doesn't show an empty panel.
      const cached = localStorage.getItem(HOME_WEATHER_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed?.weather) {
          setHomeWeather(parsed.weather)
          setWeatherUpdatedAt(Number(parsed.ts) || now)
        }
      }
    } catch {
      const cached = localStorage.getItem(HOME_WEATHER_CACHE_KEY)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          if (parsed?.weather) {
            setHomeWeather(parsed.weather)
            setWeatherUpdatedAt(Number(parsed.ts) || now)
          }
        } catch {
          // ignore corrupted cache
        }
      }
    } finally {
      setLoadingWeather(false)
    }
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
  const burn = Number(vesselSettings.estimated_burn_rate_litres_per_hour || 21)
  const range = burn > 0 ? (estOnBoard / burn) * Number(vesselSettings.cruise_speed_knots || 12) : 0

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  const currentHours = Number(vesselSettings.engine_hours_total || 0)
  const today = startOfDay(new Date())
  const reminderItems = maintenanceLogs
    .filter((l) => l.next_due_date || l.next_due_hours != null)
    .map((l) => {
      let status = 'ok'
      let reason = ''
      if (l.next_due_date) {
        const due = parseISO(l.next_due_date)
        const daysLeft = differenceInDays(due, today)
        if (isBefore(due, today)) {
          status = 'overdue'
          reason = `${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} overdue`
        } else if (daysLeft <= 30) {
          status = 'soon'
          reason = `Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
        }
      }
      if (l.next_due_hours != null && status === 'ok') {
        const hoursLeft = Number(l.next_due_hours) - currentHours
        if (hoursLeft <= 0) {
          status = 'overdue'
          reason = `${Math.abs(hoursLeft).toFixed(1)} hrs overdue`
        } else if (hoursLeft <= 10) {
          status = 'soon'
          reason = `${hoursLeft.toFixed(1)} hrs remaining`
        }
      }
      return { ...l, reminderStatus: status, reminderReason: reason }
    })
    .filter((r) => r.reminderStatus !== 'ok')
    .sort((a, b) => (a.reminderStatus === 'overdue' ? -1 : 1))

  // First aid expiry alerts
  const firstAidAlerts = firstAidItems
    .map((item) => {
      const qty = Number(item.qty_on_board || 0)
      const rec = Number(item.recommended_qty || 0)
      if (!item.expiry_date) {
        if (qty <= 0) {
          return {
            id: `firstaid-zero-${item.id}`,
            task: `⚕️ ${item.item_name} — zero stock on board`,
            reminderStatus: 'overdue',
            reminderReason: 'Restock immediately',
            system: 'First Aid',
            task_type: 'diy',
          }
        }
        if (qty < rec) {
          return {
            id: `firstaid-low-${item.id}`,
            task: `⚕️ ${item.item_name} — below recommended quantity`,
            reminderStatus: 'soon',
            reminderReason: `${qty}/${rec} on board`,
            system: 'First Aid',
            task_type: 'diy',
          }
        }
        return null
      }
      const due = parseISO(item.expiry_date)
      const daysLeft = differenceInDays(due, today)
      if (isBefore(due, today)) {
        return {
          id: `firstaid-exp-${item.id}`,
          task: `⚕️ ${item.item_name} — expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`,
          reminderStatus: 'overdue',
          reminderReason: 'Replace now',
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      if (daysLeft <= 30) {
        return {
          id: `firstaid-soon-${item.id}`,
          task: `⚕️ ${item.item_name} — expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          reminderStatus: 'soon',
          reminderReason: 'Expiry approaching',
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      if (qty <= 0) {
        return {
          id: `firstaid-zero-${item.id}`,
          task: `⚕️ ${item.item_name} — zero stock on board`,
          reminderStatus: 'overdue',
          reminderReason: 'Restock immediately',
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      if (qty < rec) {
        return {
          id: `firstaid-low-${item.id}`,
          task: `⚕️ ${item.item_name} — below recommended quantity`,
          reminderStatus: 'soon',
          reminderReason: `${qty}/${rec} on board`,
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      return null
    })
    .filter(Boolean)

  // AED expiry alerts (60-day window)
  const aedAlerts = []
  if (aedData) {
    for (const [field, label] of [['pad_expiry_date', 'AED pads'], ['battery_expiry_date', 'AED battery']]) {
      if (aedData[field]) {
        const due = parseISO(aedData[field])
        const daysLeft = differenceInDays(due, today)
        if (isBefore(due, today)) {
          aedAlerts.push({
            id: `aed-${field}`,
            task: `⚡ ${label} — expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`,
            reminderStatus: 'overdue',
            reminderReason: 'Replace immediately',
            system: 'Safety',
            task_type: 'specialist',
          })
        } else if (daysLeft <= 60) {
          aedAlerts.push({
            id: `aed-${field}`,
            task: `⚡ ${label} — expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            reminderStatus: 'overdue',
            reminderReason: 'Urgent cardiac equipment',
            system: 'Safety',
            task_type: 'specialist',
          })
        }
      }
    }
  }

  const foulingMonths = Number(hullFouling?.monthsSinceHaulout || 0)
  const fouling = foulingPenalty(foulingMonths)
  const foulingLabel = foulingConditionLabel(foulingMonths)
  let foulingAlert = null
  if (!hullFouling?.lastCleanDate) {
    foulingAlert = {
      id: 'hull-fouling-no-date',
      task: '⚓ Hull clean date missing — set baseline for fouling tracking',
      reminderStatus: 'soon',
      reminderReason: 'Open Speed Settings to set date',
      system: 'Hull',
      task_type: 'diy',
      action: 'speed-settings',
    }
  } else if (foulingMonths > 6) {
    foulingAlert = {
      id: 'hull-fouling-overdue',
      task: `⚓ ${foulingLabel.label} hull fouling — ${fouling.penaltyPct}% speed penalty`,
      reminderStatus: 'overdue',
      reminderReason: 'Diver clean recommended',
      system: 'Hull',
      task_type: 'specialist',
      action: 'speed-settings',
    }
  } else if (foulingMonths > 3) {
    foulingAlert = {
      id: 'hull-fouling-soon',
      task: `⚓ ${foulingLabel.label} fouling trend — ${fouling.penaltyPct}% speed penalty`,
      reminderStatus: 'soon',
      reminderReason: 'Plan clean within 2 months',
      system: 'Hull',
      task_type: 'specialist',
      action: 'speed-settings',
    }
  }

  const allAlerts = [...reminderItems, ...firstAidAlerts, ...aedAlerts, ...(foulingAlert ? [foulingAlert] : [])]
  const overdueCount = allAlerts.filter((r) => r.reminderStatus === 'overdue').length
  const soonCount = allAlerts.filter((r) => r.reminderStatus === 'soon').length
  const upcomingAttentionCount = tasks.filter((t) => t.statusFlag !== 'current').length
  const pendingReceiptCount = pendingReceipts.filter((r) => r.status === 'pending').length
  const serviceIntervalHours = Number(vesselSettings.engine_service_interval_hours || 250)
  const serviceProgress = (hours) => {
    const safeHours = Math.max(0, Number(hours || 0))
    const cycle = serviceIntervalHours > 0 ? safeHours % serviceIntervalHours : 0
    const pct = serviceIntervalHours > 0 ? Math.max(0, Math.min(100, (cycle / serviceIntervalHours) * 100)) : 0
    const nextDue = serviceIntervalHours > 0 ? Math.ceil(Math.max(1, safeHours) / serviceIntervalHours) * serviceIntervalHours : safeHours
    return {
      pct,
      remaining: Math.max(0, nextDue - safeHours),
      nextDue,
    }
  }
  const portService = serviceProgress(latest?.port_engine)
  const stbdService = serviceProgress(latest?.stbd_engine)

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

      <div className="grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2"><Stat title="Port Engine" value={latest?.port_engine || 0} suffix="hrs" /></div>
        <div className="md:col-span-2"><Stat title="Stbd Engine" value={latest?.stbd_engine || 0} suffix="hrs" /></div>
        <div className="md:col-span-2"><Stat title="Generator" value={latest?.generator || 0} suffix="hrs" /></div>
        <div className="md:col-span-3"><Stat title="Trip Log" value={Math.round(Number(vesselSettings.trip_log_baseline_nm || 0) + voyageLog.reduce((s, v) => s + Number(v.distance_nm || 0), 0))} suffix="nm" /></div>
        <div className="md:col-span-3"><Stat title="Days Since Maintenance" value={maintenanceLogs[0]?.completed_date ? differenceInDays(new Date(), parseISO(maintenanceLogs[0].completed_date)) : 'N/A'} /></div>
      </div>

      <TripTimer
        triggerRefresh={triggerRefresh}
        fuelBurnRate={Number(vesselSettings?.fuelBurnLhrAtCruise || vesselSettings?.estimated_burn_rate_litres_per_hour || 21)}
        hullFouling={hullFouling}
        onOpenSpeedSettings={openSpeedSettings}
      />

      <AnchorWatch />

      <div className={cardClass()}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-serif text-lg text-[#0A4A52]">Maintenance Summary</h3>
          <button
            type="button"
            onClick={() => goTab('maintenance')}
            className="rounded-lg border border-[#0A4A52] px-2.5 py-1 text-xs text-[#0A4A52] hover:bg-[#0A4A52] hover:text-white"
          >
            Open Maintenance
          </button>
        </div>
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {allAlerts.length === 0 ? (
            <span className="rounded-full bg-green-50 border border-green-200 text-green-700 text-[11px] font-medium px-2 py-0.5">
              Up to date
            </span>
          ) : (
            <>
              {overdueCount > 0 && (
                <span className="rounded-full bg-[#C4603A] text-white text-[11px] font-semibold px-2 py-0.5">{overdueCount} overdue</span>
              )}
              {soonCount > 0 && (
                <span className="rounded-full bg-amber-400 text-amber-900 text-[11px] font-semibold px-2 py-0.5">{soonCount} due soon</span>
              )}
            </>
          )}
          <span className="rounded-full bg-slate-100 text-slate-700 text-[11px] font-medium px-2 py-0.5">{upcomingAttentionCount} upcoming attention</span>
          {pendingReceiptCount > 0 && (
            <span className="rounded-full bg-blue-50 text-blue-800 text-[11px] font-medium px-2 py-0.5">{pendingReceiptCount} receipts pending</span>
          )}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
              <span>Port next service</span>
              <span>{portService.remaining.toFixed(1)}h left</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-2 rounded-full bg-[#0A4A52]" style={{ width: `${portService.pct}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Due around {Math.round(portService.nextDue)}h</div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
              <span>Stbd next service</span>
              <span>{stbdService.remaining.toFixed(1)}h left</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-2 rounded-full bg-[#C4603A]" style={{ width: `${stbdService.pct}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Due around {Math.round(stbdService.nextDue)}h</div>
          </div>
        </div>
      </div>

      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Fuel Status</h3>
        <div className="flex justify-center gap-10 mb-4">
          <FuelTank
            label="Port"
            litres={estOnBoard / 2}
            capacity={vesselSettings.port_tank_capacity || 1475}
          />
          <FuelTank
            label="Stbd"
            litres={estOnBoard / 2}
            capacity={vesselSettings.stbd_tank_capacity || 1475}
          />
        </div>
        <div className="text-sm space-y-1 text-slate-700">
          <div>Total: <strong>{Math.round(estOnBoard)} L</strong> of {Math.round((vesselSettings.port_tank_capacity || 1475) + (vesselSettings.stbd_tank_capacity || 1475))} L</div>
          <div>Range: <strong>{Math.round(range)} nm</strong></div>
          <div className="text-xs text-slate-400">Last fill: {fuelLog[0]?.date || 'N/A'}</div>
        </div>
        <button type="button" className="mt-2 text-[#0A4A52] text-sm underline" onClick={() => goTab('fuel')}>
          Open Fuel Log
        </button>
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
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Checklists</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(CHECKLISTS).map((name) => (
              <button
                key={name}
                type="button"
                className={`rounded-lg p-2 text-sm text-left transition-colors ${activeChecklist === name ? 'bg-[#0A4A52] text-white' : 'bg-teal-50 text-[#0A4A52] hover:bg-teal-100'}`}
                onClick={() => {
                  setActiveChecklist((prev) => prev === name ? null : name)
                  setCheckedItems({})
                  setAddingItem(false)
                  setNewItemText('')
                }}
              >
                {name}
              </button>
            ))}
          </div>
          {activeChecklist && (() => {
            const builtins = CHECKLISTS[activeChecklist] || []
            const allChecked =
              builtins.length + customItems.length > 0 &&
              builtins.every((_, i) => checkedItems[`${activeChecklist}-${i}`]) &&
              customItems.every((item) => checkedItems[`custom-${item.id}`])
            return (
              <div className="mt-3 border-t border-teal-100 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[#0A4A52]">{activeChecklist}</span>
                  <button type="button" className="text-xs text-slate-400 hover:text-slate-600"
                    onClick={() => setCheckedItems({})}>Reset</button>
                </div>
                <ul className="space-y-1">
                  {builtins.map((item, idx) => {
                    const key = `${activeChecklist}-${idx}`
                    return (
                      <li key={key}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" className="mt-0.5 accent-[#0A4A52] shrink-0"
                            checked={!!checkedItems[key]}
                            onChange={() => setCheckedItems((p) => ({ ...p, [key]: !p[key] }))} />
                          <span className={`text-xs leading-snug ${checkedItems[key] ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                            {item}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {customItems.length > 0 && (
                  <ul className="space-y-1 mt-2 pt-2 border-t border-dashed border-teal-100">
                    {customItems.map((item) => {
                      const key = `custom-${item.id}`
                      return (
                        <li key={key} className="flex items-start gap-1.5">
                          <input type="checkbox" className="mt-0.5 accent-[#0A4A52] shrink-0"
                            checked={!!checkedItems[key]}
                            onChange={() => setCheckedItems((p) => ({ ...p, [key]: !p[key] }))} />
                          <span className={`flex-1 text-xs leading-snug ${checkedItems[key] ? 'line-through text-slate-400' : 'text-slate-600'}`}>
                            {item.description}
                          </span>
                          <span className="text-[10px] text-teal-500 shrink-0 self-center">custom</span>
                          <button type="button" onClick={() => handleDeleteCustomItem(item.id)}
                            className="shrink-0 text-red-400 hover:text-red-600 self-center ml-0.5">
                            <Trash2 size={12} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {allChecked && (
                  <div className="mt-2 text-xs text-green-700 font-medium">All items checked ✓</div>
                )}
                {addingItem ? (
                  <div className="mt-2 flex gap-1">
                    <input
                      type="text"
                      value={newItemText}
                      onChange={(e) => setNewItemText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
                      placeholder="New checklist item…"
                      className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      autoFocus
                    />
                    <button type="button" onClick={handleAddItem} disabled={savingCustom}
                      className="rounded-lg bg-[#0A4A52] text-white px-2 py-1 text-xs disabled:opacity-60">
                      {savingCustom ? '…' : 'Add'}
                    </button>
                    <button type="button" onClick={() => { setAddingItem(false); setNewItemText('') }}
                      className="rounded-lg border border-slate-300 text-slate-500 px-2 py-1 text-xs">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddingItem(true)}
                    className="mt-2 flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800">
                    <Plus size={12} /> Add item
                  </button>
                )}
              </div>
            )
          })()}
        </div>
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Quick Actions</h3>
          <div className="space-y-2 text-sm">
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2.5 flex items-center justify-between" onClick={() => goTab('engine')}>
              <span>Log Engine Hours</span>
              <span className="text-xs rounded-full bg-white/20 px-2 py-0.5">{latest?.date || 'No log yet'}</span>
            </button>
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2.5 flex items-center justify-between" onClick={() => goTab('fuel')}>
              <span>Add Fuel</span>
              <span className="inline-flex items-center gap-1 text-xs">
                <span className={`inline-block h-2 w-2 rounded-full ${range > 250 ? 'bg-green-300' : 'bg-amber-300'}`} />
                {Math.round(range)}nm est range
              </span>
            </button>
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2.5 flex items-center justify-between" onClick={() => goTab('fluids')}>
              <span>Record Fluid Check</span>
              <span className="inline-flex items-center gap-1 text-xs">
                <span className={`inline-block h-2 w-2 rounded-full ${soonCount > 0 ? 'bg-amber-300' : 'bg-green-300'}`} />
                {soonCount > 0 ? `${soonCount} checks soon` : 'All current'}
              </span>
            </button>
            <button type="button" className="w-full rounded-lg bg-[#0A4A52] text-white p-2.5 flex items-center justify-between" onClick={() => goTab('maintenance')}>
              <span>Add Maintenance Entry</span>
              <span className="inline-flex items-center gap-1 text-xs">
                <span className={`inline-block h-2 w-2 rounded-full ${overdueCount > 0 ? 'bg-red-300' : 'bg-green-300'}`} />
                {overdueCount > 0 ? `${overdueCount} overdue` : 'No overdue'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {pendingReceiptCount > 0 && (
        <div className={cardClass('border border-[#0A4A52]')}>
          <div className="text-lg font-semibold text-[#0A4A52]">📬 Pending Receipts</div>
          <div className="text-sm text-slate-600 mt-1">{pendingReceiptCount} receipt{pendingReceiptCount === 1 ? '' : 's'} awaiting review</div>
          <button
            type="button"
            onClick={() => goTab('receipts')}
            className="mt-3 rounded-lg border border-[#0A4A52] px-3 py-1.5 text-sm text-[#0A4A52] hover:bg-[#0A4A52] hover:text-white"
          >
            Review Now →
          </button>
        </div>
      )}

      <a className={cardClass('block')} href="https://www.bom.gov.au/marine/" target="_blank" rel="noreferrer">
        <div className="font-semibold text-[#0A4A52]">BOM Marine Forecast (QLD)</div>
      </a>

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
  const bumpValue = (field, delta) => {
    const next = Math.max(0, Number(form[field] || 0) + delta)
    setForm((prev) => ({ ...prev, [field]: Number(next.toFixed(1)) }))
  }

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
    setForm((prev) => ({ ...prev, date: format(new Date(), 'yyyy-MM-dd'), notes: '' }))
  }

  return (
    <div className="space-y-4">
      <form className={cardClass()} onSubmit={save}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Hours Entry</h3>
        <div className="grid md:grid-cols-4 gap-3">
          <Input label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <NumberStepper label="Port Engine" value={form.port_engine} onChange={(v) => setForm({ ...form, port_engine: v })} onStep={(d) => bumpValue('port_engine', d)} />
          <NumberStepper label="Stbd Engine" value={form.stbd_engine} onChange={(v) => setForm({ ...form, stbd_engine: v })} onStep={(d) => bumpValue('stbd_engine', d)} />
          <NumberStepper label="Generator" value={form.generator} onChange={(v) => setForm({ ...form, generator: v })} onStep={(d) => bumpValue('generator', d)} />
          <NumberStepper label="Naiad" value={form.naiad} onChange={(v) => setForm({ ...form, naiad: v })} onStep={(d) => bumpValue('naiad', d)} />
          <NumberStepper label="Watermaker" value={form.watermaker} onChange={(v) => setForm({ ...form, watermaker: v })} onStep={(d) => bumpValue('watermaker', d)} />
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

function MaintenanceTab({ dataset, triggerRefresh, maintPrefill, setMaintPrefill, onLogService, openSpeedSettings, hullFouling, goTab, openInvoiceMatcher }) {
  const { maintenanceTasks, maintenanceLogs, engineHours, vesselSettings, firstAidItems = [], aedData, pendingReceipts = [] } = dataset
  const latest = latestByDate(engineHours)
  const latestAvg = latest ? (Number(latest.port_engine) + Number(latest.stbd_engine)) / 2 : 0
  const currentHours = Number(vesselSettings?.engine_hours_total || 0)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [newTask, setNewTask] = useState({ system: '', task: '', priority: 'medium', due_date: '', task_type: 'diy', next_due_hours: '', estimated_cost: '', description: '' })
  const [query, setQuery] = useState('')
  const [completing, setCompleting] = useState(null)
  const [completeNotes, setCompleteNotes] = useState('')
  const [completeDesc, setCompleteDesc] = useState('')
  const [completeTaskType, setCompleteTaskType] = useState('diy')
  const [completeVesselSystem, setCompleteVesselSystem] = useState('')
  const [completeCost, setCompleteCost] = useState('')
  const [completeNextDueDate, setCompleteNextDueDate] = useState('')
  const [completeNextDueHours, setCompleteNextDueHours] = useState('')
  const [completePhotos, setCompletePhotos] = useState([])
  const [logGallery, setLogGallery] = useState(null)
  const [expandedLog, setExpandedLog] = useState(new Set())
  const [directLog, setDirectLog] = useState({
    system: '', task: '', date: format(new Date(), 'yyyy-MM-dd'),
    cost: '', notes: '', description: '', task_type: 'diy',
    next_due_date: '', next_due_hours: '',
  })
  const [directPhotos, setDirectPhotos] = useState([])
  const [savingDirect, setSavingDirect] = useState(false)
  const [prefillTaskId, setPrefillTaskId] = useState(null)
  const [showUpdateTask, setShowUpdateTask] = useState(false)
  const [updateTaskForm, setUpdateTaskForm] = useState({ next_due_date: '', next_due_hours: '' })
  const [addPanel, setAddPanel] = useState('job')
  const [filterType, setFilterType] = useState('all')
  const [filterSystem, setFilterSystem] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [scanningInvoice, setScanningInvoice] = useState(false)
  const [invoiceConfidence, setInvoiceConfidence] = useState('')
  const [invoiceMessage, setInvoiceMessage] = useState('')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [invoiceAttachmentUrl, setInvoiceAttachmentUrl] = useState('')
  const [invoicePendingId, setInvoicePendingId] = useState(null)
  const [deletingLogId, setDeletingLogId] = useState(null)
  const invoiceInputRef = useRef(null)

  useEffect(() => {
    if (!maintPrefill) return
    setAddPanel('log')

    const extracted = maintPrefill?.extracted_data || maintPrefill
    const isReceiptPrefill = Boolean(maintPrefill?.receipt_type || maintPrefill?.source === 'email')

    setDirectLog((prev) => ({
      ...prev,
      system: extracted?.vessel_system || maintPrefill.system || prev.system,
      task: maintPrefill.task || (isReceiptPrefill ? 'Invoice work' : prev.task),
      task_type: isReceiptPrefill ? 'specialist' : (maintPrefill.task_type || prev.task_type),
      description: extracted?.description || maintPrefill.description || prev.description,
      date: extracted?.date || format(new Date(), 'yyyy-MM-dd'),
      cost: extracted?.total_cost_aud ?? prev.cost,
      notes: Array.isArray(extracted?.parts_listed)
        ? extracted.parts_listed.join(', ')
        : (prev.notes || ''),
    }))

    setPrefillTaskId(maintPrefill.task_id || null)

    if (isReceiptPrefill) {
      setInvoiceAttachmentUrl(maintPrefill.attachment_url || '')
      setInvoicePendingId(maintPrefill.id || null)
      setInvoiceConfidence(extracted?.confidence || '')
      setInvoiceMessage('✅ Invoice extracted and form pre-filled')
    }

    setMaintPrefill(null)
  }, [maintPrefill, setMaintPrefill])

  const upcoming = maintenanceTasks
    .map((t) => ({ ...t, statusFlag: dueStatus(t, latestAvg, 30) }))
    .filter((t) => t.status !== 'archived')
    .sort((a, b) => ({ overdue: 0, soon: 1, current: 2 }[a.statusFlag] - { overdue: 0, soon: 1, current: 2 }[b.statusFlag]))

  const today = startOfDay(new Date())
  const reminderItems = maintenanceLogs
    .filter((l) => l.next_due_date || l.next_due_hours != null)
    .map((l) => {
      let status = 'ok'
      let reason = ''
      if (l.next_due_date) {
        const due = parseISO(l.next_due_date)
        const daysLeft = differenceInDays(due, today)
        if (isBefore(due, today)) {
          status = 'overdue'
          reason = `${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} overdue`
        } else if (daysLeft <= 30) {
          status = 'soon'
          reason = `Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
        }
      }
      if (l.next_due_hours != null && status === 'ok') {
        const hoursLeft = Number(l.next_due_hours) - currentHours
        if (hoursLeft <= 0) {
          status = 'overdue'
          reason = `${Math.abs(hoursLeft).toFixed(1)} hrs overdue`
        } else if (hoursLeft <= 10) {
          status = 'soon'
          reason = `${hoursLeft.toFixed(1)} hrs remaining`
        }
      }
      return { ...l, reminderStatus: status, reminderReason: reason }
    })
    .filter((r) => r.reminderStatus !== 'ok')
    .sort((a, b) => (a.reminderStatus === 'overdue' ? -1 : 1))

  const firstAidAlerts = firstAidItems
    .map((item) => {
      const qty = Number(item.qty_on_board || 0)
      const rec = Number(item.recommended_qty || 0)
      if (!item.expiry_date) {
        if (qty <= 0) {
          return {
            id: `firstaid-zero-${item.id}`,
            task: `⚕️ ${item.item_name} — zero stock on board`,
            reminderStatus: 'overdue',
            reminderReason: 'Restock immediately',
            system: 'First Aid',
            task_type: 'diy',
          }
        }
        if (qty < rec) {
          return {
            id: `firstaid-low-${item.id}`,
            task: `⚕️ ${item.item_name} — below recommended quantity`,
            reminderStatus: 'soon',
            reminderReason: `${qty}/${rec} on board`,
            system: 'First Aid',
            task_type: 'diy',
          }
        }
        return null
      }
      const due = parseISO(item.expiry_date)
      const daysLeft = differenceInDays(due, today)
      if (isBefore(due, today)) {
        return {
          id: `firstaid-exp-${item.id}`,
          task: `⚕️ ${item.item_name} — expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`,
          reminderStatus: 'overdue',
          reminderReason: 'Replace now',
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      if (daysLeft <= 30) {
        return {
          id: `firstaid-soon-${item.id}`,
          task: `⚕️ ${item.item_name} — expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          reminderStatus: 'soon',
          reminderReason: 'Expiry approaching',
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      if (qty <= 0) {
        return {
          id: `firstaid-zero-${item.id}`,
          task: `⚕️ ${item.item_name} — zero stock on board`,
          reminderStatus: 'overdue',
          reminderReason: 'Restock immediately',
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      if (qty < rec) {
        return {
          id: `firstaid-low-${item.id}`,
          task: `⚕️ ${item.item_name} — below recommended quantity`,
          reminderStatus: 'soon',
          reminderReason: `${qty}/${rec} on board`,
          system: 'First Aid',
          task_type: 'diy',
        }
      }
      return null
    })
    .filter(Boolean)

  const aedAlerts = []
  if (aedData) {
    for (const [field, label] of [['pad_expiry_date', 'AED pads'], ['battery_expiry_date', 'AED battery']]) {
      if (aedData[field]) {
        const due = parseISO(aedData[field])
        const daysLeft = differenceInDays(due, today)
        if (isBefore(due, today)) {
          aedAlerts.push({
            id: `aed-${field}`,
            task: `⚡ ${label} — expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`,
            reminderStatus: 'overdue',
            reminderReason: 'Replace immediately',
            system: 'Safety',
            task_type: 'specialist',
          })
        } else if (daysLeft <= 60) {
          aedAlerts.push({
            id: `aed-${field}`,
            task: `⚡ ${label} — expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            reminderStatus: 'overdue',
            reminderReason: 'Urgent cardiac equipment',
            system: 'Safety',
            task_type: 'specialist',
          })
        }
      }
    }
  }

  const foulingMonths = Number(hullFouling?.monthsSinceHaulout || 0)
  const fouling = foulingPenalty(foulingMonths)
  const foulingLabel = foulingConditionLabel(foulingMonths)
  let foulingAlert = null
  if (!hullFouling?.lastCleanDate) {
    foulingAlert = {
      id: 'hull-fouling-no-date',
      task: '⚓ Hull clean date missing — set baseline for fouling tracking',
      reminderStatus: 'soon',
      reminderReason: 'Open Speed Settings to set date',
      system: 'Hull',
      task_type: 'diy',
      action: 'speed-settings',
    }
  } else if (foulingMonths > 6) {
    foulingAlert = {
      id: 'hull-fouling-overdue',
      task: `⚓ ${foulingLabel.label} hull fouling — ${fouling.penaltyPct}% speed penalty`,
      reminderStatus: 'overdue',
      reminderReason: 'Diver clean recommended',
      system: 'Hull',
      task_type: 'specialist',
      action: 'speed-settings',
    }
  } else if (foulingMonths > 3) {
    foulingAlert = {
      id: 'hull-fouling-soon',
      task: `⚓ ${foulingLabel.label} fouling trend — ${fouling.penaltyPct}% speed penalty`,
      reminderStatus: 'soon',
      reminderReason: 'Plan clean within 2 months',
      system: 'Hull',
      task_type: 'specialist',
      action: 'speed-settings',
    }
  }

  const allAlerts = [...reminderItems, ...firstAidAlerts, ...aedAlerts, ...(foulingAlert ? [foulingAlert] : [])]
  const overdueCount = allAlerts.filter((r) => r.reminderStatus === 'overdue').length
  const soonCount = allAlerts.filter((r) => r.reminderStatus === 'soon').length
  const pendingReceiptCount = pendingReceipts.filter((r) => r.status === 'pending').length

  const openComplete = (task) => {
    setCompleting(task)
    setCompleteNotes('')
    setCompleteDesc('')
    setCompleteTaskType('diy')
    setCompleteVesselSystem(task.system || '')
    setCompleteCost('')
    setCompleteNextDueDate('')
    setCompleteNextDueHours('')
    setCompletePhotos([])
  }

  const handleCompletePhotos = async (files) => {
    const newItems = files.map((f, i) => ({
      id: `new-${Date.now()}-${i}`,
      previewUrl: URL.createObjectURL(f),
      uploading: true,
      error: null,
      saved: false,
      _file: f,
    }))
    setCompletePhotos((prev) => [...prev, ...newItems])
    for (const item of newItems) {
      const err = validatePhoto(item._file)
      if (err) {
        setCompletePhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, error: err } : p))
        continue
      }
      try {
        const storagePath = `maintenance/${Date.now()}-${sanitizeFileName(item._file.name)}`
        const { url, path } = await uploadPhoto(item._file, storagePath)
        setCompletePhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, url, path, saved: true } : p))
      } catch {
        setCompletePhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, error: 'Upload failed' } : p))
      }
    }
  }

  const handleRemoveCompletePhoto = async (index) => {
    const photo = completePhotos[index]
    if (photo.saved && photo.path) { try { await deletePhoto(photo.path) } catch {} }
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl)
    setCompletePhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const submitComplete = async () => {
    if (!completing) return
    const completedDate = format(new Date(), 'yyyy-MM-dd')
    const photos = completePhotos.filter((p) => p.saved).map((p) => ({ url: p.url, path: p.path }))
    await db.insert('maintenance_logs', {
      task_id: completing.id,
      system: completeVesselSystem || completing.system,
      task: completing.task,
      completed_date: completedDate,
      engine_hours_at_completion: latestAvg,
      performed_by: 'Owner',
      parts_used: '',
      cost: Number(completeCost || 0),
      notes: completeNotes,
      description: completeDesc,
      task_type: completeTaskType,
      next_due_date: completeNextDueDate || null,
      next_due_hours: completeNextDueHours ? Number(completeNextDueHours) : null,
      data: {},
      photos,
    })
    await db.update('maintenance_tasks', completing.id, {
      last_completed_date: completedDate,
      last_completed_hours: latestAvg,
      status: 'active',
    })
    completePhotos.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl) })
    setCompleting(null)
    setCompletePhotos([])
    triggerRefresh('maintenanceTasks')
  }

  const handleDirectPhotos = async (files) => {
    const newItems = files.map((f, i) => ({
      id: `d-${Date.now()}-${i}`,
      previewUrl: URL.createObjectURL(f),
      uploading: true,
      error: null,
      saved: false,
      _file: f,
    }))
    setDirectPhotos((prev) => [...prev, ...newItems])
    for (const item of newItems) {
      const err = validatePhoto(item._file)
      if (err) {
        setDirectPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, error: err } : p))
        continue
      }
      try {
        const storagePath = `maintenance/${Date.now()}-${sanitizeFileName(item._file.name)}`
        const { url, path } = await uploadPhoto(item._file, storagePath)
        setDirectPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, url, path, saved: true } : p))
      } catch {
        setDirectPhotos((prev) => prev.map((p) => p.id === item.id ? { ...p, uploading: false, error: 'Upload failed' } : p))
      }
    }
  }

  const handleRemoveDirectPhoto = async (index) => {
    const photo = directPhotos[index]
    if (photo.saved && photo.path) { try { await deletePhoto(photo.path) } catch {} }
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl)
    setDirectPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const confidenceText = {
    high: '✅ High confidence',
    medium: '⚠️ Medium confidence — please verify',
    low: '❌ Low confidence — please check all fields',
  }

  const onScanInvoice = async (file) => {
    if (!file) return
    setScanningInvoice(true)
    setInvoiceMessage('🤖 Reading invoice...')
    try {
      const engineHrsTotal = Number(vesselSettings?.engine_hours_total || 0)
      const extracted = await scanReceiptImage(file, 'maintenance', {
        scheduledTasks: maintenanceTasks,
        currentEngineHours: engineHrsTotal,
      })
      if (!extracted) throw new Error('Could not parse invoice')

      if (Array.isArray(extracted.matched_tasks) && extracted.matched_tasks.length > 0) {
        setScanningInvoice(false)
        setInvoiceMessage('')
        openInvoiceMatcher({
          invoiceData: extracted,
          scheduledTasks: maintenanceTasks,
          currentEngineHours: engineHrsTotal,
          invoiceFile: file,
          invoicePhotoUrl: null,
          pendingReceiptId: invoicePendingId || null,
        })
        setInvoicePendingId(null)
        return
      }

      // Fallback: pre-fill the direct log form (old format or no matched_tasks)
      setDirectLog((prev) => ({
        ...prev,
        date: extracted.invoice_date || extracted.date || prev.date,
        system: extracted.vessel_system || prev.system,
        task: prev.task || 'Invoice work',
        description: extracted.description || prev.description,
        cost: extracted.total_cost_aud ?? prev.cost,
        notes: Array.isArray(extracted.parts_listed) ? extracted.parts_listed.join(', ') : prev.notes,
        task_type: 'specialist',
      }))

      setInvoiceFile(file)
      setInvoiceAttachmentUrl('')
      setInvoiceConfidence(extracted.confidence || '')
      setInvoiceMessage('✅ Invoice scanned and fields pre-filled')
    } catch (err) {
      setInvoiceMessage(err?.message || 'Invoice scanning failed.')
    } finally {
      setScanningInvoice(false)
    }
  }

  const submitDirectLog = async (e) => {
    e.preventDefault()
    if (!directLog.system || !directLog.task) return
    setSavingDirect(true)
    try {
      const photos = directPhotos.filter((p) => p.saved).map((p) => ({ url: p.url, path: p.path }))
      const payload = {
        task_id: null,
        system: directLog.system,
        task: directLog.task,
        completed_date: directLog.date,
        engine_hours_at_completion: latestAvg,
        performed_by: 'Owner',
        parts_used: '',
        cost: Number(directLog.cost || 0),
        notes: directLog.notes,
        description: directLog.description,
        task_type: directLog.task_type,
        next_due_date: directLog.next_due_date || null,
        next_due_hours: directLog.next_due_hours ? Number(directLog.next_due_hours) : null,
        data: {},
        photos,
        invoice_photo_url: invoiceAttachmentUrl || null,
      }

      let savedLog
      try {
        savedLog = await db.insert('maintenance_logs', payload)
      } catch (err) {
        if (err?.message?.includes('invoice_photo_url') || err?.code === 'PGRST204') {
          const { invoice_photo_url: _invoice, ...fallback } = payload
          savedLog = await db.insert('maintenance_logs', fallback)
        } else {
          throw err
        }
      }

      if (invoiceFile && savedLog?.id) {
        try {
          const storagePath = `receipts/maintenance/${savedLog.id}/${Date.now()}-${sanitizeFileName(invoiceFile.name)}`
          const { url } = await uploadPhoto(invoiceFile, storagePath)
          try {
            await db.update('maintenance_logs', savedLog.id, { invoice_photo_url: url })
          } catch {
            // invoice_photo_url column may not exist yet
          }
        } catch {
          // Do not block save if upload fails
        }
      }

      if (invoicePendingId) {
        await markPendingReceiptReviewed(invoicePendingId).catch(() => {})
        setInvoicePendingId(null)
      }

      directPhotos.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl) })
      const savedTaskId = prefillTaskId
      setDirectLog({ system: '', task: '', date: format(new Date(), 'yyyy-MM-dd'), cost: '', notes: '', description: '', task_type: 'diy', next_due_date: '', next_due_hours: '' })
      setDirectPhotos([])
      setPrefillTaskId(null)
      setInvoiceFile(null)
      setInvoiceAttachmentUrl('')
      setInvoiceMessage('✅ Invoice scanned and saved')
      triggerRefresh('all')
      if (savedTaskId) {
        setUpdateTaskForm({ next_due_date: '', next_due_hours: '' })
        setShowUpdateTask(savedTaskId)
      }
    } finally {
      setSavingDirect(false)
    }
  }

  const add = async (e) => {
    e.preventDefault()
    await db.insert('maintenance_tasks', {
      system: newTask.system,
      task: newTask.task,
      status: 'active',
      due_date: newTask.due_date || null,
      due_hours: newTask.next_due_hours ? Number(newTask.next_due_hours) : null,
      priority: newTask.priority,
      hours_interval: null,
      calendar_months: null,
      last_completed_date: null,
      last_completed_hours: null,
      job_type: 'ad-hoc',
      task_type: newTask.task_type,
      estimated_cost: newTask.estimated_cost ? Number(newTask.estimated_cost) : null,
      description: newTask.description || null,
      data: {},
    })
    setNewTask({ system: '', task: '', priority: 'medium', due_date: '', task_type: 'diy', next_due_hours: '', estimated_cost: '', description: '' })
    triggerRefresh('maintenanceTasks')
  }

  const totalSpend = maintenanceLogs.reduce((s, l) => s + Number(l.cost || 0), 0)

  const logDueStatus = (l) => {
    const todayD = startOfDay(new Date())
    if (l.next_due_date) {
      const due = parseISO(l.next_due_date)
      if (isBefore(due, todayD)) return 'overdue'
      if (differenceInDays(due, todayD) <= 30) return 'soon'
    }
    if (l.next_due_hours != null) {
      if (currentHours >= Number(l.next_due_hours)) return 'overdue'
      if (currentHours >= Number(l.next_due_hours) - 10) return 'soon'
    }
    return 'ok'
  }

  const history = maintenanceLogs
    .filter((l) => `${l.system} ${l.task} ${l.performed_by}`.toLowerCase().includes(query.toLowerCase()))
    .filter((l) => filterType === 'all' || l.task_type === filterType)
    .filter((l) => filterSystem === 'all' || l.system === filterSystem)
    .filter((l) => {
      if (filterStatus === 'all') return true
      const s = logDueStatus(l)
      return filterStatus === 'overdue' ? s === 'overdue' : s === 'soon'
    })

  const filtersActive = filterType !== 'all' || filterSystem !== 'all' || filterStatus !== 'all'

  const storagePathFromPublicUrl = (url) => {
    if (!url || typeof url !== 'string') return null
    const marker = '/storage/v1/object/public/'
    const markerIndex = url.indexOf(marker)
    if (markerIndex === -1) return null
    const remainder = url.slice(markerIndex + marker.length)
    const slashIndex = remainder.indexOf('/')
    if (slashIndex === -1) return null
    return decodeURIComponent(remainder.slice(slashIndex + 1))
  }

  const deleteMaintenanceLog = async (log) => {
    if (!window.confirm(`Delete maintenance entry "${log?.task || 'this entry'}"? This cannot be undone.`)) return
    setDeletingLogId(log.id)
    try {
      const photoPaths = (Array.isArray(log?.photos) ? log.photos : [])
        .map((photo) => (typeof photo === 'string' ? storagePathFromPublicUrl(photo) : photo?.path || storagePathFromPublicUrl(photo?.url)))
        .filter(Boolean)
      const invoicePath = storagePathFromPublicUrl(log?.invoice_photo_url)
      const storagePaths = [...new Set(invoicePath ? [...photoPaths, invoicePath] : photoPaths)]

      await Promise.all(storagePaths.map(async (path) => {
        try {
          await deletePhoto(path)
        } catch {}
      }))

      await db.remove('maintenance_logs', log.id)
      setExpandedLog((prev) => {
        const next = new Set(prev)
        next.delete(log.id)
        return next
      })
      setLogGallery((prev) => (prev ? { ...prev, photos: (prev.photos || []).filter((photo) => photo?.url !== log?.invoice_photo_url) } : prev))
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Delete failed.')
    } finally {
      setDeletingLogId(null)
    }
  }

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
      {allAlerts.length === 0 ? (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2 text-green-800 text-sm">
          <span>✅</span>
          <span className="font-medium">All logged maintenance up to date</span>
        </div>
      ) : (
        <div className={cardClass()}>
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <h3 className="font-serif text-xl text-[#0A4A52]">Service Reminders</h3>
            <button type="button" onClick={() => setRemindersOpen((o) => !o)} className="text-sm text-slate-500 hover:text-slate-700">
              {remindersOpen ? 'Collapse' : 'Expand'}
            </button>
          </div>
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {overdueCount > 0 && (
              <span className="rounded-full bg-[#C4603A] text-white text-[11px] font-semibold px-2 py-0.5">{overdueCount} Overdue</span>
            )}
            {soonCount > 0 && (
              <span className="rounded-full bg-amber-400 text-amber-900 text-[11px] font-semibold px-2 py-0.5">{soonCount} Due Soon</span>
            )}
            {pendingReceiptCount > 0 && (
              <button
                type="button"
                onClick={() => goTab?.('receipts')}
                className="rounded-full bg-blue-50 text-blue-800 text-[11px] font-semibold px-2 py-0.5"
              >
                {pendingReceiptCount} Pending Receipts
              </button>
            )}
          </div>
          {remindersOpen && (
            <div className="space-y-2">
              {allAlerts.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b border-slate-100 pb-2 gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.task}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {r.system && <span className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-1.5 py-0.5">{r.system}</span>}
                      <span className={`text-[11px] rounded-full px-1.5 py-0.5 font-medium ${r.task_type === 'specialist' ? 'bg-[#C4603A]/10 text-[#C4603A]' : 'bg-teal-50 text-[#0A4A52]'}`}>
                        {r.task_type === 'specialist' ? 'Specialist' : 'DIY'}
                      </span>
                      <span className={`text-xs font-medium ${r.reminderStatus === 'overdue' ? 'text-red-600' : 'text-amber-600'}`}>
                        {r.reminderReason}
                      </span>
                    </div>
                  </div>
                  {onLogService && r.system !== 'First Aid' && r.system !== 'Safety' && !r.action && (
                    <button
                      type="button"
                      onClick={() => onLogService({ system: r.system || '', task: r.task || '', task_type: r.task_type || 'diy', description: r.description || '', task_id: r.task_id || null })}
                      className="shrink-0 rounded-lg border border-[#0A4A52] text-[#0A4A52] text-[11px] px-2 py-1 hover:bg-[#0A4A52] hover:text-white transition-colors"
                    >
                      Log Service
                    </button>
                  )}
                  {r.action === 'speed-settings' && (
                    <button
                      type="button"
                      onClick={() => openSpeedSettings?.()}
                      className="shrink-0 rounded-lg border border-[#7C3AED] text-[#7C3AED] text-[11px] px-2 py-1 hover:bg-[#7C3AED] hover:text-white transition-colors"
                    >
                      Open Speed Settings
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={cardClass()}>
          <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Upcoming Maintenance</h3>
          <div className="space-y-2 max-h-80 overflow-auto">
            {upcoming.slice(0, 25).map((t) => (
              <div key={t.id} className="border-b border-slate-100 pb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.task}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    {t.system && <span className="text-[10px] bg-slate-100 text-slate-600 rounded-full px-1.5 py-0.5">{t.system}</span>}
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${t.task_type === 'specialist' ? 'bg-[#C4603A]/10 text-[#C4603A]' : 'bg-teal-50 text-[#0A4A52]'}`}>
                      {t.task_type === 'specialist' ? 'Specialist' : 'DIY'}
                    </span>
                    {t.due_date && <span className="text-[10px] text-slate-400">Due {t.due_date}</span>}
                  </div>
                </div>
                <button type="button" onClick={() => openComplete(t)} className="rounded-lg bg-[#0A4A52] text-white text-xs px-2 py-1 shrink-0">
                  Mark Complete
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className={cardClass()}>
          <div className="flex gap-4 border-b border-slate-100 mb-3">
            {[['job', 'Schedule Job'], ['log', 'Log Work Done']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAddPanel(id)}
                className={`pb-2 text-sm font-medium border-b-2 transition-colors ${addPanel === id ? 'border-[#0A4A52] text-[#0A4A52]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {addPanel === 'job' ? (
            <form onSubmit={add} className="space-y-2 text-sm">
              <label className="block">Vessel System
                <select className="w-full mt-1 border rounded-lg p-2" value={newTask.system} onChange={(e) => setNewTask({ ...newTask, system: e.target.value })}>
                  <option value="">— Select system —</option>
                  {VESSEL_SYSTEMS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <Input label="Task / Job Name" value={newTask.task} onChange={(v) => setNewTask({ ...newTask, task: v })} />
              <div>
                <div className="mb-1 font-medium">Type</div>
                <div className="flex gap-2">
                  {[['diy', 'DIY'], ['specialist', 'Specialist']].map(([v, l]) => (
                    <button key={v} type="button"
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${newTask.task_type === v ? (v === 'specialist' ? 'bg-[#C4603A] text-white border-[#C4603A]' : 'bg-[#0A4A52] text-white border-[#0A4A52]') : 'border-slate-300 text-slate-600'}`}
                      onClick={() => setNewTask({ ...newTask, task_type: v })}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="Due Date" type="date" value={newTask.due_date} onChange={(v) => setNewTask({ ...newTask, due_date: v })} />
                <Input label="Next Due (Engine Hrs)" type="number" value={newTask.next_due_hours} onChange={(v) => setNewTask({ ...newTask, next_due_hours: v })} />
                <Input label="Estimated Cost (AUD)" type="number" value={newTask.estimated_cost} onChange={(v) => setNewTask({ ...newTask, estimated_cost: v })} />
                <label className="text-sm">Priority
                  <select className="w-full mt-1 border rounded-lg p-2" value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}>
                    <option>low</option><option>medium</option><option>high</option>
                  </select>
                </label>
              </div>
              <label className="block">Description / Instructions
                <textarea className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm" rows={3}
                  placeholder="Describe the job, steps, parts needed, torque settings etc."
                  value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} />
              </label>
              <button className="mt-1 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Job</button>
            </form>
          ) : (
            <form onSubmit={submitDirectLog} className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-[#0A4A52]">Log Work Done</div>
                <>
                  <input
                    ref={invoiceInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => onScanInvoice(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => invoiceInputRef.current?.click()}
                    className="rounded-lg border border-[#0A4A52] text-[#0A4A52] px-3 py-1.5 text-sm"
                    disabled={scanningInvoice}
                  >
                    📷 Scan Invoice
                  </button>
                </>
              </div>

              {invoiceMessage && <div className="text-sm text-slate-600">{invoiceMessage}</div>}
              {invoiceConfidence && <div className="text-sm text-slate-700">{confidenceText[invoiceConfidence] || ''}</div>}

              <label className="block">Vessel System
                <select className="w-full mt-1 border rounded-lg p-2" value={directLog.system} onChange={(e) => setDirectLog({ ...directLog, system: e.target.value })}>
                  <option value="">— Select system —</option>
                  {VESSEL_SYSTEMS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <Input label="Task / Job Name" value={directLog.task} onChange={(v) => setDirectLog({ ...directLog, task: v })} />
              <label className="block">Description / Work Done
                <textarea className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm" rows={3}
                  placeholder="Describe what was done, parts used, observations, torque settings etc."
                  value={directLog.description} onChange={(e) => setDirectLog({ ...directLog, description: e.target.value })} />
              </label>
              <div>
                <div className="mb-1 font-medium">Type</div>
                <div className="flex gap-2">
                  {[['diy', 'DIY'], ['specialist', 'Specialist']].map(([v, l]) => (
                    <button key={v} type="button"
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${directLog.task_type === v ? (v === 'specialist' ? 'bg-[#C4603A] text-white border-[#C4603A]' : 'bg-[#0A4A52] text-white border-[#0A4A52]') : 'border-slate-300 text-slate-600'}`}
                      onClick={() => setDirectLog({ ...directLog, task_type: v })}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="Date" type="date" value={directLog.date} onChange={(v) => setDirectLog({ ...directLog, date: v })} />
                <Input label="Cost (AUD)" type="number" value={directLog.cost} onChange={(v) => setDirectLog({ ...directLog, cost: v })} />
                <Input label="Next Due Date" type="date" value={directLog.next_due_date} onChange={(v) => setDirectLog({ ...directLog, next_due_date: v })} />
                <Input label="Next Due (Engine Hrs)" type="number" value={directLog.next_due_hours} onChange={(v) => setDirectLog({ ...directLog, next_due_hours: v })} />
              </div>
              <label className="block">Notes
                <textarea className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm" rows={2}
                  value={directLog.notes} onChange={(e) => setDirectLog({ ...directLog, notes: e.target.value })} />
              </label>
              <div>
                <div className="mb-1 font-medium">Photos (optional)</div>
                <PhotoUploader photos={directPhotos} onAdd={handleDirectPhotos} onRemove={handleRemoveDirectPhoto}
                  onThumbnailClick={(i) => setLogGallery({ photos: directPhotos.filter((p) => p.url || p.previewUrl).map((p) => ({ url: p.url || p.previewUrl })), index: i })} />
              </div>
              <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2 disabled:opacity-50"
                disabled={savingDirect || directPhotos.some((p) => p.uploading)}>
                {savingDirect ? 'Saving...' : 'Save Log Entry'}
              </button>
            </form>
          )}

          {showUpdateTask && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
              <div className="text-sm font-medium text-amber-900">Update the scheduled job's next due date/hours?</div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="Next Due Date" type="date" value={updateTaskForm.next_due_date} onChange={(v) => setUpdateTaskForm((f) => ({ ...f, next_due_date: v }))} />
                <Input label="Next Due (Engine Hrs)" type="number" value={updateTaskForm.next_due_hours} onChange={(v) => setUpdateTaskForm((f) => ({ ...f, next_due_hours: v }))} />
              </div>
              <div className="flex gap-2">
                <button type="button"
                  className="rounded-lg bg-[#0A4A52] text-white text-xs px-3 py-1.5"
                  onClick={async () => {
                    await db.update('maintenance_tasks', showUpdateTask, {
                      due_date: updateTaskForm.next_due_date || null,
                      due_hours: updateTaskForm.next_due_hours ? Number(updateTaskForm.next_due_hours) : null,
                    })
                    setShowUpdateTask(false)
                    triggerRefresh('maintenanceTasks')
                  }}>
                  Yes, Update Job
                </button>
                <button type="button" className="rounded-lg border border-slate-300 text-slate-600 text-xs px-3 py-1.5"
                  onClick={() => setShowUpdateTask(false)}>
                  No Thanks
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className={`${cardClass()} lg:col-span-2`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-serif text-xl text-[#0A4A52]">History</h3>
            <span className="text-sm text-slate-500">Total spend: <strong>${totalSpend.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          </div>
          <input className="w-full border rounded-lg p-2 mb-2 text-sm" placeholder="Search history" value={query} onChange={(e) => setQuery(e.target.value)} />

          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 mb-2 text-xs">
            <div className="flex gap-1">
              {[['all', 'All'], ['diy', 'DIY'], ['specialist', 'Specialist']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setFilterType(v)}
                  className={`px-2 py-1 rounded-full border transition-colors ${filterType === v ? 'bg-[#0A4A52] text-white border-[#0A4A52]' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>{l}</button>
              ))}
            </div>
            <select className="border rounded-full px-2 py-1 text-xs" value={filterSystem} onChange={(e) => setFilterSystem(e.target.value)}>
              <option value="all">All Systems</option>
              {VESSEL_SYSTEMS.map((s) => <option key={s}>{s}</option>)}
            </select>
            <div className="flex gap-1">
              {[['all', 'All'], ['soon', 'Due Soon'], ['overdue', 'Overdue']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setFilterStatus(v)}
                  className={`px-2 py-1 rounded-full border transition-colors ${filterStatus === v ? 'bg-[#0A4A52] text-white border-[#0A4A52]' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Showing {history.length} of {maintenanceLogs.length} entries</span>
            {filtersActive && <button type="button" className="text-[#C4603A] underline" onClick={() => { setFilterType('all'); setFilterSystem('all'); setFilterStatus('all') }}>Reset filters</button>}
          </div>

          <div className="space-y-2 max-h-72 overflow-auto text-sm">
            {history.map((h) => {
              const hPhotos = Array.isArray(h.photos) ? h.photos : []
              const isExpanded = expandedLog.has(h.id)
              return (
                <div key={h.id} className="border-b border-slate-100 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{h.task}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-slate-400">{h.completed_date}</span>
                        {h.system && <span className="bg-slate-100 text-slate-600 rounded-full px-1.5 py-0.5 text-[10px]">{h.system}</span>}
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${h.task_type === 'specialist' ? 'bg-[#C4603A]/10 text-[#C4603A]' : 'bg-teal-50 text-[#0A4A52]'}`}>
                          {h.task_type === 'specialist' ? 'Specialist' : 'DIY'}
                        </span>
                        {Number(h.cost) > 0 && <span className="text-slate-500">${Number(h.cost).toFixed(2)}</span>}
                      </div>
                      {h.description && <div className="text-slate-600 text-xs mt-1 whitespace-pre-wrap">{h.description}</div>}
                      {h.notes && <div className="text-slate-400 text-xs mt-0.5 italic">{h.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      {hPhotos.length > 0 && (
                        <button type="button" onClick={() => setExpandedLog((prev) => {
                          const next = new Set(prev); next.has(h.id) ? next.delete(h.id) : next.add(h.id); return next
                        })} className="flex items-center gap-1 text-[#0A4A52]">
                          <Camera size={14} />
                          <span className="text-xs">{hPhotos.length}</span>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteMaintenanceLog(h)}
                        disabled={deletingLogId === h.id}
                        className="rounded-md p-1 text-slate-400 hover:text-[#C4603A] hover:bg-[#C4603A]/10 disabled:opacity-50"
                        title="Delete maintenance entry"
                        aria-label={`Delete maintenance entry ${h.task}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && hPhotos.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {hPhotos.map((p, pi) => (
                        <button key={pi} type="button" onClick={() => setLogGallery({ photos: hPhotos, index: pi })}
                          className="w-14 h-14 rounded-lg overflow-hidden border border-slate-200">
                          <PhotoImg src={typeof p === 'string' ? p : p.url} alt="" className="w-14 h-14" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
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

      {completing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={() => setCompleting(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-lg text-[#0A4A52] mb-1">Mark Complete</h3>
            <p className="text-sm text-slate-500 mb-3">{completing.task}</p>
            <div className="space-y-3 text-sm">
              <label className="block">Vessel System
                <select className="w-full mt-1 border rounded-lg p-2 text-sm" value={completeVesselSystem} onChange={(e) => setCompleteVesselSystem(e.target.value)}>
                  <option value="">— Select system —</option>
                  {VESSEL_SYSTEMS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">Description / Work Done
                <textarea className="w-full mt-1 border rounded-lg p-2 text-sm" rows={3}
                  placeholder="Describe what was done, parts used, observations etc."
                  value={completeDesc} onChange={(e) => setCompleteDesc(e.target.value)} />
              </label>
              <div>
                <div className="mb-1 font-medium">Type</div>
                <div className="flex gap-2">
                  {[['diy', 'DIY'], ['specialist', 'Specialist']].map(([v, l]) => (
                    <button key={v} type="button"
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${completeTaskType === v ? (v === 'specialist' ? 'bg-[#C4603A] text-white border-[#C4603A]' : 'bg-[#0A4A52] text-white border-[#0A4A52]') : 'border-slate-300 text-slate-600'}`}
                      onClick={() => setCompleteTaskType(v)}>{l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label="Cost (AUD)" type="number" value={completeCost} onChange={setCompleteCost} />
                <div />
                <Input label="Next Due Date" type="date" value={completeNextDueDate} onChange={setCompleteNextDueDate} />
                <Input label="Next Due (Hrs)" type="number" value={completeNextDueHours} onChange={setCompleteNextDueHours} />
              </div>
              <label className="block">Notes
                <textarea className="w-full mt-1 border rounded-lg p-2 text-sm" rows={2}
                  value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} />
              </label>
              <div>
                <div className="font-medium mb-1">Photos (optional)</div>
                <PhotoUploader photos={completePhotos} onAdd={handleCompletePhotos} onRemove={handleRemoveCompletePhoto}
                  onThumbnailClick={(i) => setLogGallery({ photos: completePhotos.filter((p) => p.url || p.previewUrl).map((p) => ({ url: p.url || p.previewUrl })), index: i })} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setCompleting(null)} className="flex-1 border rounded-lg py-2 text-sm">Cancel</button>
              <button type="button" onClick={submitComplete} disabled={completePhotos.some((p) => p.uploading)}
                className="flex-1 rounded-lg bg-[#0A4A52] text-white py-2 text-sm disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {logGallery && (
        <PhotoGallery photos={logGallery.photos} initialIndex={logGallery.index} onClose={() => setLogGallery(null)} />
      )}
    </div>
  )
}

function FuelTab({ dataset, triggerRefresh, fuelPrefill, setFuelPrefill }) {
  const { vesselSettings, fuelLog, engineHours } = dataset
  const latest = latestByDate(engineHours)
  const [portOn, setPortOn] = useState(true)
  const [stbdOn, setStbdOn] = useState(true)
  const [scanningReceipt, setScanningReceipt] = useState(false)
  const [scanConfidence, setScanConfidence] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptAttachmentUrl, setReceiptAttachmentUrl] = useState('')
  const [receiptPendingId, setReceiptPendingId] = useState(null)
  const receiptInputRef = useRef(null)
  const [startFuel, setStartFuel] = useState(2950)
  const [reservePct, setReservePct] = useState(20)
  const [fuelEntryOpen, setFuelEntryOpen] = useState(false)
  const [recentEntriesOpen, setRecentEntriesOpen] = useState(false)
  const [deletingFuelId, setDeletingFuelId] = useState(null)
  const [hoverSpd, setHoverSpd] = useState(null)
  const [fuelCurveMode, setFuelCurveMode] = useState('base')
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    location: 'Aquatic Paradise',
    supplier_name: '',
    fuel_type: '',
    litres: 300,
    litres_port: '',
    litres_stbd: '',
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

  useEffect(() => {
    if (!fuelPrefill) return
    const extracted = fuelPrefill?.extracted_data || fuelPrefill
    setForm((prev) => ({
      ...prev,
      date: extracted?.date || prev.date,
      supplier_name: extracted?.supplier_name || prev.supplier_name,
      location: extracted?.location || extracted?.supplier_name || prev.location,
      fuel_type: extracted?.fuel_type || prev.fuel_type,
      litres: extracted?.litres_total ?? prev.litres,
      litres_port: extracted?.litres_port ?? prev.litres_port,
      litres_stbd: extracted?.litres_stbd ?? prev.litres_stbd,
      cost_per_litre: extracted?.price_per_litre ?? prev.cost_per_litre,
      total_cost: extracted?.total_cost_aud ?? prev.total_cost,
      notes: [prev.notes, extracted?.invoice_number ? `Invoice: ${extracted.invoice_number}` : ''].filter(Boolean).join(' | '),
    }))
    setScanConfidence(extracted?.confidence || '')
    setReceiptAttachmentUrl(fuelPrefill?.attachment_url || '')
    setReceiptPendingId(fuelPrefill?.id || null)
    setScanMessage('✅ Receipt extracted and form pre-filled')
    setFuelPrefill(null)
  }, [fuelPrefill, setFuelPrefill])

  const enforceValve = (nextPort, nextStbd) => {
    if (!nextPort && !nextStbd) return
    setPortOn(nextPort)
    setStbdOn(nextStbd)
  }

  const confidenceText = {
    high: '✅ High confidence',
    medium: '⚠️ Medium confidence — please verify',
    low: '❌ Low confidence — please check all fields',
  }

  const onScanReceipt = async (file) => {
    if (!file) return
    setScanningReceipt(true)
    setScanMessage('🤖 Reading receipt...')
    try {
      const extracted = await scanReceiptImage(file, 'fuel')
      if (!extracted) throw new Error('Could not parse receipt')
      setForm((prev) => ({
        ...prev,
        date: extracted.date || prev.date,
        supplier_name: extracted.supplier_name || prev.supplier_name,
        location: extracted.location || extracted.supplier_name || prev.location,
        fuel_type: extracted.fuel_type || prev.fuel_type,
        litres: extracted.litres_total ?? prev.litres,
        litres_port: extracted.litres_port ?? prev.litres_port,
        litres_stbd: extracted.litres_stbd ?? prev.litres_stbd,
        cost_per_litre: extracted.price_per_litre ?? prev.cost_per_litre,
        total_cost: extracted.total_cost_aud ?? prev.total_cost,
        notes: [prev.notes, extracted.invoice_number ? `Invoice: ${extracted.invoice_number}` : ''].filter(Boolean).join(' | '),
      }))
      setReceiptFile(file)
      setReceiptAttachmentUrl('')
      setScanConfidence(extracted.confidence || '')
      setScanMessage('✅ Receipt scanned and fields pre-filled')
    } catch (err) {
      setScanMessage(err?.message || 'Receipt scanning failed.')
    } finally {
      setScanningReceipt(false)
    }
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
  const burnRate = Number(vesselSettings.estimated_burn_rate_litres_per_hour || 21)
  const range = (estOnBoard / burnRate) * Number(vesselSettings.cruise_speed_knots || 12)
  const portPct = portOn && stbdOn ? 50 : portOn ? 100 : 0
  const stbdPct = portOn && stbdOn ? 50 : stbdOn ? 100 : 0

  const storagePathFromPublicUrl = (url) => {
    if (!url || typeof url !== 'string') return null
    const marker = '/storage/v1/object/public/'
    const markerIndex = url.indexOf(marker)
    if (markerIndex === -1) return null
    const remainder = url.slice(markerIndex + marker.length)
    const slashIndex = remainder.indexOf('/')
    if (slashIndex === -1) return null
    return decodeURIComponent(remainder.slice(slashIndex + 1))
  }

  const deleteFuelEntry = async (entry) => {
    if (!window.confirm(`Delete fuel entry from ${entry?.date || 'this date'}? This cannot be undone.`)) return
    setDeletingFuelId(entry.id)
    try {
      const receiptPath = storagePathFromPublicUrl(entry?.receipt_photo_url)
      if (receiptPath) {
        try {
          await deletePhoto(receiptPath)
        } catch {}
      }
      await db.remove('fuel_log', entry.id)
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Delete failed.')
    } finally {
      setDeletingFuelId(null)
    }
  }

  const submit = async (e) => {
    e.preventDefault()

    const portLitres = Number(form.litres_port || 0)
    const stbdLitres = Number(form.litres_stbd || 0)
    const splits = []
    if (portLitres > 0 || stbdLitres > 0) {
      if (portLitres > 0) splits.push({ tank: 'port', litres: portLitres })
      if (stbdLitres > 0) splits.push({ tank: 'stbd', litres: stbdLitres })
    } else {
      const activeTanks = [form.fill_port, form.fill_stbd].filter(Boolean).length
      const splitLitres = activeTanks ? Number(form.litres) / activeTanks : 0
      if (form.fill_port) splits.push({ tank: 'port', litres: Math.round(splitLitres) })
      if (form.fill_stbd) splits.push({ tank: 'stbd', litres: Number(form.litres) - Math.round(splitLitres) })
    }

    const notesWithMeta = [
      form.notes,
      form.supplier_name ? `Supplier: ${form.supplier_name}` : '',
      form.fuel_type ? `Fuel type: ${form.fuel_type}` : '',
    ].filter(Boolean).join(' | ')

    const payload = {
      date: form.date,
      location: form.location,
      litres: Number(form.litres),
      cost_per_litre: Number(form.cost_per_litre),
      total_cost: Number(form.total_cost),
      engine_hours_at_fill: Number(form.engine_hours_at_fill),
      tank_level_before: Number(form.tank_level_before),
      fuel_filter_changed: form.fuel_filter_changed,
      tanks_filled_details: splits,
      notes: notesWithMeta,
      receipt_photo_url: receiptAttachmentUrl || null,
    }

    let savedRow
    try {
      savedRow = await db.insert('fuel_log', payload)
    } catch (err) {
      if (err?.message?.includes('receipt_photo_url') || err?.code === 'PGRST204') {
        const { receipt_photo_url: _receipt, ...fallback } = payload
        savedRow = await db.insert('fuel_log', fallback)
      } else {
        throw err
      }
    }

    if (receiptFile && savedRow?.id) {
      try {
        const storagePath = `receipts/fuel/${savedRow.id}/${Date.now()}-${sanitizeFileName(receiptFile.name)}`
        const { url } = await uploadPhoto(receiptFile, storagePath)
        try {
          await db.update('fuel_log', savedRow.id, { receipt_photo_url: url })
        } catch {
          // receipt_photo_url column may not exist yet
        }
      } catch {
        // Do not block save if upload fails
      }
    }

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
        notes: notesWithMeta,
        data: {},
      })
    }

    if (receiptPendingId) {
      await markPendingReceiptReviewed(receiptPendingId).catch(() => {})
      setReceiptPendingId(null)
    }

    setScanMessage('✅ Receipt scanned and saved')
    setReceiptFile(null)
    setReceiptAttachmentUrl('')
    triggerRefresh('all')
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

      {/* ── Range vs Speed + L/nm Charts ────────────────────── */}
      {(() => {
        // Fuel law: exponent 3.4 fitted to 1550 RPM=21 L/hr AND 3000 RPM≈195 L/hr
        const ANCHOR_RPM = 1550; const ANCHOR_LPH = 21; const FUEL_EXP = 3.4
        function rpmToLPH(rpm) { return ANCHOR_LPH * Math.pow(rpm / ANCHOR_RPM, FUEL_EXP) }

        // Load calibration adjustments from Speed tab if in calibrated mode
        let curveAdj = {}
        let hasCalibration = false
        try {
          const raw = localStorage.getItem('amaroo_rpm_curve_adj')
          if (raw) {
            curveAdj = JSON.parse(raw)
            hasCalibration = Object.values(curveAdj).some((v) => v !== 0 && v != null)
          }
        } catch { /* ignore */ }

        // Build effective curve (base + optional adjustments)
        const effectiveCurve = AMAROO_RPM_CURVE.map((pt) => ({
          rpm: pt.rpm,
          stwKn: Math.max(0.1, pt.stwKn + (fuelCurveMode === 'calibrated' ? (curveAdj[pt.rpm] || 0) : 0)),
        }))

        // Invert curve: STW → RPM (using effective curve)
        function stwToRPM(stw) {
          const c = effectiveCurve
          if (stw <= c[0].stwKn) return c[0].rpm
          if (stw >= c[c.length - 1].stwKn) return c[c.length - 1].rpm
          for (let i = 1; i < c.length; i++) {
            if (stw <= c[i].stwKn) {
              const lo = c[i - 1]; const hi = c[i]
              const f = (stw - lo.stwKn) / (hi.stwKn - lo.stwKn)
              return lo.rpm + f * (hi.rpm - lo.rpm)
            }
          }
          return c[c.length - 1].rpm
        }

        const usableFuel = startFuel * (1 - reservePct / 100)
        const STW_MIN = 6; const STW_MAX = 20; const STW_STEP = 0.1

        const points = []
        for (let spd = STW_MIN; spd <= STW_MAX + 0.01; spd += STW_STEP) {
          const s = Math.round(spd * 10) / 10
          const rpm = stwToRPM(s)
          const lph = rpmToLPH(rpm)
          const rangeNm = lph > 0 ? usableFuel * s / lph : 0
          const lPerNm = lph > 0 ? lph / s : 0
          points.push({ spd: s, rangeNm, lPerNm, lph, rpm })
        }

        // Best efficiency point (min L/nm)
        const bestPt = points.reduce((a, b) => b.lPerNm < a.lPerNm ? b : a)

        const cruisePt = points.find((p) => Math.abs(p.spd - 8) < STW_STEP / 2) || points[0]
        const wotPt    = points.find((p) => Math.abs(p.spd - 20) < STW_STEP / 2) || points[points.length - 1]

        // Shared SVG layout
        const SVG_W = 500; const SVG_H = 210
        const PAD_L = 54; const PAD_R = 18; const PAD_T = 14; const PAD_B = 36
        const CW = SVG_W - PAD_L - PAD_R; const CH = SVG_H - PAD_T - PAD_B
        const xTicks = [6, 8, 10, 12, 14, 16, 18, 20]

        function xOf(spd) { return PAD_L + ((spd - STW_MIN) / (STW_MAX - STW_MIN)) * CW }

        // ── Chart 1: Range ──
        // Y axis starts near chart minimum so detail is visible at all speeds
        const allRange = points.map((p) => p.rangeNm)
        const R_RAW_MIN = Math.min(...allRange); const R_RAW_MAX = Math.max(...allRange)
        const R_MIN = Math.floor(R_RAW_MIN / 100) * 100
        const R_MAX = Math.ceil(R_RAW_MAX / 100) * 100
        function yOfR(r) { return PAD_T + CH - Math.max(0, Math.min(1, (r - R_MIN) / (R_MAX - R_MIN))) * CH }
        const rTickStep = (R_MAX - R_MIN) <= 600 ? 100 : (R_MAX - R_MIN) <= 1200 ? 200 : 400
        const rTicks = []
        for (let r = Math.ceil(R_MIN / rTickStep) * rTickStep; r <= R_MAX; r += rTickStep) rTicks.push(r)
        const rangePolyline = points.map((p) => `${xOf(p.spd).toFixed(1)},${yOfR(p.rangeNm).toFixed(1)}`).join(' ')

        // ── Chart 2: L/nm efficiency ──
        const allLpNm = points.map((p) => p.lPerNm)
        const E_MIN = 0; const E_MAX = Math.ceil(Math.max(...allLpNm) / 2) * 2
        function yOfE(e) { return PAD_T + CH - Math.max(0, Math.min(1, (e - E_MIN) / (E_MAX - E_MIN))) * CH }
        const eTicks = []
        const eTickStep = E_MAX <= 20 ? 2 : E_MAX <= 50 ? 5 : 10
        for (let e = eTickStep; e <= E_MAX; e += eTickStep) eTicks.push(e)
        const effPolyline = points.map((p) => `${xOf(p.spd).toFixed(1)},${yOfE(p.lPerNm).toFixed(1)}`).join(' ')

        // Hover calculations
        const hoverPt = hoverSpd != null
          ? points.reduce((a, b) => Math.abs(b.spd - hoverSpd) < Math.abs(a.spd - hoverSpd) ? b : a)
          : null

        function handleSvgMove(e) {
          const rect = e.currentTarget.getBoundingClientRect()
          const svgX = (e.clientX - rect.left) * (SVG_W / rect.width)
          const spd = Math.round((STW_MIN + ((svgX - PAD_L) / CW) * (STW_MAX - STW_MIN)) * 10) / 10
          setHoverSpd(Math.max(STW_MIN, Math.min(STW_MAX, spd)))
        }

        function CrosshairR() {
          if (!hoverPt) return null
          const hx = xOf(hoverPt.spd); const hy = yOfR(hoverPt.rangeNm)
          const tipX = hx + 8 > SVG_W - 110 ? hx - 118 : hx + 8
          return (
            <g>
              <line x1={hx} y1={PAD_T} x2={hx} y2={PAD_T + CH} stroke="#64748b" strokeWidth="1" strokeDasharray="3 2" opacity="0.7"/>
              <circle cx={hx} cy={hy} r="4" fill="#0A4A52" stroke="white" strokeWidth="1.5"/>
              <rect x={tipX} y={PAD_T + 4} width="110" height="52" rx="4" fill="white" stroke="#e2e8f0" strokeWidth="1" opacity="0.95"/>
              <text x={tipX + 7} y={PAD_T + 18} fontSize="10" fontWeight="600" fill="#0A4A52">{hoverPt.spd.toFixed(1)} kn · {Math.round(hoverPt.rpm)} RPM</text>
              <text x={tipX + 7} y={PAD_T + 32} fontSize="10" fill="#0A4A52">Range: {Math.round(hoverPt.rangeNm)} nm</text>
              <text x={tipX + 7} y={PAD_T + 46} fontSize="10" fill="#64748b">{hoverPt.lph.toFixed(1)} L/hr</text>
            </g>
          )
        }

        function CrosshairE() {
          if (!hoverPt) return null
          const hx = xOf(hoverPt.spd); const hy = yOfE(hoverPt.lPerNm)
          const tipX = hx + 8 > SVG_W - 110 ? hx - 118 : hx + 8
          return (
            <g>
              <line x1={hx} y1={PAD_T} x2={hx} y2={PAD_T + CH} stroke="#64748b" strokeWidth="1" strokeDasharray="3 2" opacity="0.7"/>
              <circle cx={hx} cy={hy} r="4" fill="#0A4A52" stroke="white" strokeWidth="1.5"/>
              <rect x={tipX} y={PAD_T + 4} width="110" height="38" rx="4" fill="white" stroke="#e2e8f0" strokeWidth="1" opacity="0.95"/>
              <text x={tipX + 7} y={PAD_T + 18} fontSize="10" fontWeight="600" fill="#0A4A52">{hoverPt.spd.toFixed(1)} kn</text>
              <text x={tipX + 7} y={PAD_T + 32} fontSize="10" fill="#0A4A52">{hoverPt.lPerNm.toFixed(2)} L/nm</text>
            </g>
          )
        }

        function SvgAxes({ yTicks: tks, yOf: yo, yLabelText }) {
          return (
            <>
              {tks.map((v) => (
                <g key={v}>
                  <line x1={PAD_L} y1={yo(v)} x2={SVG_W - PAD_R} y2={yo(v)} stroke="#e2e8f0" strokeWidth="1"/>
                  <text x={PAD_L - 4} y={yo(v) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
                </g>
              ))}
              {xTicks.map((spd) => (
                <g key={spd}>
                  <line x1={xOf(spd)} y1={PAD_T} x2={xOf(spd)} y2={PAD_T + CH} stroke="#e2e8f0" strokeWidth="1"/>
                  <text x={xOf(spd)} y={SVG_H - PAD_B + 14} textAnchor="middle" fontSize="9" fill="#94a3b8">{spd}</text>
                </g>
              ))}
              <text x={PAD_L + CW / 2} y={SVG_H - 2} textAnchor="middle" fontSize="10" fill="#64748b">Speed (kn)</text>
              <text x={10} y={PAD_T + CH / 2} textAnchor="middle" fontSize="10" fill="#64748b" transform={`rotate(-90, 10, ${PAD_T + CH / 2})`}>{yLabelText}</text>
            </>
          )
        }

        return (
          <div className={cardClass()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-serif text-xl text-[#0A4A52]">Fuel Economy</h3>
              <div className="flex rounded-lg overflow-hidden border border-[#0A4A52] text-xs">
                {[{ id: 'base', label: 'Base curve' }, { id: 'calibrated', label: 'Calibrated' }].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setFuelCurveMode(m.id)}
                    className={`px-3 py-1.5 ${fuelCurveMode === m.id ? 'bg-[#0A4A52] text-white' : 'text-[#0A4A52]'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {fuelCurveMode === 'calibrated' && (
              <div className={`text-xs mb-3 px-3 py-2 rounded-lg border ${hasCalibration ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                {hasCalibration
                  ? '✅ Using Speed tab calibration adjustments'
                  : '⚠ No calibration data found — go to Speed → Logbook and adjust the RPM sliders first'}
              </div>
            )}

            {/* Sliders */}
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">Start fuel</span>
                  <span className="font-semibold text-[#0A4A52]">{startFuel} L ({Math.round(startFuel / totalCap * 100)}%)</span>
                </div>
                <input type="range" min="100" max={totalCap} step="50" value={startFuel}
                  onChange={(e) => setStartFuel(Number(e.target.value))}
                  className="w-full accent-[#0A4A52]" />
                <div className="flex justify-between text-xs text-slate-400 mt-0.5"><span>100 L</span><span>{totalCap} L (full)</span></div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">Reserve</span>
                  <span className="font-semibold text-[#C4603A]">{reservePct}% · {Math.round(startFuel * reservePct / 100)} L held back</span>
                </div>
                <input type="range" min="0" max="30" step="1" value={reservePct}
                  onChange={(e) => setReservePct(Number(e.target.value))}
                  className="w-full accent-[#C4603A]" />
                <div className="flex justify-between text-xs text-slate-400 mt-0.5"><span>0%</span><span>30%</span></div>
              </div>
            </div>

            {/* Summary stats */}
            <div className="flex flex-wrap gap-3 mb-3 text-sm">
              <div className="bg-teal-50 rounded-lg px-3 py-2 border border-teal-100">
                <div className="text-xs text-slate-500">Usable fuel</div>
                <div className="font-bold text-[#0A4A52]">{Math.round(usableFuel)} L</div>
              </div>
              <div className="bg-teal-50 rounded-lg px-3 py-2 border border-teal-100">
                <div className="text-xs text-slate-500">Range @ 8 kn</div>
                <div className="font-bold text-[#0A4A52]">{Math.round(cruisePt.rangeNm)} nm</div>
              </div>
              <div className="bg-orange-50 rounded-lg px-3 py-2 border border-orange-100">
                <div className="text-xs text-slate-500">Range @ 20 kn WOT</div>
                <div className="font-bold text-[#C4603A]">{Math.round(wotPt.rangeNm)} nm</div>
              </div>
              <div className="bg-green-50 rounded-lg px-3 py-2 border border-green-100">
                <div className="text-xs text-slate-500">Best efficiency</div>
                <div className="font-bold text-green-700">{bestPt.spd.toFixed(1)} kn · {bestPt.lPerNm.toFixed(2)} L/nm</div>
              </div>
            </div>

            {/* Chart 1: Range vs Speed */}
            <div className="text-xs font-semibold text-slate-500 mb-1 ml-1">Range (nm) — Y axis scaled to show variation</div>
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full border border-slate-100 rounded-lg bg-slate-50 mb-4"
              style={{ cursor: 'crosshair' }}
              onMouseMove={handleSvgMove}
              onMouseLeave={() => setHoverSpd(null)}
            >
              <SvgAxes yTicks={rTicks} yOf={yOfR} yLabelText="Range (nm)" />
              {/* Hull speed annotation */}
              <line x1={xOf(9.5)} y1={PAD_T} x2={xOf(9.5)} y2={PAD_T + CH} stroke="#C4603A" strokeWidth="1" strokeDasharray="3 2" opacity="0.4"/>
              <text x={xOf(9.5) + 3} y={PAD_T + 11} fontSize="8" fill="#C4603A" opacity="0.6">hull speed</text>
              <polyline points={rangePolyline} fill="none" stroke="#0A4A52" strokeWidth="2.5"/>
              <CrosshairR />
            </svg>

            {/* Chart 2: L/nm efficiency */}
            <div className="text-xs font-semibold text-slate-500 mb-1 ml-1">Fuel efficiency (L/nm) — lower is better</div>
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full border border-slate-100 rounded-lg bg-slate-50"
              style={{ cursor: 'crosshair' }}
              onMouseMove={handleSvgMove}
              onMouseLeave={() => setHoverSpd(null)}
            >
              <SvgAxes yTicks={eTicks} yOf={yOfE} yLabelText="L/nm" />
              {/* Best efficiency marker */}
              <line x1={xOf(bestPt.spd)} y1={PAD_T} x2={xOf(bestPt.spd)} y2={PAD_T + CH} stroke="#16A34A" strokeWidth="1" strokeDasharray="3 2" opacity="0.6"/>
              <text x={xOf(bestPt.spd) + 3} y={PAD_T + 11} fontSize="8" fill="#16A34A" opacity="0.9">best {bestPt.spd.toFixed(1)} kn</text>
              {/* Hull speed annotation */}
              <line x1={xOf(9.5)} y1={PAD_T} x2={xOf(9.5)} y2={PAD_T + CH} stroke="#C4603A" strokeWidth="1" strokeDasharray="3 2" opacity="0.4"/>
              <text x={xOf(9.5) + 3} y={PAD_T + 22} fontSize="8" fill="#C4603A" opacity="0.6">hull speed</text>
              <polyline points={effPolyline} fill="none" stroke="#0A4A52" strokeWidth="2.5"/>
              {/* Best efficiency dot */}
              <circle cx={xOf(bestPt.spd)} cy={yOfE(bestPt.lPerNm)} r="5" fill="#16A34A" stroke="white" strokeWidth="1.5">
                <title>Best efficiency: {bestPt.spd.toFixed(1)} kn = {bestPt.lPerNm.toFixed(2)} L/nm</title>
              </circle>
              <CrosshairE />
            </svg>
            <div className="text-xs text-slate-400 mt-1">Cummins QSB 6.7 twin · fitted to 1550 RPM=21 L/hr &amp; 3000 RPM≈195 L/hr · hover to inspect</div>
          </div>
        )
      })()}

      <form className={cardClass()} onSubmit={submit}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <button type="button" className="flex items-center gap-2 text-left" onClick={() => setFuelEntryOpen((o) => !o)}>
            <h3 className="font-serif text-xl text-[#0A4A52]">Fuel Entry</h3>
            {fuelEntryOpen ? <ChevronUp size={18} className="text-[#0A4A52]"/> : <ChevronDown size={18} className="text-[#0A4A52]"/>}
          </button>
          <>
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onScanReceipt(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => receiptInputRef.current?.click()}
              className="rounded-lg border border-[#0A4A52] text-[#0A4A52] px-3 py-1.5 text-sm"
              disabled={scanningReceipt}
            >
              📷 Scan Receipt
            </button>
          </>
        </div>

        {fuelEntryOpen && (
          <>
            {scanMessage && <div className="text-sm text-slate-600 mb-2">{scanMessage}</div>}
            {scanConfidence && <div className="text-sm text-slate-700 mb-3">{confidenceText[scanConfidence] || ''}</div>}

            <div className="grid md:grid-cols-4 gap-2">
              <Input label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <Input label="Supplier / Marina" value={form.supplier_name} onChange={(v) => setForm({ ...form, supplier_name: v })} />
              <Input label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
              <Input label="Fuel type" value={form.fuel_type} onChange={(v) => setForm({ ...form, fuel_type: v })} />
              <Input label="Litres added" value={form.litres} onChange={(v) => setForm({ ...form, litres: v })} />
              <Input label="Port tank litres" value={form.litres_port} onChange={(v) => setForm({ ...form, litres_port: v })} />
              <Input label="Starboard tank litres" value={form.litres_stbd} onChange={(v) => setForm({ ...form, litres_stbd: v })} />
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
          </>
        )}
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

      <div className={cardClass()}>
        <button type="button" className="flex items-center gap-2 mb-3" onClick={() => setRecentEntriesOpen((o) => !o)}>
          <h3 className="font-serif text-xl text-[#0A4A52]">Recent Fuel Entries</h3>
          {recentEntriesOpen ? <ChevronUp size={18} className="text-[#0A4A52]"/> : <ChevronDown size={18} className="text-[#0A4A52]"/>}
        </button>
        {recentEntriesOpen && (
          <div className="space-y-2 text-sm">
            {fuelLog.slice(0, 12).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <div className="font-medium">{entry.date} · {entry.location}</div>
                  <div className="text-slate-500">{entry.litres} L · ${Number(entry.total_cost || 0).toFixed(2)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {entry.receipt_photo_url ? (
                    <a href={entry.receipt_photo_url} target="_blank" rel="noreferrer" className="shrink-0">
                      <PhotoImg src={entry.receipt_photo_url} alt="Receipt" className="w-12 h-12 rounded border border-slate-200" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => deleteFuelEntry(entry)}
                    disabled={deletingFuelId === entry.id}
                    className="rounded-md p-1 text-slate-400 hover:text-[#C4603A] hover:bg-[#C4603A]/10 disabled:opacity-50"
                    title="Delete fuel entry"
                    aria-label={`Delete fuel entry ${entry.date} ${entry.location || ''}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FluidsTab({ dataset, triggerRefresh }) {
  const { fluidChecks, watermakerLog } = dataset
  const [subtab, setSubtab] = useState('fluids')
  const createFluidDefaults = () => ({
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
  const [fluidForm, setFluidForm] = useState(createFluidDefaults)
  const createWmDefaults = () => ({
    date: format(new Date(), 'yyyy-MM-dd'),
    duration_minutes: 90,
    litres_produced: 70,
    tds_reading: 250,
    pre_filter_pressure: 12,
    notes: '',
  })
  const [wm, setWm] = useState(createWmDefaults)
  const fluidKeys = [
    'port_engine_oil',
    'stbd_engine_oil',
    'port_engine_coolant',
    'stbd_engine_coolant',
    'generator_oil',
    'generator_coolant',
    'wesmar_hydraulic_oil',
    'mastervolt_status',
  ]
  const fluidLabel = (k) => k.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())

  const saveFluid = async (e) => {
    e.preventDefault()
    await db.insert('fluid_checks', { date: fluidForm.date, data: fluidForm })
    triggerRefresh('all')
    setFluidForm(createFluidDefaults())
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
    setWm(createWmDefaults())
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
              {fluidKeys.map((k) => (
                <div key={k} className="text-sm">
                  <div className="mb-1">{fluidLabel(k)}</div>
                  <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                    {['OK', 'Check', 'Low'].map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setFluidForm({ ...fluidForm, [k]: status })}
                        className={`px-3 py-1.5 text-xs font-medium border-r last:border-r-0 ${fluidForm[k] === status ? (status === 'Low' ? 'bg-[#C4603A] text-white' : 'bg-[#0A4A52] text-white') : 'bg-white text-slate-700'}`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
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

function FirstAidStatusDot({ item }) {
  const today = startOfDay(new Date())
  if (Number(item.qty_on_board) === 0) return <span title="Zero stock" className="inline-block w-3 h-3 rounded-full bg-red-500 shrink-0" />
  if (item.expiry_date) {
    const due = parseISO(item.expiry_date)
    if (isBefore(due, today)) return <span title="Expired" className="inline-block w-3 h-3 rounded-full bg-red-500 shrink-0" />
    if (differenceInDays(due, today) <= 30) return <span title="Expiring soon" className="inline-block w-3 h-3 rounded-full bg-amber-400 shrink-0" />
  }
  if (Number(item.qty_on_board) < Number(item.recommended_qty)) return <span title="Below recommended qty" className="inline-block w-3 h-3 rounded-full bg-amber-400 shrink-0" />
  return <span title="OK" className="inline-block w-3 h-3 rounded-full bg-green-500 shrink-0" />
}

const SAFETY_CATEGORIES = [
  'AIS MOB Beacon', 'EPIRB', 'Fire Safety', 'First Aid', 'Flares',
  'Insurance', 'Life Saving', 'PLB', 'Radio', 'Registration', 'Other',
]

const BLANK_SAFETY_ITEM = {
  category: 'Life Saving', name: '', make_model: '', serial_number: '',
  purchase_date: '', expiry_date: '', location: '', notes: '',
}

function SafetyTab({ dataset, triggerRefresh }) {
  const { safetyItems, firstAidItems = [], aedData } = dataset
  const now = new Date()
  const [aed, setAed] = useState(aedData || {})
  const [aedSaving, setAedSaving] = useState(false)
  const [tier2Open, setTier2Open] = useState(false)
  const [localItems, setLocalItems] = useState({})
  const [editingItem, setEditingItem] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setAed(aedData || {}) }, [aedData])

  const statusFor = (item) => {
    if (!item.expiry_date) return 'current'
    const d = parseISO(item.expiry_date)
    const days = differenceInDays(d, now)
    let warning = 90
    if (item.name?.includes('Insurance') || item.name?.includes('Registration')) warning = 60
    if (item.name?.includes('PLB') || item.name?.includes('AIS MOB')) warning = 365
    return days < 0 ? 'overdue' : days <= warning ? 'soon' : 'current'
  }

  const tier1 = firstAidItems.filter((i) => i.tier === 1)
  const tier2 = firstAidItems.filter((i) => i.tier === 2)

  const tier1ByCategory = tier1.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})
  const tier2ByCategory = tier2.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  const getLocal = (item, field) => {
    if (localItems[item.id]?.[field] !== undefined) return localItems[item.id][field]
    return item[field] ?? ''
  }

  const handleItemChange = (item, field, value) => {
    setLocalItems((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] || {}), [field]: value } }))
  }

  const handleItemBlur = async (item, field) => {
    const val = localItems[item.id]?.[field]
    if (val === undefined) return
    try {
      await updateFirstAidItem(item.id, { [field]: val === '' ? null : val })
      triggerRefresh('all')
    } catch { /* ignore */ }
  }

  const saveAed = async () => {
    setAedSaving(true)
    try {
      await upsertAedTracking(aed)
      triggerRefresh('all')
    } catch { /* ignore */ }
    finally { setAedSaving(false) }
  }

  const handleSaveGear = async () => {
    if (!editingItem.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        category: editingItem.category,
        name: editingItem.name.trim(),
        make_model: editingItem.make_model,
        serial_number: editingItem.serial_number,
        purchase_date: editingItem.purchase_date || null,
        expiry_date: editingItem.expiry_date || null,
        location: editingItem.location,
        notes: editingItem.notes,
      }
      if (editingItem.id) {
        await db.update('safety_items', editingItem.id, payload)
      } else {
        await db.insert('safety_items', payload)
      }
      triggerRefresh('all')
      setEditingItem(null)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const handleDeleteGear = async (id) => {
    if (!window.confirm('Delete this safety gear item?')) return
    try {
      await db.remove('safety_items', id)
      triggerRefresh('all')
    } catch { /* ignore */ }
  }

  const renderItems = (items) => items.map((item) => (
    <div key={item.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center border-b border-slate-100 py-1.5 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <FirstAidStatusDot item={{ ...item, qty_on_board: getLocal(item, 'qty_on_board') || item.qty_on_board, expiry_date: getLocal(item, 'expiry_date') || item.expiry_date }} />
        <span className="truncate">{item.item_name}</span>
        <span className="text-xs text-slate-400 shrink-0">rec. {item.recommended_qty}</span>
      </div>
      <input
        type="number"
        min="0"
        value={getLocal(item, 'qty_on_board')}
        onChange={(e) => handleItemChange(item, 'qty_on_board', e.target.value)}
        onBlur={() => handleItemBlur(item, 'qty_on_board')}
        className="w-16 border rounded p-1 text-xs text-center"
        placeholder="Qty"
      />
      <input
        type="date"
        value={getLocal(item, 'expiry_date')}
        onChange={(e) => handleItemChange(item, 'expiry_date', e.target.value)}
        onBlur={() => handleItemBlur(item, 'expiry_date')}
        className="border rounded p-1 text-xs w-32"
      />
    </div>
  ))

  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-serif text-xl text-[#0A4A52]">Safety Register</h3>
          <button type="button"
            onClick={() => setEditingItem({ ...BLANK_SAFETY_ITEM })}
            className="flex items-center gap-1 rounded-lg bg-[#0A4A52] text-white px-3 py-1.5 text-sm">
            <Plus size={14} /> Add Gear
          </button>
        </div>
        <div className="space-y-2 max-h-[36rem] overflow-auto text-sm">
          {Object.entries(
            safetyItems.reduce((acc, s) => {
              const cat = s.category || 'Other'
              if (!acc[cat]) acc[cat] = []
              acc[cat].push(s)
              return acc
            }, {})
          ).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
            <div key={cat}>
              <div className="text-xs font-bold text-[#0A4A52] uppercase tracking-wide bg-teal-50 rounded px-2 py-1 mb-1">{cat}</div>
              {items.map((s) => {
                const st = statusFor(s)
                const badge = st === 'overdue' ? '🔴 Overdue' : st === 'soon' ? '🟡 Due Soon' : '✅ OK'
                return (
                  <div key={s.id} className="border-b border-slate-100 pb-2 mb-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{s.name}</div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: TRAFFIC[st] }}>{badge}</span>
                        <button type="button" onClick={() => setEditingItem({ ...s })}
                          className="text-xs text-[#0A4A52] border border-[#0A4A52] rounded px-2 py-0.5 hover:bg-teal-50">
                          Edit
                        </button>
                      </div>
                    </div>
                    <div className="text-slate-600">{s.make_model}</div>
                    <div className="text-slate-500">Serial: {s.serial_number || '—'} · Expiry/Service: {s.expiry_date || 'TBC'}</div>
                    {s.location && <div className="text-slate-400 text-xs">📍 {s.location}</div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Safety Gear Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditingItem(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg text-[#0A4A52]">{editingItem.id ? 'Edit Safety Gear' : 'Add Safety Gear'}</h3>
              <button type="button" onClick={() => setEditingItem(null)}><X size={20} /></button>
            </div>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="font-medium text-slate-700">Category</span>
                <select value={editingItem.category} onChange={(e) => setEditingItem((i) => ({ ...i, category: e.target.value }))}
                  className="w-full mt-1 border rounded-lg p-2">
                  {SAFETY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-medium text-slate-700">Name *</span>
                <input value={editingItem.name} onChange={(e) => setEditingItem((i) => ({ ...i, name: e.target.value }))}
                  className="w-full mt-1 border rounded-lg p-2" placeholder="e.g. Life Jacket 1" />
              </label>
              <label className="block">
                <span className="font-medium text-slate-700">Make / Model</span>
                <input value={editingItem.make_model} onChange={(e) => setEditingItem((i) => ({ ...i, make_model: e.target.value }))}
                  className="w-full mt-1 border rounded-lg p-2" placeholder="Make and model" />
              </label>
              <label className="block">
                <span className="font-medium text-slate-700">Serial Number</span>
                <input value={editingItem.serial_number} onChange={(e) => setEditingItem((i) => ({ ...i, serial_number: e.target.value }))}
                  className="w-full mt-1 border rounded-lg p-2" placeholder="Serial / HEX ID" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-medium text-slate-700">Purchase Date</span>
                  <input type="date" value={editingItem.purchase_date || ''} onChange={(e) => setEditingItem((i) => ({ ...i, purchase_date: e.target.value }))}
                    className="w-full mt-1 border rounded-lg p-2" />
                </label>
                <label className="block">
                  <span className="font-medium text-slate-700">Expiry / Service Date</span>
                  <input type="date" value={editingItem.expiry_date || ''} onChange={(e) => setEditingItem((i) => ({ ...i, expiry_date: e.target.value }))}
                    className="w-full mt-1 border rounded-lg p-2" />
                </label>
              </div>
              <label className="block">
                <span className="font-medium text-slate-700">Location on Vessel</span>
                <input value={editingItem.location} onChange={(e) => setEditingItem((i) => ({ ...i, location: e.target.value }))}
                  className="w-full mt-1 border rounded-lg p-2" placeholder="Where is it stowed?" />
              </label>
              <label className="block">
                <span className="font-medium text-slate-700">Notes</span>
                <textarea rows={3} value={editingItem.notes} onChange={(e) => setEditingItem((i) => ({ ...i, notes: e.target.value }))}
                  className="w-full mt-1 border rounded-lg p-2 text-sm" placeholder="Service history, registration details, etc." />
              </label>
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
              {editingItem.id ? (
                <button type="button" onClick={() => handleDeleteGear(editingItem.id)}
                  className="text-red-600 text-sm hover:underline">Delete</button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingItem(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
                <button type="button" onClick={handleSaveGear} disabled={saving || !editingItem.name.trim()}
                  className="rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Defibrillator / AED Tracking */}
      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Defibrillator (AED) — Amaroo AED</h3>
        <div className="grid md:grid-cols-2 gap-3 text-sm mb-3">
          {[
            ['last_self_test_date', 'Last Self-Test Date', 'date'],
            ['pad_expiry_date', 'Pad Expiry Date', 'date'],
            ['battery_expiry_date', 'Battery Expiry Date', 'date'],
            ['last_service_date', 'Last Professional Service', 'date'],
            ['next_service_due', 'Next Service Due', 'date'],
          ].map(([field, label, type]) => {
            const isExpiry = field === 'pad_expiry_date' || field === 'battery_expiry_date'
            let expiryWarning = null
            if (isExpiry && aed[field]) {
              const days = differenceInDays(parseISO(aed[field]), now)
              if (days < 0) expiryWarning = <span className="ml-2 text-red-600 font-semibold text-xs">🔴 EXPIRED</span>
              else if (days <= 60) expiryWarning = <span className="ml-2 text-amber-600 font-semibold text-xs">🟡 Expires in {days}d</span>
              else expiryWarning = <span className="ml-2 text-green-700 text-xs">✅ OK</span>
            }
            return (
              <label key={field} className="block">
                {label}{expiryWarning}
                <input
                  type={type}
                  value={aed[field] || ''}
                  onChange={(e) => setAed((a) => ({ ...a, [field]: e.target.value }))}
                  className="w-full mt-1 border rounded-lg p-2"
                />
              </label>
            )
          })}
          <label className="block md:col-span-2">
            Notes
            <textarea
              rows={2}
              value={aed.notes || ''}
              onChange={(e) => setAed((a) => ({ ...a, notes: e.target.value }))}
              className="w-full mt-1 border rounded-lg p-2 text-sm"
            />
          </label>
        </div>
        <button type="button" onClick={saveAed} disabled={aedSaving}
          className="rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm disabled:opacity-50">
          {aedSaving ? 'Saving…' : 'Save AED Details'}
        </button>
      </div>

      {/* First Aid Kit */}
      <div className={cardClass()}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">First Aid Kit</h3>

        {/* Medical Disclaimer */}
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 mb-4 text-sm text-amber-900">
          <span className="font-semibold">⚕️ Medical Disclaimer</span> — This is a suggested baseline only. Always consult a medical professional before offshore passages. For personalised advice contact DAN Australia (1800 088 200) or the Royal Flying Doctor Service.
        </div>

        {firstAidItems.length === 0 ? (
          <div className="text-sm text-slate-500">First aid inventory not loaded. Run the SQL migration to create the first_aid_inventory table and reload.</div>
        ) : (
          <>
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 pb-1 mb-1">
              <span>Item</span><span className="w-16 text-center">On Board</span><span className="w-32">Expiry</span>
            </div>

            {/* Tier 1 */}
            <div className="mb-1 mt-3">
              <div className="text-xs font-bold text-[#0A4A52] uppercase tracking-wide bg-teal-50 rounded px-2 py-1 mb-2">
                Tier 1 — Coastal Queensland (Current)
              </div>
              {Object.entries(tier1ByCategory).map(([cat, items]) => (
                <div key={cat} className="mb-3">
                  <div className="text-xs font-semibold text-slate-600 mb-1">{cat}</div>
                  {renderItems(items)}
                </div>
              ))}
            </div>

            {/* Tier 2 (collapsible) */}
            <div className="mt-4">
              <button type="button"
                onClick={() => setTier2Open((o) => !o)}
                className="w-full flex items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <span>🔮 Tier 2 — Offshore / Ocean Passages (Future Requirement)</span>
                <span>{tier2Open ? '▲' : '▼'}</span>
              </button>
              {tier2Open && (
                <div className="mt-2 border border-slate-200 rounded-lg p-3">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide bg-slate-100 rounded px-2 py-1 mb-3">
                    Future Requirement — for offshore passages only
                  </div>
                  {Object.entries(tier2ByCategory).map(([cat, items]) => (
                    <div key={cat} className="mb-3">
                      <div className="text-xs font-semibold text-slate-600 mb-1">{cat}</div>
                      {renderItems(items)}
                    </div>
                  ))}
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    <div className="font-semibold mb-1">Training Recommended Before Offshore</div>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      <li>Marine First Aid (STCW standard)</li>
                      <li>DAN Oxygen Provider course</li>
                      <li>Wilderness First Responder (recommended)</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
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
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [expandedCategories, setExpandedCategories] = useState({})
  const [form, setForm] = useState({ category: '', name: '', phone: '', email: '', website: '', notes: '' })
  const categories = useMemo(
    () => ['all', ...Array.from(new Set((contacts || []).map((c) => c.category || 'Uncategorized'))).sort((a, b) => a.localeCompare(b))],
    [contacts],
  )
  const filteredContacts = useMemo(
    () => (contacts || []).filter((c) => {
      const q = filter.trim().toLowerCase()
      const hay = `${c.category || ''} ${c.name || ''} ${c.phone || ''} ${c.email || ''} ${c.notes || ''}`.toLowerCase()
      const byText = q ? hay.includes(q) : true
      const byCategory = categoryFilter === 'all' ? true : (c.category || 'Uncategorized') === categoryFilter
      return byText && byCategory
    }),
    [categoryFilter, contacts, filter],
  )
  const grouped = useMemo(() => {
    const map = new Map()
    filteredContacts.forEach((contact) => {
      const key = contact.category || 'Uncategorized'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(contact)
    })
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredContacts])

  const add = async (e) => {
    e.preventDefault()
    await db.insert('contacts', { ...form, is_favourite: false, data: {} })
    setForm({ category: '', name: '', phone: '', email: '', website: '', notes: '' })
    triggerRefresh('all')
  }
  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <div className="sticky top-[72px] z-[5] -mx-4 px-4 pb-3 mb-3 bg-white/95 backdrop-blur border-b border-slate-100">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full border rounded-lg py-2 pl-9 pr-9"
              placeholder="Search contacts by name, category, phone or notes"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryFilter(category)}
                className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap ${categoryFilter === category ? 'bg-[#0A4A52] text-white' : 'bg-slate-100 text-slate-700'}`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          {grouped.map(([category, items]) => {
            const isOpen = expandedCategories[category] ?? true
            return (
              <div key={category} className="rounded-xl border border-slate-200 bg-slate-50/60">
                <button
                  type="button"
                  onClick={() => setExpandedCategories((prev) => ({ ...prev, [category]: !isOpen }))}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left"
                >
                  <span className="font-medium text-slate-800">{category}</span>
                  <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                    {items.length}
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-2 pb-2 space-y-1.5">
                    {items.map((c) => (
                      <div key={c.id} className="rounded-lg bg-white p-3 min-h-[68px]">
                        <div className="font-medium">{c.name}</div>
                        <div>{c.phone || 'No phone'} {c.email ? `· ${c.email}` : ''}</div>
                        <div className="text-slate-500">{c.notes}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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

const MAX_DOC_BYTES = 10 * 1024 * 1024
const DEFAULT_DOCUMENT_CATEGORIES = [
  'Registration',
  'Insurance',
  'Safety',
  'Survey',
  'Manual',
  'Maintenance',
  'Reports',
  'Weather & Tides',
  'Admin',
  'Other',
]

function dataUrlToBlob(source, mimeType) {
  let base64 = source
  let mime = mimeType || 'application/octet-stream'
  if (source.startsWith('data:')) {
    const [header, b64] = source.split(',')
    base64 = b64
    mime = header.match(/:(.*?);/)?.[1] || mime
  }
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

function DocumentsTab({ dataset, triggerRefresh }) {
  const { documents } = dataset
  const [meta, setMeta] = useState({ name: '', category: '', system: '', date: format(new Date(), 'yyyy-MM-dd'), tags: '', notes: '' })
  const [queuedFiles, setQueuedFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 })
  const [uploadError, setUploadError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ name: '', category: '' })
  const [savingId, setSavingId] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState([])
  const [bulkDraft, setBulkDraft] = useState({ category: '', tags: '' })
  const [bulkSaving, setBulkSaving] = useState(false)
  const [migratingLegacy, setMigratingLegacy] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState({ current: 0, total: 0 })
  const [expandedDocCategories, setExpandedDocCategories] = useState({})
  const [docSearch, setDocSearch] = useState('')
  const fileInputRef = useRef(null)
  const legacyDocuments = useMemo(
    () => documents.filter((doc) => doc?.file_data && !parseStorageReference(String(doc.file_data))),
    [documents],
  )
  const documentCategories = useMemo(() => {
    const seen = new Set()
    const merged = []
    for (const category of [...DEFAULT_DOCUMENT_CATEGORIES, ...documents.map((doc) => doc.category).filter(Boolean)]) {
      if (!seen.has(category)) {
        seen.add(category)
        merged.push(category)
      }
    }
    return merged
  }, [documents])
  const groupedDocuments = useMemo(() => {
    const q = docSearch.trim().toLowerCase()
    const filtered = q
      ? documents.filter((doc) =>
          [doc.name, doc.category, doc.tags, doc.notes, doc.file_name]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q))
        )
      : documents
    const grouped = filtered.reduce((acc, doc) => {
      const category = doc.category || 'Uncategorized'
      if (!acc[category]) acc[category] = []
      acc[category].push(doc)
      return acc
    }, {})
    return Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right))
  }, [documents, docSearch])

  useEffect(() => {
    setExpandedDocCategories((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [category] of groupedDocuments) {
        if (!(category in next)) {
          next[category] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [groupedDocuments])

  const buildDocumentName = (selectedFile, total) => {
    const customName = meta.name.trim()
    if (!customName) return selectedFile.name
    if (total === 1) return customName
    return `${customName} - ${selectedFile.name}`
  }

  const queueFiles = (incomingFiles) => {
    const nextItems = Array.from(incomingFiles || []).map((selectedFile) => ({
      key: `${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file: selectedFile,
      name: selectedFile.name,
    }))
    if (!nextItems.length) return
    setQueuedFiles((prev) => [...prev, ...nextItems])
    setUploadError(null)
  }

  const updateQueuedName = (key, value) => {
    setQueuedFiles((prev) => prev.map((item) => (item.key === key ? { ...item, name: value } : item)))
  }

  const removeQueuedFile = (key) => {
    setQueuedFiles((prev) => prev.filter((item) => item.key !== key))
  }

  const upload = async (e) => {
    e.preventDefault()
    if (!queuedFiles.length) { setUploadError('Please select at least one file.'); return }
    const oversized = queuedFiles.filter(({ file }) => file.size > MAX_DOC_BYTES)
    if (oversized.length) {
      setUploadError(`These files exceed the 10 MB limit: ${oversized.map(({ file }) => file.name).join(', ')}`)
      return
    }
    setUploading(true)
    setUploadProgress({ current: 0, total: queuedFiles.length })
    setUploadError(null)
    try {
      const failed = []
      for (let index = 0; index < queuedFiles.length; index += 1) {
        const { file, name } = queuedFiles[index]
        setUploadProgress({ current: index + 1, total: queuedFiles.length })
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
          const storagePath = `documents/${timestamp}-${index + 1}-${sanitizeFileName(file.name)}`
          const uploaded = await uploadDocument(file, storagePath)
          await db.insert('documents', {
            ...meta,
            name: (name || '').trim() || buildDocumentName(file, queuedFiles.length),
            file_data: uploaded.reference,
            file_name: file.name,
            file_type: file.type,
            file_size: file.size,
          })
        } catch (err) {
          failed.push({ name: file.name, message: err?.message || 'Upload failed' })
        }
      }

      if (failed.length === queuedFiles.length) {
        throw new Error(failed[0]?.message || 'Upload failed.')
      }

      setMeta({ name: '', category: '', system: '', date: format(new Date(), 'yyyy-MM-dd'), tags: '', notes: '' })
      setQueuedFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      triggerRefresh('all')
      if (failed.length) {
        setUploadError(`Uploaded ${queuedFiles.length - failed.length} of ${queuedFiles.length}. Failed: ${failed.map((item) => item.name).join(', ')}`)
      }
    } catch (err) {
      setUploadError(err?.message || 'Upload failed. Check your Supabase connection.')
    } finally {
      setUploading(false)
      setUploadProgress({ current: 0, total: 0 })
    }
  }

  const applyBulkEdit = async () => {
    if (!selectedDocIds.length) return
    const patch = {
      ...(bulkDraft.category.trim() ? { category: bulkDraft.category.trim() } : {}),
      ...(bulkDraft.tags.trim() ? { tags: bulkDraft.tags.trim() } : {}),
    }
    if (Object.keys(patch).length === 0) {
      setUploadError('Enter a category or tags before applying bulk edit.')
      return
    }
    setBulkSaving(true)
    setUploadError(null)
    try {
      await Promise.all(selectedDocIds.map((id) => db.update('documents', id, patch)))
      setSelectedDocIds([])
      setBulkDraft({ category: '', tags: '' })
      triggerRefresh('all')
    } catch (err) {
      setUploadError(err?.message || 'Bulk update failed.')
    } finally {
      setBulkSaving(false)
    }
  }

  const migrateLegacyDocuments = async () => {
    if (!legacyDocuments.length) return
    if (!window.confirm(`Migrate ${legacyDocuments.length} legacy document${legacyDocuments.length === 1 ? '' : 's'} to Supabase Storage? Existing records will keep working, but this rewrites each legacy file_data value to a storage reference.`)) return
    setMigratingLegacy(true)
    setMigrationProgress({ current: 0, total: legacyDocuments.length })
    setUploadError(null)
    try {
      const failed = []
      for (let index = 0; index < legacyDocuments.length; index += 1) {
        const doc = legacyDocuments[index]
        setMigrationProgress({ current: index + 1, total: legacyDocuments.length })
        try {
          const blob = dataUrlToBlob(String(doc.file_data), doc.file_type)
          const fileName = doc.file_name || doc.name || `document-${doc.id}`
          const file = new File([blob], fileName, { type: doc.file_type || blob.type || 'application/octet-stream' })
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
          const storagePath = `documents/migrated/${timestamp}-${doc.id}-${sanitizeFileName(file.name)}`
          const uploaded = await uploadDocument(file, storagePath)
          await db.update('documents', doc.id, { file_data: uploaded.reference })
        } catch (err) {
          failed.push({ name: doc.file_name || doc.name || `Document ${doc.id}`, message: err?.message || 'Migration failed' })
        }
      }

      triggerRefresh('all')
      if (failed.length === legacyDocuments.length) {
        throw new Error(failed[0]?.message || 'Migration failed.')
      }
      if (failed.length) {
        setUploadError(`Migrated ${legacyDocuments.length - failed.length} of ${legacyDocuments.length}. Failed: ${failed.map((item) => item.name).join(', ')}`)
      }
    } catch (err) {
      setUploadError(err?.message || 'Migration failed.')
    } finally {
      setMigratingLegacy(false)
      setMigrationProgress({ current: 0, total: 0 })
    }
  }

  const openDocument = (doc) => {
    if (!doc?.file_data) return
    ;(async () => {
      try {
        const blob = parseStorageReference(String(doc.file_data))
          ? await downloadStoredFile(String(doc.file_data))
          : dataUrlToBlob(String(doc.file_data), doc.file_type)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const canInline = ['application/pdf', 'image/'].some((t) => (doc.file_type || '').startsWith(t))
        if (canInline) {
          a.target = '_blank'
          a.rel = 'noopener noreferrer'
        } else {
          a.download = doc.file_name || doc.name || 'document'
        }
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 15000)
      } catch {
        alert('Could not open this document.')
      }
    })()
  }

  const startEdit = (doc) => {
    setEditingId(doc.id)
    setEditDraft({ name: doc.name || '', category: doc.category || '' })
  }

  const saveEdit = async (id) => {
    setSavingId(id)
    try {
      await db.update('documents', id, editDraft)
      setEditingId(null)
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Save failed.')
    } finally {
      setSavingId(null)
    }
  }

  const deleteDocument = async (id, name) => {
    if (!window.confirm(`Delete "${name || 'this document'}"? This cannot be undone.`)) return
    setDeletingId(id)
    try {
      const doc = documents.find((entry) => entry.id === id)
      if (doc?.file_data && parseStorageReference(String(doc.file_data))) {
        try {
          await deleteStoredFile(String(doc.file_data))
        } catch {}
      }
      await db.remove('documents', id)
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Delete failed.')
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
          <label className="text-sm">
            Category
            <select className="w-full mt-1 rounded-lg border border-slate-300 p-2.5" value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })}>
              <option value="">Select category</option>
              {documentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <Input label="System" value={meta.system} onChange={(v) => setMeta({ ...meta, system: v })} />
          <Input label="Date" type="date" value={meta.date} onChange={(v) => setMeta({ ...meta, date: v })} />
          <Input label="Tags" value={meta.tags} onChange={(v) => setMeta({ ...meta, tags: v })} />
          <Input label="Notes" value={meta.notes} onChange={(v) => setMeta({ ...meta, notes: v })} />
        </div>
        <div className="mt-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragOver(true)
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              queueFiles(e.dataTransfer.files)
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${isDragOver ? 'border-[#0A4A52] bg-teal-50' : 'border-slate-300 bg-slate-50/70'}`}
          >
            <div className="text-sm font-medium text-[#0A4A52]">Drag and drop documents here</div>
            <div className="text-xs text-slate-500 mt-1">or browse and keep adding files to the upload queue</div>
          </div>
          <input
            ref={fileInputRef}
            id="doc-file-input"
            type="file"
            multiple
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-1.5 file:text-sm file:text-[#0A4A52] file:cursor-pointer"
            onChange={(e) => {
              queueFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <p className="mt-1 text-xs text-slate-500">PDF, images, Word, Excel — select one or many files, max 10 MB each</p>
          {queuedFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-slate-600">{queuedFiles.length} file{queuedFiles.length === 1 ? '' : 's'} queued for upload</div>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {queuedFiles.map((item) => (
                  <div key={item.key} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-slate-500 truncate">{item.file.name} · {(Number(item.file.size || 0) / 1024).toFixed(1)} KB</div>
                        <label className="block text-sm mt-2">
                          Display name
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => updateQueuedName(item.key, e.target.value)}
                            className="w-full mt-1 rounded-lg border border-slate-300 p-2"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeQueuedFile(item.key)}
                        className="rounded-md p-1 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${item.file.name}`}
                        title="Remove from upload queue"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {uploadError && <p className="mt-1 text-sm text-red-600">{uploadError}</p>}
        <button type="submit" disabled={uploading} className="mt-3 rounded-lg bg-[#0A4A52] text-white px-4 py-2 disabled:opacity-60">
          {uploading ? `Uploading ${uploadProgress.current}/${uploadProgress.total || queuedFiles.length}…` : queuedFiles.length > 1 ? `Save ${queuedFiles.length} Documents` : 'Save Document'}
        </button>
      </form>

      {documents.length > 0 && (
        <div className={cardClass()}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h3 className="font-serif text-xl text-[#0A4A52]">Documents ({documents.length})</h3>
            <span className="text-xs text-slate-500">Select documents to bulk update category and tags</span>
          </div>
          <div className="mb-3">
            <input
              type="search"
              placeholder="Search by name, category, tags, notes…"
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
            />
            {docSearch && <p className="mt-1 text-xs text-slate-500">{groupedDocuments.reduce((n, [, docs]) => n + docs.length, 0)} result{groupedDocuments.reduce((n, [, docs]) => n + docs.length, 0) !== 1 ? 's' : ''} for "{docSearch}"</p>}
          </div>
          {legacyDocuments.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-medium text-amber-900">Legacy documents detected</div>
                <div className="text-xs text-amber-800">{legacyDocuments.length} document{legacyDocuments.length === 1 ? '' : 's'} still store file contents in the database. Migrate them to Storage to reduce table size and avoid future timeout issues.</div>
              </div>
              <button
                type="button"
                onClick={migrateLegacyDocuments}
                disabled={migratingLegacy}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white disabled:opacity-60"
              >
                {migratingLegacy ? `Migrating ${migrationProgress.current}/${migrationProgress.total || legacyDocuments.length}…` : `Migrate ${legacyDocuments.length} Legacy Document${legacyDocuments.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="text-sm">
                Bulk Category
                <select className="w-full mt-1 rounded-lg border border-slate-300 p-2.5" value={bulkDraft.category} onChange={(e) => setBulkDraft((prev) => ({ ...prev, category: e.target.value }))}>
                  <option value="">Select category</option>
                  {documentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <Input label="Bulk Tags" value={bulkDraft.tags} onChange={(v) => setBulkDraft((prev) => ({ ...prev, tags: v }))} />
              <button
                type="button"
                onClick={applyBulkEdit}
                disabled={!selectedDocIds.length || bulkSaving}
                className="rounded-lg bg-[#0A4A52] px-4 py-2 text-white disabled:opacity-50"
              >
                {bulkSaving ? 'Applying…' : `Apply to ${selectedDocIds.length || 0}`}
              </button>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            {groupedDocuments.map(([category, categoryDocuments]) => {
              const isOpen = expandedDocCategories[category] ?? false
              return (
                <div key={category} className="rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedDocCategories((prev) => ({ ...prev, [category]: !isOpen }))}
                    className="w-full px-4 py-3 flex items-center justify-between text-left"
                  >
                    <span className="font-medium text-slate-900">{category}</span>
                    <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                      {categoryDocuments.length}
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 border-t border-slate-200 p-3">
                      {categoryDocuments.map((d) => (
                        <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-3">
                          {editingId === d.id ? (
                            <div className="space-y-2">
                              <Input label="Name" value={editDraft.name} onChange={(v) => setEditDraft((p) => ({ ...p, name: v }))} />
                              <label className="text-sm">
                                Category
                                <select className="w-full mt-1 rounded-lg border border-slate-300 p-2.5" value={editDraft.category} onChange={(e) => setEditDraft((p) => ({ ...p, category: e.target.value }))}>
                                  <option value="">Select category</option>
                                  {documentCategories.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                              </label>
                              <div className="flex gap-2 pt-1">
                                <button type="button" onClick={() => saveEdit(d.id)} disabled={savingId === d.id}
                                  className="rounded-lg bg-[#0A4A52] px-3 py-1.5 text-sm text-white disabled:opacity-60">
                                  {savingId === d.id ? 'Saving…' : 'Save'}
                                </button>
                                <button type="button" onClick={() => setEditingId(null)}
                                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  className="mt-1 accent-[#0A4A52]"
                                  checked={selectedDocIds.includes(d.id)}
                                  onChange={() => setSelectedDocIds((prev) => prev.includes(d.id) ? prev.filter((id) => id !== d.id) : [...prev, d.id])}
                                  aria-label={`Select document ${d.name || d.file_name || 'Untitled'}`}
                                />
                                <div className="space-y-0.5 min-w-0">
                                  <div className="font-medium text-base text-slate-900 truncate">{d.name || d.file_name || 'Untitled'}</div>
                                  <div className="text-slate-500 text-xs">
                                    {[d.category, d.system, d.date].filter(Boolean).join(' · ')}
                                  </div>
                                  <div className="text-slate-400 text-xs">{d.file_name} · {(Number(d.file_size || 0) / 1024).toFixed(1)} KB</div>
                                  {d.tags ? <div className="text-slate-400 text-xs">Tags: {d.tags}</div> : null}
                                  {d.notes ? <div className="text-slate-500 text-xs">{d.notes}</div> : null}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2 shrink-0">
                                <button type="button" onClick={() => openDocument(d)}
                                  className="rounded-lg bg-[#0A4A52] px-3 py-1.5 text-sm text-white">
                                  Open
                                </button>
                                <button type="button" onClick={() => startEdit(d)}
                                  className="rounded-lg border border-[#0A4A52] px-3 py-1.5 text-sm text-[#0A4A52]">
                                  Rename
                                </button>
                                <button type="button" onClick={() => deleteDocument(d.id, d.name)} disabled={deletingId === d.id}
                                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">
                                  {deletingId === d.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
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

const PART_BLANK = { name: '', category: '', quantity: 0, min_quantity: 1, unit: 'ea', location: '', part_number: '', supplier: '', notes: '' }
const SORT_OPTIONS = [
  ['cat-az', 'By Category (A→Z)'],
  ['cat-za', 'By Category (Z→A)'],
  ['name-az', 'By Name (A→Z)'],
  ['stock-low', 'By Stock Level (low first)'],
  ['date-new', 'By Date Added (newest first)'],
]

const EXPENSE_CATEGORIES = [
  'Registration',
  'Insurance',
  'Marina / Mooring',
  'Haulout / Slipping',
  'Chandlery',
  'Provisioning',
  'Maintenance',
  'Fuel',
  'Parts',
  'Other',
]

const EXPENSE_TYPE_TO_CATEGORY = {
  registration: 'Registration',
  insurance: 'Insurance',
  marina: 'Marina / Mooring',
  haulout: 'Haulout / Slipping',
  chandlery: 'Chandlery',
  provisioning: 'Provisioning',
  maintenance: 'Maintenance',
  fuel: 'Fuel',
  parts: 'Parts',
  other: 'Other',
}

const EXPENSE_BLANK = { date: '', description: '', category: '', supplier: '', amount_aud: '', invoice_number: '', notes: '', attachment_url: '' }

function ExpensesTab({ dataset, triggerRefresh, expensesPrefill, setExpensesPrefill }) {
  const expenses = dataset.expensesLog || []
  const [form, setForm] = useState(EXPENSE_BLANK)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(EXPENSE_BLANK)
  const [deletingId, setDeletingId] = useState(null)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')

  // Pre-fill from Receipts tab
  useEffect(() => {
    if (!expensesPrefill) return
    const extracted = expensesPrefill.extracted_data || {}
    setForm({
      date: extracted.date || extracted.invoice_date || new Date().toISOString().substring(0, 10),
      description: extracted.description || expensesPrefill.email_subject || '',
      category: EXPENSE_TYPE_TO_CATEGORY[expensesPrefill.receipt_type] || 'Other',
      supplier: extracted.supplier_name || '',
      amount_aud: extracted.total_cost_aud != null ? String(extracted.total_cost_aud) : '',
      invoice_number: extracted.invoice_number || '',
      notes: extracted.notes || '',
      attachment_url: expensesPrefill.attachment_url || '',
    })
    setExpensesPrefill(null)
  }, [expensesPrefill, setExpensesPrefill])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses.filter((e) => {
      const matchCat = !filterCat || e.category === filterCat
      const matchQ = !q || [e.description, e.supplier, e.category, e.notes, e.invoice_number]
        .filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
      return matchCat && matchQ
    })
  }, [expenses, search, filterCat])

  const grouped = useMemo(() => {
    const years = {}
    for (const e of filtered) {
      const y = e.date ? e.date.substring(0, 4) : 'Unknown'
      if (!years[y]) years[y] = []
      years[y].push(e)
    }
    return Object.entries(years).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  const totalFiltered = filtered.reduce((sum, e) => sum + (Number(e.amount_aud) || 0), 0)

  const save = async (e) => {
    e.preventDefault()
    if (!form.description && !form.supplier) return
    setSaving(true)
    try {
      await db.insert('expenses_log', {
        ...form,
        amount_aud: form.amount_aud !== '' ? Number(form.amount_aud) : null,
        vessel_id: 'amaroo',
      })
      setForm(EXPENSE_BLANK)
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    setEditDraft({
      date: row.date || '',
      description: row.description || '',
      category: row.category || '',
      supplier: row.supplier || '',
      amount_aud: row.amount_aud != null ? String(row.amount_aud) : '',
      invoice_number: row.invoice_number || '',
      notes: row.notes || '',
      attachment_url: row.attachment_url || '',
    })
  }

  const saveEdit = async (id) => {
    try {
      await db.update('expenses_log', id, {
        ...editDraft,
        amount_aud: editDraft.amount_aud !== '' ? Number(editDraft.amount_aud) : null,
      })
      setEditingId(null)
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Save failed.')
    }
  }

  const deleteRow = async (id) => {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return
    setDeletingId(id)
    try {
      await db.remove('expenses_log', id)
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <form className={cardClass()} onSubmit={save}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-3">Log Expense</h3>
        {expensesPrefill && <div className="mb-2 text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2">Pre-filled from receipt — review and save.</div>}
        <div className="grid md:grid-cols-3 gap-2">
          <Input label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <label className="text-sm md:col-span-2">
            Description
            <input className="w-full mt-1 rounded-lg border border-slate-300 p-2.5" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="text-sm">
            Category
            <select className="w-full mt-1 rounded-lg border border-slate-300 p-2.5" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Select…</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <Input label="Supplier" value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} />
          <Input label="Amount (AUD)" type="number" value={form.amount_aud} onChange={(v) => setForm({ ...form, amount_aud: v })} />
          <Input label="Invoice #" value={form.invoice_number} onChange={(v) => setForm({ ...form, invoice_number: v })} />
          <label className="text-sm md:col-span-2">
            Notes
            <input className="w-full mt-1 rounded-lg border border-slate-300 p-2.5" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          {form.attachment_url && (
            <div className="text-sm md:col-span-3">
              <a href={form.attachment_url} target="_blank" rel="noreferrer" className="text-[#0A4A52] underline text-xs">View attachment</a>
            </div>
          )}
        </div>
        <button type="submit" disabled={saving} className="mt-3 rounded-lg bg-[#0A4A52] text-white px-4 py-2 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save Expense'}
        </button>
      </form>

      {expenses.length > 0 && (
        <div className={cardClass()}>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="font-serif text-xl text-[#0A4A52]">Expenses ({expenses.length}) · ${expenses.reduce((s, e) => s + (Number(e.amount_aud) || 0), 0).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</h3>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="search"
              placeholder="Search expenses…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[180px] rounded-lg border border-slate-300 p-2 text-sm"
            />
            <select
              className="rounded-lg border border-slate-300 p-2 text-sm"
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
            >
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {(search || filterCat) && (
            <p className="text-xs text-slate-500 mb-2">{filtered.length} result{filtered.length !== 1 ? 's' : ''} · ${totalFiltered.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</p>
          )}
          <div className="space-y-3">
            {grouped.map(([year, rows]) => (
              <div key={year} className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 flex items-center justify-between">
                  <span className="font-medium text-slate-800">{year}</span>
                  <span className="text-xs text-slate-500">${rows.reduce((s, e) => s + (Number(e.amount_aud) || 0), 0).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <div key={row.id} className="p-3 text-sm">
                      {editingId === row.id ? (
                        <div className="space-y-2">
                          <div className="grid md:grid-cols-3 gap-2">
                            <Input label="Date" type="date" value={editDraft.date} onChange={(v) => setEditDraft({ ...editDraft, date: v })} />
                            <label className="text-sm md:col-span-2">Description<input className="w-full mt-1 rounded-lg border border-slate-300 p-2" value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} /></label>
                            <label className="text-sm">Category
                              <select className="w-full mt-1 rounded-lg border border-slate-300 p-2" value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}>
                                <option value="">Select…</option>
                                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </label>
                            <Input label="Supplier" value={editDraft.supplier} onChange={(v) => setEditDraft({ ...editDraft, supplier: v })} />
                            <Input label="Amount (AUD)" type="number" value={editDraft.amount_aud} onChange={(v) => setEditDraft({ ...editDraft, amount_aud: v })} />
                            <Input label="Invoice #" value={editDraft.invoice_number} onChange={(v) => setEditDraft({ ...editDraft, invoice_number: v })} />
                            <label className="text-sm md:col-span-3">Notes<input className="w-full mt-1 rounded-lg border border-slate-300 p-2" value={editDraft.notes} onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })} /></label>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => saveEdit(row.id)} className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5 text-sm">Save</button>
                            <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-slate-900">{row.description || row.supplier || 'Expense'}</span>
                              {row.category && <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{row.category}</span>}
                            </div>
                            <div className="text-slate-500 text-xs">{[row.date, row.supplier, row.invoice_number ? `#${row.invoice_number}` : null].filter(Boolean).join(' · ')}</div>
                            {row.notes && <div className="text-slate-400 text-xs">{row.notes}</div>}
                            {row.attachment_url && <a href={row.attachment_url} target="_blank" rel="noreferrer" className="text-xs text-[#0A4A52] underline">View attachment</a>}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-semibold text-slate-800">${Number(row.amount_aud || 0).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</span>
                            <button type="button" onClick={() => startEdit(row)} className="rounded-lg border border-[#0A4A52] px-2 py-1 text-xs text-[#0A4A52]">Edit</button>
                            <button type="button" onClick={() => deleteRow(row.id)} disabled={deletingId === row.id} className="rounded-lg bg-red-600 text-white px-2 py-1 text-xs disabled:opacity-60">{deletingId === row.id ? '…' : 'Delete'}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PendingReceiptsTab({ dataset, triggerRefresh, setFuelPrefill, setMaintPrefill, setPartsReceiptPrefill, setActiveTab, openInvoiceMatcher, setExpensesPrefill }) {
  const allReceipts = dataset.pendingReceipts || []
  const pending = allReceipts.filter((r) => r.status === 'pending')
  const reviewed = allReceipts.filter((r) => r.status === 'reviewed')
  const [showReviewed, setShowReviewed] = useState(false)
  const displayList = showReviewed
    ? allReceipts.filter((r) => r.status !== 'discarded')
    : pending
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [saveDocState, setSaveDocState] = useState({}) // { [receiptId]: { open, category, saving } }
  const [autoCatState, setAutoCatState] = useState({ running: false, progress: '', done: false })
  const maintenanceTasks = dataset.maintenanceTasks || []
  const currentEngineHours = Number(dataset.vesselSettings?.engine_hours_total || 0)

  const uncategorised = allReceipts.filter((r) => r.status !== 'discarded' && !r.receipt_type)

  const runAutoCategorise = async () => {
    if (!uncategorised.length) return
    setAutoCatState({ running: true, progress: `0 / ${uncategorised.length}`, done: false })
    let done = 0
    for (const row of uncategorised) {
      try {
        const type = await categoriseReceiptType(row)
        await updatePendingReceipt(row.id, { receipt_type: type })
      } catch (err) {
        console.error('Auto-categorise failed for', row.id, err)
      }
      done++
      setAutoCatState({ running: true, progress: `${done} / ${uncategorised.length}`, done: false })
    }
    setAutoCatState({ running: false, progress: '', done: true })
    triggerRefresh('all')
  }

  useEffect(() => {
    const next = {}
    allReceipts.forEach((row) => {
      next[row.id] = row.extracted_data || {}
    })
    setDrafts(next)
  }, [pending])

  const updateDraftField = (id, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [key]: value,
      },
    }))
  }

  const saveDraft = async (row) => {
    setSavingId(row.id)
    try {
      await updatePendingReceipt(row.id, { extracted_data: drafts[row.id] || {} })
      triggerRefresh('all')
    } finally {
      setSavingId(null)
    }
  }

  const sendToTargetTab = async (row) => {
    const payload = {
      ...row,
      extracted_data: drafts[row.id] || row.extracted_data || {},
      source: 'email',
    }

    await updatePendingReceipt(row.id, { extracted_data: payload.extracted_data })

    if (row.receipt_type === 'fuel') {
      setFuelPrefill(payload)
      setActiveTab('fuel')
      return
    }
    if (row.receipt_type === 'maintenance') {
      const extracted = payload.extracted_data
      if (Array.isArray(extracted?.matched_tasks) && extracted.matched_tasks.length > 0) {
        openInvoiceMatcher({
          invoiceData: extracted,
          scheduledTasks: maintenanceTasks,
          currentEngineHours,
          invoiceFile: null,
          invoicePhotoUrl: row.attachment_url || null,
          pendingReceiptId: row.id,
        })
        return
      }
      setMaintPrefill(payload)
      setActiveTab('maintenance')
      return
    }
    if (row.receipt_type === 'parts') {
      setPartsReceiptPrefill(payload)
      setActiveTab('parts')
      return
    }
    // All other types (registration, insurance, marina, haulout, chandlery, provisioning, other) → Expenses
    setExpensesPrefill(payload)
    setActiveTab('expenses')
  }

  const markDone = async (row) => {
    await markPendingReceiptReviewed(row.id)
    triggerRefresh('all')
  }

  const discard = async (row) => {
    await discardPendingReceipt(row.id)
    triggerRefresh('all')
  }

  const saveAsDocument = async (row) => {
    const state = saveDocState[row.id] || {}
    const category = state.category || 'Other'
    setSaveDocState((prev) => ({ ...prev, [row.id]: { ...state, saving: true } }))
    try {
      // Build a storage reference from the attachment_url so openDocument can download it
      let fileData = row.attachment_url || ''
      if (row.attachment_url) {
        // URL format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
        const match = row.attachment_url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/)
        if (match) fileData = makeStorageReference(match[1], match[2])
      }
      const attachmentName = row.attachment_url ? row.attachment_url.split('/').pop().replace(/^[\d_-]+/, '') : 'document'
      await db.insert('documents', {
        name: row.email_subject || attachmentName,
        category,
        file_data: fileData,
        file_name: attachmentName,
        file_type: row.attachment_url?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
        notes: `From email: ${row.email_from || 'unknown'}`,
        date: new Date().toISOString().substring(0, 10),
      })
      await discardPendingReceipt(row.id)
      triggerRefresh('all')
    } catch (err) {
      alert(err?.message || 'Failed to save document.')
      setSaveDocState((prev) => ({ ...prev, [row.id]: { ...state, saving: false } }))
    }
  }

  return (
    <div className="space-y-4">
      <div className={cardClass() + ' flex items-center justify-between py-3 flex-wrap gap-2'}>
        <div>
          <h3 className="font-serif text-xl text-[#0A4A52]">Receipts</h3>
          <p className="text-xs text-slate-500">{pending.length} pending · {reviewed.length} reviewed</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {uncategorised.length > 0 && (
            <button
              type="button"
              onClick={runAutoCategorise}
              disabled={autoCatState.running}
              className="text-sm rounded-lg bg-amber-500 text-white px-3 py-1.5 disabled:opacity-60"
            >
              {autoCatState.running
                ? `Categorising… ${autoCatState.progress}`
                : `Auto-categorise ${uncategorised.length} receipt${uncategorised.length !== 1 ? 's' : ''}`}
            </button>
          )}
          {autoCatState.done && !autoCatState.running && (
            <span className="text-xs text-green-700 bg-green-50 rounded-lg px-2 py-1">Done — types updated!</span>
          )}
          <button
            type="button"
            onClick={() => setShowReviewed((v) => !v)}
            className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 bg-white"
          >
            {showReviewed ? 'Hide reviewed' : 'Show reviewed'}
          </button>
        </div>
      </div>

      {displayList.length === 0 ? (
        <div className={cardClass()}>
          <p className="text-sm text-slate-600">No receipts to display.</p>
        </div>
      ) : null}

      {displayList.map((row) => {
        const draft = drafts[row.id] || {}
        const editableKeys = Object.keys(draft).filter((key) => {
          const value = draft[key]
          return ['string', 'number', 'boolean'].includes(typeof value)
        })

        return (
          <div key={row.id} className={cardClass()}>
            <div className={`flex items-center justify-between gap-2 mb-2 ${row.status === 'reviewed' ? 'opacity-70' : ''}`}>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-xl text-[#0A4A52]">{row.receipt_type?.toUpperCase() || 'RECEIPT'} Receipt</h3>
                  {row.status === 'reviewed' && <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">✓ Reviewed</span>}
                </div>
                <div className="text-xs text-slate-500">From: {row.email_from || 'unknown'} · Received: {row.received_at ? new Date(row.received_at).toLocaleString() : 'unknown'}</div>
              </div>
              <label className="text-xs text-slate-600 flex items-center gap-2">
                Type
                <select
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                  value={row.receipt_type || 'maintenance'}
                  onChange={async (e) => {
                    await updatePendingReceipt(row.id, { receipt_type: e.target.value })
                    triggerRefresh('all')
                  }}
                >
                  <option value="fuel">Fuel</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="parts">Parts</option>
                  <option disabled>──────────</option>
                  <option value="registration">Registration</option>
                  <option value="insurance">Insurance</option>
                  <option value="marina">Marina / Mooring</option>
                  <option value="haulout">Haulout / Slipping</option>
                  <option value="chandlery">Chandlery</option>
                  <option value="provisioning">Provisioning</option>
                  <option value="other">Other Expense</option>
                </select>
              </label>
              {row.attachment_url ? (
                <a href={row.attachment_url} target="_blank" rel="noreferrer" className="text-sm text-[#0A4A52] underline">View attachment</a>
              ) : null}
            </div>

            <div className="grid md:grid-cols-2 gap-2 text-sm">
              {editableKeys.length ? editableKeys.map((key) => (
                <label key={key} className="block">
                  <span className="text-slate-600">{key.replace(/_/g, ' ')}</span>
                  <input
                    className="w-full mt-1 rounded-lg border border-slate-300 p-2"
                    value={String(draft[key] ?? '')}
                    onChange={(e) => updateDraftField(row.id, key, e.target.value)}
                  />
                </label>
              )) : (
                <label className="block md:col-span-2">
                  <span className="text-slate-600">Extracted data (JSON)</span>
                  <textarea
                    className="w-full mt-1 rounded-lg border border-slate-300 p-2 min-h-[120px]"
                    value={JSON.stringify(draft, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value)
                        setDrafts((prev) => ({ ...prev, [row.id]: parsed }))
                      } catch {
                        // Ignore invalid JSON while typing
                      }
                    }}
                  />
                </label>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-3 text-sm">
              <button type="button" onClick={() => saveDraft(row)} className="rounded-lg bg-slate-100 px-3 py-1.5 border border-slate-300" disabled={savingId === row.id}>
                {savingId === row.id ? 'Saving...' : 'Save edits'}
              </button>
              {['fuel', 'maintenance', 'parts'].includes(row.receipt_type) ? (
                row.receipt_type === 'maintenance' && Array.isArray(draft?.matched_tasks) && draft.matched_tasks.length > 0 ? (
                  <button type="button" onClick={() => sendToTargetTab(row)} className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5">
                    🔧 Review &amp; Confirm Tasks
                  </button>
                ) : (
                  <button type="button" onClick={() => sendToTargetTab(row)} className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5">
                    Open in {row.receipt_type === 'fuel' ? 'Fuel Log' : row.receipt_type === 'maintenance' ? 'Maintenance Log' : 'Parts Inventory'}
                  </button>
                )
              ) : (
                <button type="button" onClick={() => sendToTargetTab(row)} className="rounded-lg bg-[#0A4A52] text-white px-3 py-1.5">
                  Open in Expenses
                </button>
              )}
              {row.attachment_url && (
                <button
                  type="button"
                  onClick={() => {
                    const typeToCategory = {
                      registration: 'Registration', insurance: 'Insurance', marina: 'Admin',
                      haulout: 'Maintenance', chandlery: 'Other', provisioning: 'Other',
                      maintenance: 'Maintenance', parts: 'Other', fuel: 'Other', other: 'Other',
                    }
                    const defaultCat = typeToCategory[row.receipt_type] || 'Other'
                    setSaveDocState((prev) => ({
                      ...prev,
                      [row.id]: { ...(prev[row.id] || {}), open: !(prev[row.id]?.open), category: prev[row.id]?.category || defaultCat },
                    }))
                  }}
                  className={`rounded-lg px-3 py-1.5 ${!['fuel','maintenance','parts'].includes(row.receipt_type) ? 'bg-[#0A4A52] text-white' : 'border border-slate-400 text-slate-700'}`}
                >
                  📄 Save as Document
                </button>
              )}
              {row.status === 'pending' && <button type="button" onClick={() => markDone(row)} className="rounded-lg bg-[#16A34A] text-white px-3 py-1.5">Mark reviewed</button>}
              {(row.status === 'pending' || row.status === 'reviewed') && <button type="button" onClick={() => discard(row)} className="rounded-lg bg-[#C4603A] text-white px-3 py-1.5">Discard</button>}
            </div>

            {saveDocState[row.id]?.open && (
              <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="text-sm flex-1 min-w-[160px]">
                  Category
                  <select
                    className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                    value={saveDocState[row.id]?.category || 'Other'}
                    onChange={(e) => setSaveDocState((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] || {}), category: e.target.value } }))}
                  >
                    {['Registration','Insurance','Safety','Survey','Manual','Maintenance','Reports','Weather & Tides','Admin','Receipt','Other'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => saveAsDocument(row)}
                  disabled={saveDocState[row.id]?.saving}
                  className="rounded-lg bg-[#0A4A52] text-white px-3 py-2 text-sm disabled:opacity-60"
                >
                  {saveDocState[row.id]?.saving ? 'Saving…' : 'Confirm Save'}
                </button>
              </div>
            )}

            {/* Matched tasks preview for maintenance receipts */}
            {row.receipt_type === 'maintenance' && Array.isArray(draft?.matched_tasks) && draft.matched_tasks.length > 0 && (
              <div className="mt-3 rounded-xl bg-teal-50 border border-teal-200 p-3">
                <div className="text-xs font-semibold text-[#0A4A52] mb-2">🤖 AI found {draft.matched_tasks.length} matched task{draft.matched_tasks.length !== 1 ? 's' : ''}:</div>
                <ul className="space-y-1">
                  {draft.matched_tasks.map((t, i) => (
                    <li key={i} className="text-xs text-teal-800 flex items-center gap-1.5">
                      <span>{t.match_confidence === 'high' ? '✅' : t.match_confidence === 'medium' ? '⚠️' : '❓'}</span>
                      <span>{t.task_name || t.invoice_line_item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PartsTab({ dataset, triggerRefresh, partsReceiptPrefill, setPartsReceiptPrefill }) {
  const { parts } = dataset
  const [form, setForm] = useState(PART_BLANK)
  const [sortBy, setSortBy] = useState('cat-az')
  const [groupByCat, setGroupByCat] = useState(true)
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [expandedCats, setExpandedCats] = useState(new Set())
  const [scanningReceipt, setScanningReceipt] = useState(false)
  const [partsConfidence, setPartsConfidence] = useState('')
  const [partsMessage, setPartsMessage] = useState('')
  const [receiptRows, setReceiptRows] = useState([])
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptAttachmentUrl, setReceiptAttachmentUrl] = useState('')
  const [receiptPendingId, setReceiptPendingId] = useState(null)
  const receiptInputRef = useRef(null)

  const confidenceText = {
    high: '✅ High confidence',
    medium: '⚠️ Medium confidence — please verify',
    low: '❌ Low confidence — please check all fields',
  }

  const applyExtractedRows = (extracted) => {
    const rows = Array.isArray(extracted?.items) ? extracted.items : []
    setReceiptRows(
      rows.map((row, idx) => ({
        id: `${Date.now()}-${idx}`,
        selected: true,
        part_name: row.part_name || '',
        quantity: row.quantity ?? 1,
        unit: row.unit || 'pcs',
        supplier: row.supplier || extracted?.supplier_name || '',
        category: row.category || extracted?.vessel_system || '',
        notes: row.notes || '',
      })),
    )
  }

  useEffect(() => {
    if (!partsReceiptPrefill) return
    const extracted = partsReceiptPrefill?.extracted_data || partsReceiptPrefill
    applyExtractedRows(extracted)
    setPartsConfidence(extracted?.confidence || '')
    setPartsMessage('✅ Parts receipt extracted and ready for review')
    setReceiptAttachmentUrl(partsReceiptPrefill?.attachment_url || '')
    setReceiptPendingId(partsReceiptPrefill?.id || null)
    setPartsReceiptPrefill(null)
  }, [partsReceiptPrefill, setPartsReceiptPrefill])

  const onScanPartsReceipt = async (file) => {
    if (!file) return
    setScanningReceipt(true)
    setPartsMessage('🤖 Reading receipt...')
    try {
      const extracted = await scanReceiptImage(file, 'parts')
      applyExtractedRows(extracted)
      setReceiptFile(file)
      setReceiptAttachmentUrl('')
      setPartsConfidence(extracted?.confidence || '')
      setPartsMessage('✅ Parts receipt scanned - review and edit below')
    } catch (err) {
      setPartsMessage(err?.message || 'Receipt scan failed.')
    } finally {
      setScanningReceipt(false)
    }
  }

  const updateReceiptRow = (id, patch) => {
    setReceiptRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const addSelectedReceiptItems = async () => {
    const selected = receiptRows.filter((r) => r.selected && r.part_name)
    if (!selected.length) return

    for (const row of selected) {
      await db.insert('parts', {
        name: row.part_name,
        category: row.category || '',
        quantity: Number(row.quantity || 0),
        min_quantity: 1,
        unit: row.unit || 'pcs',
        location: '',
        part_number: '',
        supplier: row.supplier || '',
        notes: row.notes || '',
      })
    }

    if (receiptFile && selected.length) {
      try {
        const storagePath = `receipts/parts/${Date.now()}-${sanitizeFileName(receiptFile.name)}`
        await uploadPhoto(receiptFile, storagePath)
      } catch {
        // Upload is optional for parts quick-add
      }
    }

    if (receiptPendingId) {
      await markPendingReceiptReviewed(receiptPendingId).catch(() => {})
      setReceiptPendingId(null)
    }

    setReceiptRows([])
    setReceiptFile(null)
    setReceiptAttachmentUrl('')
    setPartsMessage('✅ Selected items added to inventory')
    triggerRefresh('all')
  }

  const add = async (e) => {
    e.preventDefault()
    await db.insert('parts', { ...form, quantity: Number(form.quantity), min_quantity: Number(form.min_quantity) })
    setForm(PART_BLANK)
    triggerRefresh('all')
  }
  const adjust = async (part, delta) => {
    await db.update('parts', part.id, { quantity: Number(part.quantity) + delta })
    triggerRefresh('all')
  }

  const displayed = [...parts]
    .filter((p) => !lowStockOnly || Number(p.quantity) <= Number(p.min_quantity))
    .sort((a, b) => {
      if (sortBy === 'cat-az') return (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || '')
      if (sortBy === 'cat-za') return (b.category || '').localeCompare(a.category || '') || (a.name || '').localeCompare(b.name || '')
      if (sortBy === 'name-az') return (a.name || '').localeCompare(b.name || '')
      if (sortBy === 'stock-low') return Number(a.quantity) - Number(b.quantity)
      if (sortBy === 'date-new') return new Date(b.created_at || 0) - new Date(a.created_at || 0)
      return 0
    })

  const groups = groupByCat
    ? [...new Set(displayed.map((p) => p.category || 'Uncategorised'))].map((cat) => ({
        cat,
        items: displayed.filter((p) => (p.category || 'Uncategorised') === cat),
      }))
    : null

  const toggleCat = (cat) => setExpandedCats((prev) => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next })
  const lowCount = parts.filter((p) => Number(p.quantity) <= Number(p.min_quantity)).length

  return (
    <div className="space-y-4">
      <div className={cardClass()}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="font-serif text-xl text-[#0A4A52]">Parts Receipt Scanner</h3>
          <>
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onScanPartsReceipt(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => receiptInputRef.current?.click()}
              className="rounded-lg border border-[#0A4A52] text-[#0A4A52] px-3 py-1.5 text-sm"
              disabled={scanningReceipt}
            >
              📷 Scan Parts Receipt
            </button>
          </>
        </div>

        {partsMessage && <div className="text-sm text-slate-600 mb-1">{partsMessage}</div>}
        {partsConfidence && <div className="text-sm text-slate-700 mb-2">{confidenceText[partsConfidence] || ''}</div>}

        {receiptAttachmentUrl ? (
          <a href={receiptAttachmentUrl} target="_blank" rel="noreferrer" className="text-sm text-[#0A4A52] underline">
            View email attachment
          </a>
        ) : null}

        {receiptRows.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-1 pr-2">Add</th>
                  <th className="py-1 pr-2">Part Name</th>
                  <th className="py-1 pr-2">Qty</th>
                  <th className="py-1 pr-2">Unit</th>
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2">Supplier</th>
                  <th className="py-1 pr-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {receiptRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2 align-top">
                      <input type="checkbox" checked={row.selected} onChange={(e) => updateReceiptRow(row.id, { selected: e.target.checked })} />
                    </td>
                    <td className="py-1 pr-2 align-top"><input className="w-full rounded border border-slate-300 p-1" value={row.part_name} onChange={(e) => updateReceiptRow(row.id, { part_name: e.target.value })} /></td>
                    <td className="py-1 pr-2 align-top"><input className="w-20 rounded border border-slate-300 p-1" value={row.quantity} onChange={(e) => updateReceiptRow(row.id, { quantity: e.target.value })} /></td>
                    <td className="py-1 pr-2 align-top"><input className="w-20 rounded border border-slate-300 p-1" value={row.unit} onChange={(e) => updateReceiptRow(row.id, { unit: e.target.value })} /></td>
                    <td className="py-1 pr-2 align-top"><input className="w-32 rounded border border-slate-300 p-1" value={row.category} onChange={(e) => updateReceiptRow(row.id, { category: e.target.value })} /></td>
                    <td className="py-1 pr-2 align-top"><input className="w-32 rounded border border-slate-300 p-1" value={row.supplier} onChange={(e) => updateReceiptRow(row.id, { supplier: e.target.value })} /></td>
                    <td className="py-1 pr-2 align-top"><input className="w-full rounded border border-slate-300 p-1" value={row.notes} onChange={(e) => updateReceiptRow(row.id, { notes: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={addSelectedReceiptItems} className="mt-3 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Add Selected Items</button>
          </div>
        ) : null}
      </div>

      <form className={cardClass()} onSubmit={add}>
        <h3 className="font-serif text-xl text-[#0A4A52] mb-2">Add Part</h3>
        <div className="grid md:grid-cols-3 gap-2 text-sm">
          <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <label className="text-sm">Category
            <select className="w-full mt-1 border rounded-lg p-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">— Select —</option>
              {VESSEL_SYSTEMS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <Input label="Quantity" type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
          <Input label="Min Quantity" type="number" value={form.min_quantity} onChange={(v) => setForm({ ...form, min_quantity: v })} />
          <Input label="Unit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
          <Input label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
          <Input label="Part Number" value={form.part_number} onChange={(v) => setForm({ ...form, part_number: v })} />
          <Input label="Supplier" value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} />
          <Input label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
        </div>
        <button className="mt-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2">Save Part</button>
      </form>

      <div className={cardClass()}>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h3 className="font-serif text-xl text-[#0A4A52]">Inventory</h3>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button type="button" onClick={() => setLowStockOnly((v) => !v)}
              className={`text-xs rounded-full px-3 py-1 border font-medium transition-colors ${lowStockOnly ? 'bg-[#C4603A] text-white border-[#C4603A]' : 'border-[#C4603A] text-[#C4603A]'}`}>
              Show low stock only{lowCount > 0 ? ` (${lowCount})` : ''}
            </button>
            <button type="button" onClick={() => setGroupByCat((v) => !v)}
              className={`text-xs rounded-full px-3 py-1 border transition-colors ${groupByCat ? 'bg-[#0A4A52] text-white border-[#0A4A52]' : 'border-slate-300 text-slate-600'}`}>
              Group by category
            </button>
            <select className="text-xs border rounded-lg px-2 py-1" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1 text-sm max-h-[36rem] overflow-auto">
          {groups ? groups.map(({ cat, items }) => (
            <div key={cat}>
              <button type="button" onClick={() => toggleCat(cat)}
                className="w-full flex items-center justify-between py-1.5 px-1 text-left font-semibold text-[#0A4A52] border-b border-slate-200 hover:bg-slate-50">
                <span>{cat} <span className="font-normal text-slate-400 text-xs">({items.length} part{items.length === 1 ? '' : 's'})</span></span>
                {expandedCats.has(cat) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {expandedCats.has(cat) && items.map((p) => (
                <PartRow key={p.id} part={p} adjust={adjust} />
              ))}
            </div>
          )) : displayed.map((p) => <PartRow key={p.id} part={p} adjust={adjust} />)}
        </div>
      </div>
    </div>
  )
}

function PartRow({ part: p, adjust }) {
  const isLow = Number(p.quantity) <= Number(p.min_quantity)
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
      <div className="min-w-0">
        <div className="font-medium truncate">{p.name}</div>
        <div className="text-xs text-slate-500">
          {p.quantity} {p.unit}
          {isLow && <span className="ml-1 text-[#C4603A] font-semibold">LOW</span>}
          {p.location && ` · ${p.location}`}
        </div>
      </div>
      <div className="flex gap-1 shrink-0 ml-2">
        <button type="button" className="w-7 h-7 bg-slate-200 rounded text-sm font-bold" onClick={() => adjust(p, -1)}>−</button>
        <button type="button" className="w-7 h-7 bg-slate-200 rounded text-sm font-bold" onClick={() => adjust(p, 1)}>+</button>
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
  const [camFilter, setCamFilter] = useState('')
  const [selectedId, setSelectedId] = useState('tweed')
  const [embedFailed, setEmbedFailed] = useState(false)

  const filtered = useMemo(() => {
    const byState = state === 'ALL' ? cams : cams.filter((cam) => cam.state === state)
    const q = camFilter.trim().toLowerCase()
    if (!q) return byState
    return byState.filter((cam) => `${cam.name} ${cam.region} ${cam.notes || ''}`.toLowerCase().includes(q))
  }, [camFilter, state])
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
        <div className="sticky top-[72px] z-[5] -mx-4 px-4 pb-3 mb-3 bg-white/95 backdrop-blur border-b border-slate-100">
          <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar">
            {['ALL', 'QLD', 'NSW', 'VIC'].map((s) => <button key={s} type="button" onClick={() => setState(s)} className={`px-3 py-2 rounded whitespace-nowrap ${state === s ? 'bg-[#0A4A52] text-white' : 'bg-slate-200'}`}>{s}</button>)}
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full border rounded-lg py-2 pl-9 pr-9"
              placeholder="Search bars, regions or notes"
              value={camFilter}
              onChange={(e) => setCamFilter(e.target.value)}
            />
            {camFilter && (
              <button
                type="button"
                onClick={() => setCamFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label="Clear camera search"
              >
                <X size={14} />
              </button>
            )}
          </div>
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

const SETTINGS_FIELDS = [
  ['vessel_name', 'Vessel Name'],
  ['registration', 'Registration'],
  ['registration_expiry', 'Registration Expiry'],
  ['mmsi', 'MMSI'],
  ['home_port', 'Home Port'],
  ['owner', 'Owner'],
  ['owner_mobile', 'Owner Mobile'],
  ['owner_email', 'Owner Email'],
  ['insurance_company', 'Insurance Company'],
  ['insurance_policy', 'Insurance Policy'],
  ['insurance_expiry', 'Insurance Expiry'],
  ['insurance_broker_phone', 'Insurance Broker Phone'],
  ['cruising_area', 'Cruising Area'],
  ['port_tank_capacity', 'Port Tank Capacity (L)'],
  ['stbd_tank_capacity', 'Stbd Tank Capacity (L)'],
  ['estimated_burn_rate_litres_per_hour', 'Burn Rate (L/hr)'],
  ['cruise_speed_knots', 'Cruise Speed (kn)'],
  ['engine_hours_total', 'Engine Hours Total'],
  ['trip_log_baseline_nm', 'Trip Log Baseline (nm)'],
  ['maintenance_warning_days', 'Maintenance Warning (days)'],
  ['safety_warning_days', 'Safety Warning (days)'],
  ['insurance_registration_warning_days', 'Ins/Reg Warning (days)'],
  ['currency', 'Currency'],
]

function SettingsTab({ dataset, triggerRefresh, reload }) {
  const [settings, setSettings] = useState(dataset.vesselSettings || {})

  useEffect(() => {
    setSettings(dataset.vesselSettings || {})
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
          {SETTINGS_FIELDS.map(([key, label]) => (
            <Input key={key} label={label} value={settings[key] ?? ''} onChange={(v) => setSettings({ ...settings, [key]: v })} />
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
      <input
        type={type}
        className="w-full mt-1 rounded-lg border border-slate-300 p-2.5"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          if (type === 'date' && e.target.showPicker) e.target.showPicker()
        }}
      />
    </label>
  )
}

function NumberStepper({ label, value, onChange, onStep }) {
  return (
    <label className="text-sm">
      {label}
      <div className="mt-1 flex items-center rounded-lg border border-slate-300 overflow-hidden">
        <button
          type="button"
          onClick={() => onStep(-0.1)}
          className="px-3 py-2.5 text-slate-600 hover:bg-slate-100"
          aria-label={`Decrease ${label}`}
        >
          <Minus size={14} />
        </button>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          className="w-full text-center py-2.5 outline-none"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => onStep(0.1)}
          className="px-3 py-2.5 text-slate-600 hover:bg-slate-100"
          aria-label={`Increase ${label}`}
        >
          <Plus size={14} />
        </button>
      </div>
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
