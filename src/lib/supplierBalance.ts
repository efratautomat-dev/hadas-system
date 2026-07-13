// Shared supplier-balance math — the SINGLE source of truth so the suppliers list,
// the supplier detail headline, and the ledger total can never drift apart.
//
//   balance = opening_balance + Σ invoices − Σ (non-cancelled payments)
//
// Credit notes are stored as NEGATIVE invoices, so they are already inside Σ invoices
// (no separate term). Returns do NOT move the balance — only their matching credit note
// does. See spec/06-RULES.md §2. Amounts are read defensively (string|number|null).

type AmountLike = number | string | null | undefined
type InvoiceLike = { total_amount?: AmountLike; amount?: AmountLike }
type PaymentLike = { amount?: AmountLike; status?: string | null }

const num = (v: AmountLike): number => Number(v ?? 0) || 0

/** Σ of invoice totals (credit notes are negative and net in automatically). */
export function sumInvoiceTotals(invoices: InvoiceLike[]): number {
  return invoices.reduce((s, i) => s + num(i.total_amount ?? i.amount), 0)
}

/** Σ of payment amounts, EXCLUDING cancelled payments. */
export function sumNonCancelledPayments(payments: PaymentLike[]): number {
  return payments.reduce((s, p) => (p.status === 'cancelled' ? s : s + num(p.amount)), 0)
}

/** Current balance = opening + Σ invoices − Σ non-cancelled payments. */
export function computeSupplierBalance(
  openingBalance: AmountLike,
  invoices: InvoiceLike[],
  payments: PaymentLike[],
): number {
  return num(openingBalance) + sumInvoiceTotals(invoices) - sumNonCancelledPayments(payments)
}
