import { db } from './api'
import { supabase } from './supabase'
import { SPEED_LOG_SEED } from '../utils/vesselConstants'

const FIRST_AID_SEED = [
  // Tier 1 — Coastal Queensland (Current)
  { tier: 1, category: 'Wound Care', item_name: 'Sterile wound closure strips', recommended_qty: 5 },
  { tier: 1, category: 'Wound Care', item_name: 'Assorted adhesive dressings', recommended_qty: 20 },
  { tier: 1, category: 'Wound Care', item_name: 'Non-adherent dressings 10×10cm', recommended_qty: 10 },
  { tier: 1, category: 'Wound Care', item_name: 'Combine dressings', recommended_qty: 5 },
  { tier: 1, category: 'Wound Care', item_name: 'Crepe bandages 10cm', recommended_qty: 4 },
  { tier: 1, category: 'Wound Care', item_name: 'Triangular bandages', recommended_qty: 2 },
  { tier: 1, category: 'Wound Care', item_name: 'Waterproof wound dressing large', recommended_qty: 4 },
  { tier: 1, category: 'Wound Care', item_name: 'Sterile gauze swabs', recommended_qty: 20 },
  { tier: 1, category: 'Wound Care', item_name: 'Medical tape Leukopor', recommended_qty: 2 },
  { tier: 1, category: 'Wound Care', item_name: 'Irrigation syringe 20ml', recommended_qty: 2 },
  { tier: 1, category: 'Wound Care', item_name: 'Saline sachets for wound irrigation', recommended_qty: 10 },
  { tier: 1, category: 'Wound Care', item_name: 'Tweezers and scissors', recommended_qty: 1 },
  { tier: 1, category: 'Wound Care', item_name: 'Disposable gloves', recommended_qty: 20 },
  { tier: 1, category: 'Wound Care', item_name: 'Suture strips Steri-strips 6mm', recommended_qty: 10 },
  { tier: 1, category: 'Medications OTC', item_name: 'Paracetamol 500mg', recommended_qty: 100 },
  { tier: 1, category: 'Medications OTC', item_name: 'Ibuprofen 200mg', recommended_qty: 100 },
  { tier: 1, category: 'Medications OTC', item_name: 'Promethazine/Phenergan seasickness', recommended_qty: 20 },
  { tier: 1, category: 'Medications OTC', item_name: 'Loratadine antihistamine', recommended_qty: 30 },
  { tier: 1, category: 'Medications OTC', item_name: 'Loperamide antidiarrhoeal', recommended_qty: 20 },
  { tier: 1, category: 'Medications OTC', item_name: 'Mylanta antacid', recommended_qty: 1 },
  { tier: 1, category: 'Medications OTC', item_name: 'Hydralyte rehydration sachets', recommended_qty: 20 },
  { tier: 1, category: 'Medications OTC', item_name: 'Aspirin 300mg cardiac emergency', recommended_qty: 24 },
  { tier: 1, category: 'Medications OTC', item_name: 'Eye wash saline', recommended_qty: 2 },
  { tier: 1, category: 'Medications OTC', item_name: 'Throat lozenges', recommended_qty: 1 },
  { tier: 1, category: 'Airway & Breathing', item_name: 'Pocket mask CPR', recommended_qty: 1 },
  { tier: 1, category: 'Airway & Breathing', item_name: 'Disposable face shields', recommended_qty: 4 },
  { tier: 1, category: 'Burns', item_name: 'Burnaid gel sachets', recommended_qty: 4 },
  { tier: 1, category: 'Burns', item_name: 'Burnaid dressing 10×10cm', recommended_qty: 2 },
  { tier: 1, category: 'Burns', item_name: 'Cling wrap burns cover', recommended_qty: 1 },
  { tier: 1, category: 'Immobilisation', item_name: 'SAM splint', recommended_qty: 2 },
  { tier: 1, category: 'Immobilisation', item_name: 'Cervical collar adjustable', recommended_qty: 1 },
  { tier: 1, category: 'Diagnostic', item_name: 'Digital thermometer', recommended_qty: 1 },
  { tier: 1, category: 'Diagnostic', item_name: 'Blood pressure cuff manual', recommended_qty: 1 },
  { tier: 1, category: 'Diagnostic', item_name: 'Pulse oximeter', recommended_qty: 1 },
  { tier: 1, category: 'Diagnostic', item_name: 'Torch penlight', recommended_qty: 1 },
  { tier: 1, category: 'Diagnostic', item_name: 'First aid manual St John current edition', recommended_qty: 1 },
  { tier: 1, category: 'Prescription — Consult GP', item_name: 'Broad spectrum antibiotic Amoxicillin or Augmentin', recommended_qty: 1 },
  { tier: 1, category: 'Prescription — Consult GP', item_name: 'Strong analgesia as prescribed', recommended_qty: 1 },
  { tier: 1, category: 'Prescription — Consult GP', item_name: 'Antiemetic injection Maxolon', recommended_qty: 1 },
  { tier: 1, category: 'Prescription — Consult GP', item_name: 'Adrenaline auto-injector EpiPen', recommended_qty: 2 },
  // Tier 2 — Offshore Ocean Passages (Future)
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Suture kit with local anaesthetic', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Skin stapler', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Steridrape surgical drape', recommended_qty: 2 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Betadine solution 500ml', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'IV fluid bags Normal Saline 1L', recommended_qty: 4 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'IV giving sets', recommended_qty: 4 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'IV cannulas assorted', recommended_qty: 8 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Urinary catheter kit', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Dental emergency kit', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Ciprofloxacin', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Metronidazole', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Dexamethasone', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'Salbutamol inhaler', recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: "Ship Captain's Medical Guide", recommended_qty: 1 },
  { tier: 2, category: 'Offshore Ocean Passages', item_name: 'DAN Offshore Medical Kit Guide', recommended_qty: 1 },
]
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

    try {
      const { count: firstAidCount } = await supabase
        .from('first_aid_inventory')
        .select('*', { count: 'exact', head: true })
      if (!firstAidCount || firstAidCount === 0) {
        const rows = FIRST_AID_SEED.map((item) => ({ ...item, vessel_id: 'amaroo', qty_on_board: 0 }))
        const { error: upsertErr } = await supabase
          .from('first_aid_inventory')
          .upsert(rows, { onConflict: 'vessel_id,item_name,tier', ignoreDuplicates: true })
        if (upsertErr) {
          await supabase.from('first_aid_inventory').insert(rows)
        }
      }
    } catch {
      // Table may not exist yet — user needs to run SQL migration first
    }

    try {
      const { count: speedLogCount } = await supabase
        .from('speed_logs')
        .select('*', { count: 'exact', head: true })
      if (!speedLogCount || speedLogCount === 0) {
        const rows = SPEED_LOG_SEED.map((row) => ({ vessel_id: 'amaroo', ...row }))
        await supabase.from('speed_logs').insert(rows)
      }
    } catch {
      // Table may not exist yet — user needs to run SQL migration first
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
