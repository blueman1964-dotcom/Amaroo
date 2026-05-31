import { useRef, useState, useEffect } from 'react'
import { Camera, ScanLine, Trash2, Loader, AlertCircle, CheckCircle, ShoppingBag, Check, X } from 'lucide-react'
import { scanReceiptForStores, getShoppingList, addStoreItems, STORE_CATEGORIES } from './GalleyUtils'
import { estimateShelfLifeDays } from './shelfLife'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function normalise(name) {
  return (name || '').toLowerCase().trim()
}

function deduplicateItems(rawItems) {
  const map = {}
  for (const item of rawItems) {
    const key = normalise(item.name)
    if (!key) continue
    if (!map[key]) {
      map[key] = { ...item, quantity: Number(item.quantity) || 1 }
    } else {
      // Same item across multiple photos — sum quantities
      map[key].quantity = (Number(map[key].quantity) || 0) + (Number(item.quantity) || 0)
    }
  }
  return Object.values(map).map((item, i) => ({
    ...item,
    _key: `receipt-${i}-${Date.now()}`,
    included: true,
    onShoppingList: false, // set after comparison
  }))
}

export default function ReceiptScanner({ voyageConfigId, onStoresUpdated, showToast }) {
  const cameraRef = useRef(null)
  const [queue, setQueue] = useState([])   // [{ id, imageBase64, status, rawItems, error }]
  const [scanning, setScanning] = useState(false)
  const [reviewItems, setReviewItems] = useState([]) // deduplicated items for review
  const [saving, setSaving] = useState(false)
  const [shoppingList, setShoppingList] = useState([])

  useEffect(() => {
    if (voyageConfigId) {
      getShoppingList(voyageConfigId)
        .then((rows) => setShoppingList(rows || []))
        .catch(() => setShoppingList([]))
    }
  }, [voyageConfigId])

  async function handleCapture(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const newItems = await Promise.all(files.map(async (file) => ({
      id: crypto.randomUUID(),
      imageBase64: await fileToBase64(file),
      status: 'pending',
      rawItems: [],
      error: null,
    })))
    setQueue((q) => [...q, ...newItems])
    e.target.value = ''
    // Clear review when new photos added
    setReviewItems([])
  }

  async function scanAll() {
    const pending = queue.filter((i) => i.status === 'pending')
    if (!pending.length) return
    setScanning(true)
    setReviewItems([])

    const updatedQueue = [...queue]

    for (const item of pending) {
      const idx = updatedQueue.findIndex((q) => q.id === item.id)
      updatedQueue[idx] = { ...updatedQueue[idx], status: 'scanning' }
      setQueue([...updatedQueue])

      try {
        const rawItems = await scanReceiptForStores(item.imageBase64)
        updatedQueue[idx] = { ...updatedQueue[idx], status: 'done', rawItems }
      } catch (err) {
        updatedQueue[idx] = { ...updatedQueue[idx], status: 'error', error: err.message }
      }
      setQueue([...updatedQueue])
    }

    setScanning(false)

    // Collect all raw items from all done scans and deduplicate
    const allRaw = updatedQueue.filter((q) => q.status === 'done').flatMap((q) => q.rawItems)
    if (!allRaw.length) {
      showToast('No items found in receipts.', 'error')
      return
    }
    const deduped = deduplicateItems(allRaw)

    // Tag items that are on the shopping list
    const slNames = shoppingList.map((s) => normalise(s.item_name))
    const tagged = deduped.map((item) => ({
      ...item,
      onShoppingList: slNames.some((n) => n.includes(normalise(item.name)) || normalise(item.name).includes(n)),
    }))

    setReviewItems(tagged)
  }

  function updateItem(key, field, value) {
    setReviewItems((prev) =>
      prev.map((i) => i._key === key ? { ...i, [field]: value } : i)
    )
  }

  function removeItem(key) {
    setReviewItems((prev) => prev.filter((i) => i._key !== key))
  }

  async function saveSelected() {
    const selected = reviewItems.filter((i) => i.included)
    if (!selected.length) { showToast('No items selected.', 'error'); return }
    setSaving(true)
    try {
      await addStoreItems(
        selected.map(({ name, category, quantity, unit }) => ({
          name: name || 'Unknown',
          category: category || 'Other',
          quantity: Number(quantity) || 1,
          unit: unit || '',
        }))
      )
      showToast(`${selected.length} item${selected.length !== 1 ? 's' : ''} added to stores.`)
      setQueue([])
      setReviewItems([])
      onStoresUpdated()
    } catch (err) {
      showToast(err.message || 'Failed to save items.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const pendingCount = queue.filter((q) => q.status === 'pending').length
  const doneCount = queue.filter((q) => q.status === 'done').length
  const selectedCount = reviewItems.filter((i) => i.included).length

  return (
    <div>
      {/* Photo controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg bg-[#C4603A] px-4 py-2 text-sm text-white hover:bg-[#a84e30] transition">
          <Camera size={16} />
          {queue.length === 0 ? 'Photograph Receipt' : 'Add More Photos'}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={handleCapture}
          />
        </label>

        {pendingCount > 0 && (
          <button
            type="button"
            onClick={scanAll}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0A4A52] px-4 py-2 text-sm text-white hover:bg-[#083b42] disabled:opacity-50 transition"
          >
            {scanning ? <Loader size={16} className="animate-spin" /> : <ScanLine size={16} />}
            {scanning ? 'Reading receipt…' : `Scan ${pendingCount} photo${pendingCount !== 1 ? 's' : ''}`}
          </button>
        )}

        {queue.length > 0 && !scanning && (
          <button
            type="button"
            onClick={() => { setQueue([]); setReviewItems([]) }}
            className="text-xs text-slate-400 hover:text-red-500 transition"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Photo queue status */}
      {queue.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {queue.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border ${
                item.status === 'pending' ? 'bg-slate-50 border-slate-200 text-slate-500' :
                item.status === 'scanning' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                item.status === 'done' ? 'bg-green-50 border-green-200 text-green-700' :
                'bg-red-50 border-red-200 text-red-600'
              }`}
            >
              {item.status === 'scanning' && <Loader size={11} className="animate-spin" />}
              {item.status === 'done' && <CheckCircle size={11} />}
              {item.status === 'error' && <AlertCircle size={11} />}
              <span>
                {item.status === 'pending' && 'Ready to scan'}
                {item.status === 'scanning' && 'Reading…'}
                {item.status === 'done' && `${item.rawItems.length} items found`}
                {item.status === 'error' && (item.error || 'Scan failed')}
              </span>
              <button
                type="button"
                onClick={() => {
                  setQueue((q) => q.filter((i) => i.id !== item.id))
                  setReviewItems([])
                }}
                className="ml-1 opacity-60 hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {queue.length === 0 && reviewItems.length === 0 && (
        <p className="text-sm text-slate-400 italic">
          Photograph your receipt (long receipts can be multiple photos). Tap Scan when ready — items are deduplicated across photos before review.
        </p>
      )}

      {/* Review list */}
      {reviewItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold text-[#0A4A52]">
                Review — {reviewItems.length} item{reviewItems.length !== 1 ? 's' : ''} found
              </p>
              <p className="text-xs text-slate-400">
                Untick items not going on the boat. Edits apply before saving.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReviewItems((prev) => prev.map((i) => ({ ...i, included: true })))}
                className="text-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 transition"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setReviewItems((prev) => prev.map((i) => ({ ...i, included: false })))}
                className="text-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 transition"
              >
                Select none
              </button>
              <button
                type="button"
                onClick={saveSelected}
                disabled={saving || selectedCount === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A4A52] px-4 py-1.5 text-sm text-white hover:bg-[#083b42] disabled:opacity-50 transition"
              >
                {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Saving…' : `Add ${selectedCount} to Stores`}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {reviewItems.map((item) => (
              <div
                key={item._key}
                className={`rounded-xl border p-3 transition ${
                  item.included ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={() => updateItem(item._key, 'included', !item.included)}
                    className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                      item.included ? 'bg-[#0A4A52] border-[#0A4A52] text-white' : 'border-slate-300'
                    }`}
                  >
                    {item.included && <Check size={12} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Name row */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <input
                        className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                        value={item.name}
                        onChange={(e) => updateItem(item._key, 'name', e.target.value)}
                      />
                      {item.onShoppingList && (
                        <span className="inline-flex items-center gap-1 text-xs rounded-full bg-teal-50 border border-teal-200 text-teal-700 px-2 py-0.5 shrink-0">
                          <ShoppingBag size={10} /> On shopping list
                        </span>
                      )}
                    </div>

                    {/* Detail row */}
                    <div className="grid grid-cols-[1fr_80px_80px] gap-2">
                      <select
                        className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                        value={item.category || 'Other'}
                        onChange={(e) => updateItem(item._key, 'category', e.target.value)}
                      >
                        {STORE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        type="number"
                        className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                        value={item.quantity}
                        onChange={(e) => updateItem(item._key, 'quantity', e.target.value)}
                        placeholder="Qty"
                      />
                      <input
                        className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                        value={item.unit}
                        onChange={(e) => updateItem(item._key, 'unit', e.target.value)}
                        placeholder="unit"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item._key)}
                    className="text-slate-300 hover:text-red-400 transition shrink-0 mt-0.5"
                    title="Remove from list"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
