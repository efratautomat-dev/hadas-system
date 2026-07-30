// ── Credit-note sign (single source of truth) ────────────────────────────────
// A credit note is stored as a NEGATIVE invoice, so it nets against the supplier
// balance exactly once (spec/06-RULES.md §2). Ingest already forces that sign at
// intake — `invoices-ingest/index.ts` negates all three amounts with -Math.abs
// rather than trusting the extractor.
//
// This module is the same rule for rows that are ALREADY in the DB: when the
// classifier misses a credit note and it lands as a positive charge, the manager
// flips it from the invoice screen. Using -Math.abs (never `* -1`) makes the
// conversion IDEMPOTENT — applying it twice cannot bounce the sign back, which is
// what makes the double-minus bug impossible.
//
// The sign and `invoice_type` are one unit: they are always produced together by
// applyCreditSign, so a row can never be negative while typed as a charge.

import type { Invoice } from '../data/mockData'

export const INVOICE_TYPE_CREDIT = 'זיכוי'
export const INVOICE_TYPE_CHARGE = 'חשבונית'

type AmountLike = number | string | null | undefined

const num = (v: AmountLike): number => Number(v ?? 0) || 0

/** The three monetary fields the sign applies to. */
export interface InvoiceAmounts {
  amountBeforeVat: number
  vat: number
  amount: number
}

/**
 * Is this row a credit note?
 *
 * Keyed on the AMOUNT, not on `invoice_type`: the amount is what actually drives
 * the balance (`supplierBalance.ts`) and the ledger (`SupplierLedger.tsx`), and
 * legacy rows carry a negative total with `invoice_type` unset. Reading the sign
 * keeps this answer consistent with the money everywhere else in the app.
 */
export function isCreditInvoice(inv: Pick<Invoice, 'amount'>): boolean {
  return num(inv.amount) < 0
}

/**
 * Force the three amounts to the sign implied by `credit`, and return the
 * matching `invoice_type` alongside them.
 *
 * IDEMPOTENT — `applyCreditSign(applyCreditSign(x, true), true)` equals
 * `applyCreditSign(x, true)`. Callers may run it on every keystroke.
 */
export function applyCreditSign(
  amounts: InvoiceAmounts,
  credit: boolean,
): InvoiceAmounts & { invoice_type: string } {
  const signed = (v: AmountLike) => (credit ? -Math.abs(num(v)) : Math.abs(num(v)))
  return {
    amountBeforeVat: signed(amounts.amountBeforeVat),
    vat:             signed(amounts.vat),
    amount:          signed(amounts.amount),
    invoice_type:    credit ? INVOICE_TYPE_CREDIT : INVOICE_TYPE_CHARGE,
  }
}

/**
 * Flip a whole invoice to/from credit-note form, ready to hand to `onSave`.
 * Only the four sign-bearing fields change; everything else is carried through.
 */
export function convertInvoice(inv: Invoice, credit: boolean): Invoice {
  return { ...inv, ...applyCreditSign(inv, credit) }
}
