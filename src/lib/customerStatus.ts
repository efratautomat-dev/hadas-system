// ── The customer's line ──────────────────────────────────────────────────────
//
// An order placed for a person carries two states at once: where the goods are
// (`orders.status`) and what the person has been told. This is the second one.
//
// Only `customer_arrived` is ever set by the system — it is the single step it can
// witness. Everything else happened in a conversation it was not part of, and
// inferring those would put words in someone's mouth: a customer marked "notified"
// who was never called is worse than one marked nothing at all.
//
// Lives here rather than in StatusBadge because the labels are needed by the
// notebook's picker as well as by the badge, and exporting a constant from a
// component file breaks fast refresh. One source, two readers.

export type CustomerStatus =
  | 'customer_waiting'
  | 'customer_ordered'
  | 'customer_arrived'
  | 'customer_notified'
  | 'customer_delivered'

/** In order. The picker shows the whole line, so the sequence IS the UI. */
export const CUSTOMER_STATUS_FLOW: CustomerStatus[] = [
  'customer_waiting',
  'customer_ordered',
  'customer_arrived',
  'customer_notified',
  'customer_delivered',
]

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  customer_waiting:   'ממתינה',
  customer_ordered:   'הוזמנה מהספק',
  customer_arrived:   'הגיעה לחנות',
  customer_notified:  'נמסרה הודעה',
  customer_delivered: 'נמסר',
}

/** The one the API sets by itself, named so the rule is greppable. */
export const AUTOMATIC_CUSTOMER_STATUS: CustomerStatus = 'customer_arrived'
