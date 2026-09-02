// ── The pipeline's step rule ─────────────────────────────────────────────────
//
//   הזמנה → סחורה → חשבונית → אישור → בכרטסת
//
// WHICH step counts as reached at which stage. Kept out of the component on
// purpose: it is the part worth testing, and it is the part a second screen must
// never re-derive differently — the mistake `spec/06-RULES.md §9` records for the
// balance, where one rule lived in three places and gave three answers.
//
// D22 — the order is DISPLAYED here, it is not a state of the machine. No
// quantity and no money is ever derived from it; those are settled by the
// delivery note against the invoice.

import type { PipelineStage } from '../data/mockData'

export type StepState = 'done' | 'current' | 'todo' | 'missing' | 'na'

export interface Step {
  key: string
  label: string
  state: StepState
}

/** Does this delivery have an order behind it, and did it arrive? */
export type OrderLink = 'arrived' | 'waiting' | 'none'

/**
 * ── Why the order step has THREE states and not two ────────────────────────
 * Goods arrive with no order all the time: the supplier passes by and leaves
 * something, or adds what nobody asked for. Drawn as an EMPTY cube, the list
 * would read as dozens of deliveries stuck at step one — a queue that is not
 * one. So `na` (dashed, a dash, muted) means "does not apply, and that is
 * normal", as against `current` which means "waiting". That distinction is the
 * whole reason the order step can sit in this strip at all.
 */
export function stepsForStage(
  // `null` = there is no delivery row yet. An order that has not arrived has
  // nothing in the pipeline at all — drawing its goods step as reached would be a
  // claim about stock nobody has seen. Only the order step is live.
  stage: PipelineStage | null,
  order: OrderLink = 'none',
  /**
   * Is an invoice actually attached?
   *
   * `awaiting_goods` carries TWO meanings now, and they differ exactly here: an
   * invoice that arrived before its goods, and an order placed whose goods have
   * not come. Both are honestly "waiting for goods", so the stage cannot tell them
   * apart — only the link can. Undefined keeps the old reading, so callers that
   * cannot know are unchanged.
   */
  hasInvoice?: boolean,
): Step[] {
  const goodsIn = stage !== null && stage !== 'awaiting_goods'
  // `awaiting_goods` IS the invoice-first case — the invoice is what arrived, and
  // it is the goods that are missing. Leaving it out here drew the invoice step as
  // "not yet", which is the exact opposite of what that stage means.
  const invoiceIn = stage === 'awaiting_approval' || stage === 'in_ledger' ||
    (stage === 'awaiting_goods' && (hasInvoice ?? true))
  const approved  = stage === 'in_ledger'

  return [
    {
      key: 'order',
      label: 'הזמנה',
      state: order === 'arrived' ? 'done' : order === 'waiting' ? 'current' : 'na',
    },
    {
      key: 'goods',
      label: 'סחורה',
      // `missing` is reserved for the INVERSE case — an invoice with no goods
      // behind it, which is a discrepancy. An order still on its way is simply
      // not there yet, and that is `todo`, not an alarm.
      state: goodsIn ? 'done' : stage === 'awaiting_goods' ? 'missing' : 'todo',
    },
    { key: 'invoice', label: 'חשבונית', state: invoiceIn ? 'done' : 'todo' },
    {
      key: 'approval',
      label: 'אישור',
      // `current` ONLY when a pair actually exists and is waiting on a person.
      // Keyed on the stage itself rather than on "the invoice is in", because in
      // `awaiting_goods` the invoice IS in and approving is still not the next
      // move — finding the goods is.
      state: approved ? 'done' : stage === 'awaiting_approval' ? 'current' : 'todo',
    },
    { key: 'ledger', label: 'בכרטסת', state: approved ? 'done' : 'todo' },
  ]
}
