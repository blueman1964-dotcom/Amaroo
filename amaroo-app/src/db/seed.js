import { db } from './api'
import { supabase } from './supabase'
import {
  SEED_CONTACTS,
  SEED_MAINTENANCE_TASKS,
  SEED_PARTS,
  SEED_SAFETY_ITEMS,
  VESSEL_DEFAULTS,
  contactsSeed,
  generateEngineHoursSeed,
  generateFuelSeed,
  generateWatermakerSeed,
  maintenanceTaskSeed,
  partsSeed,
  safetyItemSeed,
  vesselDefaults,
} from '../data/seedData'

// If safety_items, contacts, or parts are empty in production,
// run this in Supabase SQL Editor to force re-seed:
// DELETE FROM safety_items WHERE true;
// DELETE FROM contacts WHERE true;
// DELETE FROM parts WHERE true;
// Then reload the app - the seed will repopulate these tables.

export async function seedDatabase() {
  try {
    const safetyCount = await supabase.from('safety_items').select('*', { count: 'exact', head: true })
    const contactCount = await supabase.from('contacts').select('*', { count: 'exact', head: true })
    const partsCount = await supabase.from('parts').select('*', { count: 'exact', head: true })
    const taskCount = await supabase
      .from('maintenance_tasks')
      .select('*', { count: 'exact', head: true })
    console.log(
      'Safety items:',
      safetyCount.count,
      'Contacts:',
      contactCount.count,
      'Parts:',
      partsCount.count,
      'Tasks:',
      taskCount.count,
    )

    const { data: existingSettings } = await supabase
      .from('vessel_settings')
      .select('id')
      .limit(1)
      .maybeSingle()
    if (!existingSettings) {
      await db.saveVesselSettings(VESSEL_DEFAULTS || vesselDefaults)
    }

    const { count: maintenanceCount } = await supabase
      .from('maintenance_tasks')
      .select('*', { count: 'exact', head: true })
    if (!maintenanceCount || maintenanceCount === 0) {
      await supabase.from('maintenance_tasks').insert(SEED_MAINTENANCE_TASKS || maintenanceTaskSeed)
    }

    const { count: safetyRows } = await supabase
      .from('safety_items')
      .select('*', { count: 'exact', head: true })
    if (!safetyRows || safetyRows === 0) {
      await supabase.from('safety_items').insert(SEED_SAFETY_ITEMS || safetyItemSeed)
    }

    const { count: contactsRows } = await supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
    if (!contactsRows || contactsRows === 0) {
      await supabase.from('contacts').insert(SEED_CONTACTS || contactsSeed)
    }

    const { count: partsRows } = await supabase
      .from('parts')
      .select('*', { count: 'exact', head: true })
    if (!partsRows || partsRows === 0) {
      await supabase.from('parts').insert(SEED_PARTS || partsSeed)
    }

    const { count: hoursCount } = await supabase
      .from('engine_hours')
      .select('*', { count: 'exact', head: true })
    if (!hoursCount || hoursCount === 0) {
      await supabase.from('engine_hours').insert(generateEngineHoursSeed())
    }

    const { count: fuelCount } = await supabase
      .from('fuel_log')
      .select('*', { count: 'exact', head: true })
    if (!fuelCount || fuelCount === 0) {
      await supabase.from('fuel_log').insert(generateFuelSeed())
    }

    const { count: watermakerCount } = await supabase
      .from('watermaker_log')
      .select('*', { count: 'exact', head: true })
    if (!watermakerCount || watermakerCount === 0) {
      await supabase.from('watermaker_log').insert(generateWatermakerSeed())
    }

    return true
  } catch (err) {
    console.error('seedDatabase error:', err)
    return false
  }
}

export async function seedIfEmpty() {
  return seedDatabase()
}
