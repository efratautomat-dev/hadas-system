import type { DeliveryNote } from '../data/mockData'
import { parseLines, parsedTotal } from './lineItemsFormat'

// ── A figure nobody printed ──────────────────────────────────────────────────
//
// The owner's reason, in her words: it is not always clear whether the final
// figure is before VAT or after it, and she wants that settled before she
// transfers money.
//
// Two kinds of delivery carry a total that no supplier ever wrote:
//
//   typed / handwritten — an employee filled a grid of unit prices and the system
//     summed them and added VAT. Every step is defensible and not one of them is
//     the supplier's own arithmetic.
//   no total on the document — the note arrived with priced lines and no final
//     figure, so the only total available is the one the screen computes.
//
// Both are fine to work with and neither is fine to PAY against unchecked, which
// is the whole distinction: this flag does not say the number is wrong, it says
// nobody outside this system has agreed to it yet.
//
// ⚠️ It never carries a figure. It is derived from the door and from whether an
// amount exists — nothing here reveals an amount, so it is safe on a screen where
// amounts are masked.

/** Was this row's total produced by us rather than read off a document? */
export function amountIsComputed(n: DeliveryNote): boolean {
  // Rows the pipeline opened for itself hold a placeholder, not a claim about
  // money — an order's shell and an invoice's shell are not deliveries yet.
  if (n.intakeSource === 'order' || n.intakeSource === 'invoice') return false

  // Recorded at the counter: the grid IS the arithmetic.
  if ((n.intakeSource === 'manual' || n.intakeSource === 'sheet') && (n.amount ?? 0) !== 0) return true

  // A document with priced lines and no total of its own. The screen shows a sum
  // for it, and that sum is ours.
  if ((n.amount ?? 0) === 0 && parsedTotal(parseLines(n.lineItems ?? '')) !== null) return true

  return false
}

/** The rows behind the flag, so a screen can name them rather than only count. */
export function computedAmountNotes(notes: DeliveryNote[]): DeliveryNote[] {
  return notes.filter(amountIsComputed)
}
