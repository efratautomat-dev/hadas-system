import { demoTables, demoUser } from '../data/demoData'

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

// Taken from the seed's demo user rather than repeated as a literal: a note written
// during the walkthrough must carry the same author as the seeded ones, and two
// copies of one address drift the moment the demo is rebranded.
const DEMO_AUTHOR = demoUser.email

export function applyDemoWrite(method: string, path: string, body?: unknown): Row | null {
  const b = (body ?? {}) as Row

  // ── The pipeline gestures ──────────────────────────────────────────────────
  // Opening an order, marking it arrived, attaching an invoice, approving into
  // the ledger. These are APPLIED for the same reason supplier notes are: the
  // gesture IS the feature, and a demo whose central button does nothing
  // demonstrates the opposite of what it should. In memory only — a refresh puts
  // the story back, which is right for a demo.
  const pipeline = applyPipelineWrite(method, path, b)
  if (pipeline) return pipeline

  const notes = demoTables.supplier_notes
  if (!notes) return null

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


// ─────────────────────────────────────────────────────────────────────────────
// The goods pipeline, in demo.
//
// The stage rules here are a deliberate MIRROR of hadas-api's, not a second
// invention: link → in_ledger if the invoice is already approved, else
// awaiting_approval; unlink → back to awaiting_invoice; approve → every note
// attached to that invoice moves at once, which is what makes a consolidated
// invoice one decision instead of five. If those rules ever diverge, the demo
// teaches a pipeline the system does not have.
// ─────────────────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString()

function find(table: string, id: string): Row | undefined {
  return demoTables[table]?.find(r => String(r.id) === id)
}

function applyPipelineWrite(method: string, path: string, b: Row): Row | null {
  const orders   = demoTables.orders
  const notes    = demoTables.delivery_notes
  const links    = demoTables.delivery_note_invoices
  const invoices = demoTables.invoices
  if (!orders || !notes || !links || !invoices) return null

  // ── GET /delivery-notes/:id/candidates ───────────────────────────────────
  // The suggestion list. It was the ONE read the pipeline makes through the API
  // rather than through the client, so in demo it fell through to the generic
  // stub and every delivery reported "no matching invoice" — which made the whole
  // attach-and-approve chain untestable.
  //
  // Same rule as the server: same supplier, within MATCH_WINDOW_DAYS, not already
  // linked, nearest date first. Amount equality is a HINT shown to the person; it
  // never attaches anything on its own (§6.f).
  const cand = path.match(/^\/delivery-notes\/([^/]+)\/candidates$/)
  if (method === 'GET' && cand) {
    const note = find('delivery_notes', cand[1])
    if (!note) return { candidates: [] } as unknown as Row
    const noteDate = String(note.date ?? '')
    const taken = new Set(links.map(l => String(l.invoice_id)))
    const MATCH_WINDOW_DAYS = 45
    const dayGap = (a: string, b: string) =>
      (!a || !b) ? null
        : Math.round(Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000)

    const list = invoices
      .filter(i => i.supplier_id === note.supplier_id && !taken.has(String(i.id)))
      .map(i => ({
        invoice_id:     String(i.id),
        invoice_number: (i.invoice_number as string) ?? '',
        invoice_date:   (i.invoice_date as string) ?? '',
        day_gap:        dayGap(noteDate, String(i.invoice_date ?? '')),
        amount_match:   note.amount != null && Number(i.total_amount) === Number(note.amount),
      }))
      .filter(c => c.day_gap === null || c.day_gap <= MATCH_WINDOW_DAYS)
      .sort((a, b) => (a.day_gap ?? 999) - (b.day_gap ?? 999))

    return { candidates: list } as unknown as Row
  }

  // ── POST /orders ─────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/orders') {
    const row: Row = {
      id: `ord_${Date.now()}`,
      supplier_id:    String(b.supplier_id ?? ''),
      supplier_name:  String(b.supplier_name ?? ''),
      description:    String(b.description ?? ''),
      date:           nowIso().slice(0, 10),
      expected_date:  b.expected_date ?? null,
      status:         'order_waiting',
      arrived_at:     null,
      arrived_differs: false,
      delivery_note_id: null,
      customer_name:  b.customer_name  ?? null,
      customer_phone: b.customer_phone ?? null,
    }
    orders.unshift(row)

    // Mirrors the server: a CUSTOMER order landing on a supplier that already has
    // one open raises the alert, because the shipment on its way can still carry
    // the customer's item if somebody sees it in time.
    const alerts = demoTables.alerts
    if (row.customer_name && alerts) {
      const sibling = orders.find(o =>
        o.id !== row.id && o.supplier_id === row.supplier_id && o.status === 'order_waiting')
      if (sibling) {
        alerts.unshift({
          id: `alert_${Date.now()}`,
          type: 'customer_order_joins_shipment',
          title: 'הזמנת לקוחה אצל ספק עם משלוח בדרך',
          message: `${row.customer_name} הזמינה מ${row.supplier_name}. יש כבר הזמנה פתוחה אצל אותו ספק — אפשר לצרף.`,
          status: 'unread',
          created_at: nowIso(),
          payload: { supplierId: row.supplier_id, orderId: row.id, existingOrderId: sibling.id },
        })
      }
    }
    return row
  }

  // ── PUT /orders/:id/arrived ──────────────────────────────────────────────
  const arrived = path.match(/^\/orders\/([^/]+)\/arrived$/)
  if (method === 'PUT' && arrived) {
    const order = find('orders', arrived[1])
    if (!order) return null
    const partial = b.partial === true

    // Mirrors the server: the supplier's note usually arrives by email BEFORE the
    // goods, so look for one already waiting instead of opening a second row for
    // one physical delivery. Offered, never adopted automatically — two deliveries
    // from one supplier in a week are ordinary, and a silent merge loses a
    // shipment, which is worse than a duplicate because nobody can see it.
    const adoptId  = typeof b.delivery_note_id === 'string' ? b.delivery_note_id : null
    const forceNew = b.force_new === true
    if (!adoptId && !forceNew) {
      const claimed = new Set(orders.map(o => String(o.delivery_note_id ?? '')))
      const waiting = notes.filter(n =>
        n.supplier_id === order.supplier_id &&
        n.stage === 'awaiting_invoice' &&
        !claimed.has(String(n.id)))
      if (waiting.length > 0) {
        return {
          success: false, needsChoice: true,
          candidates: waiting.map(n => ({
            id: String(n.id), note_number: n.note_number ?? null,
            date: n.date ?? null, supplier_name: n.supplier_name ?? null,
          })),
        } as unknown as Row
      }
    }
    if (adoptId) {
      const adopted = find('delivery_notes', adoptId)
      if (adopted) {
        if (partial) {
          orders.unshift({
            ...order, id: `ord_${Date.now()}`,
            description: `הגיע: ${order.description}`,
            status: 'order_partial', arrived_at: nowIso(), delivery_note_id: adopted.id,
          })
        } else {
          order.status = 'order_arrived'
          order.arrived_at = nowIso()
          order.delivery_note_id = adopted.id
        }
        return { success: true, delivery_note_id: adopted.id }
      }
    }

    // The delivery the order becomes. An order is the pipeline's ENTRY POINT
    // (D23), so "arrived" does not just recolour a card — it produces the row
    // that then waits for an invoice.
    const note: Row = {
      id: `dn_${Date.now()}`,
      supplier_id:   order.supplier_id,
      supplier_name: order.supplier_name,
      date:          nowIso().slice(0, 10),
      amount: null, amount_before_vat: null, vat_amount: null,
      status: 'pending_match',
      stage:  'awaiting_invoice',
      invoice_id: null,
      line_items: order.description,
      intake_source: 'manual',
      drive_file_link: null, storage_url: null,
      note_number: null,
    }
    notes.unshift(note)

    if (partial) {
      // §7 — the arrived part becomes its OWN order and the original keeps
      // waiting for the rest. Two rows, not one that changed its mind.
      orders.unshift({
        ...order,
        id: `ord_${Date.now()}`,
        description: `הגיע: ${order.description}`,
        status: 'order_partial',
        arrived_at: nowIso(),
        delivery_note_id: note.id,
      })
    } else {
      order.status = 'order_arrived'
      order.arrived_at = nowIso()
      order.delivery_note_id = note.id
    }
    return { success: true, delivery_note_id: note.id }
  }

  // ── PUT /invoices/:id/open-pipeline ──────────────────────────────────────
  const openPipe = path.match(/^\/invoices\/([^/]+)\/open-pipeline$/)
  if (method === 'PUT' && openPipe) {
    const invoice = find('invoices', openPipe[1])
    if (!invoice) return null
    const already = links.find(l => String(l.invoice_id) === String(invoice.id))
    if (already) return { success: true, alreadyLinked: true, deliveryNoteId: already.delivery_note_id }
    const note: Row = {
      id: `dn_${Date.now()}`,
      supplier_id: invoice.supplier_id, supplier_name: invoice.supplier_name,
      date: invoice.invoice_date ?? nowIso().slice(0, 10),
      amount: null, amount_before_vat: null, vat_amount: null,
      status: 'pending', stage: 'awaiting_goods', invoice_id: String(invoice.id),
      line_items: null, intake_source: 'invoice',
      drive_file_link: null, storage_url: null, note_number: null,
    }
    notes.unshift(note)
    links.push({ delivery_note_id: note.id, invoice_id: String(invoice.id), created_at: nowIso() })
    return { success: true, deliveryNoteId: note.id }
  }

  // ── DELETE /delivery-notes/:id/dismantle ─────────────────────────────────
  // Links go, documents stay. The shell an invoice opened is the one row removed,
  // because a pipeline that never held goods is not a delivery.
  const dismantle = path.match(/^\/delivery-notes\/([^/]+)\/dismantle$/)
  if (method === 'DELETE' && dismantle) {
    const note = find('delivery_notes', dismantle[1])
    if (!note) return null
    for (let i = links.length - 1; i >= 0; i--) {
      if (String(links[i].delivery_note_id) === String(note.id)) links.splice(i, 1)
    }
    for (const o of orders) {
      if (String(o.delivery_note_id) === String(note.id)) {
        o.delivery_note_id = null; o.status = 'order_waiting'; o.arrived_at = null
      }
    }
    const shell = note.intake_source === 'invoice' && !note.note_number
    if (shell) {
      const i = notes.findIndex(n => String(n.id) === String(note.id))
      if (i >= 0) notes.splice(i, 1)
    } else {
      note.invoice_id = null; note.status = 'pending_match'; note.stage = 'awaiting_invoice'
    }
    return { success: true, removedShell: shell }
  }

  // ── PUT /delivery-notes/:id/link ─────────────────────────────────────────
  const link = path.match(/^\/delivery-notes\/([^/]+)\/link$/)
  if (method === 'PUT' && link) {
    const note = find('delivery_notes', link[1])
    const invoiceId = String(b.invoice_id ?? '')
    const invoice = find('invoices', invoiceId)
    if (!note || !invoice) return null
    if (!links.some(l => l.delivery_note_id === note.id && l.invoice_id === invoiceId)) {
      links.push({ delivery_note_id: note.id, invoice_id: invoiceId, created_at: nowIso() })
    }
    note.invoice_id = invoiceId
    note.status = 'linked'
    note.stage = invoice.ledger_approved_at ? 'in_ledger' : 'awaiting_approval'
    return { success: true, stage: note.stage }
  }

  // ── PUT /delivery-notes/:id/unlink ───────────────────────────────────────
  const unlink = path.match(/^\/delivery-notes\/([^/]+)\/unlink$/)
  if (method === 'PUT' && unlink) {
    const note = find('delivery_notes', unlink[1])
    if (!note) return null
    for (let i = links.length - 1; i >= 0; i--) {
      if (links[i].delivery_note_id === note.id) links.splice(i, 1)
    }
    note.invoice_id = null
    note.status = 'pending_match'
    note.stage = 'awaiting_invoice'
    return { success: true }
  }

  // ── PUT /invoices/:id/ledger-approve ─────────────────────────────────────
  const approve = path.match(/^\/invoices\/([^/]+)\/ledger-(approve|unapprove)$/)
  if (method === 'PUT' && approve) {
    const invoice = find('invoices', approve[1])
    if (!invoice) return null
    const on = approve[2] === 'approve'
    invoice.ledger_approved_at = on ? nowIso() : null
    invoice.ledger_approved_by = on ? demoUser.email : null
    // ONE approval moves every delivery hanging off this invoice — the
    // consolidated-invoice case, and the reason the count is worth returning.
    let moved = 0
    for (const l of links) {
      if (l.invoice_id !== invoice.id) continue
      const n = find('delivery_notes', String(l.delivery_note_id))
      if (!n) continue
      n.stage = on ? 'in_ledger' : 'awaiting_approval'
      moved++
    }
    return { success: true, notesMoved: moved }
  }

  // ── PUT /delivery-notes/:id — שינוי ספק ──────────────────────────────────
  const upd = path.match(/^\/delivery-notes\/([^/]+)$/)
  if (method === 'PUT' && upd && b.supplierId !== undefined) {
    const note = find('delivery_notes', upd[1])
    const sup  = find('suppliers', String(b.supplierId))
    if (!note) return null
    note.supplier_id = String(b.supplierId)
    // Name follows the id, exactly as the server does it. Two sources of truth
    // for one supplier is the defect this whole control exists to prevent.
    if (sup?.name) note.supplier_name = sup.name
    return { success: true }
  }

  return null
}
