import type { Invoice, Alert } from '../data/mockData'

// ── Derived invoice status (single source of truth) ──────────────────────────
// Status is computed live and never read from the stored `status` column (which
// drifts). Exactly three values, in priority order: transferred → under review →
// waiting. Both the Invoices screen and the Dashboard KPI import from here so the
// two can never diverge.
export const STATUS_TRANSFERRED = 'הועבר לרו״ח'
export const STATUS_REVIEW      = 'בבדיקה'
export const STATUS_WAITING     = 'ממתין'

// An alert "points at" an invoice when its payload references the invoice id
// (under any of the known keys) or shares the same Gmail message id. Backend
// currently emits existingInvoiceId + gmailMessageId; invoiceId/duplicateInvoiceId
// are matched too for forward-compatibility. relatedId covers mock data.
export function alertRefersToInvoice(alert: Alert, invoice: Invoice): boolean {
  const p = (alert.payload ?? {}) as Record<string, unknown>
  const ids = [p.invoiceId, p.existingInvoiceId, p.duplicateInvoiceId, alert.relatedId]
  if (invoice.id && ids.includes(invoice.id)) return true
  const gm = p.gmailMessageId as string | undefined
  return !!gm && !!invoice.gmailMessageId && gm === invoice.gmailMessageId
}

// Live status, in priority order:
//   1. transferred to accountant (sentToAccountant ← transferred_at) → "הועבר לרו״ח"
//   2. any UNRESOLVED alert (new/read) points at this invoice        → "בבדיקה"
//   3. otherwise                                                     → "ממתין"
export function deriveInvoiceStatus(invoice: Invoice, alerts: Alert[]): string {
  if (invoice.sentToAccountant) return STATUS_TRANSFERRED
  const underReview = alerts.some(
    a => a.status !== 'resolved' && alertRefersToInvoice(a, invoice),
  )
  return underReview ? STATUS_REVIEW : STATUS_WAITING
}

// Map the derived Hebrew status onto the badge keys. Lives HERE, not in a screen,
// so every screen renders the same badge.
//
// These used to point at the generic `new` / `in_progress` / `done` taxonomy,
// which renders `חדש` / `בטיפול` / `טופל` — three words that appear nowhere else
// on the invoices screen. The filter tabs, the counters and the detail header all
// speak the derived vocabulary above, so the badge in the row disagreed with the
// tab that had just filtered to it. The badge keys now carry the invoice's own
// words (registered in `StatusBadge`), with the same colours as before.
export const INVOICE_STATUS_INTERNAL: Record<string, string> = {
  [STATUS_WAITING]:     'invoice_waiting',
  [STATUS_REVIEW]:      'invoice_review',
  [STATUS_TRANSFERRED]: 'invoice_transferred',
}

/** Derived status → the internal key StatusBadge expects. */
export function invoiceStatusKey(invoice: Invoice, alerts: Alert[]): string {
  const derived = deriveInvoiceStatus(invoice, alerts)
  return INVOICE_STATUS_INTERNAL[derived] ?? derived
}
