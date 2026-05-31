import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// SETUP REQUIRED:
// 1. Deploy this Edge Function: supabase functions deploy process-receipt-email
// 2. Get the function URL from Supabase dashboard -> Edge Functions
// 3. In Resend dashboard -> Domains -> vapelaab.resend.app -> Inbound
// 4. Set webhook URL to: https://[project-ref].supabase.co/functions/v1/process-receipt-email
// 5. Forward receipts to: receipts@vapelaab.resend.app
// 6. Test by forwarding a fuel receipt and checking pending_receipts table in Supabase

serve(async (req) => {
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        ok: true,
        message: 'process-receipt-email is live. This endpoint expects POST webhooks from Resend inbound email.',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing required Supabase secrets.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const contentType = req.headers.get('content-type') || ''
  let parseMode = 'unknown'
  let eventFrom = ''
  let eventSubject = ''
  let pendingReceiptId: number | null = null
  let payloadSummary: Record<string, unknown> | null = null

  try {
    const parsed = await parseIncomingPayload(req)
    const payload = parsed.payload
    parseMode = parsed.parseMode

    const emailFrom = payload.from || ''
    const emailSubject = payload.subject || ''
    const emailText = payload.text || payload.html || ''
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : []

    eventFrom = String(emailFrom)
    eventSubject = String(emailSubject)
    payloadSummary = {
      keys: Object.keys(payload || {}),
      attachmentCount: attachments.length,
      hasText: Boolean(emailText),
      attachmentKeys: attachments.length > 0 ? Object.keys(attachments[0] || {}) : [],
      attachmentSample: attachments.length > 0 ? JSON.stringify(attachments[0]).substring(0, 300) : null,
    }

    let receiptType = classifyReceiptType({
      subject: String(emailSubject),
      body: String(emailText),
      filename: String(attachments?.[0]?.filename || ''),
    })

    let extractedData: Record<string, unknown> | null = null
    let attachmentUrl: string | null = null

    // Find the PDF attachment specifically; fall back to first attachment
    const emailId = String(payload.email_id || '')

    // Deduplication: check if this email has already been processed
    if (emailId) {
      const { data: existing, error: checkErr } = await supabase
        .from('pending_receipts')
        .select('id')
        .eq('email_id', emailId)
        .limit(1)
        .single()
        .then((res) => ({ data: res.data, error: res.error }))
        .catch((err) => ({ data: null, error: err }))

      // If we found an existing record with this email_id, return success (idempotent)
      if (existing && existing.id) {
        return new Response(
          JSON.stringify({ success: true, message: 'Email already processed', pending_receipt_id: existing.id }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    // Fetch full attachment list AND email body from Resend API
    let allAttachments = attachments
    let fullEmailText = emailText
    if (RESEND_KEY && emailId) {
      try {
        const emailResp = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
          headers: { Authorization: `Bearer ${RESEND_KEY}` },
        })
        if (emailResp.ok) {
          const emailData = await emailResp.json() as {
            attachments?: Array<Record<string, unknown>>
            text?: string
            html?: string
          }
          if (Array.isArray(emailData.attachments) && emailData.attachments.length > 0) {
            allAttachments = emailData.attachments
          }
          // Capture email body text (not available in webhook payload, only in full API response)
          if (emailData.text) fullEmailText = emailData.text
          else if (emailData.html) {
            // Strip HTML tags to plain text
            fullEmailText = emailData.html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
          }
        }
      } catch {
        // fall back to webhook payload attachments
      }
    }

    // Only treat non-inline attachments as invoice candidates (skip logo/signature images)
    const invoiceAttachments = allAttachments.filter((a: Record<string, unknown>) =>
      String(a.content_disposition || '').toLowerCase() !== 'inline' ||
      String(a.content_type || '').toLowerCase().includes('pdf')
    )

    const pdfAttachment = invoiceAttachments.find((a: Record<string, unknown>) =>
      String(a.content_type || a.type || '').toLowerCase().includes('pdf')
    ) || invoiceAttachments.find((a: Record<string, unknown>) =>
      String(a.filename || '').toLowerCase().endsWith('.pdf')
    )
    // Only fall back to first attachment if it's not inline (i.e. not a logo)
    const targetAttachment = pdfAttachment || (invoiceAttachments.length > 0 ? invoiceAttachments[0] : null)

    if (targetAttachment) {
      const attachment = targetAttachment as Record<string, unknown>
      const mediaType = String(attachment.content_type || attachment.type || 'application/octet-stream')
      const attachmentName = String(attachment.filename || 'receipt')
      let attachmentData = normalizeBase64(await readAttachmentBase64(attachment, RESEND_KEY ?? undefined, emailId))

      const isImage = typeof mediaType === 'string' && mediaType.startsWith('image/')
      const isPdf = mediaType === 'application/pdf'

      if ((isImage || isPdf) && attachmentData && ANTHROPIC_KEY) {
        try {
          if (isPdf && !isLikelyPdfBase64(attachmentData)) {
            const fetchedPdfBase64 = await readAttachmentFromUrlFields(attachment, RESEND_KEY ?? undefined)
            if (fetchedPdfBase64 && isLikelyPdfBase64(fetchedPdfBase64)) {
              attachmentData = fetchedPdfBase64
            } else {
              throw new Error('Attachment content is not a valid PDF payload (base64 decode did not produce PDF header).')
            }
          }

          const { prompt: aiPrompt, maxTokens: aiMaxTokens } = await buildAiPromptAndTokens(supabase, receiptType)
          const contentBlocks = isPdf
            ? [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: attachmentData },
              },
              {
                type: 'text',
                text: `${aiPrompt} This attachment is a PDF receipt or invoice. Read the document and extract fields from the PDF content.`,
              },
            ]
            : [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: attachmentData },
              },
              {
                type: 'text',
                text: aiPrompt,
              },
            ]

          const claudeResponse = await callClaudeWithFallback(ANTHROPIC_KEY, contentBlocks, aiMaxTokens)

          const claudeData = await claudeResponse.json()
          const rawText = claudeData.content?.[0]?.text || '{}'
          extractedData = parseClaudeJson(rawText)

          receiptType = classifyReceiptType({
            subject: String(emailSubject),
            body: String(emailText),
            filename: attachmentName,
            extractedData,
          })

          if (extractedData && typeof extractedData === 'object') {
            extractedData = {
              ...(extractedData as Record<string, unknown>),
              receipt_type_suggested: receiptType,
            }
          }
        } catch (extractErr) {
          extractedData = {
            requires_manual_review: true,
            reason: 'AI extraction failed for attachment',
            error: extractErr instanceof Error ? extractErr.message : String(extractErr),
          }
        }

        const fileName = `email/${Date.now()}_${sanitizeFileName(attachmentName)}`
        const buffer = Uint8Array.from(atob(String(attachmentData)), (c) => c.charCodeAt(0))
        const { data: storageData } = await supabase.storage
          .from('amaroo-photos')
          .upload(fileName, buffer, { contentType: mediaType })

        if (storageData?.path) {
          const { data: publicData } = supabase.storage.from('amaroo-photos').getPublicUrl(storageData.path)
          attachmentUrl = publicData?.publicUrl || null
        }

        // Save PDF/image to documents table flagged as Receipt
        try {
          const fileDataUrl = `data:${mediaType};base64,${attachmentData}`
          const fileSize = buffer.length
          const docName = String(emailSubject || attachmentName).substring(0, 200) || attachmentName
          await supabase.from('documents').insert({
            name: docName,
            category: 'Receipt',
            file_data: fileDataUrl,
            file_name: attachmentName,
            file_type: mediaType,
            file_size: fileSize,
            notes: `Auto-imported from email. From: ${emailFrom}`,
            date: new Date().toISOString().substring(0, 10),
          })
        } catch (docErr) {
          console.error('Failed to save to documents table:', docErr)
        }
      } else if ((isImage || isPdf) && attachmentData && !ANTHROPIC_KEY) {
        extractedData = {
          requires_manual_review: true,
          reason: 'ANTHROPIC_API_KEY missing - saved without AI extraction',
        }
      } else if ((isImage || isPdf) && !attachmentData) {
        extractedData = {
          requires_manual_review: true,
          reason: 'Attachment content was missing or invalid in webhook payload',
        }
      }

      if (!attachmentUrl && typeof attachment.url === 'string' && attachment.url) {
        attachmentUrl = attachment.url
      }

      if (!attachmentUrl && typeof attachment.path === 'string' && attachment.path) {
        attachmentUrl = attachment.path
      }

      receiptType = classifyReceiptType({
        subject: String(emailSubject),
        body: String(emailText),
        filename: attachmentName,
        extractedData,
      })
    } else {
      // No valid invoice attachment found — fall back to email body text + any linked invoice URL
      const invoiceUrl = extractInvoiceUrl(fullEmailText)
      let linkedPageText = ''
      if (invoiceUrl) {
        linkedPageText = await fetchPageAsText(invoiceUrl)
      }

      const bodyForClaude = [fullEmailText, linkedPageText ? `\n\n--- Linked invoice page content ---\n${linkedPageText}` : ''].join('').trim()

      if (bodyForClaude && ANTHROPIC_KEY) {
        try {
          const { prompt: aiPrompt, maxTokens: aiMaxTokens } = await buildAiPromptAndTokens(supabase, receiptType)
          const contentBlocks = [
            {
              type: 'text',
              text: `${aiPrompt}\n\nNo PDF attachment was provided. The invoice may be linked in the email or the details are in the body text. Extract what you can from the following email content:\n\n${bodyForClaude.substring(0, 4000)}`,
            },
          ]
          const claudeResponse = await callClaudeWithFallback(ANTHROPIC_KEY, contentBlocks, aiMaxTokens)
          const claudeData = await claudeResponse.json()
          const rawText = claudeData.content?.[0]?.text || '{}'
          extractedData = parseClaudeJson(rawText)
          if (extractedData && typeof extractedData === 'object') {
            extractedData = {
              ...(extractedData as Record<string, unknown>),
              invoice_url: invoiceUrl || null,
              source_note: invoiceUrl ? 'Extracted from linked invoice page' : 'Extracted from email body text',
              receipt_type_suggested: receiptType,
            }
          }
        } catch (bodyErr) {
          extractedData = {
            requires_manual_review: true,
            reason: 'No PDF attachment; AI extraction from email body failed',
            invoice_url: invoiceUrl || null,
            error: bodyErr instanceof Error ? bodyErr.message : String(bodyErr),
          }
        }
      } else {
        extractedData = {
          requires_manual_review: true,
          reason: 'No PDF attachment and no email body text available',
          invoice_url: invoiceUrl || null,
        }
      }

      receiptType = classifyReceiptType({
        subject: String(emailSubject),
        body: fullEmailText,
        filename: '',
        extractedData,
      })
    }

    const { data: inserted, error } = await supabase
      .from('pending_receipts')
      .insert({
        vessel_id: 'amaroo',
        source: 'email',
        email_id: emailId || null,
        receipt_type: receiptType,
        email_from: emailFrom,
        email_subject: emailSubject,
        email_body: String(emailText).substring(0, 1000),
        extracted_data: extractedData,
        attachment_url: attachmentUrl,
        status: 'pending',
      })
      .select('id')
      .single()

    if (error) throw error
    pendingReceiptId = inserted?.id ?? null

    await logWebhookEvent(supabase, {
      content_type: contentType,
      parse_mode: parseMode,
      email_from: eventFrom,
      email_subject: eventSubject,
      status: 'inserted',
      pending_receipt_id: pendingReceiptId,
      payload_summary: payloadSummary,
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Receipt email processing error:', err)

    await logWebhookEvent(supabase, {
      content_type: contentType,
      parse_mode: parseMode,
      email_from: eventFrom,
      email_subject: eventSubject,
      status: 'error',
      pending_receipt_id: pendingReceiptId,
      error_message: message,
      payload_summary: payloadSummary,
    })

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

function getPromptForType(type: string): string {
  const prompts: Record<string, string> = {
    fuel: 'Extract fuel receipt data. Return ONLY JSON: {"date":"YYYY-MM-DD","supplier_name":null,"location":null,"litres_total":null,"price_per_litre":null,"total_cost_aud":null,"fuel_type":null,"invoice_number":null,"confidence":"high|medium|low"}',
    maintenance: 'Extract maintenance invoice data. Return ONLY JSON: {"date":"YYYY-MM-DD","supplier_name":null,"description":null,"parts_listed":[],"labour_hours":null,"labour_cost_aud":null,"parts_cost_aud":null,"total_cost_aud":null,"vessel_system":null,"invoice_number":null,"confidence":"high|medium|low"}',
    parts: 'Extract parts receipt items. Return ONLY JSON: {"date":"YYYY-MM-DD","supplier_name":null,"items":[{"name":null,"quantity":1,"unit_price_aud":null,"total_price_aud":null,"category":null}],"total_cost_aud":null,"invoice_number":null,"confidence":"high|medium|low"}',
  }

  return prompts[type] || prompts.fuel
}

function getMaintenanceTaskMatchingPrompt(scheduledTasks: Array<Record<string, unknown>>, engineHours: number): string {
  const today = new Date().toISOString().split('T')[0]
  const taskList = scheduledTasks.map(t => ({
    id: t.id,
    name: t.task,
    system: t.system,
    interval_months: t.calendar_months,
    interval_hours: t.hours_interval,
    next_due_date: t.due_date,
    next_due_hours: t.due_hours,
    task_type: t.task_type,
  }))
  return `You are analysing a marine maintenance invoice or receipt for the vessel Amaroo (Clipper Explorer 50 PH, twin Cummins QSB 6.7 480HP engines).

Current engine hours: ${engineHours || 'unknown'}
Today's date: ${today}

Here are the vessel's scheduled maintenance tasks:
${JSON.stringify(taskList, null, 2)}

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
- Set is_new_task to true for line items with no good scheduled task match`
}

async function buildAiPromptAndTokens(
  supabase: ReturnType<typeof createClient>,
  receiptType: string,
): Promise<{ prompt: string; maxTokens: number }> {
  if (receiptType !== 'maintenance') {
    return { prompt: getPromptForType(receiptType), maxTokens: 1000 }
  }
  // Fetch scheduled tasks and engine hours for task matching
  const [tasksResult, settingsResult] = await Promise.all([
    supabase.from('maintenance_tasks').select('*').order('system', { ascending: true }),
    supabase.from('vessel_settings').select('data').order('updated_at', { ascending: false }).limit(1),
  ])
  const scheduledTasks = (tasksResult.data || []) as Array<Record<string, unknown>>
  const engineHours = (settingsResult.data?.[0]?.data as Record<string, unknown>)?.engine_hours_total as number || 0
  return { prompt: getMaintenanceTaskMatchingPrompt(scheduledTasks, engineHours), maxTokens: 8000 }
}

function parseClaudeJson(rawText: unknown): Record<string, unknown> {
  const text = String(rawText || '{}')
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // Fall through to wrapped error payload below.
  }
  return { parse_error: true, raw: cleaned }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function classifyReceiptType(input: {
  subject?: string
  body?: string
  filename?: string
  extractedData?: Record<string, unknown> | null
}): 'fuel' | 'maintenance' | 'parts' {
  const text = `${input.subject || ''} ${input.body || ''} ${input.filename || ''}`.toLowerCase()
  const extracted = input.extractedData || {}

  const partsItemCount = Array.isArray(extracted.items) ? extracted.items.length : 0
  const litresTotal = toNumber(extracted.litres_total)
  const fuelWords = ['fuel', 'diesel', 'petrol', 'unleaded', 'litre', 'ltrs', 'l/']
  const partsWords = ['parts', 'chandlery', 'spare', 'bolt', 'filter', 'impeller', 'hose', 'gasket']
  const maintenanceWords = ['invoice', 'service', 'repair', 'mechanic', 'labour', 'haulout', 'haul out']

  const fuelScore = fuelWords.reduce((score, token) => score + (text.includes(token) ? 2 : 0), 0) + (litresTotal > 0 ? 5 : 0)
  const partsScore = partsWords.reduce((score, token) => score + (text.includes(token) ? 2 : 0), 0) + (partsItemCount > 0 ? 5 : 0)
  const maintenanceScore = maintenanceWords.reduce((score, token) => score + (text.includes(token) ? 2 : 0), 0)

  if (partsScore >= fuelScore && partsScore >= maintenanceScore) return 'parts'
  if (fuelScore >= maintenanceScore) return 'fuel'
  return 'maintenance'
}

async function readAttachmentBase64(attachment: Record<string, unknown>, resendApiKey?: string, emailId?: string): Promise<string | null> {
  // Resend inbound: webhook only sends metadata. Must call individual attachment endpoint to get download_url.
  if (resendApiKey && emailId && attachment.id) {
    try {
      const metaUrl = `https://api.resend.com/emails/receiving/${emailId}/attachments/${attachment.id}`
      const metaResp = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      })
      if (metaResp.ok) {
        const meta = await metaResp.json() as Record<string, unknown>
        const downloadUrl = String(meta.download_url || '')
        if (downloadUrl) {
          // download_url is a pre-signed CDN URL — fetch without auth header
          const data = await fetchUrlAsBase64(downloadUrl)
          if (data) return data
        }
      }
    } catch {
      // fall through to other methods
    }
  }

  const inline = attachment.content || attachment.data || attachment.base64 || attachment.content_base64 || attachment.contentBase64
  if (typeof inline === 'string' && inline.trim()) {
    const trimmed = inline.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return await fetchUrlAsBase64(trimmed)
    }
    return trimmed
  }

  return await readAttachmentFromUrlFields(attachment)
}

async function readAttachmentFromUrlFields(attachment: Record<string, unknown>, resendApiKey?: string): Promise<string | null> {
  const candidates = [attachment.url, attachment.path, attachment.download_url]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue
    const data = await fetchUrlAsBase64(candidate, resendApiKey)
    if (data) return data
  }
  return null
}

async function fetchUrlAsBase64(url: string, apiKey?: string): Promise<string | null> {
  const headers: Record<string, string> = {}
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  const response = await fetch(url, { headers })
  if (!response.ok) return null
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function callClaudeWithFallback(apiKey: string, contentBlocks: Array<Record<string, unknown>>, maxTokens = 1000): Promise<Response> {
  const models = [
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-1-20250805',
  ]

  let lastError = 'Unknown Claude error'

  for (const model of models) {
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
          content: contentBlocks,
        }],
      }),
    })

    if (response.ok) return response

    const detail = await response.text()
    lastError = `model=${model} detail=${detail}`
    const lower = detail.toLowerCase()
    const retryableModelError = lower.includes('not_found_error') || lower.includes('model')
    if (!retryableModelError) {
      throw new Error(`Claude extraction failed: ${lastError}`)
    }
  }

  throw new Error(`Claude extraction failed: ${lastError}`)
}

// Extract the first recognisable invoice/payment URL from email body text
function extractInvoiceUrl(text: string): string | null {
  if (!text) return null
  // Match Xero, MYOB, QuickBooks, Stripe, Square, or generic invoice share links
  const patterns = [
    /https?:\/\/invoicing\.xero\.com\/[^\s<>"')]+/i,
    /https?:\/\/go\.xero\.com\/[^\s<>"')]+/i,
    /https?:\/\/[^\s<>"')]*xero\.com[^\s<>"')]+/i,
    /https?:\/\/[^\s<>"')]*myob\.com[^\s<>"')]+invoice[^\s<>"')]+/i,
    /https?:\/\/[^\s<>"')]*quickbooks[^\s<>"')]+invoice[^\s<>"')]+/i,
    /https?:\/\/[^\s<>"')]*invoice[^\s<>"')]{10,}/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0].replace(/[.,;)>]+$/, '') // strip trailing punctuation
  }
  return null
}

// Fetch a URL and return its content as plain text (HTML stripped), max 4000 chars
async function fetchPageAsText(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; receipt-processor/1.0)' },
      redirect: 'follow',
    })
    if (!resp.ok) return ''
    const contentType = resp.headers.get('content-type') || ''
    if (contentType.includes('application/pdf')) {
      // If URL returns a PDF directly, that's great — but we can't easily parse it here as text
      return '[PDF document at linked URL — attach PDF directly for best results]'
    }
    const html = await resp.text()
    // Strip scripts, styles, then tags
    const stripped = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return stripped.substring(0, 4000)
  } catch {
    return ''
  }
}

async function parseIncomingPayload(req: Request): Promise<{ payload: Record<string, unknown>; parseMode: string }> {
  const contentType = (req.headers.get('content-type') || '').toLowerCase()

  if (contentType.includes('application/json')) {
    const raw = await req.json()
    // Resend inbound webhook wraps email in { type, created_at, data: { from, subject, ... } }
    const payload = (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object')
      ? raw.data as Record<string, unknown>
      : raw as Record<string, unknown>
    return { payload, parseMode: 'json' }
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    return { payload: await payloadFromFormData(form), parseMode: 'multipart' }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = await req.text()
    const params = new URLSearchParams(raw)
    return { payload: payloadFromSearchParams(params), parseMode: 'urlencoded' }
  }

  const rawText = await req.text()
  if (!rawText.trim()) return { payload: {}, parseMode: 'empty' }

  try {
    return { payload: JSON.parse(rawText), parseMode: 'raw-json' }
  } catch {
    return { payload: { text: rawText }, parseMode: 'raw-text' }
  }
}

async function logWebhookEvent(
  supabase: ReturnType<typeof createClient>,
  event: {
    content_type: string
    parse_mode: string
    email_from: string
    email_subject: string
    status: string
    pending_receipt_id: number | null
    error_message?: string
    payload_summary?: Record<string, unknown> | null
  },
): Promise<void> {
  try {
    await supabase.from('receipt_webhook_events').insert(event)
  } catch (logErr) {
    console.error('Failed to log receipt webhook event:', logErr)
  }
}

async function payloadFromFormData(form: FormData): Promise<Record<string, unknown>> {
  const fields: Record<string, string[]> = {}
  const attachments: Array<Record<string, unknown>> = []

  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      const base64 = await fileToBase64(value)
      attachments.push({
        filename: value.name || 'attachment',
        content_type: value.type || 'application/octet-stream',
        content: base64,
      })
      continue
    }

    const text = String(value || '')
    if (!fields[key]) fields[key] = []
    fields[key].push(text)
  }

  const jsonAttachments = parseAttachmentsJson(firstField(fields, ['attachments', 'attachment']))
  const mergedAttachments = [...attachments, ...jsonAttachments]

  return {
    from: firstField(fields, ['from', 'sender', 'email_from', 'reply_to']),
    subject: firstField(fields, ['subject', 'email_subject']),
    text: firstField(fields, ['text', 'body', 'plain', 'stripped-text', 'stripped_text']),
    html: firstField(fields, ['html']),
    attachments: mergedAttachments,
  }
}

function payloadFromSearchParams(params: URLSearchParams): Record<string, unknown> {
  const get = (...keys: string[]): string => {
    for (const key of keys) {
      const value = params.get(key)
      if (value) return value
    }
    return ''
  }

  return {
    from: get('from', 'sender', 'email_from', 'reply_to'),
    subject: get('subject', 'email_subject'),
    text: get('text', 'body', 'plain', 'stripped-text', 'stripped_text'),
    html: get('html'),
    attachments: parseAttachmentsJson(get('attachments', 'attachment')),
  }
}

function firstField(fields: Record<string, string[]>, keys: string[]): string {
  for (const key of keys) {
    const values = fields[key]
    if (!values || !values.length) continue
    const first = values.find((v) => typeof v === 'string' && v.trim())
    if (first) return first
  }
  return ''
}

function parseAttachmentsJson(raw: string): Array<Record<string, unknown>> {
  if (!raw || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((v) => v && typeof v === 'object') as Array<Record<string, unknown>>
    if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>]
  } catch {
    // Ignore invalid JSON attachment fields.
  }
  return []
}

function normalizeBase64(input: string | null): string | null {
  if (!input) return null
  let value = String(input).trim()
  if (!value) return null

  const dataUrlMatch = value.match(/^data:[^;]+;base64,(.+)$/i)
  if (dataUrlMatch?.[1]) {
    value = dataUrlMatch[1]
  }

  // Remove whitespace/newlines often introduced by webhook serialization.
  value = value.replace(/\s+/g, '')

  return value || null
}

function isLikelyPdfBase64(base64: string): boolean {
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    if (bytes.length < 5) return false
    // PDF header: "%PDF-"
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  } catch {
    return false
  }
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
