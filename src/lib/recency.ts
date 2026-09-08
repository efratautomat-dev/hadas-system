// ── "החדש ביותר למעלה" — one definition of newest ───────────────────────────
//
// The owner's rule, and it is not the same as "the latest date on the paper":
// newest means WHEN THE ROW ENTERED THE SYSTEM. A pipeline opened this morning
// for an invoice dated last month is the newest thing that happened, and sorting
// it by the invoice's date buries it mid-list, which reads as the row never
// having been created.
//
// The invoice screen has been doing this correctly for months
// (`createdAt || emailReceivedAt || invoiceDate`); every other list either
// repeated a variation of it or did not sort at all. The supplier card and the
// employee's supplier view sorted NOTHING — they showed whatever order the
// database happened to return, which for deliveries is physical row order.
//
// So the rule lives here once. Adding a screen means importing it, not
// remembering it.
//
// PRECEDENCE, most trustworthy first:
//   createdAt        — the row was written then. Nothing is more certain.
//   receivedAt       — when the email arrived, for rows ingested from mail.
//   emailReceivedAt  — the invoice hook's name for the same thing.
//   isoDate / dateIso / invoiceDate / date — the document's own date, last
//                      resort, because the paper says when the event happened
//                      and not when we learned about it.
//
// Rows with nothing at all sink to the bottom rather than float: a row we can
// date is more useful at the top than one we cannot.

type Datable = {
  createdAt?: string | null
  receivedAt?: string | null
  emailReceivedAt?: string | null
  isoDate?: string | null
  dateIso?: string | null
  invoiceDate?: string | null
  date?: string | null
  /** Statements name their arrival differently — same meaning, snake_case. */
  uploaded_at?: string | null
  created_at?: string | null
}

/** When this row entered the system, as an ISO-ish string. '' when unknown. */
export function enteredAt(row: Datable): string {
  return (
    row.createdAt ||
    row.created_at ||
    row.uploaded_at ||
    row.receivedAt ||
    row.emailReceivedAt ||
    row.isoDate ||
    row.dateIso ||
    row.invoiceDate ||
    row.date ||
    ''
  )
}

/**
 * Comparator: newest first, undated last.
 *
 * All the candidate fields are ISO strings (`YYYY-MM-DD` or a full timestamp), so
 * a plain string compare is chronological. Deliberately NOT `new Date()` — an
 * unparseable value there becomes NaN and every comparison with it returns false,
 * which shuffles the list instead of sorting it.
 */
export function newestFirst(a: Datable, b: Datable): number {
  const da = enteredAt(a)
  const db = enteredAt(b)
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return da === db ? 0 : da < db ? 1 : -1
}
