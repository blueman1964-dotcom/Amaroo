import { useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Cloud,
  ContactRound,
  Droplets,
  FileText,
  Fuel,
  Gauge,
  HardHat,
  HelpCircle,
  Info,
  Map,
  Package,
  Settings,
  Shield,
  Ship,
  Smartphone,
  Waves,
  Webcam,
  Wrench,
} from 'lucide-react'

const SECTIONS = [
  { id: 'start',       label: 'Getting Started',    icon: HelpCircle },
  { id: 'dashboard',   label: 'Dashboard',           icon: Gauge },
  { id: 'passage',     label: 'Passage Planner',     icon: Map },
  { id: 'voyagelog',   label: 'Voyage Log',          icon: Ship },
  { id: 'engine',      label: 'Engine Hours',        icon: Wrench },
  { id: 'maintenance', label: 'Maintenance',         icon: HardHat },
  { id: 'fuel',        label: 'Fuel Log',            icon: Fuel },
  { id: 'fluids',      label: 'Fluid Levels',        icon: Droplets },
  { id: 'safety',      label: 'Safety Gear',         icon: Shield },
  { id: 'contacts',    label: 'Contacts',            icon: ContactRound },
  { id: 'documents',   label: 'Documents',           icon: FileText },
  { id: 'weather',     label: 'Weather',             icon: Cloud },
  { id: 'parts',       label: 'Parts',               icon: Package },
  { id: 'barcams',     label: 'Bar Cams',            icon: Webcam },
  { id: 'reports',     label: 'Reports',             icon: BarChart3 },
  { id: 'settings',    label: 'Settings',            icon: Settings },
  { id: 'mobile',      label: 'PWA & Mobile',        icon: Smartphone },
]

function Tip({ children }) {
  return (
    <div className="flex gap-2 bg-teal-50 border-l-4 border-[#0A4A52] rounded-r-lg p-3 my-3 text-sm text-[#0A4A52]">
      <Info size={16} className="flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

function Warn({ children }) {
  return (
    <div className="flex gap-2 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg p-3 my-3 text-sm text-amber-800">
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

function Steps({ items }) {
  return (
    <ol className="space-y-1.5 my-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="w-6 h-6 rounded-full bg-[#0A4A52] text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
            {i + 1}
          </span>
          <span className="text-slate-700">{item}</span>
        </li>
      ))}
    </ol>
  )
}

function H2({ children }) {
  return <h2 className="font-serif text-2xl text-[#0A4A52] mb-1 mt-6 first:mt-0">{children}</h2>
}

function H3({ children }) {
  return <h3 className="font-semibold text-[#0A4A52] mt-4 mb-1">{children}</h3>
}

function P({ children }) {
  return <p className="text-sm text-slate-600 leading-relaxed mb-2">{children}</p>
}

function Table({ headers, rows }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[#0A4A52] text-white">
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-slate-700 border-b border-slate-100">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Section content ───────────────────────────────────────────��──────────────

function GettingStarted() {
  return (
    <>
      <H2>Getting Started</H2>
      <P>
        The Amaroo Vessel Management app is a full-featured mobile-first progressive web app for managing
        the Clipper Explorer 50 PH <strong>Amaroo</strong> (BZI70Q · MMSI 503106120), based at Aquatic
        Paradise, Brisbane. All data is stored in Supabase and syncs across devices in real time.
      </P>

      <H3>Navigation</H3>
      <P>
        On desktop, use the teal sidebar on the left. On mobile, a five-tab bar at the bottom gives
        quick access to Dashboard, Passage Planner, Maintenance, Fuel Log, and Weather. All other tabs
        are reachable via the sidebar (swipe it in, or use a keyboard / stylus).
      </P>

      <H3>Refresh</H3>
      <P>
        The <strong>Refresh</strong> button in the top-right header reloads all data from Supabase. Most
        tabs also refresh automatically when you save a record. Use Refresh if you suspect data is stale
        after editing on another device.
      </P>

      <Tip>
        The app works offline for reading data. Writes (saves, deletes) will fail without a connection
        and show an error — re-try once connectivity is restored.
      </Tip>

      <H3>Vessel quick-facts</H3>
      <Table
        headers={['Item', 'Value']}
        rows={[
          ['Call sign', 'BZI70Q'],
          ['MMSI', '503106120'],
          ['Home port', 'Aquatic Paradise, Brisbane'],
          ['Engines', 'Twin Cummins QSB 6.7 480HP'],
          ['Total fuel capacity', '2,950 L (two tanks)'],
          ['Default fuel rate', '35 L/nm · ~60 L/hr at cruise'],
          ['Reserve threshold', '295 L (10% of capacity)'],
          ['Cruise speed', '12 knots'],
        ]}
      />
    </>
  )
}

function DashboardGuide() {
  return (
    <>
      <H2>Dashboard</H2>
      <P>
        The Dashboard is your at-a-glance status page. It pulls together the most critical numbers from
        every other module and displays live weather for Aquatic Paradise.
      </P>

      <H3>Status cards</H3>
      <P>
        Four summary cards appear at the top: latest engine hours (port / starboard average),
        maintenance items due soon or overdue, last fuel fill, and a live Moreton Bay weather snapshot.
        Cards link to their respective tabs when tapped.
      </P>

      <H3>Maintenance traffic lights</H3>
      <P>
        Each maintenance task is colour-coded: <strong className="text-red-600">red</strong> = overdue,
        <strong className="text-amber-500"> amber</strong> = due within the warning window,
        <strong className="text-green-600"> green</strong> = current. The warning window defaults to 30 days
        and can be adjusted in Settings.
      </P>

      <H3>Recent activity feed</H3>
      <P>
        The five most recent records across engine hours, fuel fills, and maintenance logs appear in
        reverse-chronological order so you can quickly confirm the last action taken.
      </P>

      <H3>Home weather</H3>
      <P>
        Wind speed / direction, wave height, and swell data for the Aquatic Paradise area are fetched
        from the Open-Meteo Marine API (free, no key required). Data refreshes automatically on load
        and is cached for 30 minutes to avoid hammering the API.
      </P>

      <H3>Checklists</H3>
      <P>
        Four built-in checklists — Pre-Departure, After Passage, Lay-Up, and Post Haul-Out — are
        available directly from the Dashboard. Tick items as you work through them; state is not
        persisted (checklists reset on reload) so they function as a live checklist, not a log.
      </P>

      <Tip>
        Run the Pre-Departure checklist on every passage start. It covers windlass isolator, anchor
        seating, hatch closure, AIS transmit, and 13 other vessel-specific checks.
      </Tip>
    </>
  )
}

function PassagePlannerGuide() {
  return (
    <>
      <H2>Passage Planner</H2>
      <P>
        The Passage Planner lets you build, import, and save routes, calculate fuel and ETA, fetch
        route weather, and export GPX files compatible with Navionics and Raymarine Axiom.
      </P>

      <H3>Build Route mode</H3>
      <Steps items={[
        'Select Build Route (active by default).',
        'Tap or click on the Leaflet map to drop numbered waypoints in sequence.',
        'Drag any marker to fine-tune its position — the route line and all calculations update immediately.',
        'Edit waypoint names inline in the Waypoints panel on the right (double-tap on mobile to focus the field).',
        'Delete individual waypoints with the × button, or tap Clear All to start over.',
      ]} />
      <Tip>
        OpenSeaMap seamarks are overlaid on the base chart. Zoom in past level 12 to see channel
        markers, hazards, and anchorages.
      </Tip>

      <H3>Import GPX mode</H3>
      <Steps items={[
        'Switch to Import GPX mode.',
        'Tap Choose GPX File and select a .gpx file from Navionics, Raymarine Axiom, or any chart plotter export.',
        'The app parses all <rtept> route points (falling back to <wpt> waypoints), plots them on the map, and fits the view to the full route.',
        'Switch back to Build Route mode to edit, add, or delete waypoints.',
      ]} />
      <Warn>
        GPX files must contain valid lat/lon attributes on each waypoint element. Files exported from
        some older chart plotters may use a non-standard schema — if import produces zero waypoints,
        open the file in a text editor and check for &lt;rtept&gt; or &lt;wpt&gt; elements.
      </Warn>

      <H3>Importing from Navionics via Android share sheet</H3>
      <Steps items={[
        'Install the Amaroo app to your Android home screen (see PWA & Mobile section).',
        'In the Navionics app, open a route and tap Share → Export GPX.',
        'Select Amaroo from the share sheet.',
        'The app opens directly on the Passage Planner tab and automatically imports the route.',
        'A toast notification confirms how many waypoints were loaded.',
      ]} />

      <H3>Saved Routes mode</H3>
      <Steps items={[
        'Build or import a route, then tap Save Route in the top-right of the mode bar.',
        'Enter a descriptive name (e.g. "Aquatic Paradise to Coomera via ICW") and tap Save.',
        'Switch to Saved Routes mode to see all stored routes with distance and waypoint count.',
        'Tap Load to restore a saved route onto the map, or the bin icon to delete it.',
      ]} />
      <Tip>
        Saved routes are stored in Supabase and available on all devices. They persist even if you clear
        browser storage.
      </Tip>

      <H3>Passage Summary (calculations panel)</H3>
      <P>
        Once two or more waypoints exist, a five-card summary appears below the map and updates in
        real time as you edit the route:
      </P>
      <Table
        headers={['Card', 'What it shows']}
        rows={[
          ['Distance', 'Total nautical miles via Haversine formula across all legs'],
          ['Fuel Required', 'L/nm rate × distance. Rate comes from lifetime average (fuel log), manual override, or 35 L/nm default'],
          ['Remaining (full)', 'Fuel left if you depart with a full 2,950 L tank. Flags red below 10% reserve (295 L)'],
          ['Est. Duration', 'Distance ÷ speed. Edit the speed field inline (default 12 kn)'],
          ['ETA', 'Departure datetime + duration. Set the datetime-local input — ETA updates instantly'],
        ]}
      />

      <H3>Fuel rate priority order</H3>
      <Table
        headers={['Priority', 'Source', 'How to set']}
        rows={[
          ['1st', 'L/nm manual override', 'Trip Details → Advanced fuel parameters → Efficiency (L/nm)'],
          ['2nd', 'L/hr manual override ÷ speed', 'Trip Details → Advanced → Burn Rate (L/hr)'],
          ['3rd', 'Lifetime average (fuel log)', 'Automatic — grows more accurate as fuel entries accumulate'],
          ['4th', '35 L/nm default', 'Used when no other data is available — conservative estimate'],
        ]}
      />

      <H3>Route Weather</H3>
      <Steps items={[
        'Add 2+ waypoints, set Departure datetime.',
        'Tap Fetch Route Weather — the app queries Open-Meteo Marine API for the midpoint of your route.',
        'Wind speed/direction, gusts, wave height/period, and swell are shown with a comfort rating.',
        'Tap Send Trip & Weather to Voyage Log → to pre-fill the voyage log with all trip and weather data.',
      ]} />

      <H3>Export GPX</H3>
      <P>
        Tap Export GPX (coral button, top right) at any time when waypoints exist. A GPX 1.1 file is
        downloaded named <code className="bg-slate-100 px-1 rounded text-xs">amaroo-route-[timestamp].gpx</code>.
        The file uses <code className="bg-slate-100 px-1 rounded text-xs">&lt;rte&gt;</code> / <code className="bg-slate-100 px-1 rounded text-xs">&lt;rtept&gt;</code> elements
        and is valid for import into Navionics, Raymarine Axiom, and GPX validators.
      </P>
    </>
  )
}

function VoyageLogGuide() {
  return (
    <>
      <H2>Voyage Log</H2>
      <P>
        Every passage should be logged here for insurance, maintenance records, and operational
        history. The form supports manual entry and can auto-fill from a completed Passage Planner
        plan.
      </P>

      <H3>Creating a new log entry</H3>
      <Steps items={[
        'Fill in Date, Departure time, Departure port, and Destination.',
        'Enter distance in nm (auto-filled if coming from Passage Planner).',
        'Log engine hours at start and end of passage — the trip log calculates the delta.',
        'Enter fuel used in litres (from tank gauge readings before and after).',
        'Record crew names, conditions, wind, waves, and swell.',
        'Add free-text notes for anything unusual — breakdowns, anchorages, bar crossings.',
        'Tap Save Voyage Log Entry.',
      ]} />

      <H3>Using Passage Planner data</H3>
      <P>
        After fetching route weather in the Passage Planner and tapping <strong>Send Trip &amp; Weather
        to Voyage Log →</strong>, the voyage log form opens pre-filled with departure port, destination,
        distance, speed, estimated duration, fuel estimate, and all weather conditions. Review and
        adjust the fields before saving.
      </P>

      <H3>Trip log hours</H3>
      <P>
        Enter the engine hours reading at the start of the trip. The form uses your most recent engine
        hours entry as a suggestion. The <em>Use Last Trip Log End</em> button carries forward the
        ending hours from your previous voyage automatically.
      </P>

      <Tip>
        Record the trip log end hours immediately after arrival, before you forget. The Maintenance
        module uses these readings to calculate hours-based service intervals.
      </Tip>

      <H3>Editing and deleting entries</H3>
      <P>
        Tap any existing voyage entry to expand it. Use the Edit button to modify the record or the
        Delete button (bin icon) to remove it permanently. Deletions cannot be undone.
      </P>

      <H3>Summary statistics</H3>
      <P>
        Below the entry list, running totals show cumulative nautical miles, total engine hours, and
        total fuel used across all logged voyages.
      </P>
    </>
  )
}

function EngineGuide() {
  return (
    <>
      <H2>Engine Hours</H2>
      <P>
        Track port and starboard Cummins QSB 6.7 engine hours here. Regular logging gives accurate
        data for hours-based maintenance intervals and resale history.
      </P>

      <H3>Logging a reading</H3>
      <Steps items={[
        'Enter today\'s date.',
        'Read both engine hour meters at the helm and enter Port and Starboard hours.',
        'Add optional notes (e.g. "after Coomera run", "post service").',
        'Tap Save.',
      ]} />

      <H3>Hour meter readings</H3>
      <P>
        The port and starboard meters on Amaroo are independently read from the Cummins Quantum
        gauges at each helm station. The DTS system may show slightly different values — use the
        individual gauge readings for logging accuracy.
      </P>

      <Tip>
        Log hours every time you fill with fuel. This ties hours directly to fuel events and makes
        lifetime consumption calculations much more accurate in the Fuel Log and Passage Planner.
      </Tip>

      <H3>Average hours</H3>
      <P>
        The dashboard and maintenance module use the average of port and starboard hours when
        calculating hours-based service due dates. If one engine has significantly more hours (e.g.
        after single-engine motoring), maintenance tasks trigger earlier — which is the correct
        conservative behaviour.
      </P>
    </>
  )
}

function MaintenanceGuide() {
  return (
    <>
      <H2>Maintenance</H2>
      <P>
        The Maintenance module manages all service tasks and service logs for Amaroo. Tasks can be
        scheduled by date, engine hours, or calendar weeks.
      </P>

      <H3>Adding a maintenance task</H3>
      <Steps items={[
        'Tap Add Task.',
        'Enter a task name (e.g. "Cummins QSB 6.7 oil and filter change — Port").',
        'Choose the interval type: Date-based, Hours-based, or Weekly.',
        'For date-based: set the due date and optional warning days (default 30).',
        'For hours-based: set the service interval in hours (e.g. 250) and the hours at last service.',
        'For weekly: set the interval in weeks and the date last done.',
        'Set category: Engine, Hull, Electrical, Safety, Rigging, or Other.',
        'Tap Save.',
      ]} />

      <H3>Recording a service</H3>
      <Steps items={[
        'Find the task in the list and tap Mark Done / Log Service.',
        'Enter the date completed, hours at service (for hours-based tasks), technician or notes.',
        'The task resets its due date / hours counter based on the completed date or hours entered.',
      ]} />

      <H3>Status colours</H3>
      <Table
        headers={['Colour', 'Meaning']}
        rows={[
          ['Red', 'Overdue — past due date or hours exceeded'],
          ['Amber', 'Due soon — within warning window (default 30 days or 25 hours)'],
          ['Green', 'Current — no action needed'],
        ]}
      />

      <H3>Key Amaroo service intervals</H3>
      <Table
        headers={['Task', 'Interval', 'Last service approx.']}
        rows={[
          ['Cummins QSB 6.7 oil + filter (each)', '250 hrs', 'Log after each service'],
          ['Raw water impeller (each)', '500 hrs or annually', 'Log after each service'],
          ['Fuel filters (primary + secondary, each)', '500 hrs', 'Log after each service'],
          ['Sea strainer inspection', 'Weekly underway', 'Each passage start'],
          ['Antifouling + anode check', 'At haul-out', 'Log with haul-out date'],
          ['Muir 3500 windlass service', 'Annually', 'Log with service date'],
          ['Rainman watermaker pickle', 'If not used >4 weeks', 'Log date pickled'],
          ['EPIRB battery + registration', 'Per manufacturer + annually', 'Log expiry date'],
          ['Life raft service', 'Per manufacturer', 'Log service date + cert'],
        ]}
      />

      <Warn>
        Hours-based tasks use the average of port and starboard engine hours. If one engine has
        significantly more hours, consider creating separate tasks per engine to track individually.
      </Warn>
    </>
  )
}

function FuelGuide() {
  return (
    <>
      <H2>Fuel Log</H2>
      <P>
        Log every fuel fill here. The data feeds the Passage Planner (lifetime consumption rate and
        recent price) and the Dashboard fuel status card.
      </P>

      <H3>Logging a fill</H3>
      <Steps items={[
        'Enter the date of the fill.',
        'Enter litres pumped.',
        'Enter location (marina name, e.g. "Coomera Marine", "Manly Boat Harbour").',
        'Enter cost per litre ($/L) — used for passage cost estimates.',
        'Enter engine hours at time of fill — this is critical for lifetime L/hr calculations.',
        'Record tank level before fill as a percentage (e.g. 35% = ~1,033 L on a 2,950 L capacity).',
        'Add notes for anything unusual (e.g. "suspect fuel — treated with biocide", "marina fuel dock closed, jerry cans used").',
        'Tap Save.',
      ]} />

      <Tip>
        Always enter engine hours at fill. Without them, the lifetime average consumption calculation
        cannot determine the hours delta between fills and will be skipped, falling back to the 35 L/nm
        default in the Passage Planner.
      </Tip>

      <H3>Tank capacity reference</H3>
      <Table
        headers={['Tank', 'Capacity', 'Notes']}
        rows={[
          ['Total (combined)', '2,950 L', 'Used for all calculations'],
          ['Reserve threshold', '295 L (10%)', 'Triggers warning in Passage Planner'],
          ['Typical full fill', '~1,000–1,500 L', 'Depends on last fill level'],
        ]}
      />

      <H3>Cost tracking</H3>
      <P>
        The most recent $/L entry is used as the default price in Passage Planner fuel cost estimates.
        Override it in the Passage Planner's Advanced fuel parameters if the current price differs.
      </P>
    </>
  )
}

function FluidsGuide() {
  return (
    <>
      <H2>Fluid Levels</H2>
      <P>
        Track engine oil, coolant, hydraulic fluid, and other service fluids. Regular checks help
        spot trends (e.g. gradual oil consumption) before they become problems.
      </P>

      <H3>Adding a check</H3>
      <Steps items={[
        'Select the fluid type from the dropdown.',
        'Enter the level (percentage or specific units depending on fluid).',
        'Note which engine or system it applies to (port / starboard / both).',
        'Add a note if topping up was required and how much was added.',
        'Tap Save.',
      ]} />

      <H3>Key fluids to track on Amaroo</H3>
      <Table
        headers={['Fluid', 'Check frequency', 'Notes']}
        rows={[
          ['Cummins engine oil (each)', 'Every departure, every 50 hrs', 'Dipstick on each QSB 6.7'],
          ['Cummins coolant (each)', 'Every departure', 'Overflow bottle level'],
          ['Mastervolt inverter/charger', 'Weekly', 'Check for faults on display'],
          ['Hydraulic steering fluid', 'Monthly', 'Ram reservoir on helm deck'],
          ['Bilge (visual check)', 'Every departure', 'Both forward and aft bilges'],
          ['Freshwater tanks', 'Weekly', 'Gauge on helm station'],
          ['Rainman watermaker oil', 'Per service schedule', 'Honda GX200 crankcase'],
        ]}
      />

      <Warn>
        Any unexpected drop in engine oil level between checks should be investigated immediately.
        The Cummins QSB 6.7 engines are not high oil consumers under normal conditions.
      </Warn>
    </>
  )
}

function SafetyGuide() {
  return (
    <>
      <H2>Safety Gear</H2>
      <P>
        Track all safety equipment with expiry dates and service records. The module flags items
        approaching or past expiry in the same red/amber/green system as Maintenance.
      </P>

      <H3>Adding a safety item</H3>
      <Steps items={[
        'Enter the item name (e.g. "EPIRB — GME MT600G", "Life raft — Revere 6-person").',
        'Set the expiry or next-service date.',
        'Add serial number, registration, or certification number in the notes field.',
        'Tap Save.',
      ]} />

      <H3>AMSA statutory requirements</H3>
      <Table
        headers={['Item', 'Requirement', 'Action required']}
        rows={[
          ['EPIRB', 'Registered with AMSA, battery in-date', 'Register at beacons.amsa.gov.au'],
          ['Life raft', 'Service per manufacturer (typically 1–3 years)', 'Send to approved service station'],
          ['Flares', 'In-date (3-year shelf life typical)', 'Replace before expiry'],
          ['Fire extinguishers', 'Annual inspection, 5-yr hydrotest', 'Service with licensed company'],
          ['PLBs', 'Registered with AMSA, battery in-date', 'Same as EPIRB registration'],
          ['Life jackets', 'Annual inspection, bladder test', 'Follow manufacturer schedule'],
          ['SOLAS grab bag', 'Check contents quarterly', 'Rotate food/water, check flares'],
        ]}
      />

      <Tip>
        AMSA EPIRB registration is free and mandatory. If the vessel name or contact details change,
        update the registration immediately at beacons.amsa.gov.au.
      </Tip>
    </>
  )
}

function ContactsGuide() {
  return (
    <>
      <H2>Contacts</H2>
      <P>
        Store all marine-relevant contacts — marinas, mechanics, chandleries, coastguard, and crew.
        Contacts are grouped by category and available offline once loaded.
      </P>

      <H3>Adding a contact</H3>
      <Steps items={[
        'Tap Add Contact.',
        'Enter name, phone, and email.',
        'Set category: Marina, Mechanic, Chandlery, Emergency, Crew, or Other.',
        'Add notes (e.g. "Coomera fuel dock — call ahead on Ch16", "after-hours mobile for Cummins service").',
        'Tap Save.',
      ]} />

      <H3>Suggested contacts to add</H3>
      <Table
        headers={['Contact', 'Category', 'Notes']}
        rows={[
          ['QLD Marine Rescue', 'Emergency', 'Ch16 VHF · 1800 641 792'],
          ['Water Police Brisbane', 'Emergency', 'Ch16 VHF · 07 3895 4400'],
          ['AMSA Search & Rescue', 'Emergency', '1800 641 792 (24hr)'],
          ['Coomera Marine Centre', 'Marina', 'Fuel · Ch16'],
          ['Manly Boat Harbour', 'Marina', 'Fuel, slipway · 07 3396 5566'],
          ['Moreton Bay Cummins dealer', 'Mechanic', 'QSB 6.7 specialist'],
          ['Whitworths Marine (Tingalpa)', 'Chandlery', 'Parts and supplies'],
        ]}
      />
    </>
  )
}

function DocumentsGuide() {
  return (
    <>
      <H2>Documents</H2>
      <P>
        Upload and store scanned copies of all vessel documents. Files are stored in Supabase Storage
        with document metadata kept in the app database.
      </P>

      <H3>Uploading a document</H3>
      <Steps items={[
        'Tap Add Document.',
        'Enter a descriptive name (e.g. "AMSA Certificate of Survey 2025").',
        'Select category: Registration, Insurance, Safety, Survey, Manual, or Other.',
        'Choose file (PDF, PNG, JPG — recommended under 10 MB).',
        'Add expiry date if applicable.',
        'Tap Save.',
      ]} />

      <H3>Documents to keep on file</H3>
      <Table
        headers={['Document', 'Category', 'Renewal']}
        rows={[
          ['Certificate of Survey (AMSA)', 'Survey', 'Per survey cycle'],
          ['Certificate of Registration', 'Registration', 'Annually'],
          ['Hull & machinery insurance', 'Insurance', 'Annually'],
          ['P&I / third party insurance', 'Insurance', 'Annually'],
          ['EPIRB registration certificate', 'Safety', 'Update on details change'],
          ['Life raft service certificate', 'Safety', 'Per service'],
          ['Cummins QSB 6.7 manuals (×2)', 'Manual', 'Permanent'],
          ['Mastervolt system manual', 'Manual', 'Permanent'],
          ['Muir 3500 windlass manual', 'Manual', 'Permanent'],
          ['Ship\'s radio licence', 'Registration', '5-year renewal with ACMA'],
          ['Operator\'s restricted radio cert.', 'Registration', 'Permanent once issued'],
        ]}
      />

      <Warn>
        Documents stored in the app are a convenience copy only. Always carry originals or certified
        copies aboard as required by AMSA and Queensland Transport.
      </Warn>
    </>
  )
}

function WeatherGuide() {
  return (
    <>
      <H2>Weather</H2>
      <P>
        The Weather tab consolidates multiple data sources into one place: embedded Windy.com maps,
        official BOM text forecasts for Queensland marine zones, and links to GRIB download services.
      </P>

      <H3>Map view (Windy)</H3>
      <P>
        The embedded Windy premium map shows wind, waves, swell, rain, and tides in animated layers.
        Use the layer selector at the bottom of the Windy panel to switch between overlays. Tap the
        full-screen icon to open Windy in a dedicated view for detailed planning.
      </P>

      <H3>BOM marine forecasts</H3>
      <P>
        Seven Queensland and northern NSW coastal locations are pre-loaded with direct BOM forecast
        fetch. Tap a location to load the current 7-day marine forecast. Data includes wind, seas,
        swell, and visibility text forecasts. Tap Refresh to update.
      </P>

      <H3>Relevant marine zones for Amaroo</H3>
      <Table
        headers={['Zone', 'BOM code', 'Coverage']}
        rows={[
          ['Moreton Bay', 'IDQ65600', 'Home waters — Aquatic Paradise, Redcliffe, Manly'],
          ['Gold Coast Offshore', 'IDQ65601', 'Seaway bar + offshore to 60 nm'],
          ['Sunshine Coast Offshore', 'IDQ65602', 'Mooloolaba bar + offshore'],
          ['Wide Bay (Hervey Bay)', 'IDQ65603', 'Fraser Island passages'],
          ['Capricorn Coast', 'IDQ65604', 'Rockhampton, Yeppoon northward'],
        ]}
      />

      <H3>Tides</H3>
      <P>
        The Tides view shows major Queensland tide stations with links to the BOM official tide
        predictions page and the Windy tide viewer. The app uses your device location (if permitted)
        to suggest the nearest station.
      </P>

      <H3>GRIB files</H3>
      <P>
        The GRIB/Download panel links to PredictWind, Passage Weather, NOAA GFS, and Open-Meteo
        for downloading GRIB2 weather model files for use in dedicated routing software (e.g.
        PredictWind Offshore, OpenCPN).
      </P>

      <Tip>
        For passages across Moreton Bay or north past the Sunshine Coast, check the Offshore forecast
        (not just the inshore Moreton Bay text). Southerly changes can build quickly once you're
        outside the bay.
      </Tip>
    </>
  )
}

function PartsGuide() {
  return (
    <>
      <H2>Parts</H2>
      <P>
        Track spare parts and consumables carried aboard and stored ashore. Helps you know what's
        on hand before a passage and identifies items to reorder.
      </P>

      <H3>Adding a part</H3>
      <Steps items={[
        'Tap Add Part.',
        'Enter part name, manufacturer part number, and quantity on hand.',
        'Set minimum quantity — the app flags items below this threshold.',
        'Set location (e.g. "Engine room — starboard shelf", "Forward bilge locker").',
        'Add supplier and approx. cost for reorder planning.',
        'Tap Save.',
      ]} />

      <H3>Recommended spare parts for Amaroo</H3>
      <Table
        headers={['Part', 'Qty min', 'Notes']}
        rows={[
          ['Cummins QSB 6.7 impeller (×2)', '1 each', 'Sherwood — check part # on each engine'],
          ['Cummins primary fuel filter', '2', 'Racor 500 series'],
          ['Cummins secondary fuel filter (×2)', '2 each', 'Fleetguard FF5327 or equiv.'],
          ['Cummins oil filter (×2)', '2 each', 'Fleetguard LF9009 or equiv.'],
          ['Engine oil 15W-40 (litres)', '10', 'Shell Rotella T4 or Cummins approved'],
          ['V-belts (set per engine)', '1 set each', 'Measure before ordering'],
          ['Thermostat (×2)', '1 each', 'QSB thermostat'],
          ['Zinc anodes (hull, shaft, trim tabs)', '2 sets', 'Replace at haul-out'],
          ['Bilge pump float switch', '2', 'Rule or equivalent'],
          ['Muir windlass shear pin', '3', 'Check Muir 3500 part #'],
          ['Zincs for trim tabs', '2 pairs', 'Bennett or Lenco pattern'],
          ['Electrical fuses (assorted)', '1 pack', 'ANL, blade, ceramic'],
        ]}
      />
    </>
  )
}

function BarCamsGuide() {
  return (
    <>
      <H2>Bar Cams</H2>
      <P>
        The Bar Cams tab provides live camera feeds and links for Queensland bar crossings. Check
        conditions before committing to an entry or exit.
      </P>

      <H3>Available cameras</H3>
      <Table
        headers={['Bar', 'Authority', 'Notes']}
        rows={[
          ['Gold Coast Seaway', 'GCWA / VMR', 'Main passage south of Brisbane'],
          ['Mooloolaba Bar', 'Sunshine Coast Council', 'Common northbound stop'],
          ['Noosa Bar', 'VMR Noosa', 'Shallow — check carefully'],
          ['Double Island Point', 'VMR Rainbow Beach', 'Entry to Wide Bay'],
          ['Hervey Bay / Urangan', 'Wide Bay Maritime', 'No bar — sheltered port'],
          ['Bundaberg (Burnett Heads)', 'Maritime Safety QLD', 'Tidal bar — timing critical'],
        ]}
      />

      <Warn>
        Bar camera feeds show present conditions only. Conditions can change rapidly. Always consult
        the current BOM forecast, contact VMR/Coast Guard on Ch16, and review tide tables before
        crossing any Queensland bar.
      </Warn>

      <H3>Gold Coast Seaway — key notes for Amaroo</H3>
      <P>
        The Seaway is the main offshore access point south of Moreton Bay. Amaroo's 1.5 m draft is
        well within limits. Key considerations:
      </P>
      <Steps items={[
        'Check the GCWA swell camera and patrol vessel report on Ch16 before entry.',
        'Cross within 2 hours of high water when possible — deeper water over the training walls.',
        'In SE swells above 1.5 m the bar can be confused even at LW+2. Use the Southport VMR camera.',
        'Monitor Ch16 and Ch22A (VMR Gold Coast) throughout the approach.',
      ]} />
    </>
  )
}

function ReportsGuide() {
  return (
    <>
      <H2>Reports</H2>
      <P>
        Generate downloadable PDF reports for insurance, marina records, or personal logs. Reports
        are generated client-side using jsPDF — no data is sent to a third-party service.
      </P>

      <H3>Available reports</H3>
      <Table
        headers={['Report', 'Contents']}
        rows={[
          ['Vessel Summary', 'Engine hours, maintenance status, recent fuel fills, fluid levels'],
          ['Maintenance Report', 'All tasks with status, last service date, next due date/hours'],
          ['Voyage History', 'All voyage log entries with distance, crew, conditions, fuel'],
          ['Fuel Analysis', 'Fill history, cost per litre trends, consumption averages'],
          ['Safety Gear Status', 'All items with expiry dates, flagging overdue/near-expiry'],
        ]}
      />

      <H3>Generating a report</H3>
      <Steps items={[
        'Select the report type from the dropdown.',
        'Set date range if applicable.',
        'Tap Generate PDF.',
        'The PDF downloads automatically to your device Downloads folder.',
      ]} />

      <Tip>
        Generate the Vessel Summary report before any haul-out or insurance renewal. It provides a
        complete snapshot of the vessel's maintenance and operational status.
      </Tip>
    </>
  )
}

function SettingsGuide() {
  return (
    <>
      <H2>Settings</H2>
      <P>
        Configure vessel-specific parameters that are used across all modules.
      </P>

      <H3>Key settings</H3>
      <Table
        headers={['Setting', 'Used by', 'Default']}
        rows={[
          ['Cruise speed (knots)', 'Passage Planner fuel rate calculation', '12'],
          ['Maintenance warning days', 'Dashboard + Maintenance traffic lights', '30'],
          ['Fuel tank capacity (L)', 'Passage Planner reserve calculation', '2,950'],
          ['Vessel name / call sign', 'Reports header', 'Amaroo / BZI70Q'],
          ['MMSI', 'Reports header', '503106120'],
        ]}
      />

      <H3>Data backup and restore</H3>
      <Steps items={[
        'In Settings, tap Export Backup to download a full JSON snapshot of all Supabase data.',
        'Store the backup in cloud storage (Google Drive, iCloud) or email it to yourself.',
        'To restore, tap Import Backup and select the JSON file.',
        'Restore overwrites all current data — use with caution.',
      ]} />

      <Warn>
        Restore is destructive. It deletes all existing records before importing the backup file.
        Always export a fresh backup immediately before running a restore.
      </Warn>
    </>
  )
}

function MobileGuide() {
  return (
    <>
      <H2>PWA &amp; Mobile</H2>
      <P>
        Amaroo is a Progressive Web App (PWA). Installing it to your Android or iOS home screen gives
        a full-screen native-app experience, offline caching, and — on Android — the ability to
        receive GPX files directly from Navionics via the share sheet.
      </P>

      <H3>Installing on Android (Chrome)</H3>
      <Steps items={[
        'Open the app in Chrome on your Android device.',
        'Tap the three-dot menu (⋮) in the top right.',
        'Tap "Add to Home screen" or "Install app".',
        'Confirm the installation prompt.',
        'The Amaroo icon now appears on your home screen and launches full-screen without browser chrome.',
      ]} />
      <Tip>
        The Web Share Target (receiving GPX from Navionics) only activates after the PWA is
        installed to the home screen. It does not work from the browser tab.
      </Tip>

      <H3>Installing on iPhone / iPad (Safari)</H3>
      <Steps items={[
        'Open the app in Safari.',
        'Tap the Share button (box with arrow) at the bottom of the screen.',
        'Scroll down and tap "Add to Home Screen".',
        'Rename if desired and tap Add.',
      ]} />
      <Warn>
        iOS does not support the Web Share Target API. You cannot receive GPX files from Navionics
        on iPhone/iPad — use the Import GPX button in the Passage Planner instead.
      </Warn>

      <H3>Receiving a route from Navionics (Android only)</H3>
      <Steps items={[
        'Ensure Amaroo is installed to the Android home screen (see above).',
        'In the Navionics app, open your planned route.',
        'Tap the export / share icon and choose "Export GPX".',
        'In the Android share sheet, select Amaroo.',
        'Amaroo opens automatically on the Passage Planner tab and imports the route.',
        'A notification bar confirms the number of waypoints loaded.',
      ]} />

      <H3>Offline use</H3>
      <P>
        The app shell (HTML, CSS, JavaScript) and all previously loaded Supabase data are cached by
        the service worker. Map tiles from OpenStreetMap and OpenSeaMap are cached on demand (up to
        500 tiles). When offline:
      </P>
      <Table
        headers={['Feature', 'Offline available?']}
        rows={[
          ['View all logged data (maintenance, fuel, voyages, etc.)', 'Yes — cached'],
          ['Passage Planner — use existing waypoints + calculations', 'Yes'],
          ['Map — tiles already cached in prior sessions', 'Yes (cached area only)'],
          ['Map — new areas not previously viewed', 'No — requires connection'],
          ['Save new records to Supabase', 'No — requires connection'],
          ['Fetch route weather', 'No — requires connection'],
          ['BOM forecasts', 'No — requires connection'],
        ]}
      />

      <H3>Updating the app</H3>
      <P>
        The service worker automatically checks for app updates in the background. When a new version
        is deployed, it downloads silently and activates on the next app reload. No manual update
        action is required.
      </P>
    </>
  )
}

const CONTENT = {
  start:       <GettingStarted />,
  dashboard:   <DashboardGuide />,
  passage:     <PassagePlannerGuide />,
  voyagelog:   <VoyageLogGuide />,
  engine:      <EngineGuide />,
  maintenance: <MaintenanceGuide />,
  fuel:        <FuelGuide />,
  fluids:      <FluidsGuide />,
  safety:      <SafetyGuide />,
  contacts:    <ContactsGuide />,
  documents:   <DocumentsGuide />,
  weather:     <WeatherGuide />,
  parts:       <PartsGuide />,
  barcams:     <BarCamsGuide />,
  reports:     <ReportsGuide />,
  settings:    <SettingsGuide />,
  mobile:      <MobileGuide />,
}

export default function UserGuide() {
  const [active, setActive] = useState('start')

  return (
    <div className="flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-120px)]">
      {/* Section nav — horizontal scroll on mobile, sticky sidebar on desktop */}
      <nav className="lg:w-56 lg:flex-shrink-0 lg:sticky lg:top-20 lg:self-start">
        {/* Mobile: horizontal scroll strip */}
        <div className="lg:hidden flex gap-1 overflow-x-auto pb-2 px-0.5 mb-3">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  active === s.id
                    ? 'bg-[#0A4A52] text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={13} />
                {s.label}
              </button>
            )
          })}
        </div>
        {/* Desktop: vertical list */}
        <div className="hidden lg:flex flex-col bg-white rounded-xl shadow p-2 mr-4 max-h-[calc(100vh-140px)] overflow-y-auto">
          <div className="px-2 py-1 mb-1">
            <div className="flex items-center gap-2 text-[#0A4A52]">
              <BookOpen size={16} />
              <span className="font-serif font-semibold text-sm">User Guide</span>
            </div>
          </div>
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={`flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm transition-colors ${
                  active === s.id
                    ? 'bg-[#0A4A52] text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} className="flex-shrink-0" />
                {s.label}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Content area */}
      <div className="flex-1 min-w-0">
        <div className="bg-white rounded-xl shadow p-6 max-w-3xl">
          {CONTENT[active]}
          {/* Prev / Next navigation */}
          <div className="flex justify-between mt-8 pt-4 border-t border-slate-100">
            {(() => {
              const idx = SECTIONS.findIndex((s) => s.id === active)
              const prev = SECTIONS[idx - 1]
              const next = SECTIONS[idx + 1]
              return (
                <>
                  {prev ? (
                    <button
                      type="button"
                      onClick={() => setActive(prev.id)}
                      className="flex items-center gap-1 text-sm text-[#0A4A52] hover:underline"
                    >
                      ← {prev.label}
                    </button>
                  ) : <span />}
                  {next ? (
                    <button
                      type="button"
                      onClick={() => setActive(next.id)}
                      className="flex items-center gap-1 text-sm text-[#0A4A52] hover:underline"
                    >
                      {next.label} →
                    </button>
                  ) : <span />}
                </>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
