// ─── DEMO: the writes that must be REAL ──────────────────────────────────────
// Demo writes are no-ops by design (see src/lib/demoWrites.ts) — the dataset is
// curated so the walkthrough always tells the same story. `app_settings` is an
// exception, and the logo is why.
//
// Settings offers "upload your logo". In the demo that call used to hit the
// generic stub: storage accepted the file, the app_settings upsert resolved with
// no error, and the screen announced "הלוגו עודכן בהצלחה ✓" — while nothing
// changed and a refresh proved it. A demo that reports success for something it
// did not do is worse than one that has no such button: the person watching is
// usually a prospect being shown their own brand on the product.
//
// So `app_settings` is real here, backed by sessionStorage:
//   • it survives a refresh, so the visitor can upload a logo and keep browsing
//   • it dies with the tab, so the next visitor gets the untouched demo back
//   • Settings' existing "reset to default" button clears it, no special case
//
// Uploaded files are kept as data: URLs — a blob: URL would not survive the
// refresh that this whole module exists to survive.

import { demoTables } from '../data/demoData'

type Row = Record<string, unknown>

const SETTINGS_KEY = 'hadas-demo-app-settings'
const UPLOADS_KEY = 'hadas-demo-uploads'

// Session storage is unavailable in some privacy modes, and a 2MB logo can exceed
// its quota. Neither is a reason to break the demo — fall back to memory-only,
// which still works for everything except a refresh.
function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota or privacy mode — in-memory state is already updated */
  }
}

// ── uploaded files ───────────────────────────────────────────────────────────

const uploads: Record<string, string> = readStore(UPLOADS_KEY, {})

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function putUpload(path: string, dataUrl: string): void {
  uploads[path] = dataUrl
  writeStore(UPLOADS_KEY, uploads)
}

/** The data: URL for a demo-uploaded file, or the path itself when nothing was uploaded. */
export function resolveUpload(path: string): string {
  return uploads[path] ?? path
}

// ── app_settings ─────────────────────────────────────────────────────────────

/**
 * Replays this session's app_settings writes onto the seeded table. Called once,
 * at module load, so a refresh comes back to the state the visitor left.
 */
export function hydrateAppSettings(): void {
  const saved = readStore<Row[]>(SETTINGS_KEY, [])
  for (const row of saved) upsertSetting(row, false)
}

function persistAppSettings(): void {
  writeStore(SETTINGS_KEY, demoTables.app_settings ?? [])
}

/** Upserts one app_settings row by `key`, matching the real table's unique constraint. */
export function upsertSetting(row: Row, persist = true): Row {
  const table = (demoTables.app_settings ??= [])
  const key = String(row.key ?? '')
  const existing = table.find((r) => String(r.key) === key)

  if (existing) Object.assign(existing, row)
  else table.push({ ...row })

  if (persist) persistAppSettings()
  return existing ?? row
}

export function deleteSettings(rows: Row[]): void {
  const table = demoTables.app_settings ?? []
  for (const row of rows) {
    const i = table.indexOf(row)
    if (i >= 0) table.splice(i, 1)
  }
  persistAppSettings()
}
