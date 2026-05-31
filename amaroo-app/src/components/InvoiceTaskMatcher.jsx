import { useState, useMemo } from 'react'
import { format, addMonths } from 'date-fns'
import { db, updateScheduledTask, markPendingReceiptReviewed, setEngineHoursTotal } from '../db/api'
import { uploadPhoto, sanitizeFileName } from '../db/storage'

const VESSEL_SYSTEMS = [
  'Engines', 'Generator', 'Watermaker', 'Stabilisers', 'Electrical',
  'Plumbing', 'Deck & Anchor', 'Safety', 'Navigation', 'Fuel System',
  'A/C', 'Bilge', 'Tenders & Outboards', 'Other',
]

const card = 'rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_8px_24px_rgba(10,74,82,0.08)]'

const confidenceBadge = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-700',
  none: 'bg-slate-100 text-slate-600',
}

const confidenceIcon = { high: '✅', medium: '⚠️', low: '❓', none: '❓' }

export default function InvoiceTaskMatcher({
  invoiceData,
  scheduledTasks = [],
  currentEngineHours = 0,
  invoiceFile = null,
  invoicePhotoUrl = null,
  pendingReceiptId = null,
  onConfirm,
  onCancel,
}) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const matchedTasks = invoiceData?.matched_tasks || []
  const unmatchedItems = invoiceData?.unmatched_line_items || []
  const invoiceTotal = Number(invoiceData?.total_cost_aud || 0)
  const engineHoursAtService = invoiceData?.engine_hours_at_service
    ? Number(invoiceData.engine_hours_at_service)
    : null

  // Default allocation: split equally across matched tasks
  const defaultCostPortion = (tasks) => {
    if (!tasks.length || !invoiceTotal) return null
    return Math.round((invoiceTotal / tasks.length) * 100) / 100
  }

  // Task selections: one entry per matched task
  const [selections, setSelections] = useState(() =>
    matchedTasks.map((t) => ({
      checked: t.match_confidence === 'high' || t.match_confidence === 'medium',
      nextDueDate: t.next_due_date || '',
      nextDueHours: t.next_due_hours != null ? String(t.next_due_hours) : '',
      costPortion: t.cost_portion_aud != null ? String(t.cost_portion_aud) : '',
      notes: '',
      // For new tasks (is_new_task === true)
      vesselSystem: t.vessel_system || '',
    }))
  )

  // New/unmatched task entries — separate state, unchecked by default
  const [newTaskSelections, setNewTaskSelections] = useState(() =>
    matchedTasks
      .filter((t) => t.is_new_task)
      .map((t) => ({
        checked: false,
        taskName: t.task_name || t.invoice_line_item || '',
        vesselSystem: t.vessel_system || '',
        nextDueDate: t.next_due_date || '',
        costPortion: t.cost_portion_aud != null ? String(t.cost_portion_aud) : '',
      }))
  )

  const [allocationMethod, setAllocationMethod] = useState('equal')
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 })
  const [saved, setSaved] = useState(false)
  const [savedSummary, setSavedSummary] = useState(null)
  const [engineHoursAction, setEngineHoursAction] = useState(null) // 'accept' | 'keep' | null
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState(invoicePhotoUrl || null)

  // Matched tasks that are existing scheduled tasks (not new)
  const existingMatched = matchedTasks.filter((t) => !t.is_new_task)
  // Matched tasks that are new (is_new_task === true)
  const newMatched = matchedTasks.filter((t) => t.is_new_task)

  const checkedCount = selections.filter((s, i) => !matchedTasks[i]?.is_new_task && s.checked).length
    + newTaskSelections.filter((s) => s.checked).length

  const totalAllocated = useMemo(() => {
    const fromExisting = selections
      .filter((s, i) => !matchedTasks[i]?.is_new_task && s.checked)
      .reduce((sum, s) => sum + Number(s.costPortion || 0), 0)
    const fromNew = newTaskSelections
      .filter((s) => s.checked)
      .reduce((sum, s) => sum + Number(s.costPortion || 0), 0)
    return Math.round((fromExisting + fromNew) * 100) / 100
  }, [selections, newTaskSelections, matchedTasks])

  const updateSelection = (index, field, value) => {
    setSelections((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  const updateNewTask = (index, field, value) => {
    setNewTaskSelections((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  const applyEqualSplit = () => {
    const checked = selections.filter((s, i) => !matchedTasks[i]?.is_new_task && s.checked).length
      + newTaskSelections.filter((s) => s.checked).length
    if (!checked || !invoiceTotal) return
    const portion = (Math.round((invoiceTotal / checked) * 100) / 100).toString()
    setSelections((prev) =>
      prev.map((s, i) => (!matchedTasks[i]?.is_new_task && s.checked ? { ...s, costPortion: portion } : s))
    )
    setNewTaskSelections((prev) =>
      prev.map((s) => (s.checked ? { ...s, costPortion: portion } : s))
    )
  }

  const handleAllocationChange = (method) => {
    setAllocationMethod(method)
    if (method === 'equal') applyEqualSplit()
  }

  const handleConfirm = async () => {
    setSaving(true)
    const today = format(new Date(), 'yyyy-MM-dd')
    let photoUrl = uploadedPhotoUrl

    // Upload invoice photo if we have a file
    if (invoiceFile && !photoUrl) {
      try {
        const storagePath = `receipts/maintenance/${Date.now()}-${sanitizeFileName(invoiceFile.name)}`
        const { url } = await uploadPhoto(invoiceFile, storagePath)
        photoUrl = url
        setUploadedPhotoUrl(url)
      } catch {
        // Non-fatal — proceed without photo
      }
    }

    const tasksToSave = []

    // Collect existing matched tasks that are checked
    selections.forEach((sel, idx) => {
      if (matchedTasks[idx]?.is_new_task || !sel.checked) return
      const t = matchedTasks[idx]
      tasksToSave.push({ type: 'existing', sel, task: t })
    })

    // Collect new tasks that are checked
    newTaskSelections.forEach((sel, idx) => {
      if (!sel.checked) return
      const t = newMatched[idx]
      tasksToSave.push({ type: 'new', sel, task: t })
    })

    setSaveProgress({ current: 0, total: tasksToSave.length })

    let loggedCount = 0
    let totalCostSaved = 0
    let firstNextDue = null

    for (let i = 0; i < tasksToSave.length; i++) {
      setSaveProgress({ current: i + 1, total: tasksToSave.length })
      const { type, sel, task } = tasksToSave[i]

      try {
        if (type === 'existing') {
          // Create maintenance log entry
          const logPayload = {
            task_id: task.scheduled_task_id || null,
            system: task.vessel_system || '',
            task: task.task_name || task.invoice_line_item || '',
            completed_date: today,
            engine_hours_at_completion: currentEngineHours,
            performed_by: invoiceData?.supplier_name || 'Specialist',
            parts_used: '',
            cost: Number(sel.costPortion || 0),
            notes: sel.notes || '',
            description: `${task.invoice_line_item || ''}${invoiceData?.supplier_name ? ` — ${invoiceData.supplier_name}` : ''}`,
            task_type: 'specialist',
            next_due_date: sel.nextDueDate || null,
            next_due_hours: sel.nextDueHours ? Number(sel.nextDueHours) : null,
            data: {},
            photos: [],
            invoice_photo_url: photoUrl || null,
          }
          try {
            await db.insert('maintenance_logs', logPayload)
          } catch (err) {
            if (err?.code === 'PGRST204' || err?.message?.includes('invoice_photo_url')) {
              const { invoice_photo_url: _x, ...fallback } = logPayload
              await db.insert('maintenance_logs', fallback)
            } else {
              throw err
            }
          }

          // Update scheduled task next due
          if (task.scheduled_task_id) {
            const taskUpdates = {
              last_completed_date: today,
              last_completed_hours: currentEngineHours,
              status: 'active',
            }
            if (sel.nextDueDate) taskUpdates.due_date = sel.nextDueDate
            if (sel.nextDueHours) taskUpdates.due_hours = Number(sel.nextDueHours)
            await updateScheduledTask(task.scheduled_task_id, taskUpdates).catch(() => {})
          }

          totalCostSaved += Number(sel.costPortion || 0)
          loggedCount++
          if (!firstNextDue && sel.nextDueDate) firstNextDue = { task: task.task_name, date: sel.nextDueDate }
        } else {
          // Create new scheduled task then log it
          const newTask = await db.insert('maintenance_tasks', {
            system: sel.vesselSystem || task.vessel_system || 'Other',
            task: sel.taskName || task.invoice_line_item || 'Invoice work',
            status: 'active',
            due_date: sel.nextDueDate || null,
            due_hours: null,
            priority: 'medium',
            hours_interval: null,
            calendar_months: null,
            last_completed_date: today,
            last_completed_hours: currentEngineHours,
            job_type: 'ad-hoc',
            task_type: 'specialist',
            data: {},
          }).catch(() => null)

          const logPayload = {
            task_id: newTask?.id || null,
            system: sel.vesselSystem || task.vessel_system || 'Other',
            task: sel.taskName || task.invoice_line_item || 'Invoice work',
            completed_date: today,
            engine_hours_at_completion: currentEngineHours,
            performed_by: invoiceData?.supplier_name || 'Specialist',
            parts_used: '',
            cost: Number(sel.costPortion || 0),
            notes: '',
            description: `${task.invoice_line_item || ''}${invoiceData?.supplier_name ? ` — ${invoiceData.supplier_name}` : ''}`,
            task_type: 'specialist',
            next_due_date: sel.nextDueDate || null,
            next_due_hours: null,
            data: {},
            photos: [],
            invoice_photo_url: photoUrl || null,
          }
          try {
            await db.insert('maintenance_logs', logPayload)
          } catch (err) {
            if (err?.code === 'PGRST204' || err?.message?.includes('invoice_photo_url')) {
              const { invoice_photo_url: _x, ...fallback } = logPayload
              await db.insert('maintenance_logs', fallback)
            } else {
              throw err
            }
          }

          totalCostSaved += Number(sel.costPortion || 0)
          loggedCount++
        }
      } catch {
        // Continue with other tasks even if one fails
      }
    }

    // Mark pending receipt reviewed
    if (pendingReceiptId) {
      await markPendingReceiptReviewed(pendingReceiptId).catch(() => {})
    }

    // Update engine hours if user accepted
    if (engineHoursAction === 'accept' && engineHoursAtService != null) {
      await setEngineHoursTotal(engineHoursAtService).catch(() => {})
    }

    setSavedSummary({ loggedCount, totalCostSaved, firstNextDue })
    setSaving(false)
    setSaved(true)
  }

  if (saved && savedSummary) {
    return (
      <div className="fixed inset-0 z-50 bg-[#F7F3EE] flex items-start justify-center overflow-auto p-4 pt-8">
        <div className="w-full max-w-lg space-y-4">
          <div className={card}>
            <div className="text-center space-y-3">
              <div className="text-4xl">✅</div>
              <h2 className="font-serif text-2xl text-[#0A4A52]">Invoice Saved</h2>
              <div className="space-y-1 text-sm text-slate-700">
                <div>✅ {savedSummary.loggedCount} maintenance task{savedSummary.loggedCount !== 1 ? 's' : ''} logged</div>
                {savedSummary.totalCostSaved > 0 && (
                  <div>💰 ${savedSummary.totalCostSaved.toLocaleString('en-AU', { minimumFractionDigits: 2 })} recorded</div>
                )}
                {savedSummary.firstNextDue && (
                  <div>📅 Service reminders updated — next: {savedSummary.firstNextDue.task} due {savedSummary.firstNextDue.date}</div>
                )}
              </div>
              <button
                type="button"
                onClick={onConfirm}
                className="mt-4 rounded-xl bg-[#0A4A52] text-white px-6 py-2.5 font-medium"
              >
                Back to Maintenance
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#F7F3EE] overflow-auto">
      <div className="mx-auto max-w-2xl p-4 pb-24 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <h1 className="font-serif text-2xl text-[#0A4A52]">📋 Invoice Review</h1>
          <button type="button" onClick={onCancel} className="text-slate-500 hover:text-slate-800 text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white">
            Cancel
          </button>
        </div>

        {/* Invoice summary card */}
        <div className={card}>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {invoiceData?.supplier_name && (
              <div><span className="text-slate-500">Supplier</span><div className="font-medium">{invoiceData.supplier_name}</div></div>
            )}
            {invoiceData?.invoice_date && (
              <div><span className="text-slate-500">Date</span><div className="font-medium">{invoiceData.invoice_date}</div></div>
            )}
            {invoiceData?.invoice_number && (
              <div><span className="text-slate-500">Invoice #</span><div className="font-medium">{invoiceData.invoice_number}</div></div>
            )}
            {invoiceTotal > 0 && (
              <div><span className="text-slate-500">Total</span><div className="font-medium">${invoiceTotal.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</div></div>
            )}
            {invoiceData?.confidence && (
              <div className="col-span-2">
                <span className="text-slate-500">AI confidence </span>
                <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ml-1 ${confidenceBadge[invoiceData.confidence] || confidenceBadge.medium}`}>
                  {confidenceIcon[invoiceData.confidence]} {invoiceData.confidence}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Engine hours reconciliation */}
        {engineHoursAtService != null && engineHoursAtService !== currentEngineHours && (
          <div className={`${card} border-amber-200`}>
            <div className="text-sm font-medium text-amber-800 mb-2">🕐 Engine hours at service</div>
            <div className="text-sm text-slate-700 space-y-1">
              <div>Extracted from invoice: <span className="font-semibold">{engineHoursAtService.toLocaleString()} hrs</span></div>
              <div>Current app reading: <span className="font-semibold">{currentEngineHours.toLocaleString()} hrs</span></div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setEngineHoursAction('accept')}
                className={`text-sm rounded-lg px-3 py-1.5 border transition-colors ${engineHoursAction === 'accept' ? 'bg-[#0A4A52] text-white border-[#0A4A52]' : 'border-slate-300 text-slate-700'}`}
              >
                Update to {engineHoursAtService.toLocaleString()} hrs
              </button>
              <button
                type="button"
                onClick={() => setEngineHoursAction('keep')}
                className={`text-sm rounded-lg px-3 py-1.5 border transition-colors ${engineHoursAction === 'keep' ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-300 text-slate-700'}`}
              >
                Keep current
              </button>
            </div>
          </div>
        )}

        {/* Matched tasks */}
        {existingMatched.length > 0 && (
          <div className="space-y-3">
            <div>
              <h2 className="font-serif text-lg text-[#0A4A52]">🔧 Matched Maintenance Tasks</h2>
              <p className="text-xs text-slate-500 mt-0.5">Review and confirm tasks to mark as complete</p>
            </div>
            {existingMatched.map((task, idx) => {
              const sel = selections[idx]
              const isLow = task.match_confidence === 'low' || task.match_confidence === 'none'
              return (
                <div
                  key={idx}
                  className={`${card} ${isLow ? 'border-amber-300' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={sel.checked}
                      onChange={(e) => updateSelection(idx, 'checked', e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#0A4A52]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{task.task_name || task.invoice_line_item}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Matched from: <span className="italic">"{task.invoice_line_item}"</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${confidenceBadge[task.match_confidence] || confidenceBadge.medium}`}>
                          {confidenceIcon[task.match_confidence]} {task.match_confidence || 'medium'} match
                        </span>
                        {task.vessel_system && (
                          <span className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{task.vessel_system}</span>
                        )}
                      </div>
                      {isLow && (
                        <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2 border border-amber-200">
                          ⚠️ Low confidence match — please verify this is correct before confirming
                        </div>
                      )}
                      {task.match_reason && (
                        <div className="text-xs text-slate-400 mt-1">{task.match_reason}</div>
                      )}

                      {sel.checked && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          <div className="text-xs text-slate-500">Last done: {today}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block text-xs">
                              Next due date
                              <input
                                type="date"
                                value={sel.nextDueDate}
                                onChange={(e) => updateSelection(idx, 'nextDueDate', e.target.value)}
                                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs">
                              Next due (hrs)
                              <input
                                type="number"
                                value={sel.nextDueHours}
                                onChange={(e) => updateSelection(idx, 'nextDueHours', e.target.value)}
                                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                                placeholder="Engine hrs"
                              />
                            </label>
                            <label className="block text-xs col-span-2">
                              Cost portion (AUD)
                              <input
                                type="number"
                                value={sel.costPortion}
                                onChange={(e) => updateSelection(idx, 'costPortion', e.target.value)}
                                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                                placeholder="0.00"
                              />
                            </label>
                          </div>
                          <label className="block text-xs">
                            Notes
                            <textarea
                              rows={2}
                              value={sel.notes}
                              onChange={(e) => updateSelection(idx, 'notes', e.target.value)}
                              className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                              placeholder="Any additional notes..."
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* New unmatched task items */}
        {newMatched.length > 0 && (
          <div className="space-y-3">
            <div>
              <h2 className="font-serif text-lg text-[#0A4A52]">➕ Unmatched Invoice Items</h2>
              <p className="text-xs text-slate-500 mt-0.5">Add as new tasks?</p>
            </div>
            {newMatched.map((task, idx) => {
              const sel = newTaskSelections[idx]
              if (!sel) return null
              return (
                <div key={idx} className={card}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={sel.checked}
                      onChange={(e) => updateNewTask(idx, 'checked', e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#0A4A52]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{task.invoice_line_item}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Not found in scheduled tasks</div>
                      {sel.checked && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          <label className="block text-xs">
                            Task name
                            <input
                              type="text"
                              value={sel.taskName}
                              onChange={(e) => updateNewTask(idx, 'taskName', e.target.value)}
                              className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                            />
                          </label>
                          <label className="block text-xs">
                            Vessel system
                            <select
                              value={sel.vesselSystem}
                              onChange={(e) => updateNewTask(idx, 'vesselSystem', e.target.value)}
                              className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                            >
                              <option value="">— Select system —</option>
                              {VESSEL_SYSTEMS.map((s) => <option key={s}>{s}</option>)}
                            </select>
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block text-xs">
                              Next due date
                              <input
                                type="date"
                                value={sel.nextDueDate}
                                onChange={(e) => updateNewTask(idx, 'nextDueDate', e.target.value)}
                                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                              />
                            </label>
                            <label className="block text-xs">
                              Cost (AUD)
                              <input
                                type="number"
                                value={sel.costPortion}
                                onChange={(e) => updateNewTask(idx, 'costPortion', e.target.value)}
                                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
                                placeholder="0.00"
                              />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Unmatched line items (not parseable as tasks) */}
        {unmatchedItems.length > 0 && (
          <div className={card}>
            <div className="text-sm font-medium text-slate-600 mb-2">ℹ️ Invoice items not added to maintenance log</div>
            <ul className="space-y-1">
              {unmatchedItems.map((item, i) => (
                <li key={i} className="text-sm text-slate-500">• {item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Cost summary */}
        {invoiceTotal > 0 && (
          <div className={card}>
            <div className="font-serif text-lg text-[#0A4A52] mb-3">💰 Cost Summary</div>
            <div className="space-y-1 text-sm mb-3">
              <div className="flex justify-between">
                <span className="text-slate-600">Invoice total</span>
                <span className="font-medium">${invoiceTotal.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Allocated to tasks</span>
                <span className="font-medium">${totalAllocated.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Unallocated</span>
                <span className={`font-medium ${invoiceTotal - totalAllocated > 0.01 ? 'text-amber-600' : 'text-green-600'}`}>
                  ${Math.max(0, invoiceTotal - totalAllocated).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <label className="block text-xs text-slate-600">
              Cost allocation
              <select
                value={allocationMethod}
                onChange={(e) => handleAllocationChange(e.target.value)}
                className="w-full mt-1 rounded-lg border border-slate-300 p-2 text-sm"
              >
                <option value="equal">Split equally</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            {allocationMethod === 'equal' && (
              <button
                type="button"
                onClick={applyEqualSplit}
                className="mt-2 text-xs text-[#0A4A52] underline"
              >
                Recalculate equal split
              </button>
            )}
          </div>
        )}

        {/* Saving progress */}
        {saving && (
          <div className={card}>
            <div className="text-sm text-slate-600 text-center">
              Saving task {saveProgress.current} of {saveProgress.total}...
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#0A4A52] transition-all duration-300"
                style={{ width: `${saveProgress.total ? (saveProgress.current / saveProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={checkedCount === 0 || saving}
            className="flex-1 rounded-xl bg-[#0A4A52] text-white py-3 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : `✅ Confirm ${checkedCount > 0 ? checkedCount : ''} Task${checkedCount !== 1 ? 's' : ''}`}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-slate-700 font-medium disabled:opacity-40"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  )
}
