import type React from 'react'
import type { LedgerRow } from './ledgerEngine'

// ── A ledger row is a way IN to the record it came from ─────────────────────
//
// Owner, 18.10.2026: "I see rows and I can't go through them to the record — so
// what does it give me besides seeing there is a minus?" Every ledger row already
// carries the id of the invoice or payment it was built from (ledgerEngine sets
// `id` to it), so the only thing missing was a click.
//
// One callback for every ledger on every screen, so the routing rule lives here
// and not in four tables. A reset row (`reset:<id>`) and the opening line are not
// records anyone can open — the row stays plain.

// `here` is what the CURRENT screen needs to reopen itself — the statement or
// supplier she was on — so that Back from the invoice lands on that exact place,
// not on the list above it.
export type OpenLedgerRow = (row: Pick<LedgerRow, 'type' | 'id'>, here?: Record<string, string>) => void

export function ledgerRowOpens(row: Pick<LedgerRow, 'type' | 'id'>): boolean {
  if (!row.id || row.id.startsWith('reset:')) return false
  return row.type === 'חשבונית' || row.type === 'זיכוי' || row.type === 'תשלום'
}

/** Props for a <tr> that opens its record — its own style kept, a pointer added. */
export function ledgerRowProps(
  row: Pick<LedgerRow, 'type' | 'id'>,
  open: OpenLedgerRow | undefined,
  style: React.CSSProperties = {},
) {
  if (!open || !ledgerRowOpens(row)) return { style }
  return {
    onClick: () => open(row),
    style: { ...style, cursor: 'pointer' },
    title: row.type === 'תשלום' ? 'פתיחת התשלום' : 'פתיחת החשבונית',
  }
}
