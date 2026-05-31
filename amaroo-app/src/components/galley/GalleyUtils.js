import { supabase } from '../../db/supabase'
import { jsonrepair } from 'jsonrepair'
import { estimateShelfLifeDays } from './shelfLife'

const VESSEL_ID = 'amaroo'

function parseAIJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = stripped.search(/[[{]/)
  if (start === -1) throw new Error('No JSON found in AI response')
  const payload = stripped.slice(start)
  try {
    return JSON.parse(payload)
  } catch {
    return JSON.parse(jsonrepair(payload))
  }
}

async function handle(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

// ── Voyage config ──────────────────────────────────────────────────────────

export async function getActiveVoyageConfig() {
  const { data, error } = await supabase
    .from('galley_voyage_config')
    .select('*')
    .eq('vessel_id', VESSEL_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data || null
}

export async function upsertVoyageConfig(config) {
  const existing = await getActiveVoyageConfig()
  if (existing) {
    return handle(
      supabase
        .from('galley_voyage_config')
        .update({ ...config, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
    )
  }
  return handle(
    supabase
      .from('galley_voyage_config')
      .insert({ ...config, vessel_id: VESSEL_ID })
      .select()
      .single()
  )
}

// ── Stores ─────────────────────────────────────────────────────────────────

export async function getStores() {
  return handle(
    supabase
      .from('galley_stores')
      .select('*')
      .eq('vessel_id', VESSEL_ID)
      .order('category', { ascending: true })
  )
}

export async function addStoreItem(item) {
  const qty = Number(item.quantity) || 0
  const shelfLife = item.shelf_life_days ?? estimateShelfLifeDays(item.name, item.category)
  return handle(
    supabase
      .from('galley_stores')
      .insert({
        ...item,
        quantity: qty,
        original_quantity: item.original_quantity ?? qty,
        shelf_life_days: shelfLife,
        vessel_id: VESSEL_ID,
      })
      .select()
      .single()
  )
}

export async function addStoreItems(items) {
  return handle(
    supabase
      .from('galley_stores')
      .insert(
        items.map((i) => {
          const qty = Number(i.quantity) || 0
          const shelfLife = i.shelf_life_days ?? estimateShelfLifeDays(i.name, i.category)
          return {
            ...i,
            quantity: qty,
            original_quantity: i.original_quantity ?? qty,
            shelf_life_days: shelfLife,
            vessel_id: VESSEL_ID,
          }
        })
      )
      .select()
  )
}

export async function updateStoreItem(id, item) {
  return handle(
    supabase
      .from('galley_stores')
      .update({ ...item, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
  )
}

export async function deleteStoreItem(id) {
  return handle(supabase.from('galley_stores').delete().eq('id', id))
}

// Upsert by name — used by shopping list auto-push
export async function upsertStoreByName({ name, quantity, category, unit }, stores) {
  const existing = stores.find((s) => s.name.toLowerCase() === name.toLowerCase())
  const qty = Number(quantity) || 0
  if (existing) {
    const newQty = (Number(existing.quantity) || 0) + qty
    return handle(
      supabase
        .from('galley_stores')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
    )
  }
  return addStoreItem({ name, quantity: qty, category, unit })
}

// ── Stores log ─────────────────────────────────────────────────────────────

export async function getStoresLog() {
  return handle(
    supabase
      .from('galley_stores_log')
      .select('*')
      .eq('vessel_id', VESSEL_ID)
  )
}

// Deduct ingredients from stores when a meal is marked cooked.
// Always reads the CURRENT quantity from Supabase (not local state) to avoid stale-cache double-deduction.
export async function deductStoresForMeal(mealId, ingredients, stores) {
  // Deduplicate ingredients by store match to avoid double-deducting the same store item
  const deductions = {} // storeId → totalDeduct
  for (const ing of ingredients || []) {
    const ingLower = (ing.name || '').toLowerCase().trim()
    if (!ingLower) continue
    const match =
      stores.find((s) => s.name.toLowerCase() === ingLower) ||
      stores.find(
        (s) =>
          s.name.toLowerCase().includes(ingLower) ||
          ingLower.includes(s.name.toLowerCase())
      )
    if (!match) continue
    const deduct = Math.max(0, Number(ing.quantity) || 0)
    if (!deduct) continue
    deductions[match.id] = (deductions[match.id] || 0) + deduct
  }

  for (const [storeId, deduct] of Object.entries(deductions)) {
    // Fetch the CURRENT quantity from Supabase to avoid stale React state
    const { data: fresh } = await supabase
      .from('galley_stores')
      .select('quantity')
      .eq('id', storeId)
      .single()
    const currentQty = Number(fresh?.quantity) || 0
    const newQty = Math.max(0, currentQty - deduct)
    await handle(
      supabase
        .from('galley_stores')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', storeId)
    )
    await handle(
      supabase.from('galley_stores_log').insert({
        vessel_id: VESSEL_ID,
        store_id: storeId,
        meal_plan_id: mealId,
        quantity_deducted: deduct,
      })
    )
  }
}

// Restore stores when a meal is unmarked cooked
export async function restoreStoresForMeal(mealId) {
  const logs = await handle(
    supabase.from('galley_stores_log').select('*').eq('meal_plan_id', mealId)
  )
  for (const log of logs || []) {
    const { data: store } = await supabase
      .from('galley_stores')
      .select('quantity')
      .eq('id', log.store_id)
      .single()
    if (!store) continue
    const newQty = (Number(store.quantity) || 0) + log.quantity_deducted
    await handle(
      supabase
        .from('galley_stores')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', log.store_id)
    )
  }
  if ((logs || []).length > 0) {
    await handle(
      supabase.from('galley_stores_log').delete().eq('meal_plan_id', mealId)
    )
  }
}

// ── Meal plan ──────────────────────────────────────────────────────────────

export async function getMealPlan(voyageConfigId) {
  return handle(
    supabase
      .from('galley_meal_plan')
      .select('*')
      .eq('voyage_config_id', voyageConfigId)
      .order('day_number', { ascending: true })
  )
}

export async function saveMealPlan(voyageConfigId, meals) {
  await handle(
    supabase.from('galley_meal_plan').delete().eq('voyage_config_id', voyageConfigId)
  )
  if (!meals.length) return []
  return handle(
    supabase
      .from('galley_meal_plan')
      .insert(meals.map((m) => ({ ...m, vessel_id: VESSEL_ID, voyage_config_id: voyageConfigId })))
      .select()
  )
}

// Partial save: delete only uncooked meals from fromDay onward, then insert new ones.
// Cooked meals in that range are left untouched.
export async function savePartialMealPlan(voyageConfigId, fromDay, newMeals) {
  await handle(
    supabase
      .from('galley_meal_plan')
      .delete()
      .eq('voyage_config_id', voyageConfigId)
      .eq('cooked', false)
      .gte('day_number', fromDay)
  )
  if (!newMeals.length) return []
  return handle(
    supabase
      .from('galley_meal_plan')
      .insert(newMeals.map((m) => ({ ...m, vessel_id: VESSEL_ID, voyage_config_id: voyageConfigId })))
      .select()
  )
}

export async function updateMealItem(id, fields) {
  return handle(
    supabase
      .from('galley_meal_plan')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
  )
}

// ── Shopping list ──────────────────────────────────────────────────────────

export async function getShoppingList(voyageConfigId) {
  return handle(
    supabase
      .from('galley_shopping_list')
      .select('*')
      .eq('voyage_config_id', voyageConfigId)
      .order('category', { ascending: true })
  )
}

export async function saveShoppingList(voyageConfigId, items) {
  await handle(
    supabase.from('galley_shopping_list').delete().eq('voyage_config_id', voyageConfigId)
  )
  if (!items.length) return []
  return handle(
    supabase
      .from('galley_shopping_list')
      .insert(
        items.map((i) => ({
          ...i,
          vessel_id: VESSEL_ID,
          voyage_config_id: voyageConfigId,
        }))
      )
      .select()
  )
}

export async function updateShoppingItem(id, fields) {
  return handle(
    supabase
      .from('galley_shopping_list')
      .update(fields)
      .eq('id', id)
      .select()
      .single()
  )
}

// Fetch all rated meals across all voyages for cross-voyage learning
export async function getHistoricalRatings() {
  const { data } = await supabase
    .from('galley_meal_plan')
    .select('meal_name, rating, notes, meal_slot')
    .eq('vessel_id', VESSEL_ID)
    .not('rating', 'is', null)
    .order('rating', { ascending: false })
  return data || []
}

// ── AI: receipt scan ───────────────────────────────────────────────────────

export async function scanReceiptForStores(imageBase64) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          {
            type: 'text',
            text: `You are reading a shopping receipt. Extract every food, drink, and grocery item.
Ignore: prices, totals, taxes, store name, address, loyalty points, non-food items (cleaning, toiletries, stationery).
For each item extract the name and infer quantity/unit from the receipt text where possible (e.g. "6pk" = quantity 6, "500g" = quantity 500 unit g). If unclear, default quantity to 1.
Clean up abbreviated product names to be human-readable (e.g. "CHKN BRST 500G" → "Chicken Breast").
Return ONLY a JSON array, no other text, no markdown:
[{ "name": string, "quantity": number, "unit": string, "category": string }]
Category must be one of: Proteins, Vegetables, Fruit, Dairy, Dry Goods, Canned, Drinks, Condiments, Frozen, Other`,
          },
        ],
      }],
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  const rawText = data.content[0].text
  console.log('[Receipt scan raw]', rawText)
  return parseAIJson(rawText)
}

// ── AI: vision scan ────────────────────────────────────────────────────────

export async function scanImageForStores(imageBase64) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
            },
            {
              type: 'text',
              text: `You are helping stock a boat galley. Identify all food/drink products visible in this image.
Return ONLY a JSON array, no other text, no markdown. Each item:
{ "name": string, "category": string, "quantity": number, "unit": string }
Category must be one of: Proteins, Vegetables, Fruit, Dairy, Dry Goods, Canned, Drinks, Condiments, Frozen, Other
Estimate quantity from packaging visible (e.g. 1 tin, 500g packet, 6 pack).
If multiple distinct products are visible, return all of them as separate items in the array.`,
            },
          ],
        },
      ],
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  const rawText = data.content[0].text
  console.log('[Galley AI raw response]', rawText)
  return parseAIJson(rawText)
}

// ── AI: meal plan (chunked) ────────────────────────────────────────────────

const CHUNK_SIZE = 5

async function generateMealPlanChunk({
  stores, startDay, endDay, numDays, numCrew, userSuggestions, selectedSlots, historicalRatings = [],
}) {
  const storesSummary = stores.map((s) => `${s.name}: ${s.quantity} ${s.unit}`).join('\n')
  const perishables = stores
    .filter((s) => s.shelf_life_days && s.shelf_life_days < 60 && s.quantity > 0)
    .sort((a, b) => a.shelf_life_days - b.shelf_life_days)
    .map((s) => `- ${s.name}: use by Day ${s.shelf_life_days}`)
    .join('\n')

  const loved = historicalRatings
    .filter((r) => r.rating >= 4)
    .map((r) => `${r.meal_name} (${r.rating}★)`)
    .slice(0, 15)
    .join(', ')
  const avoided = historicalRatings
    .filter((r) => r.rating <= 2)
    .map((r) => r.meal_name)
    .slice(0, 10)
    .join(', ')
  const prompt = `You are planning meals for a ${numDays}-day offshore boat voyage for ${numCrew} people.

AVAILABLE STORES:
${storesSummary}

USER PREFERENCES:
${userSuggestions || 'No specific preferences'}

MEAL SLOTS REQUIRED: ${selectedSlots.join(', ')}

Generate meals for days ${startDay} to ${endDay} ONLY (out of ${numDays} total days).
Be creative and practical. Easy meals for potential rough weather early in the voyage.
Long-life items (canned, dry goods) should be used in later days.
${perishables ? `\nPERISHABLE ITEMS — must be used before these voyage days:\n${perishables}\nEnsure each perishable item appears in a meal BEFORE its use-by day.\n` : ''}${loved ? `\nPREVIOUSLY LOVED MEALS on this vessel (include similar dishes where ingredients allow):\n${loved}\n` : ''}${avoided ? `\nMEALS TO AVOID (crew did not enjoy these previously):\n${avoided}\n` : ''}

Return ONLY a JSON array. No markdown, no explanation, no extra text — just the array.

CRITICAL SCALING RULE: All ingredient quantities MUST be for ALL ${numCrew} crew combined — NOT per person.
If a dish normally uses 1 salmon fillet per person, list ${numCrew} fillets. If pasta is 80g per person, list ${numCrew * 80}g.
Every single ingredient quantity must be multiplied for ${numCrew} people.

The "ingredients" array must be COMPLETE. Include every ingredient: proteins, vegetables, liquids, sauces, spices, oils, condiments, garnishes. Do not omit anything.

[{
  "day_number": ${startDay},
  "meal_slot": "breakfast",
  "meal_name": "Porridge with honey",
  "ingredients": [{ "name": "Oats", "quantity": ${numCrew * 80}, "unit": "g" }, { "name": "Honey", "quantity": ${numCrew * 1}, "unit": "tbsp" }, { "name": "Milk", "quantity": ${numCrew * 200}, "unit": "ml" }],
  "calories": 450
}]
The "calories" field is the estimated total calories for this meal for ALL ${numCrew} crew combined.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  const rawText = data.content[0].text
  console.log(`[Galley AI days ${startDay}-${endDay}]`, rawText)
  return parseAIJson(rawText)
}

export async function generateMealPlanAI({
  stores, numDays, numCrew, userSuggestions, selectedSlots, onProgress, fromDay = 1, historicalRatings = [],
}) {
  const chunks = []
  for (let start = fromDay; start <= numDays; start += CHUNK_SIZE) {
    chunks.push({ startDay: start, endDay: Math.min(start + CHUNK_SIZE - 1, numDays) })
  }

  const allMeals = []
  const failedChunks = []

  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress({ chunk: i + 1, total: chunks.length })
    try {
      const meals = await generateMealPlanChunk({
        stores, numDays, numCrew, userSuggestions, selectedSlots, historicalRatings, ...chunks[i],
      })
      const { startDay, endDay } = chunks[i]
      const valid = meals.filter((m) => m.day_number >= startDay && m.day_number <= endDay)
      allMeals.push(...valid)

      const expectedDays = endDay - startDay + 1
      const returnedDays = new Set(valid.map((m) => m.day_number)).size
      if (returnedDays < expectedDays) {
        const missingDays = Array.from({ length: expectedDays }, (_, k) => startDay + k)
          .filter((d) => !valid.some((m) => m.day_number === d))
        console.warn(`[Galley] Chunk ${i + 1} missing days ${missingDays.join(', ')} — retrying`)
        const retry = await generateMealPlanChunk({
          stores, numDays, numCrew, userSuggestions, selectedSlots, historicalRatings,
          startDay: missingDays[0],
          endDay: missingDays[missingDays.length - 1],
        })
        allMeals.push(
          ...retry.filter(
            (m) => m.day_number >= missingDays[0] && m.day_number <= missingDays[missingDays.length - 1]
          )
        )
      }
    } catch (err) {
      console.error(`[Galley] Chunk ${i + 1} failed:`, err)
      failedChunks.push(chunks[i])
    }
  }

  if (failedChunks.length) {
    const dayRanges = failedChunks.map((c) => `days ${c.startDay}–${c.endDay}`).join(', ')
    throw new Error(`Some chunks failed to generate (${dayRanges}). Please try again.`)
  }

  return allMeals
}

// ── AI: recipe on demand ───────────────────────────────────────────────────
// Returns { recipe: string, ingredients: [{name, quantity, unit}] }
// The ingredients list replaces the stored one so it's always complete and in sync.

export async function generateMealRecipeAI(mealName, existingIngredients, numCrew = 2) {
  const ingHint = (existingIngredients || []).map((i) => `${i.quantity} ${i.unit} ${i.name}`).join(', ')
  const prompt = `Write a concise galley recipe for "${mealName}" for ${numCrew} people, suitable for a small boat at sea.
${ingHint ? `Suggested ingredients (these quantities are for ${numCrew} people): ${ingHint}.` : ''}

Return a JSON object (no markdown, no extra text):
{
  "recipe": "2-5 sentence cooking method in plain text",
  "ingredients": [{ "name": "string", "quantity": 1, "unit": "string" }]
}
CRITICAL: All ingredient quantities must be for ALL ${numCrew} people combined (not per person).
The "ingredients" array must be COMPLETE — include every ingredient the recipe uses: proteins, vegetables, liquids, sauces, spices, oils, condiments. Do not omit anything (e.g. coconut milk, fish sauce, curry paste, garlic, oil, seasoning).`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  const rawText = data.content[0].text.trim()
  const parsed = parseAIJson(rawText)
  return {
    recipe: parsed.recipe || rawText,
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : (existingIngredients || []),
  }
}

// Extract complete structured ingredients from an existing recipe text
export async function extractIngredientsFromRecipe(mealName, recipeText, numCrew = 2) {
  const prompt = `Extract every ingredient from this recipe for "${mealName}" (serves ${numCrew} people):

${recipeText}

IMPORTANT: Return quantities for ALL ${numCrew} people combined.
If the recipe is written for 1 person (e.g. "1 fillet", "80g pasta"), multiply ALL quantities by ${numCrew}.
If the recipe is already written for ${numCrew} people, use those quantities as-is.

Return ONLY a JSON array, no markdown, no other text:
[{ "name": "string", "quantity": 1, "unit": "string" }]
Include everything: proteins, vegetables, liquids, sauces, spices, oils, condiments, garnishes. Do not omit anything.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return parseAIJson(data.content[0].text)
}

// ── AI: shopping list ──────────────────────────────────────────────────────

export async function generateShoppingListAI({ stores, meals }) {
  const storesSummary = stores.map((s) => `${s.name}: ${s.quantity} ${s.unit}`).join('\n') || 'None'
  const ingredientMap = {}
  for (const meal of meals) {
    for (const ing of Array.isArray(meal.ingredients) ? meal.ingredients : []) {
      const key = ing.name?.toLowerCase() || ''
      if (!key) continue
      if (!ingredientMap[key]) ingredientMap[key] = { name: ing.name, quantity: 0, unit: ing.unit || '' }
      ingredientMap[key].quantity += Number(ing.quantity) || 0
    }
  }
  const ingredientsSummary =
    Object.values(ingredientMap)
      .map((i) => `${i.name}: ${i.quantity} ${i.unit}`)
      .join('\n') || 'None'

  const prompt = `You are generating a shopping list for a boat voyage.

CURRENT STORES:
${storesSummary}

MEAL PLAN INGREDIENTS REQUIRED:
${ingredientsSummary}

Calculate what needs to be purchased. Account for quantities already in stores.
Add a 10-15% buffer for wastage and unexpected use.
Group by category and suggest practical purchase quantities (e.g. round up to nearest pack size).

Return ONLY a JSON array, no markdown:
[{ "item_name": string, "quantity": number, "unit": string, "category": string }]`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  const rawText = data.content[0].text
  console.log('[Galley AI raw response]', rawText)
  return parseAIJson(rawText)
}

// Batch-categorize items that keyword lookup couldn't classify.
// Returns a map of { itemName: category }
export async function categorizeItemsAI(itemNames) {
  if (!itemNames.length) return {}
  const list = itemNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
  const prompt = `Categorize these grocery items for a boat provisioning list.
Each must be assigned one of these exact categories: Proteins, Vegetables, Fruit, Dairy, Dry Goods, Canned, Drinks, Condiments, Frozen, Other

${list}

Return ONLY a JSON array, no markdown:
[{ "name": "item name", "category": "category" }]`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  const parsed = parseAIJson(data.content[0].text)
  const result = {}
  for (const { name, category } of parsed) {
    if (name && category) result[name] = category
  }
  return result
}

export const STORE_CATEGORIES = [
  'Proteins', 'Vegetables', 'Fruit', 'Dairy',
  'Dry Goods', 'Canned', 'Drinks', 'Condiments', 'Frozen', 'Other',
]
