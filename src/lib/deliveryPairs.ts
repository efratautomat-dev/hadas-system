import type { DeliveryNote } from '../data/mockData'

// ── One delivery, two records ────────────────────────────────────────────────
//
// The order the owner described, and both halves happen:
//
//   note first  — the supplier emails it, then the goods arrive. She types
//                 nothing: the row is already there and she confirms it.
//   goods first — she records what came, and his note reaches the mailbox a day
//                 later. Two rows now describe one delivery.
//
// Only the second needs a person. Whether Tuesday's manual receipt and this
// morning's emailed note are the same shipment is a judgement about physical
// goods — two deliveries from one supplier in a week are ordinary — so the system
// finds the candidate and asks. It never merges on its own: a silent merge loses a
// shipment, while a duplicate merely shows one, and only the visible error can be
// corrected.
//
// `pairedNoteId` is the answer, once given. A question re-asked after it has been
// answered is one people learn to click past without reading.

/** How far apart two records of one delivery can plausibly be. */
const PAIR_WINDOW_DAYS = 14

// Everything recorded HERE, whichever way: typed at the counter, photographed, or
// read off a handwritten page. `sheet` belongs with them and not with `email` —
// what makes a row pairable is that WE made it, not how much of it a model read.
const typedByHand = (n: DeliveryNote) =>
  n.intakeSource === 'manual' || n.intakeSource === 'photo' || n.intakeSource === 'sheet'

const cameFromSupplier = (n: DeliveryNote) =>
  n.intakeSource === 'email'

function daysApart(a?: string, b?: string): number | null {
  if (!a || !b) return null
  const d = Math.abs(new Date(a).getTime() - new Date(b).getTime())
  return Number.isFinite(d) ? Math.round(d / 86_400_000) : null
}

/**
 * The emailed note that might BE this hand-entered delivery — or null.
 *
 * Deliberately narrow: same supplier, his own document, neither row already
 * answered for, close in time, and neither attached to an invoice yet. Once
 * either is in the ledger the question is no longer worth raising.
 */
export function pendingPairFor(
  note: DeliveryNote,
  all: DeliveryNote[],
): DeliveryNote | null {
  if (!typedByHand(note)) return null
  if (note.pairedNoteId) return null
  if (note.stage && note.stage !== 'awaiting_invoice') return null

  const candidates = all.filter(o =>
    o.id !== note.id &&
    o.supplierId === note.supplierId &&
    cameFromSupplier(o) &&
    !o.pairedNoteId &&
    (!o.stage || o.stage === 'awaiting_invoice'))

  // Nearest in time. More than one is possible and the person picks by opening
  // them; offering the closest first is a suggestion, not a decision.
  const scored = candidates
    .map(o => ({ o, gap: daysApart(note.isoDate, o.isoDate) ?? 999 }))
    .filter(x => x.gap <= PAIR_WINDOW_DAYS)
    .sort((a, b) => a.gap - b.gap)

  return scored[0]?.o ?? null
}

/** How many of a supplier's deliveries are waiting on that question. */
export function pendingPairCount(notes: DeliveryNote[]): number {
  return notes.filter(n => pendingPairFor(n, notes)).length
}
