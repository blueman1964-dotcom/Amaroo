import { supabase } from './supabase'
import { SPEED_LOG_SEED } from '../utils/vesselConstants'

const tableNames = [
  'vessel_settings',
  'engine_hours',
  'maintenance_tasks',
  'maintenance_logs',
  'fuel_log',
  'fluid_checks',
  'safety_items',
  'contacts',
  'documents',
  'voyage_log',
  'mooring_log',
  'departure_checks',
  'parts',
  'watermaker_log',
  'scratchpad_notes',
  'first_aid_inventory',
  'aed_tracking',
  'pending_receipts',
  'speed_logs',
]

async function handle(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

export const db = {
  getAll: (table, orderBy = 'created_at', ascending = false, limit = null) => {
    let q = supabase.from(table).select('*').order(orderBy, { ascending })
    if (limit) q = q.limit(limit)
    return handle(q)
  },

  getOne: (table, id) => handle(supabase.from(table).select('*').eq('id', id).single()),

  insert: (table, row) => handle(supabase.from(table).insert(row).select().single()),

  insertMany: (table, rows) => handle(supabase.from(table).insert(rows).select()),

  update: (table, id, row) =>
    handle(supabase.from(table).update(row).eq('id', id).select().single()),

  remove: (table, id) => handle(supabase.from(table).delete().eq('id', id)),

  clearTable: (table) => handle(supabase.from(table).delete().gte('id', 0)),

  clearAll: async () => {
    for (const table of tableNames) {
      await db.clearTable(table)
    }
  },

  getVesselSettings: async () => {
    const rows = await db.getAll('vessel_settings', 'updated_at', false)
    return rows[0] || null
  },

  saveVesselSettings: async (data) => {
    const current = await db.getVesselSettings()
    if (current) {
      return db.update('vessel_settings', current.id, { data, updated_at: new Date().toISOString() })
    }
    return db.insert('vessel_settings', { data })
  },

  getLatestEngineReading: async () => {
    const rows = await db.getAll('engine_hours', 'date', true)
    if (!rows.length) return null
    return rows.reduce((latest, r) =>
      new Date(r.date) > new Date(latest.date) ? r : latest,
    )
  },
}

export async function getFuelLog() {
  return db.getAll('fuel_log', 'date', true)
}

export async function getVesselSettings() {
  return db.getVesselSettings()
}

export async function getVesselSetting(key) {
  const settings = await db.getVesselSettings()
  const data = settings?.data || {}
  return data?.[key] ?? null
}

export async function upsertVesselSetting(key, value) {
  const settings = await db.getVesselSettings()
  const data = { ...(settings?.data || {}), [key]: value }
  return db.saveVesselSettings(data)
}

export async function upsertVesselSettingsBulk(patch) {
  const settings = await db.getVesselSettings()
  const data = { ...(settings?.data || {}), ...(patch || {}) }
  return db.saveVesselSettings(data)
}

/**
 * Finds the most recent haulout or antifoul event from maintenance logs.
 * Returns ISO date string or null when not found.
 */
export async function getLastHauloutDate() {
  const keywords = [
    'haulout',
    'haul out',
    'haul-out',
    'antifoul',
    'anti-foul',
    'slipway',
    'bottom paint',
    'diver clean',
    'hull clean',
    'ablative',
  ]

  let data = null

  // Try with vessel filter first when column exists.
  let response = await supabase
    .from('maintenance_logs')
    .select('*')
    .eq('vessel_id', 'amaroo')
    .order('completed_date', { ascending: false })
    .limit(300)

  if (response.error) {
    response = await supabase
      .from('maintenance_logs')
      .select('*')
      .order('completed_date', { ascending: false })
      .limit(300)
  }

  if (response.error) throw response.error
  data = response.data || []
  if (!data.length) return null

  const match = data.find((entry) => {
    const text = [
      entry.description,
      entry.task_name,
      entry.task,
      entry.notes,
      entry.vessel_system,
      entry.system,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return keywords.some((keyword) => text.includes(keyword))
  })

  return match ? (match.completed_date || match.date || null) : null
}

export async function saveManualHullCleanDate(date) {
  await upsertVesselSetting('last_hull_clean_date', date)
}

export async function getManualHullCleanDate() {
  return getVesselSetting('last_hull_clean_date')
}

export const getSavedRoutes = () => db.getAll('saved_routes', 'name', true)

export const saveRoute = (name, waypoints, total_nm, notes = '') =>
  db.insert('saved_routes', { name, waypoints, total_nm, notes })

export const deleteSavedRoute = (id) => db.remove('saved_routes', id)

export const getCustomChecklistItems = (checklistId) =>
  handle(
    supabase
      .from('checklist_custom_items')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('created_at', { ascending: true }),
  )

export const addCustomChecklistItem = (checklistId, description) =>
  db.insert('checklist_custom_items', { checklist_id: checklistId, description })

export const deleteCustomChecklistItem = (id) =>
  db.remove('checklist_custom_items', id)

const firstAidDedupKey = (row) => {
  const tier = String(row?.tier ?? '').trim()
  const category = String(row?.category ?? '').trim().toLowerCase()
  const itemName = String(row?.item_name ?? '').trim().toLowerCase()
  return `${tier}|${category}|${itemName}`
}

const rowTimestamp = (row) => {
  const raw = row?.updated_at || row?.created_at || null
  if (!raw) return 0
  const ts = Date.parse(raw)
  return Number.isFinite(ts) ? ts : 0
}

const pickPreferredFirstAidRow = (current, candidate) => {
  const currentTs = rowTimestamp(current)
  const candidateTs = rowTimestamp(candidate)
  if (candidateTs !== currentTs) return candidateTs > currentTs ? candidate : current

  const currentQty = Number(current?.qty_on_board || 0)
  const candidateQty = Number(candidate?.qty_on_board || 0)
  if (candidateQty !== currentQty) return candidateQty > currentQty ? candidate : current

  return Number(candidate?.id || 0) > Number(current?.id || 0) ? candidate : current
}

const dedupeFirstAidInventory = (rows = []) => {
  const byKey = new Map()
  for (const row of rows) {
    const key = firstAidDedupKey(row)
    const existing = byKey.get(key)
    byKey.set(key, existing ? pickPreferredFirstAidRow(existing, row) : row)
  }
  return Array.from(byKey.values()).sort((a, b) => (
    Number(a.tier || 0) - Number(b.tier || 0)
    || String(a.category || '').localeCompare(String(b.category || ''))
    || String(a.item_name || '').localeCompare(String(b.item_name || ''))
  ))
}

export const getFirstAidInventory = () =>
  handle(
    supabase
      .from('first_aid_inventory')
      .select('*')
      .order('tier', { ascending: true })
      .order('category', { ascending: true })
      .order('item_name', { ascending: true }),
  ).then((rows) => dedupeFirstAidInventory(rows || []))

export const updateFirstAidItem = (id, updates) =>
  handle(
    supabase
      .from('first_aid_inventory')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single(),
  )

export const getAedTracking = async () => {
  const rows = await handle(
    supabase.from('aed_tracking').select('*').order('updated_at', { ascending: false }).limit(1),
  )
  return rows[0] || null
}

export const upsertAedTracking = async (data) => {
  const existing = await getAedTracking()
  if (existing) {
    return handle(
      supabase
        .from('aed_tracking')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single(),
    )
  }
  return handle(
    supabase
      .from('aed_tracking')
      .insert({ ...data, updated_at: new Date().toISOString() })
      .select()
      .single(),
  )
}

export const getFirstAidAlerts = async () => {
  const today = new Date()
  const in30 = new Date(today)
  in30.setDate(in30.getDate() + 30)
  const todayStr = today.toISOString().slice(0, 10)
  const in30Str = in30.toISOString().slice(0, 10)

  return handle(
    supabase
      .from('first_aid_inventory')
      .select('*')
      .or(`qty_on_board.eq.0,expiry_date.lte.${in30Str}`)
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .order('item_name', { ascending: true }),
  ).then((rows) =>
    (rows || []).map((row) => ({
      ...row,
      is_expired: Boolean(row.expiry_date) && row.expiry_date < todayStr,
      is_expiring_soon: Boolean(row.expiry_date) && row.expiry_date >= todayStr && row.expiry_date <= in30Str,
      is_zero_stock: Number(row.qty_on_board || 0) <= 0,
    })),
  )
}

export const getPendingReceipts = () =>
  handle(
    supabase
      .from('pending_receipts')
      .select('*')
      .in('status', ['pending', 'reviewed'])
      .order('created_at', { ascending: false })
      .limit(50),
  )

export const updatePendingReceipt = (id, updates) =>
  handle(
    supabase
      .from('pending_receipts')
      .update(updates)
      .eq('id', id)
      .select()
      .single(),
  )

export const markPendingReceiptReviewed = (id) =>
  updatePendingReceipt(id, {
    status: 'reviewed',
    reviewed_at: new Date().toISOString(),
  })

export const discardPendingReceipt = (id) =>
  updatePendingReceipt(id, {
    status: 'discarded',
    reviewed_at: new Date().toISOString(),
  })

export async function getSpeedLogs() {
  const { data, error } = await supabase
    .from('speed_logs')
    .select('*')
    .eq('vessel_id', 'amaroo')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addSpeedLog(entry) {
  const { data, error } = await supabase
    .from('speed_logs')
    .insert({ vessel_id: 'amaroo', ...entry })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteSpeedLog(id) {
  const { error } = await supabase.from('speed_logs').delete().eq('id', id)
  if (error) throw error
}

export async function seedSpeedLogsIfEmpty() {
  const { count, error } = await supabase
    .from('speed_logs')
    .select('*', { count: 'exact', head: true })
  if (error) throw error
  if ((count || 0) > 0) return

  const payload = SPEED_LOG_SEED.map((row) => ({ vessel_id: 'amaroo', ...row }))
  const { error: insertError } = await supabase.from('speed_logs').insert(payload)
  if (insertError) throw insertError
}

export const updateEngineHours = async (additionalHours) => {
  const current = await db.getVesselSettings()
  const data = {
    ...(current?.data || {}),
    engine_hours_total: +((Number(current?.data?.engine_hours_total) || 0) + additionalHours).toFixed(1),
  }
  return db.saveVesselSettings(data)
}

export const addVoyageLogEntry = async (payload) => {
  const withTrackPoints = {
    ...payload,
    track_points: Array.isArray(payload?.track_points) ? payload.track_points : [],
  }

  try {
    return await db.insert('voyage_log', withTrackPoints)
  } catch (err) {
    if (err?.message?.includes('track_points') || err?.code === 'PGRST204') {
      const { track_points: _tp, ...fallback } = withTrackPoints
      return db.insert('voyage_log', fallback)
    }
    throw err
  }
}

export const updateVoyageLogEntry = async (id, payload) => {
  const withTrackPoints = {
    ...payload,
    track_points: payload?.track_points === undefined
      ? undefined
      : Array.isArray(payload.track_points)
        ? payload.track_points
        : [],
  }

  try {
    return await db.update('voyage_log', id, withTrackPoints)
  } catch (err) {
    if (err?.message?.includes('track_points') || err?.code === 'PGRST204') {
      const { track_points: _tp, ...fallback } = withTrackPoints
      return db.update('voyage_log', id, fallback)
    }
    throw err
  }
}

export async function getScheduledTasks() {
  return db.getAll('maintenance_tasks', 'system', true)
}

export async function updateScheduledTask(id, updates) {
  return db.update('maintenance_tasks', id, updates)
}

export async function bulkCreateMaintenanceLogEntries(entries) {
  return db.insertMany('maintenance_logs', entries)
}

export async function setEngineHoursTotal(hours) {
  return upsertVesselSetting('engine_hours_total', hours)
}
