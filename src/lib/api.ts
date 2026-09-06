import { DEMO_MODE } from './demo'
import { applyDemoWrite } from './demoWrites'
import { supabase } from './supabase'
import { notify, resourcesFor } from './dataBus'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hadas-api`

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  // Demo mode: never hit the network. Accept the write and echo a synthetic id
  // so optimistic UI flows (e.g. supplier create) keep working on fake data.
  if (DEMO_MODE) {
    // Supplier notes and the PIPELINE gestures are what the demo APPLIES, to its
    // in-memory tables. Everything else stays a no-op: an invoice or a payment is
    // a financial record whose demo dataset is curated, and mutating it would make
    // the walkthrough drift.
    //
    // The exceptions share one test — is the gesture the feature? Writing a note
    // is the whole point of the notes panel; marking an order arrived, attaching
    // an invoice and approving into the ledger ARE the pipeline. A demo whose
    // central button silently does nothing teaches the opposite of the feature.
    // None of them touches money: the amounts stay exactly as seeded, and only
    // the stage a row sits at moves.
    const applied = applyDemoWrite(method, path, body)
    if (applied) {
      // Demo writes mutate in-memory tables, so every other screen holding a copy
      // must be told — the same wire the real path uses, for the same reason.
      if (method !== 'GET') notify(resourcesFor(path))
      return applied
    }
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
  // Announce the write. Every hook reading a touched resource reloads, so a change
  // made on one screen is true on all of them — the difference between a system
  // with one source of truth and several screens that each remember something.
  if (method !== 'GET') notify(resourcesFor(path))
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


/** One handwritten line as the reader returned it. */
export interface HandwrittenLine {
  item: string
  quantity: string
  /** The model's own doubt about THIS line. Marked, never dropped. */
  uncertain: boolean
}

/**
 * Read a handwritten goods sheet. Returns what it read and files NOTHING.
 *
 * Handwriting is the one input where the machine is least certain and the person
 * standing there is most certain, so the model proposes and she confirms. The
 * delivery is then created through the ordinary `POST /delivery-notes`, which is
 * why a sheet-captured delivery needs no special case anywhere downstream.
 */
export async function readHandwrittenSheet(input: {
  imageBase64: string
  mimeType: string
  capturedBy?: string
}): Promise<HandwrittenLine[]> {
  if (DEMO_MODE) {
    // A fixed answer, and honestly labelled: the demo has no model behind it, and
    // pretending to read the photo would teach that the reading is trustworthy
    // without ever having tested it.
    console.warn('[DEMO MODE] stubbed readHandwrittenSheet — no network call')
    return [
      { item: 'חלב 3% ארגז', quantity: '2', uncertain: false },
      { item: 'קוטג׳ ארגז',  quantity: '1', uncertain: false },
      { item: 'ביצים מגש',   quantity: '4', uncertain: true  },
    ]
  }
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('לא מחוברת — יש להתחבר מחדש כדי לבצע את הפעולה')
  const res = await fetch(INGEST_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ source: 'handwritten', ...input }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`)
  return ((data as { lines?: HandwrittenLine[] }).lines ?? [])
}
