// The supplier ledger — ONE implementation.
//
// It existed three times: SupplierDetail built its own, SupplierLedger built a
// second one filtered to a hard-coded 2026 window, and the statement screen read
// a STORED `our_balance` column that nothing ever refreshed. The same supplier
// showed three different balances (measured: 9000 / 7000 / 6000 on one dataset).
//
// Rules, from spec/06-RULES.md §2:
//   balance = opening_balance + Σ invoices − Σ (non-cancelled payments)
// Credit notes are NEGATIVE invoices and net in automatically. Returns never move
// the balance — only the credit note that matches them does. Rows link by
// SUPPLIER_ID, never by name (§2b).

import { isoToDisplay } from './dates'

type AmountLike = number | string | null | undefined
const num = (v: AmountLike): number => Number(v ?? 0) || 0

export type LedgerEntryType = 'פתיחה' | 'חשבונית' | 'זיכוי' | 'תשלום'

export interface LedgerRow {
  id: string
  /** ISO `YYYY-MM-DD`, or '' when the source had no usable date. */
  isoDate: string
  displayDate: string
  description: string
  type: LedgerEntryType
  debit: number
  credit: number
  /** Running balance INCLUDING this row. */
  balance: number
  /**
   * True when the source row carried no date. Such a row still counts towards the
   * balance, but it used to sort as "before the period" (since `'' < any date`)
   * and vanish into the opening figure — a ledger whose opening balance did not
   * agree with the rows under it. Callers must surface these, not hide them.
   */
  undated: boolean
}

interface InvoiceLike {
  id: string
  supplierId?: string | null
  amount?: AmountLike
  total_amount?: AmountLike
  invoiceDate?: string | null
  date?: string | null
  invoiceNumber?: string | null
}

interface PaymentLike {
  id: string | number
  supplier_id?: string | null
  amount?: AmountLike
  date?: string | null
  type?: string | null
  status?: string | null
}

/** A credit note is a NEGATIVE invoice — the amount is what drives the balance. */
export function isCreditRow(amount: AmountLike): boolean {
  return num(amount) < 0
}

function invoiceIso(inv: InvoiceLike): string {
  const iso = (inv.invoiceDate ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10)
  // Fall back to the display field if it is day-first DD/MM/YYYY.
  const d = (inv.date ?? '').trim()
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

/**
 * Every ledger movement for one supplier, oldest first. Undated rows come FIRST
 * and are flagged, so they are visible rather than folded into the opening balance.
 */
export function buildLedgerEntries(
  supplierId: string,
  invoices: InvoiceLike[],
  payments: PaymentLike[],
): Omit<LedgerRow, 'balance'>[] {
  const inv = invoices
    .filter(i => i.supplierId === supplierId)
    .map(i => {
      const amount = num(i.total_amount ?? i.amount)
      const credit = isCreditRow(amount)
      const iso = invoiceIso(i)
      return {
        id: i.id,
        isoDate: iso,
        displayDate: iso ? isoToDisplay(iso) : '',
        description: `${credit ? 'זיכוי' : 'חשבונית'} ${i.invoiceNumber || i.id}`,
        type: (credit ? 'זיכוי' : 'חשבונית') as LedgerEntryType,
        debit:  credit ? 0 : amount,
        credit: credit ? -amount : 0,
        undated: !iso,
      }
    })

  const pay = payments
    .filter(p => p.supplier_id === supplierId && p.status !== 'cancelled')
    .map(p => {
      const iso = (p.date ?? '').slice(0, 10)
      return {
        id: String(p.id),
        isoDate: iso,
        displayDate: iso ? isoToDisplay(iso) : '',
        description: `תשלום · ${p.type ?? ''}`.trim(),
        type: 'תשלום' as LedgerEntryType,
        debit: 0,
        credit: num(p.amount),
        undated: !iso,
      }
    })

  return [...inv, ...pay].sort((a, b) => {
    // Undated first, then chronological. Sorting them by '' would scatter them
    // through the "before period" bucket, which is how they used to disappear.
    if (a.undated !== b.undated) return a.undated ? -1 : 1
    return a.isoDate.localeCompare(b.isoDate)
  })
}

export interface LedgerResult {
  /** Rows to display — filtered by the window when one is given. */
  rows: LedgerRow[]
  /** Balance carried INTO the window (opening + everything before it). */
  periodOpening: number
  /**
   * The supplier's TRUE current balance — opening + every movement, whatever the
   * display window is. A date filter narrows what is SHOWN, never what is owed:
   * the old screen dropped anything after its window from the total, so an
   * invoice dated next year silently vanished from the balance.
   */
  closingBalance: number
  /** Undated movements — surfaced so the caller can flag them. */
  undatedCount: number
  undatedTotal: number
}

/**
 * Build the ledger. `from`/`to` are ISO days and are a DISPLAY FILTER ONLY.
 * Omit them for the whole history.
 */
export function buildLedger(
  supplierId: string,
  invoices: InvoiceLike[],
  payments: PaymentLike[],
  openingBalance: AmountLike,
  opts?: { from?: string; to?: string; paymentArrangement?: boolean },
): LedgerResult {
  const entries = buildLedgerEntries(supplierId, invoices, payments)
  const opening = num(openingBalance)
  const { from, to } = opts ?? {}

  // The TRUE closing balance always counts every movement.
  const closing = entries.reduce((s, e) => s + e.debit - e.credit, opening)

  // Undated rows always belong to the visible set — hiding them behind a date
  // filter is exactly the bug this replaces.
  const inWindow = (e: { isoDate: string; undated: boolean }) =>
    e.undated || ((!from || e.isoDate >= from) && (!to || e.isoDate <= to))

  const periodOpening = entries
    .filter(e => !e.undated && from && e.isoDate < from)
    .reduce((s, e) => s + e.debit - e.credit, opening)

  let running = periodOpening
  const rows: LedgerRow[] = entries.filter(inWindow).map(e => {
    running += e.debit - e.credit
    return { ...e, balance: running }
  })

  const undated = entries.filter(e => e.undated)
  return {
    rows,
    periodOpening,
    // "בהסדר תשלום" is display-only: the balance reads 0 and the rows stay visible.
    closingBalance: opts?.paymentArrangement ? 0 : closing,
    undatedCount: undated.length,
    undatedTotal: undated.reduce((s, e) => s + e.debit - e.credit, 0),
  }
}
