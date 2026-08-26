// The supplier ledger ENGINE — the rules, and nothing but the rules.
//
// Zero imports on purpose. This file is copied verbatim to
// `supabase/functions/_shared/ledgerEngine.ts` so the Deno edge functions can
// compute the same balance the UI shows; anything importable from `src/` would
// make that copy impossible. Display formatting therefore lives in the caller —
// the engine emits `isoDate` and never a formatted date.
//
// `scripts/check-twins.mjs` compares the two copies below their header comment
// and fails the build if they diverge. Edit both, or edit neither.
//
// Rules, from spec/06-RULES.md §2:
//   balance = opening_balance + Σ invoices − Σ (non-cancelled payments)
// Credit notes are NEGATIVE invoices and net in automatically. Returns never move
// the balance — only the credit note that matches them does. Rows link by
// SUPPLIER_ID, never by name (§2b).

type AmountLike = number | string | null | undefined
const num = (v: AmountLike): number => Number(v ?? 0) || 0

// Local, deliberately: `round2` also lives in vat.ts, but this file may not
// import anything (see the header). One line, and the twin guard keeps the two
// copies of THIS file honest.
const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Is a supplier's statement figure in agreement with our ledger?
 *
 * `null` when there is nothing to compare — an unknown vendor figure is NOT a
 * mismatch, and claiming one accuses a supplier of a gap nobody measured.
 *
 * **Exactly zero, no tolerance band** — the owner's rule. Rounding to the agora
 * FIRST is what makes that safe: without it a float artefact
 * (0.30000000000000004) masquerades as a gap.
 *
 * It lives here, next to the balance itself, because the verdict was previously
 * re-derived at every call site and the copies drifted: three different bands in
 * one screen (`=== 0`, `> 0.005`, `< 1`), so a 0.004 gap read `תואם` in the list
 * and `לא תואם` in the detail one click later. `spec/06-RULES.md §9` is the
 * record of the same failure for the balance; this is the verdict computed from it.
 */
export function statementVerdict(
  ourBalance: number,
  vendorBalance: number | null | undefined,
): 'matched' | 'mismatch' | null {
  if (vendorBalance == null) return null
  return statementDiff(ourBalance, vendorBalance) === 0 ? 'matched' : 'mismatch'
}

/** The signed gap, rounded to the agora: positive = we show more than they do. */
export function statementDiff(ourBalance: number, vendorBalance: number): number {
  return round2(ourBalance - vendorBalance)
}

export type LedgerEntryType = 'פתיחה' | 'חשבונית' | 'זיכוי' | 'תשלום'

export interface LedgerRow {
  id: string
  /** ISO `YYYY-MM-DD`, or '' when the source had no usable date. */
  isoDate: string
  description: string
  type: LedgerEntryType
  debit: number
  credit: number
  /** Running balance INCLUDING this row. */
  balance: number
  /** Flagged duplicate/errored: shown, but NOT counted in the balance. */
  excluded: boolean
  /**
   * The signed amount this row REPRESENTS (+ owed to the supplier, − paid or
   * credited), independent of whether it counts. For a normal row it is just
   * `debit − credit`; for an EXCLUDED row it is the only place the real figure
   * survives, since `debit`/`credit` are forced to 0 so the running totals stay
   * honest. Without it a suspected double-charge shows as "—/—" and the manager
   * cannot see the very number that explains a statement's gap.
   */
  movement: number
  /**
   * True when the source row carried no date. Such a row still counts towards the
   * balance, but it used to sort as "before the period" (since `'' < any date`)
   * and vanish into the opening figure — a ledger whose opening balance did not
   * agree with the rows under it. Callers must surface these, not hide them.
   */
  undated: boolean
  /**
   * An invoice over the approval threshold that the owner has not yet approved
   * or rejected.
   *
   * Modelled on `undated`, NOT on `excluded`, and the difference is the whole
   * decision: `excluded` zeroes debit/credit, `undated` COUNTS AND MARKS. The
   * owner chose counting — a balance that quietly omits a real, filed invoice
   * shows less than is owed, and that is the more dangerous of the two errors.
   * The mark is what stops it from being invisible.
   */
  pendingApproval: boolean
  /**
   * The PIPELINE's approval (§6.e): goods and invoice are paired, and no human has
   * yet let the pair into the ledger. Sourced from `invoices.ledger_approved_at`
   * being null.
   *
   * Deliberately a SECOND field and not a reuse of `pendingApproval` above, which
   * is the ₪20K gate. They are two different questions that happen to share the
   * word "approval", they are set by different code, and one invoice can be
   * waiting on both at once — collapsing them would make "approve" ambiguous at
   * exactly the moment someone clicks it.
   *
   * It follows the same COUNT-AND-MARK rule, for the same reason: a balance that
   * quietly omits a real, filed invoice shows less than is owed, and that is the
   * more dangerous of the two errors. The mark is what stops it being invisible.
   */
  awaitingLedgerApproval: boolean
}

interface InvoiceLike {
  id: string
  supplierId?: string | null
  amount?: AmountLike
  total_amount?: AmountLike
  invoiceDate?: string | null
  date?: string | null
  invoiceNumber?: string | null
  // Flags set by ingest. Both accepted in snake_case too, because the suppliers
  // list reads straight from the view without going through useInvoices.
  isDuplicate?: boolean | null
  hasError?: boolean | null
  is_duplicate?: boolean | null
  has_error?: boolean | null
  awaitingApproval?: boolean | null
  awaiting_approval?: boolean | null
  ledgerApprovedAt?: string | null
  ledger_approved_at?: string | null
}

/**
 * A row flagged as a possible duplicate or as errored does NOT move the balance —
 * a suspected double-charge must not inflate what the supplier is owed.
 *
 * This rule already existed, but ONLY inside useSuppliers, so the list card and
 * every other screen disagreed for any supplier holding such a row. It lives here
 * now, which is what makes the figure the same everywhere. The row is still
 * RETURNED and flagged, never hidden — same principle as an undated row.
 */
export function isExcludedFromBalance(inv: {
  isDuplicate?: boolean | null
  hasError?: boolean | null
  is_duplicate?: boolean | null
  has_error?: boolean | null
}): boolean {
  return !!(inv.isDuplicate ?? inv.is_duplicate) || !!(inv.hasError ?? inv.has_error)
}

/**
 * Waiting on the owner's decision (see LedgerRow.pendingApproval). Accepts both
 * spellings for the same reason isExcludedFromBalance does: the suppliers list
 * reads the view directly, without going through useInvoices' camelCase mapping.
 */
export function isAwaitingApproval(inv: {
  awaitingApproval?: boolean | null
  awaiting_approval?: boolean | null
}): boolean {
  return !!(inv.awaitingApproval ?? inv.awaiting_approval)
}

/**
 * Waiting to be let into the ledger by the goods pipeline (see
 * LedgerRow.awaitingLedgerApproval). A TIMESTAMP, not a boolean: the column
 * records when it was approved, so absence is the pending state.
 *
 * Both spellings for the same reason the two predicates above accept both — the
 * suppliers list reads the view directly, without useInvoices' camelCase mapping.
 *
 * Every invoice that existed before the pipeline shipped was stamped approved by
 * the migration, so this is false for all of them. Without that backfill this
 * would be true for the entire history and the mark would mean nothing.
 */
export function isAwaitingLedgerApproval(inv: {
  ledgerApprovedAt?: string | null
  ledger_approved_at?: string | null
}): boolean {
  return !(inv.ledgerApprovedAt ?? inv.ledger_approved_at)
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
      const excluded = isExcludedFromBalance(i)
      return {
        id: i.id,
        isoDate: iso,
        description: `${credit ? 'זיכוי' : 'חשבונית'} ${i.invoiceNumber || i.id}`,
        type: (credit ? 'זיכוי' : 'חשבונית') as LedgerEntryType,
        // An excluded row contributes ZERO to every running total; its real
        // amount survives on `movement` so the caller can still show it.
        debit:  excluded ? 0 : (credit ? 0 : amount),
        credit: excluded ? 0 : (credit ? -amount : 0),
        excluded,
        movement: amount,
        undated: !iso,
        pendingApproval: isAwaitingApproval(i),
        awaitingLedgerApproval: isAwaitingLedgerApproval(i),
      }
    })

  const pay = payments
    .filter(p => p.supplier_id === supplierId && p.status !== 'cancelled')
    .map(p => {
      const iso = (p.date ?? '').slice(0, 10)
      return {
        id: String(p.id),
        isoDate: iso,
        description: `תשלום · ${p.type ?? ''}`.trim(),
        type: 'תשלום' as LedgerEntryType,
        debit: 0,
        credit: num(p.amount),
        excluded: false,
        movement: -num(p.amount),
        undated: !iso,
        // Only invoices pass through either approval gate — a payment is money that
        // already moved, and there is nothing to hold back.
        pendingApproval: false,
        awaitingLedgerApproval: false,
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
  /** Rows excluded from the balance as duplicate/errored — surfaced, not hidden. */
  excludedCount: number
  /**
   * Invoices counted in the balance that the owner has not yet approved.
   * `pendingApprovalTotal` is how much of `closingBalance` is still undecided —
   * the figure the supplier screen puts above the ledger in words.
   */
  pendingApprovalCount: number
  pendingApprovalTotal: number
  /**
   * Movements counted in the balance that the goods pipeline has not approved into
   * the ledger yet. These feed a MESSAGE ("קיימות תנועות הממתינות לאישור"), never a
   * second balance: the owner's decision was one figure plus a mark, because two
   * balances on one screen is the ambiguity this engine exists to remove.
   */
  awaitingLedgerCount: number
  awaitingLedgerTotal: number
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
  const excluded = entries.filter(e => e.excluded)
  // Counted from ALL entries, never from the windowed rows: how much of what is
  // owed is still undecided does not change because the screen is showing one
  // month. Excluded rows are left out — they contribute nothing to the balance,
  // so nothing of theirs is pending.
  const pending = entries.filter(e => e.pendingApproval && !e.excluded)
  // Same exclusion rule as `pending`, and counted from ALL entries rather than the
  // windowed rows: how much of what is owed is still unapproved does not change
  // because the screen is showing one month.
  const awaitingLedger = entries.filter(e => e.awaitingLedgerApproval && !e.excluded)
  return {
    rows,
    periodOpening,
    // "בהסדר תשלום" is display-only: the balance reads 0 and the rows stay visible.
    closingBalance: opts?.paymentArrangement ? 0 : closing,
    undatedCount: undated.length,
    undatedTotal: undated.reduce((s, e) => s + e.debit - e.credit, 0),
    excludedCount: excluded.length,
    pendingApprovalCount: pending.length,
    pendingApprovalTotal: round2(pending.reduce((s, e) => s + e.debit - e.credit, 0)),
    awaitingLedgerCount: awaitingLedger.length,
    awaitingLedgerTotal: round2(awaitingLedger.reduce((s, e) => s + e.debit - e.credit, 0)),
  }
}
