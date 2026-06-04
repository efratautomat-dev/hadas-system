const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hadas-api`
const KEY  = import.meta.env.VITE_HADAS_API_KEY as string

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-hadas-key': KEY },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`)
  return data
}

export const api = {
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
  const res = await fetch(INGEST_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-hadas-key': KEY },
    body:    JSON.stringify({ source: 'camera', ...input }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`)
  return data as CaptureResult
}
