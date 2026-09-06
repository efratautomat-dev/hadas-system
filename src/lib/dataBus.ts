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

  if (path.startsWith('/delivery-notes')) add('delivery_notes', 'orders', 'invoices')
  if (path.startsWith('/orders'))         add('orders', 'delivery_notes')
  if (path.startsWith('/invoices'))       add('invoices', 'delivery_notes', 'alerts')
  if (path.startsWith('/suppliers'))      add('suppliers', 'invoices', 'delivery_notes')
  if (path.startsWith('/payments'))       add('payments', 'suppliers')
  if (path.startsWith('/returns'))        add('returns', 'suppliers')
  if (path.startsWith('/statements') || path.startsWith('/vendor-statements')) add('statements')
  if (path.startsWith('/alerts'))         add('alerts')
  if (path.startsWith('/supplier-notes')) add('supplier_notes')
  if (path.startsWith('/ingest'))         add('delivery_notes', 'invoices', 'alerts')
  return all
}
