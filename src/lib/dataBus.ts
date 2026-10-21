// ── One source of truth, in practice ─────────────────────────────────────────
//
// Every screen calls its own `useDeliveryNotes()` / `useOrders()` / `useInvoices()`,
// and each call holds a SEPARATE copy of the data. A write in the goods screen
// reloaded the goods screen; the supplier card kept showing what it fetched when
// it mounted. Nothing was wrong with either copy — they simply never learned about
// each other, which is how one system starts telling two stories about the same
// record.
//
// This is the missing wire. A write announces which resources it touched; every
// hook reading those resources reloads. No provider tree, no refactor of thirteen
// hooks into a store — each hook keeps its own fetch and simply learns when to
// repeat it.
//
// Why a bus rather than a shared cache: the hooks already agree on how to read
// (they all go through the same client and the same masking views). What they
// lacked was a reason to read AGAIN. Replacing them with a store would rewrite
// working code to solve a problem that is one notification wide.

export type Resource =
  | 'delivery_notes'
  | 'orders'
  | 'invoices'
  | 'suppliers'
  | 'payments'
  | 'returns'
  | 'statements'
  | 'alerts'
  | 'supplier_notes'
  | 'ledger_resets'
  | 'ledger_marks'
  | 'backup_runs'

/**
 * Every topic, in one array — the list a time-based refresh announces.
 *
 * Kept next to the union it mirrors so the two cannot drift: a topic added
 * above and forgotten here would be a resource the periodic refresh silently
 * stops refreshing, which is the hardest kind of staleness to notice.
 */
export const ALL_RESOURCES: Resource[] = [
  'delivery_notes', 'orders', 'invoices', 'suppliers', 'payments',
  'returns', 'statements', 'alerts', 'supplier_notes', 'ledger_resets', 'ledger_marks',
]

type Listener = () => void

const listeners = new Map<Resource, Set<Listener>>()

export function subscribe(resources: Resource[], fn: Listener): () => void {
  for (const r of resources) {
    if (!listeners.has(r)) listeners.set(r, new Set())
    listeners.get(r)!.add(fn)
  }
  return () => {
    for (const r of resources) listeners.get(r)?.delete(fn)
  }
}

export function notify(resources: Resource[]): void {
  // De-duplicated: one hook listening to two changed resources reloads once, not
  // twice. Two reads of the same table in one tick is a flicker and a wasted trip.
  const called = new Set<Listener>()
  for (const r of resources) {
    for (const fn of listeners.get(r) ?? []) {
      if (called.has(fn)) continue
      called.add(fn)
      fn()
    }
  }
}

/** Reload everything — what the periodic refresh calls. */
export function notifyAll(): void {
  notify(ALL_RESOURCES)
}

/**
 * Which resources a write touched, from its path.
 *
 * Deliberately GENEROUS. Attaching an invoice to a delivery changes the delivery,
 * the invoice and the ledger built from them; approving one moves every delivery
 * hanging off it. Guessing narrowly here re-creates the exact bug this file
 * exists to fix, and the cost of an extra read is a network trip nobody notices.
 */
export function resourcesFor(path: string): Resource[] {
  const all: Resource[] = []
  const add = (...rs: Resource[]) => { for (const r of rs) if (!all.includes(r)) all.push(r) }

  // A receipt closes a delivery AND stops its payments counting, so the ledger
  // everywhere has to be rebuilt — hence `payments` and `suppliers` on a path that
  // looks like it only touches goods.
  if (path.startsWith('/delivery-notes')) add('delivery_notes', 'orders', 'invoices', 'payments', 'suppliers')
  if (path.startsWith('/orders'))         add('orders', 'delivery_notes')
  if (path.startsWith('/invoices'))       add('invoices', 'delivery_notes', 'alerts')
  if (path.startsWith('/suppliers'))      add('suppliers', 'invoices', 'delivery_notes')
  if (/^\/suppliers\/[^/]+\/ledger-reset$/.test(path)) add('ledger_resets')
  if (path.startsWith('/payments'))       add('payments', 'suppliers')
  if (path.startsWith('/returns'))        add('returns', 'suppliers')
  if (path.startsWith('/statements') || path.startsWith('/vendor-statements')) add('statements')
  if (path.startsWith('/alerts'))         add('alerts')
  // Re-filing a document creates an invoice / delivery note / statement (and
  // possibly a supplier), closes its alert, and may remove the statement it was
  // filed as — it announced nothing, so the new invoice appeared only on reload.
  if (path.startsWith('/documents/reclassify')) add('invoices', 'delivery_notes', 'statements', 'alerts', 'suppliers')
  if (path.startsWith('/supplier-notes')) add('supplier_notes')
  // The "טופל" toggle writes to `note_handled`, not to the note — and announced
  // nothing, so the mark landed in the DB and no other screen showing that note
  // learned about it until a reload.
  if (path.startsWith('/note-handled'))  add('supplier_notes')
  // A reset moves the balance on every screen that shows one, which is why it
  // announces `suppliers` as well as itself.
  if (path.startsWith('/ledger-resets')) add('ledger_resets', 'suppliers')
  if (path.startsWith('/ledger-marks'))  add('ledger_marks')
  if (path.startsWith('/ingest'))         add('delivery_notes', 'invoices', 'alerts')
  // A backup can raise an alert of its own (a failed run, an unclassified table),
  // so the feed has to hear about it too — not only the panel that started it.
  if (path.startsWith('/backups'))        add('backup_runs', 'alerts')
  return all
}
