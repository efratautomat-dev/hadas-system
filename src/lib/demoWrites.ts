import { demoTables } from '../data/demoData'

/**
 * The few writes demo mode actually APPLIES, against its in-memory tables.
 *
 * Demo writes are no-ops by design: the dataset is curated so the walkthrough
 * always tells the same story, and letting invoices or payments be edited would
 * make it drift. Supplier notes are the exception, because writing one IS the
 * feature — a panel whose central gesture silently does nothing demonstrates the
 * opposite of what it should.
 *
 * In-memory only. A refresh restores the seeded notes, which is the right
 * behaviour for a demo: it always starts from the same place.
 *
 * Returns the created/updated row, or `null` when the call is not one we apply —
 * the caller then falls back to the generic stub.
 */
type Row = Record<string, unknown>

const DEMO_AUTHOR = 'demo@hadas-system.co.il'

export function applyDemoWrite(method: string, path: string, body?: unknown): Row | null {
  const notes = demoTables.supplier_notes
  if (!notes) return null
  const b = (body ?? {}) as Row

  if (method === 'POST' && path === '/supplier-notes') {
    const now = new Date().toISOString()
    const row: Row = {
      id: `note_${Date.now()}`,
      supplier_id: String(b.supplierId ?? ''),
      body: String(b.body ?? ''),
      tag: String(b.tag ?? 'suppliers'),
      author_email: DEMO_AUTHOR,
      created_at: now,
      updated_at: now,
    }
    notes.unshift(row)          // newest first, same order the real query returns
    return row
  }

  const idMatch = path.match(/^\/supplier-notes\/(.+)$/)
  if (!idMatch) return null
  const id = idMatch[1]

  if (method === 'PUT') {
    const row = notes.find(n => String(n.id) === id)
    if (!row) return null
    row.body = String(b.body ?? row.body)
    row.updated_at = new Date().toISOString()
    return row
  }

  if (method === 'DELETE') {
    const i = notes.findIndex(n => String(n.id) === id)
    if (i >= 0) notes.splice(i, 1)
    return { success: true }
  }

  return null
}
