import { supabase } from './supabase'

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
]

async function handle(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

export const db = {
  getAll: (table, orderBy = 'created_at', ascending = false) =>
    handle(supabase.from(table).select('*').order(orderBy, { ascending })),

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
