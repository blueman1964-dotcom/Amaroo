import { subDays, format } from 'date-fns'

export const VESSEL_DEFAULTS = {
  vesselName: 'Amaroo',
  registration: 'BZI70Q',
  registrationExpiry: '2026-05-28',
  hullSerial: 'AUCCR50E02H518',
  mmsi: '503106120',
  builder: 'Clipper Motor Yachts',
  design: 'Clipper Explorer 50 PH',
  designer: 'Mark Williamson',
  yearBuilt: '2015',
  loa: '15.24m',
  beam: '4.67m',
  draft: '1.65m',
  displacement: '25 tonnes (loaded)',
  maxSpeed: '20 knots',
  homePort: 'Aquatic Paradise, Brisbane QLD',
  ownerName: 'Stuart James McDonald',
  insuranceCompany: 'Anchorage Marine Underwriting Agency (QBE)',
  insurancePolicyNo: 'AM024374',
  insuranceExpiry: '2026-05-19',
  insuranceBrokerPhone: '(02) 9959 4422',
  insuranceEmail: 'enquiry@anchoragemarine.com.au',
  cruisingArea: 'QLD Waters South of Noosa',
  cruiseSpeed: 12,
  fuelTankCapacityLitres: 2950,
  estimatedBurnRateLitresPerHour: 21,
  fuelTankConfig: {
    port: { name: 'Port Tank', capacityLitres: 1475, active: true, isBladder: false },
    starboard: {
      name: 'Starboard Tank',
      capacityLitres: 1475,
      active: true,
      isBladder: false,
    },
  },
  fuelLevels: { port: null, starboard: null },
  activeTanks: ['port', 'starboard'],
  maintenanceWarningDays: 30,
  safetyGearWarningDays: 90,
  lastHauloutDate: '',
  hauloutIntervalMonths: 12,
  darkMode: false,
  largeMode: false,

  // Snake-case compatibility fields used elsewhere in the app.
  vessel_name: 'Amaroo',
  registration_number: 'BZI70Q',
  registration_expiry: '2026-05-28',
  hull_serial_number: 'AUCCR50E02H518',
  engine_number: '73733929',
  ais_transceiver: 'Raymarine AIS700 - S/N E704760',
  vhf_fixed: 'Raymarine R70370 - S/N 0750574',
  vhf_handheld: 'Recent RS-38M - S/N 2019FP11717',
  year_built: '2015',
  hull_construction: 'GRP (Fibreglass)',
  max_speed: '20 knots',
  home_port: 'Aquatic Paradise, Brisbane QLD',
  owner: 'Stuart James McDonald',
  owner_address: '18 Zephyr Court, Birkdale QLD 4159',
  owner_mobile: '0488 190 174',
  owner_email: 'stuart.mcdonald@bosun.net.au',
  insurance_company: 'Anchorage Marine Underwriting Agency (QBE)',
  insurance_policy: 'AM024374',
  insurance_expiry: '2026-05-19',
  insurance_broker_phone: '(02) 9959 4422',
  insurance_email: 'enquiry@anchoragemarine.com.au',
  cruising_area: 'QLD Waters South of Noosa',
  estimated_burn_rate_litres_per_hour: 21,
  cruise_speed_knots: 12,
  port_tank_capacity: 1475,
  stbd_tank_capacity: 1475,
  trip_log_baseline_nm: 0,
  maintenance_warning_days: 30,
  safety_warning_days: 90,
  insurance_registration_warning_days: 60,
  currency: 'AUD',
  date_format: 'DD/MM/YYYY',
  dark_mode: false,
  sunlight_mode: false,
}

const maintenanceRows = [
  ['Engine oil & filter change', 'Both Cummins', 250, 6],
  ['Primary fuel filter (Racor)', 'Both Cummins', 250, 6],
  ['Secondary fuel filter', 'Both Cummins', 250, 6],
  ['Air filter inspection', 'Both Cummins', 250, 6],
  ['Coolant concentration test', 'Both Cummins', 250, 6],
  ['Raw water impeller replacement', 'Both Cummins', 500, 12],
  ['Drive belt inspection & replacement', 'Both Cummins', 500, 12],
  ['Heat exchanger inspection', 'Both Cummins', 500, 12],
  ['Sacrificial anode inspection', 'Both Cummins', 500, 12],
  ['Valve clearance check', 'Both Cummins', 500, 12],
  ['Injector inspection', 'Both Cummins', 500, 12],
  ['Turbocharger inspection', 'Both Cummins', 500, 12],
  ['Coolant flush & full replacement', 'Both Cummins', 1000, 24],
  ['Major engine service (Cummins authorised)', 'Both Cummins', 1000, 36],
  ['Fuel injector service', 'Both Cummins', 1000, null],
  ['Coolant hose replacement', 'Both Cummins', 2000, 60],
  ['Heat exchanger descale or replacement', 'Both Cummins', 2000, null],
  ['Engine mount inspection', 'Both Cummins', 500, 12],
  ['DTS system check', 'Cummins DTS', 500, 12],
  ['Oil & filter change', 'Onan Generator', 150, 12],
  ['Raw water impeller', 'Onan Generator', 150, 12],
  ['Fuel filter', 'Onan Generator', 150, 6],
  ['Air filter', 'Onan Generator', 150, 6],
  ['Valve clearance', 'Onan Generator', 1000, null],
  ['PCB / control board check', 'Onan Generator', 500, 12],
  ['HP pump oil check', 'Rainman AC250', 250, 6],
  ['HP pump seal inspection', 'Rainman AC250', 500, 12],
  ['Pre-filter replacement (20 micron)', 'Rainman AC250', null, 1],
  ['Pre-filter replacement (5 micron)', 'Rainman AC250', null, 1],
  ['Membrane clean-in-place', 'Rainman AC250', 500, null],
  ['RO membrane replacement', 'Rainman AC250', 1000, 48],
  ['Hydraulic oil change', 'Wesmar Stabilisers', 4000, 36],
  ['Lower shaft seal replacement', 'Wesmar Stabilisers', 4000, 36],
  ['Fin inspection and antifouling', 'Wesmar Stabilisers', null, 12],
  ['Thruster bearing grease', 'Vetus Bow Thruster', null, 12],
  ['Thruster antifouling in tunnel', 'Vetus Bow Thruster', null, 12],
  ['Windlass gearbox oil', 'Muir 3500', 1000, 24],
  ['Windlass service', 'Muir 3500', 1000, 24],
  ['Trim tab service', 'Bennett', 500, 12],
  ['A/C raw water impeller', 'Cruise Air', 500, 12],
  ['A/C filter clean', 'Cruise Air', null, 1],
  ['A/C condensate drain check', 'Cruise Air', null, 1],
  ['Seastar steering fluid check', 'Seastar', null, 6],
  ['Full electrical audit', 'All electrical', 500, 12],
  ['Mastervolt inverter service', 'Mastervolt 3000', 500, 12],
  ['Outboard service - Yamaha 15HP', 'Tender outboard', 100, 12],
  ['Outboard impeller', 'Tender outboard', 100, 12],
  ['Zodiac tender inspection', 'Tender', null, 12],
  ['Antifouling', 'Hull', null, 12],
  ['Shaft seal inspection', 'Shaft drive', null, 12],
  ['Propeller inspection', 'Both props', null, 12],
  ['Anode replacement', 'All anodes', null, 12],
  ['Raymarine autopilot service', 'Raymarine', 500, 12],
  ['Starlink firmware check', 'Starlink', null, 6],
  ['Fuel tank inspection', 'Both tanks', null, 60],
  ['Fuel polishing', 'Both tanks', null, 24],
]

export const SEED_MAINTENANCE_TASKS = maintenanceRows.map(([task, system, hours, months]) => ({
  task,
  system,
  priority: 'medium',
  status: 'active',
  due_hours: hours,
  hours_interval: hours,
  calendar_months: months,
  last_completed_date: null,
  last_completed_hours: null,
  job_type: 'scheduled',
  due_date: null,
}))

export const SEED_SAFETY_ITEMS = [
  {
    category: 'Life Saving',
    name: 'Life Raft',
    make_model:
      'Viking RescYou Ocean ISO 9650-1 - 4 person - Compact Container - <24hr Pack',
    serial_number: '13056442',
    purchase_date: '2025-05-21',
    expiry_date: '2028-06-01',
    location: 'Confirm location on vessel - Viking Rail Mounted Cradle fitted',
    notes:
      'Serviced 01/06/2025 by MarineSafe Australia. Next service 01/06/2028. Certificate No. 41310-A. Mfr date 08/2023.',
  },
  {
    category: 'Life Saving',
    name: 'Life Jacket 1',
    make_model: 'Spinlock Lite Auto 170N - with AIS, PLB, and ACR Hemi light',
    serial_number: '091706079',
    purchase_date: '2025-05-30',
    expiry_date: '2027-05-01',
    location: 'Confirm stowage location',
    notes:
      'Inspected 30/05/2025 by MarineSafe Australia. Certificate No. 41310. Next service May 2027. AIS fitted: 10/32. PLB fitted: 8/32. Auto inflation. Light fitted.',
  },
  {
    category: 'Life Saving',
    name: 'Life Jacket 2',
    make_model: 'Spinlock Lite Auto 170N - with AIS, PLB, and ACR Hemi light',
    serial_number: '091706098',
    purchase_date: '2025-05-30',
    expiry_date: '2027-05-01',
    location: 'Confirm stowage location',
    notes:
      'Inspected 30/05/2025 by MarineSafe Australia. Certificate No. 41310. Next service May 2027. AIS fitted: 10/32. PLB fitted: 8/32. Auto inflation. Light fitted.',
  },
  {
    category: 'Life Saving',
    name: 'MOB Throwing Line',
    make_model: 'Lalizas Life Link MOB System',
    serial_number: '',
    purchase_date: '2025-05-21',
    expiry_date: '',
    location: 'Confirm cockpit location',
    notes: 'Purchased May 2025 from MarineSafe Australia. Inspect annually.',
  },
  {
    category: 'PLB',
    name: 'PLB 1',
    make_model: 'Ocean Signal RescueME PLB1',
    serial_number: '0140203999Z',
    purchase_date: '2025-05-21',
    expiry_date: '2032-08-01',
    location: 'Confirm who carries it',
    notes:
      'HEX ID: 3EEEC799C6FFBFF. Battery expiry 08/2032. Register with AMSA at beacons.amsa.gov.au. Purchased MarineSafe Australia Invoice MSA41310.',
  },
  {
    category: 'PLB',
    name: 'PLB 2',
    make_model: 'Ocean Signal RescueME PLB1',
    serial_number: '0140203523Z',
    purchase_date: '2025-05-21',
    expiry_date: '2032-08-01',
    location: 'Confirm who carries it',
    notes:
      'HEX ID: 3EEEC79B86FFBFF. Battery expiry 08/2032. Register with AMSA at beacons.amsa.gov.au. Purchased MarineSafe Australia Invoice MSA41310.',
  },
  {
    category: 'AIS MOB Beacon',
    name: 'AIS MOB Beacon 1',
    make_model: 'Ocean Signal RescueME MOB1 AIS Beacon',
    serial_number: '01704H8156Z',
    purchase_date: '2025-05-21',
    expiry_date: '2032-10-01',
    location: 'Confirm attachment point',
    notes: 'Battery expiry 10/2032. Purchased MarineSafe Australia Invoice MSA41310.',
  },
  {
    category: 'AIS MOB Beacon',
    name: 'AIS MOB Beacon 2',
    make_model: 'Ocean Signal RescueME MOB1 AIS Beacon',
    serial_number: '01704H8159Z',
    purchase_date: '2025-05-21',
    expiry_date: '2032-10-01',
    location: 'Confirm attachment point',
    notes: 'Battery expiry 10/2032. Purchased MarineSafe Australia Invoice MSA41310.',
  },
  {
    category: 'Flares',
    name: 'Parachute Rocket Flares',
    make_model: 'P/Wessex Parachute Rocket MK8A - Qty 2',
    serial_number: '',
    purchase_date: '2025-05-21',
    expiry_date: '2028-05-01',
    location: 'Confirm flare stowage location',
    notes:
      'Purchased May 2025 from MarineSafe Australia. 3 years from manufacture date printed on casing. Check casing for exact manufacture date.',
  },
  {
    category: 'Flares',
    name: 'Red Handflares',
    make_model: 'P/Wessex Red Handflare MK8 SOLAS - Qty 2',
    serial_number: '',
    purchase_date: '2025-05-21',
    expiry_date: '2028-05-01',
    location: 'Confirm flare stowage location',
    notes:
      'Purchased May 2025 from MarineSafe Australia. 3 years from manufacture date printed on casing.',
  },
  {
    category: 'Flares',
    name: 'Orange Smoke Flares',
    make_model: 'P/Wessex Aurora Orange Hand Smoke MK2 - Qty 2',
    serial_number: '',
    purchase_date: '2025-05-21',
    expiry_date: '2028-05-01',
    location: 'Confirm flare stowage location',
    notes:
      'Purchased May 2025 from MarineSafe Australia. 3 years from manufacture date printed on casing.',
  },
  {
    category: 'Life Saving',
    name: 'Lifejacket Lights',
    make_model: 'ACR Hemi Lifejacket Light - Qty 2',
    serial_number: '',
    purchase_date: '2025-05-21',
    expiry_date: '',
    location: 'Fitted to lifejackets',
    notes: 'Purchased May 2025. Check annually. One per lifejacket.',
  },
  {
    category: 'EPIRB',
    name: 'EPIRB',
    make_model: 'To be confirmed - register with AMSA at beacons.amsa.gov.au',
    serial_number: 'TO BE CONFIRMED',
    purchase_date: '',
    expiry_date: 'TO BE CONFIRMED',
    location: 'TO BE CONFIRMED',
    notes:
      'EPIRB must be registered with AMSA. Confirm make, model, serial number, battery expiry, and AMSA registration number. Registration is free at beacons.amsa.gov.au.',
  },
  {
    category: 'Fire Safety',
    name: 'Fire Extinguishers',
    make_model: 'TO BE CONFIRMED - qty, type, and size',
    serial_number: '',
    purchase_date: 'TO BE CONFIRMED',
    expiry_date: 'TO BE CONFIRMED',
    location: 'Walk vessel and list all locations',
    notes: 'Annual service tag required. List each extinguisher location separately when confirmed.',
  },
  {
    category: 'Fire Safety',
    name: 'Fire Blanket',
    make_model: 'TO BE CONFIRMED',
    serial_number: '',
    purchase_date: 'TO BE CONFIRMED',
    expiry_date: '',
    location: 'Galley - confirm exact location',
    notes: 'Replace immediately if used.',
  },
  {
    category: 'First Aid',
    name: 'First Aid Kit',
    make_model: 'TO BE CONFIRMED',
    serial_number: '',
    purchase_date: 'TO BE CONFIRMED',
    expiry_date: 'TO BE CONFIRMED',
    location: 'TO BE CONFIRMED',
    notes: 'Check all medication expiry dates annually. Restock any used items.',
  },
  {
    category: 'Radio',
    name: 'VHF Radio - Fixed',
    make_model: 'Raymarine R70370',
    serial_number: '0750574',
    purchase_date: '',
    expiry_date: '',
    location: 'Helm station',
    notes:
      'MMSI: 503106120. DSC capable. ACMA licence required - confirm licence currency. Registered on AMSA 89 form.',
  },
  {
    category: 'Radio',
    name: 'VHF Radio - Handheld',
    make_model: 'Recent RS-38M',
    serial_number: '2019FP11717',
    purchase_date: '',
    expiry_date: '',
    location: 'TO BE CONFIRMED',
    notes: 'MMSI registered via AMSA 89 form. Check battery condition annually.',
  },
  {
    category: 'Radio',
    name: 'AIS Transceiver',
    make_model: 'Raymarine E70476 AIS700',
    serial_number: 'E704760',
    purchase_date: '',
    expiry_date: '',
    location: 'TO BE CONFIRMED',
    notes:
      'MMSI: 503106120. Registered with AMSA. Confirm MMSI displays correctly on own vessel overlay in MFD.',
  },
  {
    category: 'Registration',
    name: 'Queensland Vessel Registration',
    make_model: 'BZI70Q - Clipper Explorer 50 - Amaroo',
    serial_number: 'AUCCR50E02H518',
    purchase_date: '2025-05-29',
    expiry_date: '2026-05-28',
    location: 'Keep original aboard',
    notes:
      'Queensland Registration BZI70Q. Hull serial AUCCR50E02H518. Engine no 73733929. Renewal due 28/05/2026. Renew early - allow 2 weeks. Fee paid 29/05/2025: $728.85.',
  },
  {
    category: 'Insurance',
    name: 'Marine Hull Insurance',
    make_model: 'Anchorage Marine / QBE - Policy AM024374',
    serial_number: 'AM024374',
    purchase_date: '2026-03-05',
    expiry_date: '2026-05-19',
    location: 'Keep certificate aboard',
    notes:
      'Insured: Stuart James McDonald. Insurer: Anchorage Marine (QBE). Third party liability $20,000,000. Covers QLD waters south of Noosa. Phone: (02) 9959 4422. Email: enquiry@anchoragemarine.com.au. Renew before 19/05/2026.',
  },
]

export const SEED_CONTACTS = [
  { category: 'Emergency', name: 'AMSA Maritime Emergency', phone: '1800 641 792', email: '', website: 'amsa.gov.au', notes: 'International distress: VHF Channel 16', is_favourite: true },
  { category: 'Emergency', name: 'Marine Rescue QLD', phone: '1300 369 003', email: '', website: 'mrq.qld.gov.au', notes: 'VHF Channel 16. VMR rescue coordination for QLD coastal waters.', is_favourite: true },
  { category: 'Emergency', name: 'RACQ BoatSafe', phone: '1800 500 568', email: '', website: 'racq.com.au', notes: 'Towing and emergency assistance', is_favourite: false },
  { category: 'Emergency', name: 'Bureau of Meteorology Marine', phone: '1300 360 427', email: '', website: 'bom.gov.au/marine', notes: 'Marine weather forecasts and warnings', is_favourite: false },
  { category: 'Emergency', name: 'Queensland Water Police', phone: '13 14 44', email: '', website: '', notes: 'QLD Police maritime emergency', is_favourite: false },
  { category: 'Engine', name: 'Cummins South Pacific (National)', phone: '1300 286 647', email: '', website: 'cummins.com.au', notes: 'National Cummins dealer support - QSB 6.7 480HP engines', is_favourite: false },
  { category: 'Engine', name: 'Cummins Brisbane', phone: '(07) 3212 6900', email: '', website: 'cummins.com.au', notes: 'Nearest Cummins dealer. Also handles Onan generators (Cummins product). Primary contact for engine and generator service.', is_favourite: true },
  { category: 'Engine', name: 'Cummins Townsville', phone: '(07) 4779 5433', email: '', website: 'cummins.com.au', notes: 'Cummins service north QLD', is_favourite: false },
  { category: 'Engine', name: 'Cummins Cairns', phone: '(07) 4035 2399', email: '', website: 'cummins.com.au', notes: 'Cummins service far north QLD', is_favourite: false },
  { category: 'Watermaker', name: 'Rainman Water Australia', phone: '1300 737 638', email: '', website: 'rainmanwater.com.au', notes: 'Rainman AC250 manufacturer and service. Call for filter supplies, membrane service, and technician referral.', is_favourite: true },
  { category: 'Stabilisers', name: 'Wesmar USA (Head Office)', phone: '+1 206 763 8361', email: '', website: 'wesmar.com', notes: 'Wesmar hydraulic stabilisers. Contact for QLD service technician referral and parts.', is_favourite: false },
  { category: 'Thruster', name: 'Vetus Australia (Plastimo)', phone: '(02) 9979 5004', email: '', website: 'vetus.com', notes: 'Vetus electric bow thruster distributor Australia.', is_favourite: false },
  { category: 'Anchor & Windlass', name: 'Muir Engineering Tasmania', phone: '(03) 6229 0600', email: '', website: 'muir.com.au', notes: 'Muir 3500 windlass manufacturer. Parts and technical support.', is_favourite: false },
  { category: 'Anchor & Windlass', name: 'Seatech Marine (Gold Coast)', phone: '(07) 5580 1883', email: '', website: '', notes: 'Muir dealer - Gold Coast. Closest to Brisbane for parts and service.', is_favourite: false },
  { category: 'Electronics', name: 'Raymarine Australia', phone: '(02) 9525 3799', email: '', website: 'raymarine.com', notes: 'Raymarine MFD, AIS700, autopilot, VHF, radar. Ask for nearest QLD authorised service dealer.', is_favourite: false },
  { category: 'Electrical', name: 'Mastervolt Australia', phone: '(02) 9999 5555', email: '', website: 'mastervolt.com.au', notes: 'Mastervolt 3000 inverter/charger. Service and programming support.', is_favourite: false },
  { category: 'Air Conditioning', name: 'Dometic Marine (Cruise Air)', phone: '1300 426 337', email: '', website: 'dometic.com/en-au', notes: 'Cruise Air marine A/C. Dometic is the parent company. QLD technician referral available.', is_favourite: false },
  { category: 'Trim Tabs', name: 'Bennett Marine USA', phone: '+1 954 427 1400', email: '', website: 'bennettmarine.com', notes: 'Bennett trim tabs manufacturer. Find Australian distributor via website.', is_favourite: false },
  { category: 'Tender', name: 'Yamaha Marine Australia', phone: '1300 762 624', email: '', website: 'yamaha-motor.com.au', notes: 'Yamaha 15HP 4-stroke outboard on Zodiac 3.0m tender. Find nearest dealer to Aquatic Paradise.', is_favourite: false },
  { category: 'Safety Equipment', name: 'MarineSafe Australia', phone: '(07) 3808 1988', email: 'sales@marinesafe.com.au', website: 'marinesafe.com.au', notes: '21 Rowland Street, Slacks Creek QLD 4127. Supplied life raft, lifejackets, PLBs, flares in May 2025. Invoice MSA41310. Annual safety gear servicing.', is_favourite: true },
  { category: 'Insurance', name: 'Anchorage Marine (QBE)', phone: '(02) 9959 4422', email: 'enquiry@anchoragemarine.com.au', website: 'anchoragemarine.com.au', notes: 'Policy AM024374. Insurer for Amaroo. Claims and enquiries. Suite 401, 66 Berry Street, North Sydney.', is_favourite: true },
  { category: 'Vessel Builder', name: 'Clipper Motor Yachts', phone: '', email: '', website: 'clippermotoryachts.com', notes: 'Builder of Amaroo - Clipper Explorer 50 PH. Designer: Mark Williamson. Built 2015.', is_favourite: false },
  { category: 'Registration', name: 'TMR Queensland (Registration)', phone: '13 23 80', email: '', website: 'tmr.qld.gov.au', notes: 'Queensland vessel registration renewal. BZI70Q expires 28/05/2026. Renew online at tmr.qld.gov.au.', is_favourite: false },
  { category: 'EPIRB & Beacons', name: 'AMSA Beacon Registration', phone: '1800 406 406', email: 'ausbeacon@amsa.gov.au', website: 'beacons.amsa.gov.au', notes: 'Register PLBs, EPIRB, and MMSI. Current MMSI: 503106120. PLB HEX IDs: 3EEEC799C6FFBFF and 3EEEC79B86FFBFF. Free registration.', is_favourite: false },
]

export const SEED_PARTS = [
  { name: 'Raw water impeller - Port Cummins QSB 6.7', category: 'Engine', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - port shelf', part_number: 'TBC - confirm with Cummins Brisbane (07) 3212 6900', supplier: 'Cummins Brisbane', notes: 'Critical spare. Replace every 500hrs. Count vanes on removal, check housing for vane fragments.' },
  { name: 'Raw water impeller - Stbd Cummins QSB 6.7', category: 'Engine', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - stbd shelf', part_number: 'TBC - confirm with Cummins Brisbane', supplier: 'Cummins Brisbane', notes: 'Critical spare. Replace every 500hrs.' },
  { name: 'Engine oil - Cummins Premium Blue 15W-40 API CK-4', category: 'Engine', quantity: 20, min_quantity: 10, unit: 'L', location: 'Engine room - oil locker', part_number: 'Cummins genuine or equivalent API CK-4', supplier: 'Cummins Brisbane / Repco', notes: 'Approximately 17L per engine per oil change. Keep minimum 1 full change on board.' },
  { name: 'Primary Racor fuel filter - Port Cummins', category: 'Engine', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - filter shelf', part_number: 'TBC - confirm with Cummins Brisbane', supplier: 'Cummins Brisbane', notes: 'Replace every 250hrs or 6 months. Replace primary and secondary together.' },
  { name: 'Primary Racor fuel filter - Stbd Cummins', category: 'Engine', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - filter shelf', part_number: 'TBC - confirm with Cummins Brisbane', supplier: 'Cummins Brisbane', notes: 'Replace every 250hrs or 6 months.' },
  { name: 'Secondary fuel filter - each Cummins', category: 'Engine', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - filter shelf', part_number: 'TBC - confirm with Cummins Brisbane', supplier: 'Cummins Brisbane', notes: 'Replace at same time as primary filter.' },
  { name: 'Fleetguard ES Compleat OAT coolant concentrate', category: 'Engine', quantity: 5, min_quantity: 2, unit: 'L', location: 'Engine room - chemical shelf', part_number: 'Fleetguard CC2825 or equivalent OAT', supplier: 'Cummins Brisbane / Repco', notes: 'Mix 50/50 with distilled water. Do not use standard green coolant.' },
  { name: 'Drive belts - Port Cummins QSB 6.7 (set)', category: 'Engine', quantity: 1, min_quantity: 1, unit: 'set', location: 'Engine room - spares box', part_number: 'TBC - measure installed belts on vessel', supplier: 'Cummins Brisbane', notes: 'Replace every 500hrs. Confirm all belt sizes from engine.' },
  { name: 'Drive belts - Stbd Cummins QSB 6.7 (set)', category: 'Engine', quantity: 1, min_quantity: 1, unit: 'set', location: 'Engine room - spares box', part_number: 'TBC - measure installed belts on vessel', supplier: 'Cummins Brisbane', notes: 'Replace every 500hrs.' },
  { name: 'Raw water impeller - Onan generator', category: 'Generator', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - generator shelf', part_number: 'TBC - confirm with Cummins Brisbane - provide Onan model number', supplier: 'Cummins Brisbane (07) 3212 6900', notes: 'Critical spare. Replace every 150hrs. Most common Onan failure after PCB.' },
  { name: 'Oil filter - Onan generator', category: 'Generator', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - generator shelf', part_number: 'TBC - confirm with Cummins Brisbane', supplier: 'Cummins Brisbane', notes: 'Replace every 150hrs with oil change.' },
  { name: 'Fuel filter - Onan generator', category: 'Generator', quantity: 2, min_quantity: 1, unit: 'pcs', location: 'Engine room - generator shelf', part_number: 'TBC - confirm with Cummins Brisbane', supplier: 'Cummins Brisbane', notes: 'Replace every 150hrs.' },
  { name: 'PCB control board - Onan generator', category: 'Generator', quantity: 1, min_quantity: 1, unit: 'pcs', location: 'Engine room - electrical cabinet', part_number: 'CRITICAL - confirm part no. urgently with Cummins Brisbane', supplier: 'Cummins Brisbane (07) 3212 6900', notes: 'MOST COMMON ONAN FAILURE. Generator stops with no warning when PCB fails. Carry one on all passages. Confirm model-specific part number before ordering.' },
  { name: 'Pre-filter cartridge 20-micron - Rainman AC250', category: 'Watermaker', quantity: 4, min_quantity: 2, unit: 'pcs', location: 'Watermaker area - filter housing', part_number: 'TBC - confirm size from Rainman manual or filter housing label', supplier: 'Rainman Water Australia 1300 737 638', notes: 'Replace when inlet pressure drops or monthly in heavy use. Replace both filters together.' },
  { name: 'Pre-filter cartridge 5-micron - Rainman AC250', category: 'Watermaker', quantity: 4, min_quantity: 2, unit: 'pcs', location: 'Watermaker area - filter housing', part_number: 'TBC - confirm size', supplier: 'Rainman Water Australia 1300 737 638', notes: 'Always replace with 20-micron filter - never one without the other.' },
  { name: 'Membrane housing O-rings (set) - Rainman AC250', category: 'Watermaker', quantity: 1, min_quantity: 1, unit: 'set', location: 'Watermaker - spares bag', part_number: 'TBC - confirm with Rainman Water Australia', supplier: 'Rainman Water Australia 1300 737 638', notes: 'Inspect on every membrane service.' },
  { name: 'HP pump oil - Rainman AC250', category: 'Watermaker', quantity: 1, min_quantity: 1, unit: 'bottle', location: 'Watermaker - chemical shelf', part_number: 'TBC - confirm specification in Rainman manual', supplier: 'Rainman Water Australia', notes: 'Check every 250hrs, change every 500hrs.' },
  { name: 'Membrane preservation biocide - Rainman', category: 'Watermaker', quantity: 1, min_quantity: 1, unit: 'kit', location: 'Watermaker - chemical shelf', part_number: 'TBC - confirm product with Rainman', supplier: 'Rainman Water Australia 1300 737 638', notes: 'Use if membrane idle more than 2 weeks in warm climate. NEVER use chlorinated water.' },
  { name: 'Fuses - assorted (12V and 24V)', category: 'Electrical', quantity: 1, min_quantity: 1, unit: 'pack', location: 'Electrical cabinet', part_number: 'Various sizes - blade and ANL', supplier: 'Whitworths Marine / Repco', notes: 'Keep full assorted pack covering all ratings used aboard.' },
  { name: 'Marine crimp terminals - assorted', category: 'Electrical', quantity: 1, min_quantity: 1, unit: 'pack', location: 'Electrical cabinet', part_number: 'Marine grade tinned copper', supplier: 'Whitworths Marine', notes: 'Always use marine-grade tinned terminals - automotive grade corrodes rapidly at sea.' },
  { name: 'Heat shrink tubing - assorted', category: 'Electrical', quantity: 1, min_quantity: 1, unit: 'pack', location: 'Electrical cabinet', part_number: 'Adhesive-lined marine grade', supplier: 'Whitworths Marine', notes: 'Adhesive-lined only for marine connections near water.' },
  { name: 'Yamaha 15HP 4-stroke outboard impeller', category: 'Tender', quantity: 1, min_quantity: 1, unit: 'pcs', location: 'Tender locker', part_number: 'TBC - confirm at nearest Yamaha dealer', supplier: 'Yamaha Marine Australia 1300 762 624', notes: 'Replace every 100hrs or annually. Confirm model year of outboard with dealer.' },
  { name: 'Yamaha 15HP spark plugs (set)', category: 'Tender', quantity: 1, min_quantity: 1, unit: 'set', location: 'Tender locker', part_number: 'TBC - confirm from Yamaha manual', supplier: 'Yamaha Marine Australia', notes: 'Replace annually or at each service.' },
  { name: 'Yamaha 15HP outboard engine oil', category: 'Tender', quantity: 2, min_quantity: 1, unit: 'L', location: 'Tender locker', part_number: 'Yamaha 10W-30 4-stroke outboard oil', supplier: 'Yamaha dealer / Repco', notes: 'Check before every use. Change annually.' },
  { name: 'Zodiac tender repair kit (Hypalon)', category: 'Tender', quantity: 1, min_quantity: 1, unit: 'kit', location: 'Tender locker', part_number: 'Hypalon patches and adhesive - confirm tender material', supplier: 'Whitworths Marine', notes: 'Confirm tender tube material is Hypalon (not PVC) - kits are not interchangeable.' },
  { name: 'Outboard fuel primer bulb', category: 'Tender', quantity: 1, min_quantity: 1, unit: 'pcs', location: 'Tender locker', part_number: 'Universal - confirm hose diameter', supplier: 'Whitworths Marine', notes: 'Primer bulbs crack in UV - inspect seasonally. Replace if cracked or stiff.' },
  { name: 'Biobor JF diesel biocide', category: 'General', quantity: 2, min_quantity: 1, unit: 'bottle (250ml)', location: 'Engine room - chemical shelf', part_number: 'Biobor JF - 250ml treats 800L', supplier: 'Whitworths Marine / Repco', notes: 'Add at every third fill in Queensland. Diesel bug is common in warm water. Treats microbial contamination.' },
  { name: 'CRC 6-66 marine corrosion inhibitor', category: 'General', quantity: 2, min_quantity: 1, unit: 'cans', location: 'Engine room - chemical shelf', part_number: 'CRC 6-66 marine spray', supplier: 'Repco / Whitworths Marine', notes: 'Superior to WD-40 in saltwater. Use on all stainless, electrical connections, and exposed metal.' },
  { name: 'Underwater epoxy - MarineTex or equivalent', category: 'General', quantity: 1, min_quantity: 1, unit: 'kit', location: 'Engine room - spares box', part_number: 'MarineTex or Loctite Marine Epoxy', supplier: 'Whitworths Marine', notes: 'Emergency underwater hull or fitting repair. Sets in water. Always keep one kit aboard.' },
  { name: 'Teflon tape (PTFE)', category: 'General', quantity: 3, min_quantity: 2, unit: 'rolls', location: 'Engine room - plumbing box', part_number: 'Standard PTFE thread tape', supplier: 'Bunnings / Repco', notes: 'Use on all threaded plumbing fittings.' },
  { name: 'Hose clamps - stainless assorted (20-80mm)', category: 'General', quantity: 1, min_quantity: 1, unit: 'pack', location: 'Engine room - fastener box', part_number: 'Stainless 316 grade 20-80mm range', supplier: 'Whitworths Marine / Repco', notes: 'Marine grade stainless only - standard hardware store clamps corrode rapidly at sea.' },
  { name: 'Oil absorbent bilge pads', category: 'General', quantity: 1, min_quantity: 1, unit: 'pack', location: 'Engine room bilge', part_number: 'Oil-only absorbent bilge pads', supplier: 'Whitworths Marine', notes: 'Keep in bilge at all times. Do not pump oily bilge water overboard - illegal and environmentally harmful.' },
]

// Backward-compatible exports used by current app code.
export const vesselDefaults = VESSEL_DEFAULTS
export const maintenanceTaskSeed = SEED_MAINTENANCE_TASKS
export const safetyItemSeed = SEED_SAFETY_ITEMS
export const contactsSeed = SEED_CONTACTS
export const partsSeed = SEED_PARTS

export const suggestedDocuments = [
  'Registration Certificate (BZI70Q) - expiry 28/05/2026',
  'Insurance Certificate of Currency (AM024374) - expiry 19/05/2026',
  'Life Raft Certificate (No. 41310-A - Viking) - next service 01/06/2028',
  'Lifejacket Inspection Certificate (No. 41310) - next service May 2027',
  'MarineSafe Invoice (MSA41310) - safety gear purchase May 2025',
  'MMSI Application - AMSA 89 - MMSI 503106120',
]

export function generateEngineHoursSeed() {
  const rows = []
  let port = 1200
  let stbd = 1197
  let generator = 640
  let naiad = 320
  let watermaker = 90
  for (let i = 0; i < 96; i += 1) {
    const daysBack = i * (5 + (i % 6))
    const date = format(subDays(new Date(), daysBack), 'yyyy-MM-dd')
    port += 2 + (i % 3)
    stbd += 2 + ((i + 1) % 3)
    generator += 1 + (i % 2)
    naiad += i % 2
    watermaker += i % 2
    rows.push({
      date,
      port_engine: Number(port.toFixed(1)),
      stbd_engine: Number(stbd.toFixed(1)),
      generator: Number(generator.toFixed(1)),
      naiad: Number(naiad.toFixed(1)),
      watermaker: Number(watermaker.toFixed(1)),
      notes: 'Auto-seeded historical reading',
    })
  }
  return rows.sort((a, b) => new Date(a.date) - new Date(b.date))
}

export function generateFuelSeed() {
  const marinas = ['Aquatic Paradise', 'Moreton Island', 'Manly Marina', 'Mooloolaba']
  const rows = []
  let engineHours = 1250
  for (let i = 0; i < 38; i += 1) {
    const daysBack = i * (14 + (i % 3) * 5)
    const litres = 220 + (i % 6) * 60
    const costPerLitre = 1.9 + (i % 7) * 0.05
    rows.push({
      date: format(subDays(new Date(), daysBack), 'yyyy-MM-dd'),
      location: marinas[i % marinas.length],
      litres,
      cost_per_litre: Number(costPerLitre.toFixed(2)),
      total_cost: Number((litres * costPerLitre).toFixed(2)),
      engine_hours_at_fill: engineHours,
      tank_level_before: 35 + (i % 5) * 8,
      fuel_filter_changed: i % 13 === 0,
      tanks_filled_details: [
        { tank: 'port', litres: Math.round(litres / 2) },
        { tank: 'stbd', litres: litres - Math.round(litres / 2) },
      ],
      notes: 'Seed data entry',
    })
    engineHours += 12
  }
  return rows.sort((a, b) => new Date(a.date) - new Date(b.date))
}

export function generateWatermakerSeed() {
  const rows = []
  for (let i = 0; i < 90; i += 1) {
    const date = format(subDays(new Date(), i * 4), 'yyyy-MM-dd')
    const duration = 60 + (i % 7) * 10
    const litres = 55 + (i % 8) * 7
    const trendOffset = i < 20 ? 90 : 40
    rows.push({
      date,
      duration_minutes: duration,
      litres_produced: litres,
      tds_reading: 180 + (i % 9) * 12 + trendOffset,
      pre_filter_pressure: 10 + (i % 5),
      notes: 'Seed watermaker run',
    })
  }
  return rows.sort((a, b) => new Date(a.date) - new Date(b.date))
}
