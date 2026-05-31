import { useState, useEffect } from 'react'
import { ShoppingCart, Loader, Check, Copy, ClipboardCheck, BarChart2 } from 'lucide-react'
import {
  getMealPlan,
  getShoppingList,
  saveShoppingList,
  updateShoppingItem,
  generateShoppingListAI,
  categorizeItemsAI,
  upsertStoreByName,
} from './GalleyUtils'
import { inferCategory } from './shelfLife'

// Woolworths Birkdale aisle order (produce entry → back wall dairy/frozen → centre aisles)
const WOOLWORTHS_SECTIONS = [
  { label: 'Fresh Produce', categories: ['Fruit', 'Vegetables'] },
  { label: 'Meat & Seafood', categories: ['Proteins'] },
  { label: 'Dairy & Eggs', categories: ['Dairy'] },
  { label: 'Frozen Foods', categories: ['Frozen'] },
  { label: 'Canned & Jarred', categories: ['Canned'] },
  { label: 'Pantry & Dry Goods', categories: ['Dry Goods'] },
  { label: 'Condiments & Sauces', categories: ['Condiments'] },
  { label: 'Drinks & Beverages', categories: ['Drinks'] },
  { label: 'Other', categories: ['Other'] },
]

function categoryToWoolworthsSection(category) {
  return WOOLWORTHS_SECTIONS.find((s) => s.categories.includes(category)) || WOOLWORTHS_SECTIONS[WOOLWORTHS_SECTIONS.length - 1]
}

function groupByCategory(items) {
  const groups = {}
  for (const item of items) {
    const cat = item.category || 'Other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  }
  return groups
}

function findStoreMatch(name, stores) {
  const lower = name.toLowerCase()
  return (
    stores.find((s) => s.name.toLowerCase() === lower) ||
    stores.find((s) => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()))
  )
}

function buildRawIngredients(meals, stores) {
  const map = {}
  for (const meal of meals) {
    for (const ing of Array.isArray(meal.ingredients) ? meal.ingredients : []) {
      const key = (ing.name || '').toLowerCase().trim()
      if (!key) continue
      if (!map[key]) map[key] = { name: ing.name, quantity: 0, unit: ing.unit || '', category: 'Other' }
      map[key].quantity += Number(ing.quantity) || 0
    }
  }
  return Object.values(map).map((ing) => {
    const match = findStoreMatch(ing.name, stores)
    const inStore = match ? Number(match.quantity) || 0 : 0
    const need = Math.max(0, ing.quantity - inStore)
    const section = match?.category || 'Other'
    return { ...ing, inStore, need, category: section }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

function copyForKeep(title, sections) {
  const lines = [title, '']
  for (const { heading, items } of sections) {
    if (!items.length) continue
    lines.push(heading)
    for (const item of items) {
      lines.push(`${item.name} ${item.qty}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

export default function ShoppingList({ voyageConfig, stores, showToast, onStoresUpdated }) {
  const [activeView, setActiveView] = useState('list')    // 'list' | 'raw'
  const [listFormat, setListFormat] = useState('category') // 'category' | 'woolworths'
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [toggling, setToggling] = useState({})
  const [rawIngredients, setRawIngredients] = useState([])
  const [loadingRaw, setLoadingRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (voyageConfig?.id) loadList()
  }, [voyageConfig?.id])

  useEffect(() => {
    if (activeView === 'raw' && voyageConfig?.id) loadRaw()
  }, [activeView, voyageConfig?.id])

  async function loadList() {
    if (!voyageConfig?.id) return
    setLoading(true)
    try {
      const data = await getShoppingList(voyageConfig.id)
      setList(data || [])
    } catch (err) {
      showToast(err.message || 'Failed to load shopping list.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function loadRaw() {
    if (!voyageConfig?.id) return
    setLoadingRaw(true)
    try {
      const meals = await getMealPlan(voyageConfig.id)
      setRawIngredients(buildRawIngredients(meals || [], stores))
    } catch (err) {
      showToast(err.message || 'Failed to load ingredients.', 'error')
    } finally {
      setLoadingRaw(false)
    }
  }

  // Apply keyword lookup then AI for anything still 'Other'
  async function applyCategories(items) {
    // Step 1: keyword inference
    const withKeyword = items.map((item) => ({
      ...item,
      category: item.category !== 'Other' ? item.category : inferCategory(item.item_name || item.name),
    }))
    // Step 2: batch AI for remaining unknowns
    const stillOther = withKeyword.filter((i) => i.category === 'Other').map((i) => i.item_name || i.name)
    if (stillOther.length) {
      try {
        const aiMap = await categorizeItemsAI(stillOther)
        return withKeyword.map((item) => {
          const key = item.item_name || item.name
          return item.category === 'Other' && aiMap[key] ? { ...item, category: aiMap[key] } : item
        })
      } catch { /* leave as Other if AI fails */ }
    }
    return withKeyword
  }

  // Deterministic: aggregate all meal ingredients, subtract stores, categorize, save.
  async function generate() {
    if (!voyageConfig?.id) { showToast('Set up voyage first.', 'error'); return }
    setGenerating(true)
    try {
      const meals = await getMealPlan(voyageConfig.id)
      const raw = buildRawIngredients(meals || [], stores)
      const needed = raw
        .filter((ing) => ing.need > 0)
        .map((ing) => ({
          item_name: ing.name,
          quantity: Math.round(ing.need * 100) / 100,
          unit: ing.unit,
          category: ing.category,
        }))
      if (!needed.length) {
        showToast('All ingredients are covered by your current stores.')
        setGenerating(false)
        return
      }
      const categorized = await applyCategories(needed)
      const saved = await saveShoppingList(voyageConfig.id, categorized)
      setList(saved || [])
      showToast(`${categorized.length} items calculated and categorised.`)
    } catch (err) {
      showToast(err.message || 'Failed to generate list.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  // AI fallback: asks the AI to suggest practical pack sizes and round quantities.
  // Less accurate for counts but useful for formatting purchase quantities.
  async function generateAI() {
    if (!voyageConfig?.id) { showToast('Set up voyage first.', 'error'); return }
    setGenerating(true)
    try {
      const meals = await getMealPlan(voyageConfig.id)
      const items = await generateShoppingListAI({ stores, meals })
      const saved = await saveShoppingList(voyageConfig.id, items)
      setList(saved || [])
      showToast('AI shopping list generated.')
    } catch (err) {
      showToast(err.message || 'AI generation failed.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function togglePurchased(item) {
    setToggling((t) => ({ ...t, [item.id]: true }))
    try {
      const nowPurchased = !item.purchased
      await updateShoppingItem(item.id, { purchased: nowPurchased })
      setList((prev) => prev.map((i) => i.id === item.id ? { ...i, purchased: nowPurchased } : i))
      if (nowPurchased) {
        try {
          await upsertStoreByName(
            { name: item.item_name, quantity: item.quantity, category: item.category, unit: item.unit },
            stores
          )
          showToast(`${item.item_name} added to stores.`)
          if (onStoresUpdated) onStoresUpdated()
        } catch (err) {
          showToast(err.message || 'Failed to update stores.', 'error')
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to update item.', 'error')
    } finally {
      setToggling((t) => ({ ...t, [item.id]: false }))
    }
  }

  function handleCopy() {
    let title, sections

    if (activeView === 'raw') {
      title = `Ingredient Requirements — ${voyageConfig?.voyage_name || 'Amaroo Voyage'}`
      const grouped = groupByCategory(rawIngredients)
      sections = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => ({
        heading: `--- ${cat.toUpperCase()} ---`,
        items: items.map((i) => ({ name: i.name, qty: `${i.need > 0 ? i.need : i.quantity} ${i.unit}`.trim() })),
      }))
    } else if (listFormat === 'woolworths') {
      title = `Shopping List — Woolworths Birkdale\n${voyageConfig?.voyage_name || 'Amaroo Voyage'}`
      sections = WOOLWORTHS_SECTIONS.map((section) => ({
        heading: `--- ${section.label.toUpperCase()} ---`,
        items: list
          .filter((i) => !i.purchased && section.categories.includes(i.category || 'Other'))
          .map((i) => ({ name: i.item_name, qty: `${i.quantity} ${i.unit}`.trim() })),
      }))
    } else {
      title = `Shopping List — ${voyageConfig?.voyage_name || 'Amaroo Voyage'}`
      const grouped = groupByCategory(list.filter((i) => !i.purchased))
      sections = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => ({
        heading: `--- ${cat.toUpperCase()} ---`,
        items: items.map((i) => ({ name: i.item_name, qty: `${i.quantity} ${i.unit}`.trim() })),
      }))
    }

    const text = copyForKeep(title, sections)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => showToast('Copy failed — clipboard not available.', 'error'))
  }

  if (!voyageConfig) {
    return (
      <div className="text-center py-10 text-slate-400">
        <ShoppingCart size={32} className="mx-auto mb-2 opacity-40" />
        <p>Configure your voyage in the Setup tab first.</p>
      </div>
    )
  }

  const purchasedCount = list.filter((i) => i.purchased).length

  // Build the display list based on format
  function renderShoppingItems() {
    const unpurchased = list.filter((i) => !i.purchased)
    const purchased = list.filter((i) => i.purchased)

    if (listFormat === 'woolworths') {
      return (
        <div className="space-y-4">
          <p className="text-xs text-slate-400 px-1 flex items-center gap-1">
            🛒 Woolworths Birkdale aisle order — Tick when purchased, auto-added to stores.
          </p>
          {WOOLWORTHS_SECTIONS.map((section) => {
            const items = unpurchased.filter((i) => section.categories.includes(i.category || 'Other'))
            if (!items.length) return null
            return (
              <div key={section.label} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="bg-teal-50 px-4 py-2 text-xs font-semibold text-[#0A4A52] uppercase tracking-wide border-b border-slate-200">
                  {section.label}
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((item) => <ShoppingRow key={item.id} item={item} toggling={toggling} onToggle={togglePurchased} />)}
                </div>
              </div>
            )
          })}
          {purchased.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-200">
                Purchased ({purchased.length})
              </div>
              <div className="divide-y divide-slate-100">
                {purchased.map((item) => <ShoppingRow key={item.id} item={item} toggling={toggling} onToggle={togglePurchased} />)}
              </div>
            </div>
          )}
        </div>
      )
    }

    // Category format
    const grouped = groupByCategory(list)
    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-400 px-1">Tick when purchased — auto-added to stores.</p>
        {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
          <div key={cat} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="bg-teal-50 px-4 py-2 text-xs font-semibold text-[#0A4A52] uppercase tracking-wide border-b border-slate-200">
              {cat}
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((item) => <ShoppingRow key={item.id} item={item} toggling={toggling} onToggle={togglePurchased} />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Top toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        {/* View toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setActiveView('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm transition ${activeView === 'list' ? 'bg-[#0A4A52] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <ShoppingCart size={14} /> List
          </button>
          <button
            type="button"
            onClick={() => setActiveView('raw')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm transition ${activeView === 'raw' ? 'bg-[#0A4A52] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <BarChart2 size={14} /> Raw Ingredients
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Format toggle (list view only) */}
          {activeView === 'list' && list.length > 0 && (
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setListFormat('category')}
                className={`px-3 py-1.5 transition ${listFormat === 'category' ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                By Category
              </button>
              <button
                type="button"
                onClick={() => setListFormat('woolworths')}
                className={`px-3 py-1.5 transition ${listFormat === 'woolworths' ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                🛒 Woolworths Birkdale
              </button>
            </div>
          )}

          {/* Copy for Google Keep */}
          {(list.length > 0 || rawIngredients.length > 0) && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              {copied ? <ClipboardCheck size={14} className="text-green-600" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy for Keep'}
            </button>
          )}

          {/* Generate buttons */}
          {activeView === 'list' && (
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={generate}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg bg-[#C4603A] px-4 py-2 text-sm text-white hover:bg-[#a84e30] disabled:opacity-50 transition"
                title="Calculates exactly what's needed based on meal plan minus current stores"
              >
                {generating ? <Loader size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
                {generating ? 'Calculating…' : list.length ? 'Recalculate' : 'Calculate List'}
              </button>
              <button
                type="button"
                onClick={generateAI}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
                title="Uses AI to suggest practical pack sizes — less accurate for item counts"
              >
                {generating ? <Loader size={14} className="animate-spin" /> : null}
                AI Suggestions
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {activeView === 'list' && list.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${list.length ? (purchasedCount / list.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 shrink-0">{purchasedCount}/{list.length} purchased</span>
        </div>
      )}

      {/* Raw ingredients view */}
      {activeView === 'raw' && (
        <RawIngredientsView
          ingredients={rawIngredients}
          loading={loadingRaw}
          saving={generating}
          onSaveAsList={async () => {
            if (!voyageConfig?.id) return
            setGenerating(true)
            try {
              const needed = rawIngredients
                .filter((ing) => ing.need > 0)
                .map((ing) => ({
                  item_name: ing.name,
                  quantity: Math.round(ing.need * 100) / 100,
                  unit: ing.unit,
                  category: ing.category,
                }))
              const categorized = await applyCategories(needed)
              const saved = await saveShoppingList(voyageConfig.id, categorized)
              setList(saved || [])
              setActiveView('list')
              showToast(`${categorized.length} items saved and categorised.`)
            } catch (err) {
              showToast(err.message || 'Failed to save.', 'error')
            } finally {
              setGenerating(false)
            }
          }}
        />
      )}

      {/* Shopping list view */}
      {activeView === 'list' && (
        loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
            <Loader size={16} className="animate-spin" /> Loading…
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <ShoppingCart size={32} className="mx-auto mb-2 opacity-40" />
            <p>No shopping list yet. Generate one based on your meal plan and current stores.</p>
            <p className="text-xs mt-1">Make sure your meal plan is saved first.</p>
          </div>
        ) : renderShoppingItems()
      )}
    </div>
  )
}

function ShoppingRow({ item, toggling, onToggle }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 text-sm transition ${item.purchased ? 'bg-slate-50 opacity-60' : ''}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <button
          type="button"
          onClick={() => !toggling[item.id] && onToggle(item)}
          disabled={toggling[item.id]}
          className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
            item.purchased ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'
          } disabled:opacity-50`}
        >
          {toggling[item.id]
            ? <Loader size={10} className="animate-spin text-slate-400" />
            : item.purchased && <Check size={12} />}
        </button>
        <span className={`font-medium ${item.purchased ? 'line-through text-slate-400' : 'text-slate-800'}`}>
          {item.item_name}
        </span>
      </div>
      <span className="text-slate-500 text-xs shrink-0">{item.quantity} {item.unit}</span>
    </div>
  )
}

function RawIngredientsView({ ingredients, loading, onSaveAsList, saving }) {
  const [showAll, setShowAll] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
        <Loader size={16} className="animate-spin" /> Loading ingredients…
      </div>
    )
  }
  if (!ingredients.length) {
    return (
      <div className="text-center py-10 text-slate-400">
        <p>No meal plan ingredients found. Save a meal plan first.</p>
      </div>
    )
  }

  const needToBuy = ingredients.filter((i) => i.need > 0)
  const alreadyHave = ingredients.filter((i) => i.need === 0)
  const display = showAll ? ingredients : needToBuy

  const totalIngredients = ingredients.length
  const gapCount = needToBuy.length

  return (
    <div>
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-4 text-sm flex-wrap">
        <div className="text-center">
          <p className="text-lg font-bold text-[#0A4A52]">{totalIngredients}</p>
          <p className="text-xs text-slate-500">total ingredients</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-[#C4603A]">{gapCount}</p>
          <p className="text-xs text-slate-500">need to buy</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-green-600">{alreadyHave.length}</p>
          <p className="text-xs text-slate-500">in stores</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition"
          >
            {showAll ? 'Show gaps only' : 'Show all ingredients'}
          </button>
          {needToBuy.length > 0 && onSaveAsList && (
            <button
              type="button"
              onClick={onSaveAsList}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs rounded-lg bg-[#C4603A] px-3 py-1.5 text-white hover:bg-[#a84e30] disabled:opacity-50 transition"
            >
              {saving ? <Loader size={11} className="animate-spin" /> : <ShoppingCart size={11} />}
              {saving ? 'Saving…' : `Save ${needToBuy.length} gaps as Shopping List`}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 mb-3 px-1">
        {showAll ? 'All meal plan ingredients vs current stores.' : 'Ingredients where stores are insufficient. Switch to "Show all" to see the full picture.'}
      </p>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-4 py-2 bg-teal-50 border-b border-slate-200 text-xs font-semibold text-[#0A4A52] uppercase tracking-wide">
          <span>Ingredient</span>
          <span className="text-right">Need</span>
          <span className="text-right">In stores</span>
          <span className="text-right">Buy</span>
        </div>
        <div className="divide-y divide-slate-100">
          {display.map((ing, i) => (
            <div key={i} className={`grid grid-cols-[1fr_80px_80px_80px] gap-2 px-4 py-2 text-sm ${ing.need > 0 ? '' : 'opacity-50'}`}>
              <span className="font-medium text-slate-800">{ing.name}</span>
              <span className="text-right text-slate-500 text-xs">{ing.quantity} {ing.unit}</span>
              <span className="text-right text-green-700 text-xs">{ing.inStore} {ing.unit}</span>
              <span className={`text-right text-xs font-semibold ${ing.need > 0 ? 'text-[#C4603A]' : 'text-slate-300'}`}>
                {ing.need > 0 ? `${ing.need} ${ing.unit}` : '✓'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
