import { supabase } from './supabase'

// ── Which alert types she wants to see (Settings → התראות) ──────────────────
//
// Stored as the list of types turned OFF, in app_settings under one key — the
// same key/value table as the approval threshold and the logo, so it changes
// without a deploy and the demo writes it for real (demoSettings).
//
// The OFF list, not the ON list, on purpose: a type added next month is ON until
// someone turns it off. An ON list would hide every new warning by default, and
// hiding a warning nobody chose to hide is the error this screen must not make —
// the same rule as `tierAllowsAlert`, where an unmapped type stays visible.
//
// Ingest is untouched: alerts of a muted type are still written, so turning the
// type back on shows them. Muting is a view, never a deletion.

export const ALERT_PREFS_KEY = 'alerts_disabled'

/** Used while nothing is saved yet. Customer-order alerts were the one she asked to
 *  drop outright (18.10, item 4); everything else starts on. */
export const DEFAULT_DISABLED: readonly string[] = ['customer_order_joins_shipment']

export interface AlertSettingRow {
  /** Every type this switch covers — legacy aliases and per-document siblings ride
   *  together, so one switch means one thing on screen. */
  types: string[]
  label: string
  desc: string
}

export interface AlertSettingGroup {
  bucket: 'urgent' | 'action' | 'check' | 'info'
  title: string
  sub: string
  rows: AlertSettingRow[]
}

// Mirrors the buckets in Alerts.tsx (ALERT_TYPE_CONFIG). A type registered there
// and not here simply has no switch — it stays visible, never silently hidden.
export const ALERT_SETTING_GROUPS: AlertSettingGroup[] = [
  { bucket: 'urgent', title: 'דחוף', sub: 'משהו נכשל ודורש טיפול ידני', rows: [
    { types: ['invoice_ingest_failed', 'extraction_failed'], label: 'פענוח חשבונית נכשל', desc: 'מייל עם חשבונית שהמערכת לא הצליחה לקרוא — צריך להזין ידנית.' },
    { types: ['invoice_duplicate', 'duplicate_invoice'], label: 'כפילות חשבונית', desc: 'הגיעה חשבונית עם מספר שכבר קיים אצל אותו ספק.' },
    { types: ['delivery_note_duplicate'], label: 'תעודת משלוח כפולה', desc: 'הגיעה תעודה עם מספר שכבר קיים אצל אותו ספק.' },
    { types: ['return_amount_mismatch'], label: 'פער בהחזר', desc: 'הזיכוי שהגיע לא תואם לסכום החזרה שנרשמה.' },
    { types: ['statement_mismatch'], label: 'אי-התאמת כרטסת', desc: 'היתרה בכרטסת של הספק שונה מהיתרה אצלנו.' },
    { types: ['statement_extract_failed', 'statement_ingest_failed'], label: 'פענוח כרטסת נכשל', desc: 'כרטסת שהמערכת לא הצליחה לקרוא.' },
    { types: ['delivery_note_ingest_failed'], label: 'פענוח תעודת משלוח נכשל', desc: 'תעודה שהמערכת לא הצליחה לקרוא.' },
    { types: ['return_ingest_failed'], label: 'פענוח זיכוי / חזרה נכשל', desc: 'מסמך זיכוי שהמערכת לא הצליחה לקרוא.' },
    { types: ['backup_failed'], label: 'הגיבוי השבועי נכשל', desc: 'הגיבוי של ליל ראשון לא הושלם.' },
  ]},
  { bucket: 'action', title: 'פעולה', sub: 'צריך לעשות משהו, לא בהכרח עכשיו', rows: [
    { types: ['supplier_incomplete'], label: 'ספק חדש — חסרים פרטים', desc: 'נוצר ספק אוטומטית מחשבונית; צריך להשלים ח.פ, טלפון, קטגוריה.' },
    { types: ['supplier_details_review'], label: 'ספק — לבדוק פרטים', desc: 'חשבונית עם ח.פ של ספק קיים אבל בשם אחר.' },
    { types: ['unmatched_credit_note'], label: 'זיכוי בלי חזרה', desc: 'הגיע זיכוי שלא נמצאה לו חזרה פתוחה.' },
    { types: ['statement_save_failed'], label: 'שמירת כרטסת נכשלה', desc: 'הכרטסת נקראה אבל לא נשמרה.' },
    { types: ['invoice_approval_required'], label: 'חשבונית גדולה — נדרש אישור', desc: 'חשבונית מעל הסכום שהגדרת לאישור.' },
    { types: ['invoice_amount_unreadable', 'delivery_note_amount_unreadable'], label: 'סכום לא נקרא', desc: 'חשבונית או תעודה שנקלטו בלי סכום.' },
    { types: ['customer_order_joins_shipment'], label: 'הזמנת לקוחה — אפשר לצרף למשלוח', desc: 'הזמנת לקוחה שאפשר להוסיף להזמנה פתוחה מאותו ספק.' },
  ]},
  { bucket: 'check', title: 'לבדוק', sub: 'כנראה בסדר, אבל כדאי להעיף מבט', rows: [
    { types: ['invoice_low_confidence'], label: 'ודאות נמוכה בפענוח', desc: 'החשבונית נקלטה, אבל ייתכן שהתאריך או הסכום שגויים.' },
    { types: ['document_misclassified'], label: 'מסמך לא חשבונית', desc: 'הגיע לתיבת החשבוניות מסמך שאינו חשבונית — לבחור מה הוא.' },
    { types: ['invoice_no_attachment', 'invoice_no_valid_attachment', 'statement_no_file', 'delivery_note_no_file', 'return_no_file'], label: 'מייל בלי קובץ / קובץ לא תקין', desc: 'מייל שסומן אבל אין בו מסמך שאפשר לקרוא (חשבונית, תעודה, כרטסת או זיכוי).' },
    { types: ['invoice_link_failed'], label: 'הורדה מקישור נכשלה', desc: 'המסמך נשלח כקישור, וההורדה שלו נכשלה.' },
    { types: ['backup_table_unlisted'], label: 'טבלה חדשה אינה מגובה', desc: 'נוספה למערכת טבלה שהגיבוי עוד לא כולל.' },
  ]},
  { bucket: 'info', title: 'מידע', sub: 'לידיעה בלבד', rows: [
    { types: ['invoice_old_date'], label: 'תאריך מוקדם', desc: 'חשבונית עם תאריך ישן מהרגיל — נשמרה בחודש שלה.' },
    { types: ['receipt_skipped'], label: 'קבלה — לא נקלטה', desc: 'מייל שזוהה כקבלה ולכן לא נקלט כחשבונית.' },
  ]},
]

/** Parses the stored value. Anything unreadable falls back to the defaults rather
 *  than to "everything off" — a corrupt setting must never mute the feed. */
export function parseDisabled(value: string | null | undefined): Set<string> {
  if (value == null || value === '') return new Set(DEFAULT_DISABLED)
  try {
    const list = JSON.parse(value)
    if (Array.isArray(list)) return new Set(list.filter((t): t is string => typeof t === 'string'))
  } catch {
    // fall through
  }
  return new Set(DEFAULT_DISABLED)
}

export async function loadDisabledAlertTypes(): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from('app_settings').select('value').eq('key', ALERT_PREFS_KEY).maybeSingle()
    return parseDisabled(data?.value as string | null | undefined)
  } catch {
    return new Set(DEFAULT_DISABLED)
  }
}

export async function saveDisabledAlertTypes(disabled: Set<string>): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    { key: ALERT_PREFS_KEY, value: JSON.stringify([...disabled].sort()), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (error) throw error
}
