import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X, History, Package, AlertTriangle, Wand2, Receipt } from 'lucide-react'
import { addStoreItem, updateStoreItem, deleteStoreItem, getStoresLog, STORE_CATEGORIES } from './GalleyUtils'
import {
  estimateShelfLifeDays, currentVoyageDay, daysRemaining, useByBadge, isPerishable,
} from './shelfLife'
import ScanQueue from './ScanQueue'
import ReceiptScanner from './ReceiptScanner'

const BLANK = { name: '', category: 'Other', quantity: '', unit: '' }

function groupByCategory(items) {
  const groups = {}
  for (const item of items) {
    const cat = item.category || 'Other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  }
  return groups
}

function pct(remaining, original) {
  if (!original || original <= 0) return null
  return Math.max(0, Math.min(100, (remaining / original) * 100))
}

function ProgressBar({ value }) {
  if (value === null) return <span className="text-xs text-slate-300">—</span>
  const colour = value > 50 ? 'bg-green-500' : value > 20 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{Math.round(value)}%</span>
    </div>
  )
}

function UseByBadge({ shelfLifeDays, voyageDay }) {
  const badge = useByBadge(shelfLifeDays, voyageDay)
  if (!badge) return null
  return (
    <span className={`text-xs rounded-full px-2 py-0.5 border ${badge.cls}`}>
      {badge.text}
    </span>
  )
}

function HistoryView({ stores }) {
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getStoresLog().then((r) => setLog(r || [])).catch(() => setLog([])).finally(() => setLoading(false))
  }, [])

  const consumed = {}
  for (const row of log) {
    consumed[row.store_id] = (consumed[row.store_id] || 0) + row.quantity_deducted
  }

  const sorted = [...stores].sort((a, b) => {
    const c = (a.category || '').localeCompare(b.category || '')
    return c !== 0 ? c : a.name.localeCompare(b.name)
  })

  if (loading) return <div className="py-6 text-center text-sm text-slate-400">Loading history…</div>
  if (!stores.length) return <div className="py-6 text-center text-sm text-slate-400">No stores recorded yet.</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
            <th className="text-left py-2 pr-3 font-medium">Item</th>
            <th className="text-left py-2 pr-3 font-medium">Category</th>
            <th className="text-right py-2 pr-3 font-medium">Original</th>
            <th className="text-right py-2 pr-3 font-medium">Used</th>
            <th className="text-right py-2 pr-3 font-medium">Remaining</th>
            <th className="text-left py-2 font-medium w-36">% Left</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((item) => {
            const used = consumed[item.id] || 0
            const remaining = Number(item.quantity) || 0
            const original = Number(item.original_quantity) || remaining
            const p = pct(remaining, original)
            return (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="py-2 pr-3 font-medium text-slate-800">{item.name}</td>
                <td className="py-2 pr-3 text-slate-500">{item.category || '—'}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{original > 0 ? `${original} ${item.unit || ''}` : '—'}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{used > 0 ? `${used} ${item.unit || ''}` : '—'}</td>
                <td className="py-2 pr-3 text-right font-medium text-slate-800">{remaining} {item.unit || ''}</td>
                <td className="py-2"><ProgressBar value={p} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function StoresManager({ stores, onStoresUpdated, showToast, voyageConfig }) {
  const [view, setView] = useState('current')
  const [search, setSearch] = useState('')
  const [addForm, setAddForm] = useState(BLANK)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ ...BLANK, shelf_life_days: '' })
  const [deletingId, setDeletingId] = useState(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [autoAssigning, setAutoAssigning] = useState(false)

  const voyageDay = currentVoyageDay(voyageConfig?.start_date)
  const voyageStarted = voyageDay !== null

  // Items expiring within 3 days of current voyage day
  const useSoonItems = voyageStarted
    ? stores.filter((s) => {
        if (!s.shelf_life_days || s.quantity <= 0) return false
        const d = daysRemaining(s.shelf_life_days, voyageDay)
        return d !== null && d <= 3
      }).sort((a, b) => a.shelf_life_days - b.shelf_life_days)
    : []

  const filtered = stores.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.category || '').toLowerCase().includes(search.toLowerCase())
  )
  const grouped = groupByCategory(filtered)

  async function handleAdd(e) {
    e.preventDefault()
    if (!addForm.name.trim()) { showToast('Item name is required.', 'error'); return }
    setAdding(true)
    try {
      await addStoreItem({ ...addForm, quantity: Number(addForm.quantity) || 0 })
      setAddForm(BLANK)
      onStoresUpdated()
      showToast('Item added.')
    } catch (err) {
      showToast(err.message || 'Failed to add item.', 'error')
    } finally {
      setAdding(false)
    }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditForm({
      name: item.name,
      category: item.category || 'Other',
      quantity: item.quantity ?? '',
      unit: item.unit || '',
      shelf_life_days: item.shelf_life_days ?? '',
    })
  }

  async function saveEdit(id) {
    try {
      await updateStoreItem(id, {
        ...editForm,
        quantity: Number(editForm.quantity) || 0,
        shelf_life_days: editForm.shelf_life_days !== '' ? Number(editForm.shelf_life_days) : null,
      })
      setEditingId(null)
      onStoresUpdated()
      showToast('Item updated.')
    } catch (err) {
      showToast(err.message || 'Failed to update.', 'error')
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this item from stores?')) return
    setDeletingId(id)
    try {
      await deleteStoreItem(id)
      onStoresUpdated()
      showToast('Item removed.')
    } catch (err) {
      showToast(err.message || 'Failed to delete.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function autoAssignShelfLives() {
    const toUpdate = stores.filter((s) => !s.shelf_life_days)
    if (!toUpdate.length) { showToast('All items already have shelf lives assigned.'); return }
    setAutoAssigning(true)
    try {
      await Promise.all(
        toUpdate.map((s) =>
          updateStoreItem(s.id, { shelf_life_days: estimateShelfLifeDays(s.name, s.category) })
        )
      )
      onStoresUpdated()
      showToast(`Shelf lives assigned to ${toUpdate.length} item${toUpdate.length !== 1 ? 's' : ''}.`)
    } catch (err) {
      showToast(err.message || 'Failed to assign shelf lives.', 'error')
    } finally {
      setAutoAssigning(false)
    }
  }

  return (
    <div>
      {/* Use soon alert */}
      {useSoonItems.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-red-600 shrink-0" />
            <p className="text-sm font-semibold text-red-700">Use soon — Day {voyageDay} of voyage</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {useSoonItems.map((item) => {
              const d = daysRemaining(item.shelf_life_days, voyageDay)
              const badge = useByBadge(item.shelf_life_days, voyageDay)
              return (
                <div key={item.id} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border text-xs ${badge?.cls || 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  <span className="font-medium">{item.name}</span>
                  <span>{item.quantity} {item.unit}</span>
                  <span className="opacity-70">— {d <= 0 ? 'expired' : d === 1 ? 'today' : `${d}d`}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* View toggle + controls */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button type="button" onClick={() => setView('current')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm transition ${view === 'current' ? 'bg-[#0A4A52] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            <Package size={14} /> Current
          </button>
          <button type="button" onClick={() => setView('history')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm transition ${view === 'history' ? 'bg-[#0A4A52] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            <History size={14} /> History
          </button>
        </div>

        {view === 'current' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A52] w-40"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="text-sm text-slate-500">{filtered.length}</span>
            <button type="button" onClick={autoAssignShelfLives} disabled={autoAssigning}
              title="Auto-assign shelf lives to items that don't have one"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
              <Wand2 size={14} />
              {autoAssigning ? 'Assigning…' : 'Assign Shelf Lives'}
            </button>
            <button type="button" onClick={() => { setScanOpen((v) => !v); setReceiptOpen(false) }}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white transition ${scanOpen ? 'bg-slate-500' : 'bg-[#C4603A] hover:bg-[#a84e30]'}`}>
              {scanOpen ? 'Hide Scanner' : 'AI Scan'}
            </button>
            <button type="button" onClick={() => { setReceiptOpen((v) => !v); setScanOpen(false) }}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white transition ${receiptOpen ? 'bg-slate-500' : 'bg-[#0A4A52] hover:bg-[#083b42]'}`}>
              <Receipt size={15} />
              {receiptOpen ? 'Hide Receipt' : 'Scan Receipt'}
            </button>
          </div>
        )}
      </div>

      {view === 'history' && <HistoryView stores={stores} />}

      {view === 'current' && (
        <>
          {scanOpen && (
            <div className="mb-6 rounded-xl border border-[#C4603A]/30 bg-orange-50 p-4">
              <h3 className="text-sm font-semibold text-[#C4603A] mb-3">AI Photo Scanner</h3>
              <ScanQueue onStoresUpdated={onStoresUpdated} showToast={showToast} />
            </div>
          )}

          {receiptOpen && (
            <div className="mb-6 rounded-xl border border-[#0A4A52]/20 bg-teal-50 p-4">
              <h3 className="text-sm font-semibold text-[#0A4A52] mb-1">Receipt Scanner</h3>
              <p className="text-xs text-slate-500 mb-3">Photograph your shopping receipt — long receipts can be multiple photos. Review and confirm items before they're added to stores.</p>
              <ReceiptScanner
                voyageConfigId={voyageConfig?.id}
                onStoresUpdated={onStoresUpdated}
                showToast={showToast}
              />
            </div>
          )}

          {/* Manual add form */}
          <form onSubmit={handleAdd} className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-[#0A4A52] mb-3">Add item manually</p>
            <div className="grid grid-cols-[1fr_1fr_70px_70px_auto] gap-2 items-end">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Name</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                  value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Tinned tomatoes" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Category</label>
                <select className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                  value={addForm.category} onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}>
                  {STORE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Qty</label>
                <input type="number" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                  value={addForm.quantity} onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Unit</label>
                <input className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#0A4A52]"
                  value={addForm.unit} onChange={(e) => setAddForm((f) => ({ ...f, unit: e.target.value }))} placeholder="tin, kg…" />
              </div>
              <button type="submit" disabled={adding}
                className="inline-flex items-center gap-1 rounded-lg bg-[#0A4A52] px-3 py-1.5 text-sm text-white hover:bg-[#083b42] disabled:opacity-50 transition">
                <Plus size={15} /> {adding ? '…' : 'Add'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">Shelf life is assigned automatically from the item name.</p>
          </form>

          {/* Grouped list */}
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <p>No stores yet — scan photos or add items manually above.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
                <div key={cat} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="bg-teal-50 px-4 py-2 text-xs font-semibold text-[#0A4A52] uppercase tracking-wide border-b border-slate-200">
                    {cat} ({items.length})
                  </div>
                  <div className="divide-y divide-slate-100">
                    {items.map((item) =>
                      editingId === item.id ? (
                        <div key={item.id} className="grid grid-cols-[1fr_1fr_70px_70px_70px_auto] gap-2 items-center px-3 py-2">
                          <input className="rounded border border-slate-300 px-2 py-1 text-sm" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                          <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}>
                            {STORE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input type="number" className="rounded border border-slate-300 px-2 py-1 text-sm" value={editForm.quantity} onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))} />
                          <input className="rounded border border-slate-300 px-2 py-1 text-sm" value={editForm.unit} onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))} placeholder="unit" />
                          <input type="number" className="rounded border border-slate-300 px-2 py-1 text-sm" value={editForm.shelf_life_days} onChange={(e) => setEditForm((f) => ({ ...f, shelf_life_days: e.target.value }))} placeholder="days" title="Shelf life in days" />
                          <div className="flex gap-1">
                            <button type="button" onClick={() => saveEdit(item.id)} className="text-green-600 hover:text-green-800"><Check size={16} /></button>
                            <button type="button" onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                          </div>
                        </div>
                      ) : (
                        <div key={item.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="font-medium text-slate-800">{item.name}</span>
                            <UseByBadge shelfLifeDays={item.shelf_life_days} voyageDay={voyageDay} />
                          </div>
                          <div className="flex items-center gap-3 text-slate-600 shrink-0">
                            <span>{item.quantity} {item.unit}</span>
                            <button type="button" onClick={() => startEdit(item)} className="text-slate-400 hover:text-[#0A4A52]"><Pencil size={14} /></button>
                            <button type="button" onClick={() => handleDelete(item.id)} disabled={deletingId === item.id} className="text-slate-400 hover:text-red-500 disabled:opacity-40"><Trash2 size={14} /></button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
