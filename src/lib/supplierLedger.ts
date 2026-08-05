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
//
// ── Why this file is now a wrapper ──────────────────────────────────────────
// The rules themselves moved to `./ledgerEngine`, which has ZERO imports so it
// can be copied byte-for-byte to `supabase/functions/_shared/ledgerEngine.ts` and
// let ingest compute the very same balance (Deno cannot import from `src/`).
// `scripts/check-twins.mjs` fails the build if those two copies drift — the same
// three-balances failure, mechanically prevented this time.
//
// What is left here is the one thing the engine deliberately does NOT do:
// formatting. The engine emits `isoDate`; this wrapper adds the `displayDate` the
// screens render, and re-exports everything else unchanged, so every existing
// consumer keeps importing from `lib/supplierLedger` exactly as before.

import {
  buildLedger as buildLedgerCore,
  buildLedgerEntries as buildLedgerEntriesCore,
  isCreditRow,
  isExcludedFromBalance,
  type LedgerEntryType,
  type LedgerResult as LedgerResultCore,
  type LedgerRow as LedgerRowCore,
} from './ledgerEngine'
import { isoToDisplay } from './dates'

export { isCreditRow, isExcludedFromBalance }
export type { LedgerEntryType }
/** The engine's row, before this module adds the display date. */
export type { LedgerRowCore, LedgerResultCore }

/** An engine row plus the day-first `DD/MM/YYYY` string the screens render. */
export type LedgerRow = LedgerRowCore & { displayDate: string }

export type LedgerResult = Omit<LedgerResultCore, 'rows'> & { rows: LedgerRow[] }

/** '' stays '' — an undated row has no date to format, and callers flag it. */
const withDisplayDate = <T extends { isoDate: string }>(row: T): T & { displayDate: string } =>
  ({ ...row, displayDate: row.isoDate ? isoToDisplay(row.isoDate) : '' })

/** @see buildLedgerEntries in `./ledgerEngine` — identical, plus `displayDate`. */
export function buildLedgerEntries(
  ...args: Parameters<typeof buildLedgerEntriesCore>
): (Omit<LedgerRow, 'balance'>)[] {
  return buildLedgerEntriesCore(...args).map(withDisplayDate)
}

/** @see buildLedger in `./ledgerEngine` — identical, plus `displayDate` per row. */
export function buildLedger(
  ...args: Parameters<typeof buildLedgerCore>
): LedgerResult {
  const result = buildLedgerCore(...args)
  return { ...result, rows: result.rows.map(withDisplayDate) }
}
