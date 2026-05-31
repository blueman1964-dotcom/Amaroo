import { useRef, useState } from 'react'
import { Camera, Trash2, ScanLine, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { scanImageForStores, addStoreItems, STORE_CATEGORIES } from './GalleyUtils'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ScanQueue({ onStoresUpdated, showToast }) {
  const cameraRef = useRef(null)
  const [queue, setQueue] = useState([])
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleCapture(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const newItems = await Promise.all(
      files.map(async (file) => ({
        id: crypto.randomUUID(),
        imageBase64: await fileToBase64(file),
        status: 'pending',
        results: [],
        error: null,
      }))
    )
    setQueue((q) => [...q, ...newItems])
    e.target.value = ''
  }

  async function scanAll() {
    const pending = queue.filter((i) => i.status === 'pending')
    if (!pending.length) return
    setScanning(true)
    for (const item of pending) {
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'scanning' } : i))
      try {
        const results = await scanImageForStores(item.imageBase64)
        setQueue((q) =>
          q.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: 'done',
                  results: results.map((r, idx) => ({ ...r, _key: `${item.id}-${idx}` })),
                }
              : i
          )
        )
      } catch (err) {
        setQueue((q) =>
          q.map((i) => i.id === item.id ? { ...i, status: 'error', error: err.message } : i)
        )
      }
    }
    setScanning(false)
  }

  function updateResult(itemId, key, field, value) {
    setQueue((q) =>
      q.map((i) =>
        i.id === itemId
          ? {
              ...i,
              results: i.results.map((r) =>
                r._key === key ? { ...r, [field]: value } : r
              ),
            }
          : i
      )
    )
  }

  function removeResult(itemId, key) {
    setQueue((q) =>
      q.map((i) =>
        i.id === itemId
          ? { ...i, results: i.results.filter((r) => r._key !== key) }
          : i
      )
    )
  }

  function removeQueueItem(id) {
    setQueue((q) => q.filter((i) => i.id !== id))
  }

  async function saveAll() {
    const allResults = queue.flatMap((i) => i.results)
    if (!allResults.length) return
    setSaving(true)
    try {
      await addStoreItems(
        allResults.map(({ name, category, quantity, unit }) => ({
          name: name || 'Unknown',
          category: category || 'Other',
          quantity: Number(quantity) || 0,
          unit: unit || '',
        }))
      )
      showToast(`${allResults.length} item${allResults.length !== 1 ? 's' : ''} added to stores.`)
      setQueue([])
      onStoresUpdated()
    } catch (err) {
      showToast(err.message || 'Failed to save items.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const doneItems = queue.filter((i) => i.status === 'done')
  const allResultCount = queue.flatMap((i) => i.results).length
  const pendingCount = queue.filter((i) => i.status === 'pending').length

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg bg-[#C4603A] px-4 py-2 text-sm text-white hover:bg-[#a84e30] transition">
          <Camera size={16} />
          Add Photo{queue.length > 0 ? ' (add more)' : ''}
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
            {scanning ? 'Scanning…' : `Scan All (${pendingCount})`}
          </button>
        )}

        {allResultCount > 0 && (
          <button
            type="button"
            onClick={saveAll}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm text-white hover:bg-green-800 disabled:opacity-50 transition"
          >
            {saving ? <Loader size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {saving ? 'Saving…' : `Add All to Stores (${allResultCount})`}
          </button>
        )}
      </div>

      {queue.length === 0 && (
        <p className="text-sm text-slate-500 italic">Tap "Add Photo" to photograph your stores. Multiple photos can be queued before scanning.</p>
      )}

      <div className="space-y-4">
        {queue.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                {item.status === 'pending' && <span className="text-slate-500">Pending scan</span>}
                {item.status === 'scanning' && (
                  <span className="flex items-center gap-1 text-[#0A4A52]">
                    <Loader size={14} className="animate-spin" /> AI is scanning…
                  </span>
                )}
                {item.status === 'done' && (
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircle size={14} /> {item.results.length} item{item.results.length !== 1 ? 's' : ''} found
                  </span>
                )}
                {item.status === 'error' && (
                  <span className="flex items-center gap-1 text-red-600">
                    <AlertCircle size={14} /> {item.error || 'Scan failed'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeQueueItem(item.id)}
                className="text-slate-400 hover:text-red-500 transition"
                title="Remove from queue"
              >
                <Trash2 size={15} />
              </button>
            </div>

            {item.results.length > 0 && (
              <div className="space-y-2">
                {item.results.map((r) => (
                  <div key={r._key} className="grid grid-cols-[1fr_1fr_80px_80px_32px] gap-2 items-center">
                    <input
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      value={r.name}
                      onChange={(e) => updateResult(item.id, r._key, 'name', e.target.value)}
                      placeholder="Item name"
                    />
                    <select
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      value={r.category}
                      onChange={(e) => updateResult(item.id, r._key, 'category', e.target.value)}
                    >
                      {STORE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      value={r.quantity}
                      onChange={(e) => updateResult(item.id, r._key, 'quantity', e.target.value)}
                      placeholder="Qty"
                    />
                    <input
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      value={r.unit}
                      onChange={(e) => updateResult(item.id, r._key, 'unit', e.target.value)}
                      placeholder="Unit"
                    />
                    <button
                      type="button"
                      onClick={() => removeResult(item.id, r._key)}
                      className="text-slate-400 hover:text-red-500 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
