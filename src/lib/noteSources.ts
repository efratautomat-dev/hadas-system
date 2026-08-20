// ─── WHERE NOTES LIVE ────────────────────────────────────────────────────────
//
// The supplier notes panel shows two kinds of rows:
//
//   1. notes WRITTEN in the panel      → `supplier_notes`, editable there
//   2. notes written ANYWHERE ELSE     → collected from their own table, read-only
//
// Kind 2 is what this file declares. Long before the panel existed the app was
// already collecting free text about suppliers — a line on the supplier card, a
// sentence on a payment, why something came back, what the gap in a statement
// turned out to be. Each of those lived alone on its own screen, so nobody could
// see a supplier's history in one place.
//
// ADDING A NEW PLACE THAT WRITES NOTES = ADDING ONE ENTRY BELOW. Nothing else.
// The panel derives its filter chips, tag colours, counts and deep links from
// this array, so a new source appears in all of them at once and cannot be half
// wired up. Do NOT special-case a source inside the panel or the hook — if a
// source needs something the shape below can't express, widen the shape.
//
// The rules an entry must honour:
//
//   • READ-ONLY here. A collected note is edited where it was written, never in
//     the panel — two editable copies of one string is two sources of truth.
//   • EMPTY MEANS ABSENT. `body()` returning '' drops the row. Most payments have
//     no note; a feed padded with blanks is a feed nobody reads.
//   • ALWAYS REACHABLE. `open()` must land on the exact record, not its list.
//     The whole point of showing the note is being one click from its context.

/** A navigation intent, shaped like Layout's NavEntry: a page plus the one field
 *  that screen reads to open a specific record. Kept loose on purpose so a new
 *  source can name a new field without this file importing Layout. */
export interface NoteOpenIntent {
  page: string
  [field: string]: string | undefined
}

/** What the footer of a collected note shows, and where it points. */
export interface DerivedNoteRef {
  /** Human label for the record — "תשלום PAY-0412". */
  label: string
  /** Optional figure shown beside it, already formatted. */
  figure?: string
  /** Wording of the link — "פתיחת התשלום". */
  action: string
}

export type SourceRow = Record<string, unknown>

export interface NoteSource {
  /** Stable key. Used as the filter-chip value and half the React key. */
  key: string
  /** Chip / tag text. */
  label: string
  /** Tag colours. Functional, not brand: a tag says WHERE a note came from, and
   *  that reading has to survive a reskin. */
  style: { bg: string; fg: string }

  /** Table to read, and the column holding the supplier id. */
  table: string
  supplierColumn: string
  /** Explicit column list — never `*`, so a schema change can't silently widen
   *  what the panel pulls. */
  columns: string

  /** The note text. Return '' to skip the row entirely. */
  body: (row: SourceRow) => string
  /** ISO date for ordering, or null when the record carries none. */
  date: (row: SourceRow) => string | null
  ref:  (row: SourceRow) => DerivedNoteRef
  open: (row: SourceRow) => NoteOpenIntent
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}

/** ₪ with thousands separators and no agorot — the panel is a summary, and the
 *  exact figure is one click away on the record itself. */
function shekels(v: unknown): string | undefined {
  const n = num(v)
  if (n === null) return undefined
  return '₪ ' + Math.round(Math.abs(n)).toLocaleString('he-IL') + (n < 0 ? '-' : '')
}

export const NOTE_SOURCES: NoteSource[] = [
  {
    key:   'card',
    label: 'כרטיס ספק',
    style: { bg: '#F3F4F6', fg: '#4B5563' },
    // suppliers_v, NOT suppliers. `20260708000000_employee_financial_column_mask`
    // REVOKEs select on the base tables from anon/authenticated and grants only
    // the role-aware views; a client reading `suppliers` gets a permission error.
    // It failed silently — loadDerived skips a failing source — so the card note
    // simply never appeared in production, while the demo (whose stub client has
    // no permissions and aliases _v to the base table) showed it fine.
    table: 'suppliers_v',
    // The supplier's OWN id — this source is the supplier row itself.
    supplierColumn: 'id',
    columns: 'id, notes',
    body: r => str(r.notes),
    // A card note has no date. It sorts last and renders as "ללא תאריך" rather
    // than borrowing created_at, which would date the CARD, not the note.
    date: () => null,
    ref:  () => ({ label: 'שדה ״הערות״ בכרטיס הספק', action: 'פתיחת הכרטיס' }),
    open: r => ({ page: 'suppliers', supplierViewId: str(r.id) }),
  },
  {
    key:   'payments',
    label: 'תשלומים',
    style: { bg: '#DBEAFE', fg: '#1E40AF' },
    table: 'payments',
    supplierColumn: 'supplier_id',
    columns: 'id, supplier_id, notes, amount, payment_date',
    body: r => str(r.notes),
    date: r => str(r.payment_date) || null,
    ref:  r => ({ label: `תשלום ${str(r.id)}`, figure: shekels(r.amount), action: 'פתיחת התשלום' }),
    open: r => ({ page: 'payments', paymentOpenId: str(r.id) }),
  },
  {
    key:   'returns',
    label: 'חזרות',
    style: { bg: '#FDEEEC', fg: '#9B2C2C' },
    table: 'returns',
    supplierColumn: 'supplier_id',
    columns: 'id, supplier_id, reason, detail, amount, date',
    // `detail` is the note; `reason` is closer to a category and is filled on
    // EVERY return, so keying on it would file every return ever made as a note.
    // The reason still shows — in the label, where it belongs.
    body: r => str(r.detail),
    date: r => str(r.date) || null,
    ref:  r => ({
      label:  `חזרה ${str(r.id)}${str(r.reason) ? ` · ${str(r.reason)}` : ''}`,
      figure: shekels(r.amount),
      action: 'פתיחת החזרה',
    }),
    open: r => ({ page: 'returns', returnsEditId: str(r.id) }),
  },
  {
    key:   'invoices',
    label: 'חשבוניות',
    style: { bg: '#E0E7FF', fg: '#3730A3' },
    // invoices_v for the same reason as suppliers_v above.
    table: 'invoices_v',
    supplierColumn: 'supplier_id',
    columns: 'id, supplier_id, notes, total_amount, invoice_date, invoice_number',
    body: r => str(r.notes),
    date: r => str(r.invoice_date) || null,
    ref:  r => ({
      label:  `חשבונית ${str(r.invoice_number) || str(r.id)}`,
      figure: shekels(r.total_amount),
      action: 'פתיחת החשבונית',
    }),
    open: r => ({ page: 'invoices', invoiceSelectedId: str(r.id) }),
  },
  {
    key:   'statements',
    label: 'כרטסות',
    style: { bg: '#FEF3C7', fg: '#92400E' },
    table: 'vendor_statements',
    supplierColumn: 'supplier_id',
    columns: 'id, supplier_id, resolution_notes, diff, month, resolved_at, uploaded_at',
    body: r => str(r.resolution_notes),
    // When the note was written is when the statement was RESOLVED. Falling back
    // to uploaded_at keeps a note dated rather than sinking it to the bottom.
    date: r => str(r.resolved_at) || str(r.uploaded_at) || null,
    ref:  r => ({
      label:  `כרטסת ${str(r.id)}${str(r.month) ? ` · ${str(r.month)}` : ''}`,
      figure: num(r.diff) ? `פער ${shekels(r.diff)}` : undefined,
      action: 'פתיחת הכרטסת',
    }),
    open: r => ({ page: 'reconciliation', statementViewId: str(r.id) }),
  },
]

// NOT here, and why: `delivery_notes` has no notes column at all — only
// `line_items`, which is the document's contents, not a remark someone made.
// Adding a notes field to that screen is the moment it earns an entry above.

export const SOURCE_BY_KEY: Record<string, NoteSource> =
  Object.fromEntries(NOTE_SOURCES.map(s => [s.key, s]))
