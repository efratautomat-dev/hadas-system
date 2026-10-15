import type { Alert, DeliveryNote, Invoice } from '../data/mockData'
import type { Payment } from '../hooks/usePayments'
import type { VendorStatement } from '../hooks/useStatements'
import type { Order } from '../hooks/useOrders'
import { pendingPairFor } from './deliveryPairs'
import { enteredAt } from './recency'
import { daysBetween, shortDate } from './clock'
import { SEMANTIC } from '../theme/status'

// ── What is waiting for a person, and on whom ────────────────────────────────
//
// The home screen answers one question — "what do I have to do this morning" —
// and answers it BY SUPPLIER, because the supplier is the unit the owner works
// in ("לאילו ספקים יש הערות חדשות"). A supplier with four problems appears once,
// with four chips, rather than in four panels.
//
// Everything here is DERIVED, live, from rows the screens already read. Nothing
// is stored and nothing needs clearing: a delivery stops being "stuck" the moment
// its invoice arrives, because the predicate stops being true. That is why this
// file has no cron and writes no alerts.
//
// Three rules the screen keeps, and this file is where the first two are kept:
//   1. Silent at zero — an empty group is not returned at all.
//   2. No invented numbers — every figure is a count of rows or a row's amount.
//   3. Every chip opens its RECORD, not a list (see `AttentionTarget`).

/** How long goods may wait for their invoice before it is somebody's problem. */
export const STUCK_DAYS = 7
/** A customer order older than this that has not arrived is worth a phone call. */
export const CUSTOMER_LATE_DAYS = 14

export type ChipTone = 'red' | 'amber' | 'yellow' | 'blue' | 'gray'

/** Where a click lands. One shape per kind of record; the screen maps each to a
 *  navigation it already has, so this file never imports Layout. */
export type AttentionTarget =
  | { kind: 'invoice';   id: string }
  | { kind: 'duplicate'; id: string }
  | { kind: 'delivery';  id: string }
  | { kind: 'payment';   id: string }
  | { kind: 'statement'; id: string }
  | { kind: 'alert';     alert: Alert }
  /** The approval queue. Deliberately the alerts screen, not the invoice: a
   *  rejection there deletes the invoice and its copies, so it is decided where
   *  the second confirmation lives. */
  | { kind: 'approvals' }

export interface AttentionChip {
  key:    string
  label:  string
  tone:   ChipTone
  /** Sort weight — lower is more urgent. */
  weight: number
  target: AttentionTarget
}

export interface SupplierAttentionRow {
  supplierId:   string
  supplierName: string
  chips:        AttentionChip[]
}

/** What the viewer's tier lets the screen point at. A chip that opens a screen
 *  outside the tier would advertise a feature the visitor cannot reach. */
export interface AttentionScope {
  payments:   boolean
  deliveries: boolean
  statements: boolean
}

const ils = (n: number) => '₪' + Math.round(Math.abs(n)).toLocaleString('he-IL')

// Weight order is the order the owner would act in: a decision only she can make,
// then a possible double payment, then something that has stopped moving, then the
// rest. Within one supplier chips sort by it; suppliers sort by their worst chip.
const W = {
  approval:  10,
  duplicate: 20,
  mismatch:  25,
  pairCheck: 28,
  goodsApprove: 30,
  unread:    35,
  payment:   40,
  stuck:     50,
  noGoods:   55,
  alert:     60,
} as const

/** Alert types already expressed as a chip from their own row — listing the alert
 *  as well would show one problem twice under one supplier. */
const COVERED_ALERT_TYPES = new Set([
  'invoice_approval_required',
  'invoice_duplicate', 'duplicate_invoice',
  'statement_mismatch',
])

export interface AttentionInput {
  invoices:   Invoice[]
  deliveries: DeliveryNote[]
  payments:   Payment[]
  statements: VendorStatement[]
  alerts:     Alert[]
  today:      string
  scope:      AttentionScope
}

export interface Unassigned {
  key:    string
  title:  string
  meta:   string
  action: string
  target: AttentionTarget
}

export function buildAttention(input: AttentionInput): {
  rows: SupplierAttentionRow[]
  unassigned: Unassigned[]
} {
  const { invoices, deliveries, payments, statements, alerts, today, scope } = input
  const bySupplier = new Map<string, SupplierAttentionRow>()
  const unassigned: Unassigned[] = []

  // Supplier names come from the rows themselves, so an alert that names a
  // supplier only by name can still be filed under the right card.
  const idByName = new Map<string, string>()
  for (const r of [...invoices.map(i => [i.supplierId, i.supplier]), ...deliveries.map(d => [d.supplierId, d.supplierName])]) {
    if (r[0] && r[1]) idByName.set(r[1], r[0])
  }

  const add = (supplierId: string, supplierName: string, chip: AttentionChip) => {
    if (!supplierId) return
    let row = bySupplier.get(supplierId)
    if (!row) { row = { supplierId, supplierName, chips: [] }; bySupplier.set(supplierId, row) }
    if (!row.supplierName && supplierName) row.supplierName = supplierName
    if (row.chips.some(c => c.key === chip.key)) return
    row.chips.push(chip)
  }

  // ── Invoices ───────────────────────────────────────────────────────────────
  const dupSeen = new Set<string>()
  for (const inv of invoices) {
    if (inv.awaitingApproval) {
      add(inv.supplierId, inv.supplier, {
        key: `approve:${inv.id}`, tone: 'red', weight: W.approval,
        label: `נדרש אישור · ${ils(inv.amount)}`,
        target: { kind: 'approvals' },
      })
    }
    if (inv.isDuplicate) {
      // A duplicate is a PAIR, and both halves carry the flag. One chip per
      // number per supplier, or the pair reads as two problems.
      const pairKey = `${inv.supplierId}:${inv.invoiceNumber || inv.id}`
      if (!dupSeen.has(pairKey)) {
        dupSeen.add(pairKey)
        add(inv.supplierId, inv.supplier, {
          key: `dup:${pairKey}`, tone: 'red', weight: W.duplicate,
          label: `כפילות · חשבונית ${inv.invoiceNumber || inv.id}`,
          target: { kind: 'duplicate', id: inv.id },
        })
      }
    }
    if (inv.hasError) {
      add(inv.supplierId, inv.supplier, {
        key: `err:${inv.id}`, tone: 'amber', weight: W.unread,
        label: `חשבונית ${inv.invoiceNumber || inv.id} · לא נקראה כראוי`,
        target: { kind: 'invoice', id: inv.id },
      })
    }
  }

  // ── Goods ──────────────────────────────────────────────────────────────────
  if (scope.deliveries) {
    for (const n of deliveries) {
      const age = daysBetween(enteredAt({ isoDate: n.isoDate, createdAt: n.createdAt }), today)
      const label = n.noteNumber ? `תעודה ${n.noteNumber}` : 'סחורה'
      if (n.stage === 'awaiting_approval') {
        add(n.supplierId, n.supplierName, {
          key: `approve-goods:${n.id}`, tone: 'yellow', weight: W.goodsApprove,
          label: 'סחורה ממתינה לאישורך',
          target: { kind: 'delivery', id: n.id },
        })
      }
      if (pendingPairFor(n, deliveries)) {
        add(n.supplierId, n.supplierName, {
          key: `pair:${n.id}`, tone: 'red', weight: W.pairCheck,
          label: 'אולי כפילות בתעודה',
          target: { kind: 'delivery', id: n.id },
        })
      }
      if (n.stage === 'awaiting_invoice' && age !== null && age > STUCK_DAYS) {
        add(n.supplierId, n.supplierName, {
          key: `stuck:${n.id}`, tone: 'amber', weight: W.stuck,
          label: `${label} · תקועה ${age} ימים`,
          target: { kind: 'delivery', id: n.id },
        })
      }
      // An invoice is on the row and the goods never came. Only when an invoice
      // IS attached — a bare order waiting for goods is the normal state of an
      // order, not a problem.
      const hasInvoice = !!n.linkedInvoiceId || n.intakeSource === 'invoice'
      if (n.stage === 'awaiting_goods' && hasInvoice && age !== null && age > STUCK_DAYS) {
        add(n.supplierId, n.supplierName, {
          key: `nogoods:${n.id}`, tone: 'amber', weight: W.noGoods,
          label: `חשבונית בלי סחורה · ${age} ימים`,
          target: { kind: 'delivery', id: n.id },
        })
      }
    }
  }

  // ── Payments due this week (today and tomorrow have their own block) ────────
  if (scope.payments) {
    for (const p of payments) {
      if (p.status !== 'pending' || !p.valueDate) continue
      const d = daysBetween(today, p.valueDate)
      if (d === null || d < 2 || d > 7) continue
      add(p.supplier_id, p.supplier, {
        key: `pay:${p.id}`, tone: 'blue', weight: W.payment,
        label: `תשלום · ${ils(p.amount)} · ת. ערך ${shortDate(p.valueDate)}`,
        target: { kind: 'payment', id: p.id },
      })
    }
  }

  // ── Statements ─────────────────────────────────────────────────────────────
  if (scope.statements) {
    for (const s of statements) {
      if (s.status !== 'mismatch' && s.status !== 'needs_review') continue
      if (!s.supplier_id) {
        unassigned.push({
          key: `stmt:${s.id}`,
          title: 'כרטסת שהגיעה בלי ספק',
          meta: `נקלטה ${shortDate(s.uploaded_at)} · לא זוהה ספק על המסמך`,
          action: 'שייכי ←',
          target: { kind: 'statement', id: s.id },
        })
        continue
      }
      add(s.supplier_id, s.supplier_name, {
        key: `stmt:${s.id}`, tone: 'red', weight: W.mismatch,
        label: s.diff ? `פער בכרטסת · ${ils(s.diff)}` : 'כרטסת לא תואמת',
        target: { kind: 'statement', id: s.id },
      })
    }
  }

  // ── Open alerts not already said by a chip above ───────────────────────────
  for (const a of alerts) {
    if (a.status === 'resolved' || COVERED_ALERT_TYPES.has(a.type)) continue
    const p = a.payload ?? {}
    const sid = String(p.supplierId ?? '') || (a.supplier ? idByName.get(a.supplier) ?? '' : '')
    if (!sid) {
      unassigned.push({
        key: `alert:${a.id}`, title: a.description.split(/[.—]/)[0].slice(0, 60) || 'התראה',
        meta: a.date, action: 'פתחי ←', target: { kind: 'alert', alert: a },
      })
      continue
    }
    // Keyed by TYPE per supplier: two "supplier missing details" alerts on one
    // card are one thing to do, not two chips saying the same words.
    add(sid, a.supplier ?? '', {
      key: `alert:${a.type}`, tone: 'gray', weight: W.alert,
      label: '', // the screen fills it from getAlertTypeConf — one wording, one place
      target: { kind: 'alert', alert: a },
    })
  }

  const rows = [...bySupplier.values()]
    .map(r => ({ ...r, chips: r.chips.sort((a, b) => a.weight - b.weight) }))
    .sort((a, b) =>
      (a.chips[0]?.weight ?? 99) - (b.chips[0]?.weight ?? 99) ||
      b.chips.length - a.chips.length ||
      a.supplierName.localeCompare(b.supplierName, 'he'))

  return { rows, unassigned }
}

// ── Today and tomorrow ───────────────────────────────────────────────────────

export interface DueLine {
  payment: Payment
  /** Negative = past its value date and still pending. */
  days: number
}

/** Pending payments whose money leaves today or tomorrow — or already should
 *  have. Overdue ones are the most urgent of all, so they are not filtered out. */
export function dueSoon(payments: Payment[], today: string): DueLine[] {
  const out: DueLine[] = []
  for (const p of payments) {
    if (p.status !== 'pending' || !p.valueDate) continue
    const d = daysBetween(today, p.valueDate)
    if (d === null || d > 1) continue
    out.push({ payment: p, days: d })
  }
  return out.sort((a, b) => a.days - b.days)
}

// ── Customers waiting ────────────────────────────────────────────────────────

export interface CustomerWait {
  order: Order
  state: 'arrived' | 'late'
  days: number
}

/** Two states only, because only two are hers to act on: it arrived and nobody
 *  phoned, or it was ordered long ago and has not come. */
export function customersWaiting(orders: Order[], today: string): CustomerWait[] {
  const out: CustomerWait[] = []
  for (const o of orders) {
    if (!o.customerName || o.cancelledAt) continue
    if (o.customerStatus === 'customer_arrived') {
      const d = daysBetween(o.arrivedAt ?? o.isoDate, today)
      out.push({ order: o, state: 'arrived', days: Math.max(0, d ?? 0) })
    } else if ((o.customerStatus === 'customer_waiting' || o.customerStatus === 'customer_ordered')
               && o.status === 'order_waiting') {
      const d = daysBetween(o.isoDate, today)
      if (d !== null && d > CUSTOMER_LATE_DAYS) out.push({ order: o, state: 'late', days: d })
    }
  }
  return out.sort((a, b) => (a.state === b.state ? b.days - a.days : a.state === 'arrived' ? -1 : 1))
}

// ── The pipeline at a glance ─────────────────────────────────────────────────

// Same words and the same functional colours as the stage badge (StatusBadge), so
// a segment here and a row on the goods screen cannot be told apart.
export const FLOW_STAGES = [
  { stage: 'awaiting_goods',    label: 'חשבונית ללא סחורה', color: SEMANTIC.mismatch.fg },
  { stage: 'awaiting_invoice',  label: 'ממתין לחשבונית',    color: SEMANTIC.new.fg },
  { stage: 'awaiting_approval', label: 'ממתין לאישור',      color: SEMANTIC.in_progress.fg },
] as const

export function flowCounts(deliveries: DeliveryNote[]): { stage: string; label: string; color: string; count: number }[] {
  return FLOW_STAGES
    .map(s => ({ ...s, count: deliveries.filter(d => d.stage === s.stage).length }))
    .filter(s => s.count > 0)
}
