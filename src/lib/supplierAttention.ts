import type { PipelineStage } from '../data/mockData'

// ── What needs a person, per supplier ────────────────────────────────────────
//
// The employee used to open supplier after supplier to discover whether any of
// them had work in it. This is that answer, computed once, so it can sit beside
// the name in the picker — the moment of choosing is the moment the information
// is useful.
//
// THREE levels, not two, and the distinction is the whole point:
//
//   red    — waiting for HER. Goods and an invoice are attached and someone has
//            to confirm they match. This is the only level that is a task.
//   amber  — waiting for something ELSE. An invoice that has not arrived, goods
//            that have not turned up. Worth knowing, not worth doing.
//   green  — nothing.
//
// Collapsing amber into red would fill the list with work nobody can do, which is
// how a signal stops being read. Collapsing it into green would hide the thing an
// employee is asked about on the phone.
//
// ⚠️ It says HOW MANY and AT WHICH STEP — never how much money. The counts are
// derived from stages alone, so this is safe on a screen where amounts are masked.

export type Attention = 'red' | 'amber' | 'green'

export interface SupplierAttention {
  level: Attention
  /** Rows needing confirmation — the red count. */
  toApprove: number
  /** Rows waiting on the outside world — the amber count. */
  waiting: number
  /** One short line for a tooltip or a secondary column. */
  label: string
}

const EMPTY: SupplierAttention = { level: 'green', toApprove: 0, waiting: 0, label: 'אין מה לעשות' }

export function supplierAttention(
  stages: (PipelineStage | null | undefined)[],
): SupplierAttention {
  let toApprove = 0
  let waiting = 0
  for (const s of stages) {
    if (s === 'awaiting_approval') toApprove++
    else if (s === 'awaiting_invoice' || s === 'awaiting_goods') waiting++
  }
  if (toApprove > 0) {
    return {
      level: 'red', toApprove, waiting,
      label: toApprove === 1 ? 'ממתינה לאישור' : `${toApprove} ממתינות לאישור`,
    }
  }
  if (waiting > 0) {
    return {
      level: 'amber', toApprove, waiting,
      label: waiting === 1 ? 'ממתין לחשבונית' : `${waiting} ממתינים`,
    }
  }
  return EMPTY
}

export const ATTENTION_COLOR: Record<Attention, string> = {
  // The functional palette, not the brand one: these are traffic-light semantics
  // and must stay legible however the app is reskinned (src/theme/status.ts).
  red:   '#DC2626',
  amber: '#A16207',
  green: '#166534',
}
