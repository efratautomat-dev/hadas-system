// Does this text read as a RECEIPT rather than an invoice?
//
// Extracted so `receipt-audit` and `data-health` share ONE definition. Two copies
// of a rule that decides whether a row counts toward a supplier balance is the
// exact failure spec/06-RULES.md §9 is about.
//
// ⚠️ "חשבונית מס קבלה" IS A VALID TAX INVOICE and must never be flagged. It is
// extremely common in Israel and it contains the word קבלה, so a naive search
// would tell you to delete real invoices. Every combined spelling is listed
// below, and a combined hit anywhere in a field cancels that field's match.

const RECEIPT = /קבלה/

const COMBINED = [
  /חשבונית\s*מס\s*[/\-–]?\s*קבלה/,   // חשבונית מס קבלה · חשבונית מס/קבלה · חשבונית מס-קבלה
  /חשבונית\s*[/\-–]\s*קבלה/,          // חשבונית/קבלה
  /קבלה\s*[/\-–]\s*חשבונית/,          // קבלה/חשבונית (reversed)
  /חשבונית\s*מס\s*קבלה/,
]

/** The invoice columns that could carry the word, with a Hebrew label for reports. */
export const RECEIPT_FIELDS = [
  ['email_subject', 'נושא המייל'],
  ['invoice_type', 'סוג המסמך'],
  ['invoice_number', 'מספר המסמך'],
  ['line_items', 'פירוט'],
]

export function looksLikeReceipt(text) {
  const t = String(text ?? '')
  if (!RECEIPT.test(t)) return false
  return !COMBINED.some(rx => rx.test(t))
}

/** Which of an invoice row's fields read as a receipt. Empty array = none. */
export function receiptMatches(row) {
  return RECEIPT_FIELDS.filter(([col]) => looksLikeReceipt(row?.[col])).map(([, label]) => label)
}
