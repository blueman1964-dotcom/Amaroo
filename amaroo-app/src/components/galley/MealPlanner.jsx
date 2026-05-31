import { useState, useEffect } from 'react'
import {
  ChefHat, Loader, RefreshCw, Save, ChevronDown, ChevronUp,
  Star, BookOpen, GripVertical,
} from 'lucide-react'
import { differenceInDays, parseISO, startOfDay } from 'date-fns'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  getMealPlan, saveMealPlan, savePartialMealPlan, updateMealItem,
  generateMealPlanAI, generateMealRecipeAI, extractIngredientsFromRecipe,
  deductStoresForMeal, restoreStoresForMeal,
} from './GalleyUtils'
import { currentVoyageDay } from './shelfLife'

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner']
const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

// ── Sub-components (must be outside MealPlanner for hooks to work inside DndContext) ──

function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n === value ? null : n)}
          className={`transition ${n <= (value || 0) ? 'text-amber-400' : 'text-slate-300'} hover:text-amber-400`}
        >
          <Star size={14} fill={n <= (value || 0) ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )
}

function MealCard({ meal, onUpdate, onCookedToggle, numCrew, showToast, gripListeners, gripAttributes, compact }) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState(meal.notes || '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [generatingRecipe, setGeneratingRecipe] = useState(false)

  async function handleGetRecipe() {
    setGeneratingRecipe(true)
    try {
      const { recipe, ingredients } = await generateMealRecipeAI(meal.meal_name, meal.ingredients, numCrew)
      await updateMealItem(meal.id, { recipe, ingredients })
      onUpdate()
    } finally {
      setGeneratingRecipe(false)
    }
  }

  async function handleRating(rating) {
    try { await updateMealItem(meal.id, { rating }); onUpdate() } catch { /* silent */ }
  }

  async function saveNotes() {
    setSavingNotes(true)
    try { await updateMealItem(meal.id, { notes }); onUpdate() } finally { setSavingNotes(false) }
  }

  const calPerPerson = meal.calories && numCrew ? Math.round(meal.calories / numCrew) : null

  if (compact) {
    // Lightweight clone for DragOverlay
    return (
      <div className="rounded-xl border border-[#C4603A] bg-white p-3 shadow-lg opacity-95">
        <p className="font-medium text-sm text-slate-800">{meal.meal_name}</p>
        {calPerPerson && <p className="text-xs text-slate-400 mt-0.5">~{calPerPerson} cal/person</p>}
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-3 transition ${meal.cooked ? 'bg-slate-50 border-slate-200 opacity-70' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <div
          className={`mt-0.5 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 shrink-0 touch-none ${meal.cooked ? 'invisible' : ''}`}
          {...(gripListeners || {})}
          {...(gripAttributes || {})}
        >
          <GripVertical size={14} />
        </div>

        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm ${meal.cooked ? 'line-through text-slate-500' : 'text-slate-800'}`}>
            {meal.meal_name}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {meal.ingredients && meal.ingredients.length > 0 && (
              <p className="text-xs text-slate-500 truncate">
                {meal.ingredients.slice(0, 3).map((i) => i.name).join(', ')}
                {meal.ingredients.length > 3 ? ` +${meal.ingredients.length - 3}` : ''}
              </p>
            )}
            {calPerPerson && (
              <span className="text-xs text-slate-400 shrink-0">~{calPerPerson} cal/person</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onCookedToggle(meal)}
            className={`text-xs rounded-full px-2 py-0.5 border transition ${
              meal.cooked
                ? 'bg-green-100 border-green-300 text-green-700'
                : 'border-slate-300 text-slate-500 hover:border-green-400'
            }`}
          >
            {meal.cooked ? 'Cooked ✓' : 'Cook'}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-slate-400 hover:text-[#0A4A52]"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-[#0A4A52]">Recipe</p>
              {!meal.recipe && (
                <button
                  type="button"
                  onClick={handleGetRecipe}
                  disabled={generatingRecipe}
                  className="inline-flex items-center gap-1 text-xs rounded-lg border border-[#0A4A52] px-2 py-0.5 text-[#0A4A52] hover:bg-teal-50 disabled:opacity-50 transition"
                >
                  {generatingRecipe ? <Loader size={11} className="animate-spin" /> : <BookOpen size={11} />}
                  {generatingRecipe ? 'Getting recipe…' : 'Get Recipe'}
                </button>
              )}
            </div>
            {meal.recipe
              ? <p className="text-xs text-slate-600 whitespace-pre-wrap">{meal.recipe}</p>
              : <p className="text-xs text-slate-400 italic">Tap "Get Recipe" to generate one.</p>}
          </div>

          {meal.ingredients && meal.ingredients.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#0A4A52] mb-1">Ingredients</p>
              <ul className="text-xs text-slate-600 space-y-0.5">
                {meal.ingredients.map((ing, i) => (
                  <li key={i}>{ing.quantity} {ing.unit} {ing.name}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-[#0A4A52] mb-1">Rating</p>
            <StarRating value={meal.rating} onChange={handleRating} />
          </div>

          <div>
            <p className="text-xs font-semibold text-[#0A4A52] mb-1">Notes</p>
            <div className="flex gap-2">
              <textarea
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes…"
              />
              <button
                type="button"
                onClick={saveNotes}
                disabled={savingNotes}
                className="self-end rounded-lg bg-[#0A4A52] px-2 py-1 text-xs text-white hover:bg-[#083b42] disabled:opacity-50"
              >
                {savingNotes ? '…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DroppableSlot({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] rounded-xl transition-all ${isOver ? 'ring-2 ring-[#C4603A] ring-inset bg-orange-50' : ''}`}
    >
      {children}
    </div>
  )
}

function DraggableMeal({ meal, onCookedToggle, onUpdate, numCrew, showToast }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: meal.id,
    disabled: meal.cooked,
  })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, position: 'relative', zIndex: 50 }
    : undefined

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-30' : ''}>
      <MealCard
        meal={meal}
        onUpdate={onUpdate}
        onCookedToggle={onCookedToggle}
        numCrew={numCrew}
        showToast={showToast}
        gripListeners={listeners}
        gripAttributes={attributes}
      />
    </div>
  )
}

// ── Cache helpers ──────────────────────────────────────────────────────────

const cacheKey = (id) => `galley_meals_${id}`
function cacheWrite(id, meals) {
  try { localStorage.setItem(cacheKey(id), JSON.stringify(meals)) } catch { /* ignore */ }
}
function cacheRead(id) {
  try { return JSON.parse(localStorage.getItem(cacheKey(id)) || 'null') } catch { return null }
}

// ── Main component ─────────────────────────────────────────────────────────

export default function MealPlanner({ voyageConfig, stores, showToast, onStoresUpdated, historicalRatings = [], onRatingsUpdated }) {
  const [meals, setMeals] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [draftPlan, setDraftPlan] = useState(null)
  const [suggestions, setSuggestions] = useState('')
  const [selectedSlots, setSelectedSlots] = useState(['breakfast', 'lunch', 'dinner'])
  const [savingPlan, setSavingPlan] = useState(false)
  const [generatingRecipes, setGeneratingRecipes] = useState(false)
  const [recipeProgress, setRecipeProgress] = useState(null)
  const [syncingIngredients, setSyncingIngredients] = useState(false)
  const [syncProgress, setSyncProgress] = useState(null)
  const [planProgress, setPlanProgress] = useState(null)
  const [activeDragId, setActiveDragId] = useState(null)
  const [draftFromDay, setDraftFromDay] = useState(null) // null = full plan, number = partial regen
  const [regenFromDay, setRegenFromDay] = useState(1)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const numCrew = voyageConfig?.num_crew || 2
  const numDays = voyageConfig?.start_date && voyageConfig?.end_date
    ? Math.max(1, differenceInDays(parseISO(voyageConfig.end_date), parseISO(voyageConfig.start_date)) + 1)
    : 0

  useEffect(() => {
    if (voyageConfig?.id) {
      loadMeals()
      // Default regen day to today's position in the voyage
      if (voyageConfig.start_date) {
        const today = startOfDay(new Date())
        const start = startOfDay(parseISO(voyageConfig.start_date))
        const currentDay = Math.max(1, Math.min(numDays, differenceInDays(today, start) + 1))
        setRegenFromDay(currentDay)
      }
    }
  }, [voyageConfig?.id])

  async function loadMeals() {
    if (!voyageConfig?.id) return
    setLoading(true)
    const cached = cacheRead(voyageConfig.id)
    if (cached) setMeals(cached)
    try {
      const data = await getMealPlan(voyageConfig.id)
      const loaded = data || []
      setMeals(loaded)
      cacheWrite(voyageConfig.id, loaded)
    } catch (err) {
      if (cached) {
        showToast('Offline — showing cached meal plan.', 'error')
      } else {
        showToast(err.message || 'Failed to load meal plan.', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCookedToggle(meal) {
    const nowCooked = !meal.cooked
    try {
      await updateMealItem(meal.id, { cooked: nowCooked })
      if (nowCooked) {
        await deductStoresForMeal(meal.id, meal.ingredients || [], stores)
        showToast(`Stores updated for ${meal.meal_name}`)
      } else {
        await restoreStoresForMeal(meal.id)
      }
      if (onStoresUpdated) onStoresUpdated()
      if (onRatingsUpdated) onRatingsUpdated()
      loadMeals()
    } catch (err) {
      showToast(err.message || 'Failed to update meal.', 'error')
    }
  }

  async function generateAllRecipes() {
    const missing = meals.filter((m) => !m.recipe)
    if (!missing.length) { showToast('All meals already have recipes.'); return }
    setGeneratingRecipes(true)
    setRecipeProgress({ done: 0, total: missing.length })
    const updated = [...meals]
    for (let i = 0; i < missing.length; i++) {
      const meal = missing[i]
      try {
        const { recipe, ingredients } = await generateMealRecipeAI(meal.meal_name, meal.ingredients, numCrew)
        await updateMealItem(meal.id, { recipe, ingredients })
        const idx = updated.findIndex((m) => m.id === meal.id)
        if (idx !== -1) updated[idx] = { ...updated[idx], recipe, ingredients }
        setMeals([...updated])
        cacheWrite(voyageConfig.id, updated)
      } catch { /* skip */ }
      setRecipeProgress({ done: i + 1, total: missing.length })
    }
    setGeneratingRecipes(false)
    setRecipeProgress(null)
    showToast('All recipes generated and cached for offline use.')
  }

  async function resyncAllIngredients() {
    const withRecipes = meals.filter((m) => m.recipe)
    if (!withRecipes.length) { showToast('No recipes to sync from.', 'error'); return }
    setSyncingIngredients(true)
    setSyncProgress({ done: 0, total: withRecipes.length })
    const updated = [...meals]
    for (let i = 0; i < withRecipes.length; i++) {
      const meal = withRecipes[i]
      try {
        const ingredients = await extractIngredientsFromRecipe(meal.meal_name, meal.recipe, numCrew)
        await updateMealItem(meal.id, { ingredients })
        const idx = updated.findIndex((m) => m.id === meal.id)
        if (idx !== -1) updated[idx] = { ...updated[idx], ingredients }
        setMeals([...updated])
        cacheWrite(voyageConfig.id, updated)
      } catch { /* skip individual failures */ }
      setSyncProgress({ done: i + 1, total: withRecipes.length })
    }
    setSyncingIngredients(false)
    setSyncProgress(null)
    showToast('Ingredients re-synced from all recipes. Regenerate your shopping list.')
  }

  function toggleSlot(slot) {
    setSelectedSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]
    )
  }

  async function generate() {
    if (!voyageConfig?.id) { showToast('Set up voyage first.', 'error'); return }
    if (!numDays) { showToast('Voyage dates are required.', 'error'); return }
    if (!selectedSlots.length) { showToast('Select at least one meal slot.', 'error'); return }
    if (!stores.length) { showToast('Add stores before generating a meal plan.', 'error'); return }
    setGenerating(true)
    setDraftPlan(null)
    setDraftFromDay(null)
    setPlanProgress(null)
    try {
      const plan = await generateMealPlanAI({
        stores, numDays, numCrew, userSuggestions: suggestions, selectedSlots, historicalRatings,
        onProgress: ({ chunk, total }) => setPlanProgress({ chunk, total }),
      })
      setDraftPlan(plan)
    } catch (err) {
      showToast(err.message || 'AI generation failed.', 'error')
    } finally {
      setGenerating(false)
      setPlanProgress(null)
    }
  }

  async function generateFromDay() {
    if (!voyageConfig?.id) { showToast('Set up voyage first.', 'error'); return }
    if (!selectedSlots.length) { showToast('Select at least one meal slot.', 'error'); return }
    if (!stores.length) { showToast('No stores found.', 'error'); return }
    setGenerating(true)
    setDraftPlan(null)
    setDraftFromDay(null)
    setPlanProgress(null)
    try {
      const plan = await generateMealPlanAI({
        stores, numDays, numCrew, userSuggestions: suggestions, selectedSlots, historicalRatings,
        fromDay: regenFromDay,
        onProgress: ({ chunk, total }) => setPlanProgress({ chunk, total }),
      })
      setDraftPlan(plan)
      setDraftFromDay(regenFromDay)
    } catch (err) {
      showToast(err.message || 'AI generation failed.', 'error')
    } finally {
      setGenerating(false)
      setPlanProgress(null)
    }
  }

  async function saveDraft() {
    if (!draftPlan?.length) return
    setSavingPlan(true)
    try {
      if (draftFromDay !== null) {
        // Partial regen — preserve cooked meals, only replace uncooked from draftFromDay onward
        await savePartialMealPlan(voyageConfig.id, draftFromDay, draftPlan)
      } else {
        await saveMealPlan(voyageConfig.id, draftPlan)
      }
      setDraftPlan(null)
      setDraftFromDay(null)
      await loadMeals()
      showToast(draftFromDay !== null ? `Plan updated from day ${draftFromDay} onward.` : 'Meal plan saved.')
    } catch (err) {
      showToast(err.message || 'Failed to save plan.', 'error')
    } finally {
      setSavingPlan(false)
    }
  }

  // ── DnD handlers ──

  function handleDragStart({ active }) {
    setActiveDragId(active.id)
  }

  async function handleDragEnd({ active, over }) {
    setActiveDragId(null)
    if (!over) return
    // over.id format: "${dayNumber}|${slotName}"
    const [dayStr, targetSlot] = over.id.split('|')
    const targetDay = parseInt(dayStr, 10)
    const draggedMeal = meals.find((m) => m.id === active.id)
    if (!draggedMeal) return
    if (draggedMeal.day_number === targetDay && draggedMeal.meal_slot === targetSlot) return
    if (draggedMeal.cooked) return

    const targetMeal = meals.find(
      (m) => m.day_number === targetDay && m.meal_slot === targetSlot
    )
    if (targetMeal?.cooked) { showToast('Cannot swap with a cooked meal.', 'error'); return }

    // Optimistic update
    const newMeals = meals.map((m) => {
      if (m.id === draggedMeal.id) return { ...m, day_number: targetDay, meal_slot: targetSlot }
      if (targetMeal && m.id === targetMeal.id)
        return { ...m, day_number: draggedMeal.day_number, meal_slot: draggedMeal.meal_slot }
      return m
    })
    setMeals(newMeals)
    cacheWrite(voyageConfig.id, newMeals)

    try {
      const updates = [
        updateMealItem(draggedMeal.id, { day_number: targetDay, meal_slot: targetSlot }),
      ]
      if (targetMeal) {
        updates.push(
          updateMealItem(targetMeal.id, {
            day_number: draggedMeal.day_number,
            meal_slot: draggedMeal.meal_slot,
          })
        )
      }
      await Promise.all(updates)
    } catch (err) {
      showToast(err.message || 'Failed to save swap.', 'error')
      loadMeals()
    }
  }

  if (!voyageConfig) {
    return (
      <div className="text-center py-10 text-slate-400">
        <ChefHat size={32} className="mx-auto mb-2 opacity-40" />
        <p>Configure your voyage in the Setup tab first.</p>
      </div>
    )
  }

  // Group meals by day
  const mealsByDay = {}
  for (const meal of meals) {
    if (!mealsByDay[meal.day_number]) mealsByDay[meal.day_number] = {}
    mealsByDay[meal.day_number][meal.meal_slot] = meal
  }

  // Group draft by day
  const draftByDay = {}
  if (draftPlan) {
    for (const meal of draftPlan) {
      if (!draftByDay[meal.day_number]) draftByDay[meal.day_number] = {}
      draftByDay[meal.day_number][meal.meal_slot] = meal
    }
  }

  const activeMeal = activeDragId ? meals.find((m) => m.id === activeDragId) : null

  return (
    <div>
      {/* Generate panel */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-[#0A4A52] mb-3 flex items-center gap-2">
          <ChefHat size={16} /> AI Meal Plan Generator
        </h3>
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">Suggestions for the AI</label>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0A4A52]"
            rows={3}
            value={suggestions}
            onChange={(e) => setSuggestions(e.target.value)}
            placeholder="e.g. Focus on the salmon fillets, 2 pasta nights, light lunches, no beef…"
          />
        </div>
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-2">Meal slots to include</label>
          <div className="flex gap-3">
            {SLOT_ORDER.map((slot) => (
              <label key={slot} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={selectedSlots.includes(slot)} onChange={() => toggleSlot(slot)} className="accent-[#0A4A52]" />
                {SLOT_LABELS[slot]}
              </label>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C4603A] px-4 py-2 text-sm text-white hover:bg-[#a84e30] disabled:opacity-50 transition"
        >
          {generating ? <Loader size={16} className="animate-spin" /> : <ChefHat size={16} />}
          {generating
            ? planProgress
              ? `Generating week ${planProgress.chunk} of ${planProgress.total}…`
              : 'Generating meal plan…'
            : 'Generate Full Plan'}
        </button>

        {/* Mid-voyage regen */}
        {meals.length > 0 && !draftPlan && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-600 mb-2">Regenerate part of your plan</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-slate-600">From day</span>
              <select
                value={regenFromDay}
                onChange={(e) => setRegenFromDay(Number(e.target.value))}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A52]"
                disabled={generating}
              >
                {Array.from({ length: numDays }, (_, i) => i + 1).map((d) => {
                  const date = voyageConfig.start_date
                    ? new Date(new Date(voyageConfig.start_date).getTime() + (d - 1) * 86400000)
                        .toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                    : ''
                  const cookedCount = Object.values(mealsByDay[d] || {}).filter((m) => m.cooked).length
                  return (
                    <option key={d} value={d}>
                      Day {d}{date ? ` (${date})` : ''}{cookedCount ? ` — ${cookedCount} cooked` : ''}
                    </option>
                  )
                })}
              </select>
              <span className="text-xs text-slate-400">{numDays - regenFromDay + 1} day{numDays - regenFromDay + 1 !== 1 ? 's' : ''} to regenerate</span>
              <button
                type="button"
                onClick={generateFromDay}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0A4A52] px-4 py-2 text-sm text-white hover:bg-[#083b42] disabled:opacity-50 transition"
              >
                {generating ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {generating
                  ? planProgress
                    ? `Week ${planProgress.chunk} of ${planProgress.total}…`
                    : 'Generating…'
                  : 'Regenerate'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Uses your suggestions above and previous ratings. Cooked meals are preserved.
            </p>
          </div>
        )}

        {/* Re-optimise from today shortcut */}
        {meals.length > 0 && !draftPlan && (() => {
          const today = currentVoyageDay(voyageConfig?.start_date)
          const urgentPerishables = stores.filter((s) => {
            if (!s.shelf_life_days || s.quantity <= 0) return false
            const daysLeft = s.shelf_life_days - (today || 1) + 1
            return daysLeft !== null && daysLeft <= 3 && s.shelf_life_days < 60
          })
          if (!today || urgentPerishables.length === 0) return null
          return (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3 flex-wrap">
              <div>
                <p className="text-xs font-medium text-red-700">
                  {urgentPerishables.length} perishable{urgentPerishables.length !== 1 ? 's' : ''} expiring within 3 days
                </p>
                <p className="text-xs text-slate-400">
                  {urgentPerishables.map((s) => s.name).join(', ')}
                </p>
              </div>
              <button
                type="button"
                disabled={generating}
                onClick={() => {
                  setRegenFromDay(today)
                  setSuggestions((prev) =>
                    prev
                      ? prev
                      : `Prioritise using these urgent perishables in the next few days: ${urgentPerishables.map((s) => s.name).join(', ')}`
                  )
                  generateFromDay()
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-50 transition shrink-0"
              >
                <RefreshCw size={13} /> Re-optimise from Day {today}
              </button>
            </div>
          )
        })()}
      </div>

      {/* Generate all recipes banner */}
      {meals.length > 0 && meals.some((m) => !m.recipe) && !draftPlan && (
        <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-[#0A4A52]">
            {generatingRecipes
              ? `Generating recipes… ${recipeProgress?.done ?? 0} of ${recipeProgress?.total ?? 0}`
              : `${meals.filter((m) => !m.recipe).length} meal${meals.filter((m) => !m.recipe).length !== 1 ? 's' : ''} missing recipes — generate while online for offline access.`}
          </p>
          <button
            type="button"
            onClick={generateAllRecipes}
            disabled={generatingRecipes}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0A4A52] px-3 py-1.5 text-xs text-white hover:bg-[#083b42] disabled:opacity-50 transition shrink-0"
          >
            {generatingRecipes ? <Loader size={13} className="animate-spin" /> : <BookOpen size={13} />}
            {generatingRecipes ? 'Generating…' : 'Generate All Recipes'}
          </button>
        </div>
      )}

      {/* Re-sync ingredients banner — shown when meals have recipes */}
      {meals.length > 0 && meals.some((m) => m.recipe) && !draftPlan && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-amber-800">
            {syncingIngredients
              ? `Re-syncing ingredients… ${syncProgress?.done ?? 0} of ${syncProgress?.total ?? 0}`
              : 'Re-sync ingredients from recipe text to ensure the shopping list is complete.'}
          </p>
          <button
            type="button"
            onClick={resyncAllIngredients}
            disabled={syncingIngredients}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50 transition shrink-0"
          >
            {syncingIngredients ? <Loader size={13} className="animate-spin" /> : null}
            {syncingIngredients ? 'Syncing…' : 'Re-sync All Ingredients'}
          </button>
        </div>
      )}

      {/* Draft preview */}
      {draftPlan && (
        <div className="mb-6 rounded-xl border-2 border-[#C4603A] bg-orange-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#C4603A]">
              {draftFromDay !== null
                ? `AI Draft — Days ${draftFromDay}–${numDays} (cooked meals preserved)`
                : 'AI Draft — Review before saving'}
            </h3>
            <div className="flex gap-2">
              <button type="button" onClick={generate} disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C4603A] px-3 py-1.5 text-xs text-[#C4603A] hover:bg-orange-100 disabled:opacity-50 transition">
                <RefreshCw size={13} /> Regenerate
              </button>
              <button type="button" onClick={saveDraft} disabled={savingPlan}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A4A52] px-3 py-1.5 text-xs text-white hover:bg-[#083b42] disabled:opacity-50 transition">
                {savingPlan ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
                {savingPlan ? 'Saving…' : 'Save Plan'}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {Object.entries(draftByDay).sort(([a], [b]) => Number(a) - Number(b)).map(([day, slots]) => {
              const dayCalories = SLOT_ORDER.reduce((sum, s) => sum + (slots[s]?.calories || 0), 0)
              const dayCalPerPerson = dayCalories && numCrew ? Math.round(dayCalories / numCrew) : null
              return (
                <div key={day}>
                  <div className="flex items-center gap-3 mb-1.5">
                    <p className="text-xs font-bold text-[#0A4A52]">Day {day}</p>
                    {dayCalPerPerson && <span className="text-xs text-slate-400">~{dayCalPerPerson} cal/person</span>}
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2">
                    {SLOT_ORDER.filter((s) => slots[s]).map((slot) => {
                      const m = slots[slot]
                      const cal = m.calories && numCrew ? Math.round(m.calories / numCrew) : null
                      return (
                        <div key={slot} className="rounded-lg bg-white border border-orange-200 p-2.5">
                          <p className="text-xs text-[#C4603A] font-semibold mb-1">{SLOT_LABELS[slot]}</p>
                          <p className="text-sm font-medium text-slate-800">{m.meal_name}</p>
                          {cal && <p className="text-xs text-slate-400 mt-0.5">~{cal} cal/person</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Saved plan — hidden while draft pending */}
      {draftPlan ? null : loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader size={16} className="animate-spin" /> Loading meal plan…
        </div>
      ) : meals.length === 0 ? (
        <div className="text-center py-10 text-slate-400">
          <p>No meal plan yet. Generate one with AI above.</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="space-y-4">
            {Array.from({ length: numDays }, (_, i) => i + 1).map((day) => {
              const dayMeals = mealsByDay[day] || {}
              const dayCalories = SLOT_ORDER.reduce((sum, s) => sum + (dayMeals[s]?.calories || 0), 0)
              const dayCalPerPerson = dayCalories && numCrew ? Math.round(dayCalories / numCrew) : null
              return (
                <div key={day} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-[#0A4A52] px-4 py-2 text-sm font-semibold text-white flex items-center gap-3">
                    <span>
                      Day {day}
                      {voyageConfig.start_date && (
                        <span className="ml-2 text-xs text-teal-200 font-normal">
                          {new Date(new Date(voyageConfig.start_date).getTime() + (day - 1) * 86400000)
                            .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </span>
                    {dayCalPerPerson && (
                      <span className="text-xs text-teal-300 font-normal ml-auto">~{dayCalPerPerson} cal/person/day</span>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-3 bg-white p-3 gap-3">
                    {SLOT_ORDER.map((slot) => (
                      <div key={slot}>
                        <p className="text-xs font-semibold text-[#C4603A] mb-2">{SLOT_LABELS[slot]}</p>
                        <DroppableSlot id={`${day}|${slot}`}>
                          {dayMeals[slot] ? (
                            <DraggableMeal
                              meal={dayMeals[slot]}
                              onUpdate={loadMeals}
                              onCookedToggle={handleCookedToggle}
                              numCrew={numCrew}
                              showToast={showToast}
                            />
                          ) : (
                            <p className="text-xs text-slate-300 italic px-2">Not planned</p>
                          )}
                        </DroppableSlot>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <DragOverlay>
            {activeMeal ? (
              <MealCard meal={activeMeal} numCrew={numCrew} compact
                onUpdate={() => {}} onCookedToggle={() => {}} showToast={() => {}} />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}
