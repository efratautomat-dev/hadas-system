import type { DeliveryNote } from '../data/mockData'

// ── Which door did this row come through? ────────────────────────────────────
//
// The owner's question, and it is the right one: "יש סחורה שאני רואה פענוח אבל
// אין מסמך — איפה המקור להסיק שזו הקלדה?". Until now there was none. Four
// different intakes wrote the SAME value:
//
//   a note the supplier emailed          → intake_source stayed null → 'email'
//   a note photographed at the counter   → also null, because the capture path
//                                          gives itself a `capture-…` message id
//   a handwritten sheet read by the model → 'manual', the server's default
//   lines typed in by hand                → 'manual'
//
// So a row with items and no document could be an honest typed receipt or a
// photograph whose file was lost, and nothing on the screen told them apart.
// A reading with no source is a claim with no evidence — exactly what a delivery
// record exists to avoid.
//
// The door is now RECORDED at every entrance and named in one place here, so the
// list, the panel and the page cannot describe the same row differently.

export type IntakeSource = NonNullable<DeliveryNote['intakeSource']>

/** Short, for a row under the supplier's name. */
const SHORT: Record<IntakeSource, string> = {
  email:   'מסמך מהספק · מייל',
  photo:   'צילום מסמך',
  sheet:   'צילום דף בכתב יד',
  manual:  'הקלדה',
  order:   'הזמנה',
  invoice: 'נפתח מחשבונית',
}

/** Long, for the provenance chip on the delivery panel. */
const LONG: Record<IntakeSource, string> = {
  email:   'הגיע במייל מהספק',
  photo:   'נקלט מצילום המסמך',
  sheet:   'נקלט מצילום דף בכתב יד',
  manual:  'נקלט בהקלדה ידנית',
  order:   'נפתח מהזמנה',
  invoice: 'נפתח מחשבונית שהגיעה לפני הסחורה',
}

export function intakeShort(src: IntakeSource | undefined | null): string {
  return SHORT[(src ?? 'manual') as IntakeSource] ?? SHORT.manual
}

export function intakeLong(src: IntakeSource | undefined | null): string {
  return LONG[(src ?? 'manual') as IntakeSource] ?? LONG.manual
}

/**
 * Was a source document ever supposed to exist on this row?
 *
 * This is the whole point of recording the door. `manual`, `order` and `invoice`
 * rows have no document by their nature and saying "no document attached" about
 * them is a fact, not a fault. `email`, `photo` and `sheet` rows were made FROM a
 * document — if the file is missing there, something was lost, and the screen has
 * to say so rather than show the same grey box in both cases.
 */
export function documentExpected(src: IntakeSource | undefined | null): boolean {
  return src === 'email' || src === 'photo' || src === 'sheet'
}

/** Why this row shows no document — the sentence under "אין מסמך מצורף". */
export function noDocumentReason(src: IntakeSource | undefined | null): string {
  switch (src ?? 'manual') {
    case 'manual':  return 'הפריטים הוקלדו ידנית — לא היה מסמך מקור.'
    case 'order':   return 'השורה נפתחה מהזמנה — המסמך יגיע עם הסחורה.'
    case 'invoice': return 'השורה נפתחה מחשבונית שהגיעה לפני הסחורה.'
    // The three that SHOULD have had one. Said plainly: this is a loss, not a state.
    case 'email':   return 'התעודה הגיעה במייל אך הקובץ לא נשמר — יש לחפש אותה בתיבה.'
    case 'photo':   return 'המסמך צולם אך הקובץ לא נשמר — כדאי לצלם שוב.'
    case 'sheet':   return 'הדף צולם ונקרא אך הצילום לא נשמר — כדאי לצלם שוב.'
    default:        return 'לתעודה הזו לא נשמר קובץ מקור.'
  }
}
