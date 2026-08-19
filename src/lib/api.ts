import { DEMO_MODE } from './demo'
import { applyDemoWrite } from './demoWrites'
import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hadas-api`

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  // Demo mode: never hit the network. Accept the write and echo a synthetic id
  // so optimistic UI flows (e.g. supplier create) keep working on fake data.
  if (DEMO_MODE) {
    // Supplier notes are the one write the demo APPLIES, to its in-memory table.
    // Everything else stays a no-op: an invoice or a payment is a financial record
    // whose demo dataset is curated, and mutating it would make the walkthrough
    // drift. A note is a free-text scratch line — the whole point of the panel is
    // writing one, and a demo where the central gesture silently does nothing
    // teaches the wrong thing about the feature.
    const applied = applyDemoWrite(method, path, body)
    if (applied) return applied
    console.warn(`[DEMO MODE] stubbed ${method} ${path} — no network call`)
    return { id: `demo-${Date.now()}` }
  }
  // hadas-api authenticates the frontend via the logged-in user's Supabase JWT.
  // Pull a fresh access token from the current session on every request.
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('לא מחוברת — יש להתחבר מחדש כדי לבצע את הפעולה')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  // hadas-api reports failures as { error: string }; fall back to the status when
  // the body is empty or shaped differently.
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`)
  return data
}

export const api = {
  get:    (path: string)                => call('GET',    path),
  post:   (path: string, body: unknown) => call('POST',   path, body),
  put:    (path: string, body: unknown) => call('PUT',    path, body),
  delete: (path: string)                => call('DELETE', path),
}

// ─── Camera capture ─────────────────────────────────────────────────────────
// Sends a photographed document to the invoices-ingest function's camera branch,
// which runs the SAME extraction + Drive/Storage upload + DB insert that
// email-ingested images go through. Type chosen by the user, image as base64.

export type CaptureDocType = 'invoice' | 'delivery_note' | 'return_doc'

export interface CaptureResult {
  ok:        boolean
  outcome:   'created' | 'alerted' | 'skipped' | 'error'
  docType:   CaptureDocType
  captureId: string
  error?:    string
  errors?:   string[]
}

const INGEST_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invoices-ingest`

export async function captureDocument(input: {
  docType:     CaptureDocType
  imageBase64: string   // raw base64 or a full data: URL
  mimeType:    string
  filename?:   string
  capturedBy?: string
}): Promise<CaptureResult> {
  if (DEMO_MODE) {
    console.warn('[DEMO MODE] stubbed captureDocument — no network call')
    return { ok: true, outcome: 'created', docType: input.docType, captureId: `demo-${Date.now()}` }
  }
  // invoices-ingest now accepts the logged-in user's Supabase JWT (same as call()).
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('לא מחוברת — יש להתחבר מחדש כדי לבצע את הפעולה')
  const res = await fetch(INGEST_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ source: 'camera', ...input }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`)
  return data as CaptureResult
}
