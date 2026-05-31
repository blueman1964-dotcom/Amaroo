const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const MODEL_FALLBACKS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-1-20250805',
]

const PROMPTS = {
  fuel: `You are analysing a fuel receipt for a vessel. Extract ALL of the following fields from this receipt image. Return ONLY valid JSON with no other text, preamble or markdown.
{
  "date": "YYYY-MM-DD or null",
  "supplier_name": "marina or fuel dock name or null",
  "location": "suburb or location or null",
  "fuel_type": "diesel or petrol or null",
  "litres_total": number or null,
  "litres_port": number or null,
  "litres_stbd": number or null,
  "price_per_litre": number or null,
  "total_cost_aud": number or null,
  "invoice_number": "string or null",
  "confidence": "high or medium or low"
}`,

  maintenance: (scheduledTasks, currentEngineHours) => `You are analysing a marine maintenance invoice or receipt for the vessel Amaroo (Clipper Explorer 50 PH, twin Cummins QSB 6.7 480HP engines).

Current engine hours: ${currentEngineHours || 'unknown'}
Today's date: ${new Date().toISOString().split('T')[0]}

Here are the vessel's scheduled maintenance tasks:
${JSON.stringify(scheduledTasks.map(t => ({
  id: t.id,
  name: t.task_name || t.task,
  system: t.vessel_system || t.system,
  interval_months: t.interval_months || t.calendar_months,
  interval_hours: t.interval_hours || t.hours_interval,
  next_due_date: t.next_due_date || t.due_date,
  next_due_hours: t.next_due_hours || t.due_hours,
  task_type: t.task_type,
})), null, 2)}

Analyse this invoice and return ONLY valid JSON with no preamble, markdown, or explanation:
{
  "invoice_date": "YYYY-MM-DD or null",
  "supplier_name": "company name or null",
  "invoice_number": "string or null",
  "total_cost_aud": number or null,
  "confidence": "high or medium or low",
  "engine_hours_at_service": number or null,
  "matched_tasks": [
    {
      "scheduled_task_id": "exact id from the scheduled tasks list above, or null if no match",
      "invoice_line_item": "exact wording from the invoice",
      "task_name": "matched task name or best description if unmatched",
      "vessel_system": "matched system or best guess",
      "match_confidence": "high or medium or low or none",
      "match_reason": "brief explanation of why this match was made",
      "cost_portion_aud": number or null,
      "next_due_date": "YYYY-MM-DD calculated from today + interval, or null",
      "next_due_hours": number or null,
      "is_new_task": false
    }
  ],
  "unmatched_line_items": ["any invoice items that could not be matched to a task"],
  "labour_hours": number or null,
  "labour_cost_aud": number or null,
  "parts_cost_aud": number or null,
  "notes": "any other relevant information from the invoice"
}

Matching rules:
- Match invoice line items to scheduled tasks using semantic similarity, not just exact wording
- "Oil and filter change" matches "Engine oil service", "Oil change — port engine" etc
- "Impeller" matches "Raw water impeller", "Water pump impeller" etc
- If an invoice mentions both port and starboard engines separately, create two matched_task entries
- Calculate next_due_date: add interval_months to invoice_date
- Calculate next_due_hours: add interval_hours to current engine hours
- If interval is unknown, set next_due_date and next_due_hours to null
- Set match_confidence to "low" if the match is uncertain
- Set is_new_task to true for line items with no good scheduled task match`,

  parts: `You are analysing a chandlery or parts receipt. Extract ALL items purchased. Return ONLY valid JSON with no other text, preamble or markdown.
{
  "date": "YYYY-MM-DD or null",
  "supplier_name": "store name or null",
  "items": [
    {
      "name": "item name",
      "quantity": number,
      "unit_price_aud": number or null,
      "total_price_aud": number or null,
      "category": "best match vessel system category"
    }
  ],
  "total_cost_aud": number or null,
  "invoice_number": "string or null",
  "confidence": "high or medium or low"
}`,
}

export async function scanReceiptImage(imageFile, receiptType, context = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('Missing VITE_ANTHROPIC_API_KEY in environment.')
  }

  if (!PROMPTS[receiptType]) {
    throw new Error(`Unsupported receipt type: ${receiptType}`)
  }

  const prompt = typeof PROMPTS[receiptType] === 'function'
    ? PROMPTS[receiptType](context.scheduledTasks || [], context.currentEngineHours || 0)
    : PROMPTS[receiptType]

  const base64 = await fileToBase64(imageFile)
  const mediaType = imageFile.type || 'image/jpeg'
  const maxTokens = receiptType === 'maintenance' ? 8000 : 1000

  const response = await callAnthropicWithFallback({
    apiKey: ANTHROPIC_API_KEY,
    prompt,
    mediaType,
    base64,
    maxTokens,
  })

  const data = await response.json()
  const text = data.content?.[0]?.text || '{}'

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    console.error('Receipt scan parse error:', text)
    return null
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Text-only Claude call to determine receipt_type for an already-processed receipt.
 * @param {object} receipt - pending_receipt row
 * @returns {Promise<string>} one of: fuel|maintenance|parts|registration|insurance|marina|haulout|chandlery|provisioning|other
 */
export async function categoriseReceiptType(receipt) {
  if (!ANTHROPIC_API_KEY) throw new Error('Missing VITE_ANTHROPIC_API_KEY')

  const info = [
    receipt.email_subject ? `Subject: ${receipt.email_subject}` : null,
    receipt.sender_email ? `From: ${receipt.sender_email}` : null,
    receipt.extracted_data?.supplier_name ? `Supplier: ${receipt.extracted_data.supplier_name}` : null,
    receipt.extracted_data?.description ? `Description: ${receipt.extracted_data.description}` : null,
    receipt.extracted_data?.notes ? `Notes: ${receipt.extracted_data.notes}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `You are categorising a vessel expense receipt. Based on the information below, return ONLY ONE of these exact type codes:
fuel, maintenance, parts, registration, insurance, marina, haulout, chandlery, provisioning, other

Rules:
- fuel = fuel / diesel / petrol purchase for the vessel
- maintenance = servicing, repairs, engine work, antifouling, mechanical work
- parts = spare parts or components ordered (not maintenance labour)
- registration = vessel registration or licence fees
- insurance = vessel or crew insurance premiums
- marina = marina fees, mooring fees, berthing, slipway fees (not haulout)
- haulout = full haulout or slipping of the vessel
- chandlery = chandlery store purchase (deck gear, ropes, safety equipment, etc.)
- provisioning = food, drinks, provisions for passages
- other = anything that doesn't fit the above

Receipt info:
${info}

Reply with ONLY the type code, nothing else.`

  let lastError = 'Unknown error'
  for (const model of MODEL_FALLBACKS) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 20,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    })
    if (response.ok) {
      const data = await response.json()
      const raw = (data.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z]/g, '')
      const valid = ['fuel','maintenance','parts','registration','insurance','marina','haulout','chandlery','provisioning','other']
      return valid.includes(raw) ? raw : 'other'
    }
    const detail = await response.text()
    lastError = detail
    if (!detail.toLowerCase().includes('not_found_error')) break
  }
  throw new Error(`Categorise failed: ${lastError}`)
}

async function callAnthropicWithFallback({ apiKey, prompt, mediaType, base64, maxTokens = 1000 }) {
  let lastError = 'Unknown Anthropic error'

  for (const model of MODEL_FALLBACKS) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        }],
      }),
    })

    if (response.ok) return response

    const detail = await response.text()
    lastError = `model=${model} detail=${detail}`
    const lower = detail.toLowerCase()
    const retryableModelError = lower.includes('not_found_error') || lower.includes('model')
    if (!retryableModelError) break
  }

  throw new Error(`Receipt scan failed: ${lastError}`)
}
