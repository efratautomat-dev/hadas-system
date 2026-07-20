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
