-- dev-seed-alerts.sql — DEV-ONLY sample data for visually testing the Alerts screen.
-- Inserts one alert of EACH of the 13 live alert types (spec/07-ALERTS.md) — with a
-- SECOND invoice_duplicate alert for the same pair (14 alerts total) so the
-- "delete duplicate → resolve both" rule is testable — plus 4 demo invoices:
--   • a duplicate PAIR (INV-DUP-77) for the side-by-side popup, and
--   • two "problem" invoices (low-confidence + parse-failed) that the invoice-opening
--     alerts point at, so clicking them lands on a real invoice with a viewable document.
--
-- Safe to re-run: it first removes its own previous rows (cleanup below).
-- Alert payloads carry "demo_seed": true; demo invoices are tagged email_subject LIKE 'DEMO-%'.
--
-- Document links use placehold.co images so the 👁 eye / document viewers open something.
-- messageLink (missing-attachment alerts) uses a harmless real Gmail thread URL.
--
-- Run: paste into the Supabase SQL editor (dev project) and execute.

begin;

-- ── Cleanup previous demo rows (idempotent re-run; children before parents) ──
delete from public.alerts            where payload->>'demo_seed' = 'true';
delete from public.returns           where email_subject like 'DEMO-%';
delete from public.vendor_statements where resolution_notes like 'DEMO%';
delete from public.payments          where source = 'demo';
delete from public.invoices          where email_subject like 'DEMO-%';
delete from public.suppliers         where notes like 'DEMO%';

-- ── Deep-link targets: suppliers + a return the alerts open directly ─────────
insert into public.suppliers (id, name, category, contact, phone, email, opening_balance, notes)
values
  ('dddddddd-0000-4000-8000-000000000001', 'עלית', 'ממתקים', 'שרה גרין', '09-4441111', 'orders@elite.example', 0, 'DEMO seed'),
  ('dddddddd-0000-4000-8000-000000000002', 'נסטלה ישראל', 'שתייה חמה', 'דוד רוזן', '03-7778899', 'ap@nestle.example', 1500, 'DEMO seed'),
  ('dddddddd-0000-4000-8000-000000000003', 'מוטי', 'שירותים', 'מוטי לוי', '052-1112233', 'moti@example.com', 0, 'DEMO seed');

-- Returns for the two-view split (spec/01-PRD.md §6). The screen derives the view
-- from gmail_message_id / message_link (no `source` column yet): rows WITH those
-- markers are "arrived" (email); rows without are "manual".
insert into public.returns
  (id, supplier_id, amount, reason, date, status, created_by, detail, email_subject,
   drive_file_link, gmail_message_id, message_link,
   supplier_credit_note_number, supplier_credit_note_date, supplier_credit_note_amount)
values
  -- manual entry (also the target of the unmatched_credit_note / return_amount_mismatch alerts)
  ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002',
   4720, 'החזרת סחורה פגומה', '2026-06-22', 'בטיפול', 'עובד דמו',
   'החזר הממתין לזיכוי תואם מהספק', 'DEMO-RET return',
   null, null, null, null, null, null),
  -- second manual entry (tracking-only, amount 0)
  ('eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001',
   0, 'החזרת פריט פגום', '2026-06-28', 'בטיפול', 'עובד דמו',
   'פריט שהוחזר לספק — ממתין לזיכוי', 'DEMO-RET manual-2',
   null, null, null, null, null, null),
  -- arrived credit note (source=email → "מסמכים שהגיעו" view)
  ('eeeeeeee-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000002',
   1800, 'זיכוי שהתקבל במייל מהספק', '2026-06-18', 'בטיפול', '',
   'חשבונית זיכוי שנקלטה מהמייל (פענוח AI)', 'DEMO-RET-EMAIL arrived',
   'https://placehold.co/620x877/dcfce7/166534.png?text=DEMO+CREDIT+NOTE',
   'demo-ret-email-1', 'https://mail.google.com/mail/u/0/?ogbl#all/FMfcgzQgMgKRBZFMJgzpPHBmSkkpnZlV',
   'CN-EMAIL-2207', '2026-06-18', 1800),
  -- MATCHED manual return: closed (נסגר) + linked to CN-EMAIL-2207 (same supplier +
  -- same amount, 1800). This is the pre-seeded end-state of the §2a match rule; the
  -- actual auto-match WRITE runs in the ingest/hadas-api backend (verify after deploy).
  ('eeeeeeee-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000002',
   1800, 'החזרת סחורה — שויכה לזיכוי', '2026-06-16', 'בטיפול', 'עובד דמו',
   'החזרה ששויכה לחשבונית זיכוי CN-EMAIL-2207', 'DEMO-RET matched',
   'https://placehold.co/620x877/dcfce7/166534.png?text=DEMO+CREDIT+NOTE',
   null, null, 'CN-EMAIL-2207', '2026-06-18', 1800);

-- A vendor statement the statement_save_failed alert opens directly (deep-link).
insert into public.vendor_statements (id, supplier_id, month, vendor_balance, our_balance, diff, status, uploaded_at, resolution_notes)
values
  ('ffffffff-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002',
   '2026-06', 4720, 4720, 0, 'needs_review', '2026-06-28T10:00:00Z', 'DEMO seed');

-- ── Demo invoices ───────────────────────────────────────────────────────────
-- drive_file_link is an image URL on purpose: (a) the eye/document viewers show it,
-- and (b) the backend delete skips Drive trashing for non-drive.google.com links
-- (hadas-api driveFileIdFromLink → null), so the duplicate popup's "delete one" works.
insert into public.invoices
  (id, supplier_name, invoice_number, invoice_date, total_amount, amount_before_vat,
   vat_amount, category, status, invoice_type, drive_file_link, ai_confidence,
   has_error, error_reason, sender_name, email_sender, received_at, is_duplicate,
   gmail_message_id, email_subject)
values
  -- duplicate pair (same supplier + invoice number → getDupPair matches)
  ('aaaaaaaa-0000-4000-8000-000000000001', 'תבורי בע"מ', 'INV-DUP-77', '2026-05-01',
   8300, 7094.02, 1205.98, 'ספקים ביגוד', 'ממתין', 'חשבונית',
   'https://placehold.co/620x877/e2e8f0/1f2937.png?text=DEMO+INVOICE+A', '',
   false, '', 'הנהלת חשבונות תבורי', 'billing@tavori.example', '2026-05-01T09:00:00Z',
   true, 'demo-dup-a', 'DEMO-DUP A'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'תבורי בע"מ', 'INV-DUP-77', '2026-05-03',
   8300, 7094.02, 1205.98, 'ספקים ביגוד', 'ממתין', 'חשבונית',
   'https://placehold.co/620x877/e2e8f0/1f2937.png?text=DEMO+INVOICE+B', '',
   false, '', 'תבורי בוט חיובים', 'noreply@tavori.example', '2026-05-03T11:30:00Z',
   true, 'demo-dup-b', 'DEMO-DUP B'),
  -- low-confidence invoice (invoice_low_confidence + invoice_old_date point here)
  ('bbbbbbbb-0000-4000-8000-000000000001', 'נסטלה ישראל', 'INV-LC-01', '2026-06-20',
   4720, 4034.19, 685.81, 'ספקים שונות', 'ממתין', 'חשבונית',
   'https://placehold.co/620x877/fef9c3/a16207.png?text=DEMO+LOW+CONFIDENCE', 'נמוכה',
   false, '', 'נסטלה חיובים', 'ap@nestle.example', '2026-06-20T08:00:00Z',
   false, 'demo-lowconf', 'DEMO-LC low confidence'),
  -- parse-failed invoice — file in Drive, NO supplier yet (invoice_ingest_failed +
  -- invoice_link_failed point here so the owner can assign a supplier + complete details)
  ('bbbbbbbb-0000-4000-8000-000000000002', '', '', '2026-06-25',
   0, 0, 0, '', 'ממתין', 'חשבונית',
   'https://placehold.co/620x877/fee2e2/b91c1c.png?text=DEMO+PARSE+FAILED', '',
   true, 'line parsing failed — assign supplier + complete manually',
   'שולח לא מזוהה', 'unknown@example.com', '2026-06-25T14:00:00Z',
   false, 'demo-parsefail', 'DEMO-PARSE parse failed');

-- ── Supplier ledger demo (נסטלה dddd…02): links + a credit note + a payment so the
--    computed balance & ledger are visible. Balance = 1500 opening + (4720 − 2000)
--    invoices − 3000 payment = 1220. Returns do NOT move the balance (only the credit
--    note does). Link key is supplier_id (spec/06-RULES.md §2, §2b).
update public.invoices set supplier_id = 'dddddddd-0000-4000-8000-000000000002'
  where id = 'bbbbbbbb-0000-4000-8000-000000000001';

insert into public.invoices
  (id, supplier_id, supplier_name, invoice_number, invoice_date, total_amount,
   amount_before_vat, vat_amount, category, status, invoice_type, sender_name,
   email_sender, received_at, is_duplicate, email_subject)
values
  ('bbbbbbbb-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000002',
   'נסטלה ישראל', 'CN-NESTLE-01', '2026-06-10', -2000, -1709.40, -290.60,
   'ספקים שונות', 'ממתין', 'זיכוי', 'נסטלה חיובים', 'ap@nestle.example',
   '2026-06-10T09:00:00Z', false, 'DEMO-LEDGER credit note');

-- Payments: the ledger payment + the "מוטי" example (immediate + 3 post-dated cheques).
-- Immediate payments carry value_date = payment_date (order date). Post-dated cheques
-- keep their order date = today and a future value_date (+1/+2/+3 months) so future-dated
-- rows are visible in the table. All tagged source='demo' for idempotent cleanup.
insert into public.payments
  (id, supplier_id, amount, payment_type, payment_date, value_date, status, reference, notes, source)
values
  ('cccccccc-0000-4000-8000-000000000010', 'dddddddd-0000-4000-8000-000000000002',
   3000, 'העברה בנקאית', '2026-06-15', '2026-06-15', 'paid', 'DEMO-LEDGER', null, 'demo'),
  -- מוטי · immediate (value_date = today = order date)
  ('cccccccc-0000-4000-8000-000000000011', 'dddddddd-0000-4000-8000-000000000003',
   4200, 'העברה בנקאית', current_date, current_date, 'paid', 'העברה 7788', 'תשלום מיידי — העברה בנקאית', 'demo'),
  -- מוטי · post-dated cheque +1 month
  ('cccccccc-0000-4000-8000-000000000012', 'dddddddd-0000-4000-8000-000000000003',
   3100, 'צ''ק', current_date, (current_date + interval '1 month')::date, 'pending', 'שיק 5001', 'שיק דחוי לחודש הבא — סחורת יוני', 'demo'),
  -- מוטי · post-dated cheque +2 months
  ('cccccccc-0000-4000-8000-000000000013', 'dddddddd-0000-4000-8000-000000000003',
   2750, 'צ''ק', current_date, (current_date + interval '2 months')::date, 'pending', 'שיק 5002', 'שיק דחוי חודשיים — יתרת חשבון', 'demo'),
  -- מוטי · post-dated cheque +3 months
  ('cccccccc-0000-4000-8000-000000000014', 'dddddddd-0000-4000-8000-000000000003',
   1980, 'צ''ק', current_date, (current_date + interval '3 months')::date, 'pending', 'שיק 5003', 'שיק דחוי שלושה חודשים — תשלום מרוכז', 'demo');

-- ── 14 alerts (13 types; invoice_duplicate appears twice for the same pair) ──
-- NB: alerts.title is NOT NULL in the dev DB, so every row sets a short title.
insert into public.alerts (type, title, message, status, payload) values
  -- 1. urgent (red) — parse-failed → opens the INVOICE (assign supplier + complete)
  ('invoice_ingest_failed', 'פענוח נכשל — טיפול ידני', 'פענוח החשבונית נכשל — נדרש טיפול ידני (הקובץ קיים ב-Drive)', 'unread',
   '{"typedSupplierName":"שולח לא מזוהה","invoiceId":"bbbbbbbb-0000-4000-8000-000000000002","demo_seed":true}'),
  -- 2. urgent (red) — duplicate popup (points at the seeded pair)
  ('invoice_duplicate', 'כפילות', 'נמצאה חשבונית כפולה אפשרית — יש לבחור איזו לשמור', 'unread',
   '{"typedSupplierName":"תבורי בע\"מ","invoiceNumber":"INV-DUP-77","supplierId":"","existingInvoiceId":"aaaaaaaa-0000-4000-8000-000000000001","invoiceId":"aaaaaaaa-0000-4000-8000-000000000002","demo_seed":true}'),
  -- 2b. urgent (red) — SECOND alert for the SAME pair (delete-one resolves BOTH)
  ('invoice_duplicate', 'כפילות', 'התראת כפילות תואמת עבור החשבונית השנייה בזוג — פתרון אחד יסגור את שתי ההתראות', 'unread',
   '{"typedSupplierName":"תבורי בע\"מ","invoiceNumber":"INV-DUP-77","supplierId":"","existingInvoiceId":"aaaaaaaa-0000-4000-8000-000000000002","invoiceId":"aaaaaaaa-0000-4000-8000-000000000001","demo_seed":true}'),
  -- 3. yellow — parse-failed → opens the INVOICE (file IS in Drive)
  ('invoice_link_failed', 'הורדה נכשלה', 'פענוח שורות נכשל — יש לפתוח את החשבונית, לשייך ספק ולהשלים פרטים', 'unread',
   '{"typedSupplierName":"שולח לא מזוהה","invoiceId":"bbbbbbbb-0000-4000-8000-000000000002","demo_seed":true}'),
  -- 4. orange — deep-links to the SPECIFIC supplier
  ('supplier_incomplete', 'ספק – חסר פרטים', 'פרטי ספק חסרים — יש להשלים את הפרטים', 'unread',
   '{"typedSupplierName":"עלית","supplierId":"dddddddd-0000-4000-8000-000000000001","demo_seed":true}'),
  -- 5. orange — deep-links to the SPECIFIC return (not the returns list)
  ('unmatched_credit_note', 'זיכוי ללא חזרה', 'התקבל זיכוי ללא החזרה תואמת — יש לפתוח את ההחזר לבדיקה ושיוך', 'unread',
   '{"typedSupplierName":"נסטלה ישראל","returnId":"eeeeeeee-0000-4000-8000-000000000001","demo_seed":true}'),
  -- 6. orange — deep-links to the SPECIFIC statement's detail
  ('statement_save_failed', 'שמירת כרטסת נכשלה', 'שמירת כרטסת הספק נכשלה — יש לפתוח את הכרטסת ולנסות שוב', 'unread',
   '{"typedSupplierName":"נסטלה ישראל","statementId":"ffffffff-0000-4000-8000-000000000001","demo_seed":true}'),
  -- 7. yellow — opens the INVOICE to verify AI extraction
  ('invoice_low_confidence', 'וודאות נמוכה', 'וודאות נמוכה בפענוח — יש לפתוח את החשבונית ולהשוות מול המסמך', 'read',
   '{"typedSupplierName":"נסטלה ישראל","invoiceId":"bbbbbbbb-0000-4000-8000-000000000001","demo_seed":true}'),
  -- 8. yellow — opens the RE-CLASSIFY popup (document image + type picker)
  ('document_misclassified', 'מסמך לא חשבונית', 'המסמך אינו חשבונית — יש לפתוח, לצפות בתמונה ולסווג מחדש', 'read',
   '{"typedSupplierName":"תנובה","documentUrl":"https://placehold.co/620x877/fef9c3/a16207.png?text=DEMO+DOCUMENT+TO+RECLASSIFY","demo_seed":true}'),
  -- 9. yellow — opens the source email (messageLink)
  ('invoice_no_attachment', 'ללא קובץ', 'המייל התקבל ללא קובץ מצורף — יש לפתוח את המייל ולצרף ידנית', 'unread',
   '{"typedSupplierName":"תבורי בע\"מ","messageLink":"https://mail.google.com/mail/u/0/?ogbl#all/FMfcgzQgMgKRBZFMJgzpPHBmSkkpnZlV","demo_seed":true}'),
  -- 10. yellow — opens the source email (messageLink)
  ('invoice_no_valid_attachment', 'ללא קובץ תקין', 'הקובץ המצורף אינו תקין — יש לפתוח את המייל ולצרף קובץ תקין', 'unread',
   '{"typedSupplierName":"אסם השקעות","messageLink":"https://mail.google.com/mail/u/0/?ogbl#all/FMfcgzQgMgKRBZFMJgzpPHBmSkkpnZlV","demo_seed":true}'),
  -- 11. gray (info) — opens the INVOICE to confirm the date
  ('invoice_old_date', 'תאריך מוקדם', 'תאריך החשבונית מוקדם מהצפוי — יש לפתוח את החשבונית ולאמת את התאריך', 'read',
   '{"typedSupplierName":"נסטלה ישראל","invoiceId":"bbbbbbbb-0000-4000-8000-000000000001","demo_seed":true}'),
  -- 12. orange — deep-links to the SPECIFIC supplier (AI-suggested detail changes)
  ('supplier_details_review', 'ספק – לבדיקת פרטים', 'המערכת מציעה עדכון פרטי ספק — נדרש אישור', 'unread',
   '{"typedSupplierName":"נסטלה ישראל","supplierId":"dddddddd-0000-4000-8000-000000000002","demo_seed":true}'),
  -- 13. urgent (red) — deep-links to the SPECIFIC return
  ('return_amount_mismatch', 'פער בהחזר', 'פער בין סכום ההחזר לזיכוי שהתקבל — יש לפתוח את ההחזר להתאמה', 'unread',
   '{"typedSupplierName":"שטראוס גרופ","returnId":"eeeeeeee-0000-4000-8000-000000000001","demo_seed":true}');

-- ── Fresh duplicate pair WITH supplier_id (like real ingest) + its two alerts ──
-- Exercises the full flow: delete one → both alerts resolve → survivor's is_duplicate
-- cleared via the (invoice_number, supplier_id) key in deleteInvoice.
insert into public.invoices
  (id, supplier_id, supplier_name, invoice_number, invoice_date, total_amount,
   amount_before_vat, vat_amount, category, status, invoice_type, drive_file_link,
   is_duplicate, gmail_message_id, email_subject, sender_name, email_sender, received_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000011', 'dddddddd-0000-4000-8000-000000000001',
   'עלית', 'INV-DUP-88', '2026-07-01', 5500, 4700.85, 799.15, 'ספקים שונות', 'ממתין',
   'חשבונית', 'https://placehold.co/620x877/e2e8f0/1f2937.png?text=DEMO+DUP2+A',
   true, 'demo-dup2-a', 'DEMO-DUP2 A', 'עלית חיובים', 'billing@elite.example', '2026-07-01T09:00:00Z'),
  ('aaaaaaaa-0000-4000-8000-000000000012', 'dddddddd-0000-4000-8000-000000000001',
   'עלית', 'INV-DUP-88', '2026-07-02', 5500, 4700.85, 799.15, 'ספקים שונות', 'ממתין',
   'חשבונית', 'https://placehold.co/620x877/e2e8f0/1f2937.png?text=DEMO+DUP2+B',
   true, 'demo-dup2-b', 'DEMO-DUP2 B', 'עלית בוט חיובים', 'noreply@elite.example', '2026-07-02T11:00:00Z');

insert into public.alerts (type, title, message, status, payload) values
  ('invoice_duplicate', 'כפילות', 'נמצאה חשבונית כפולה אפשרית (INV-DUP-88) — יש לבחור איזו לשמור', 'unread',
   '{"typedSupplierName":"עלית","invoiceNumber":"INV-DUP-88","supplierId":"dddddddd-0000-4000-8000-000000000001","existingInvoiceId":"aaaaaaaa-0000-4000-8000-000000000011","invoiceId":"aaaaaaaa-0000-4000-8000-000000000012","demo_seed":true}'),
  ('invoice_duplicate', 'כפילות', 'התראת כפילות תואמת עבור החשבונית השנייה בזוג (INV-DUP-88)', 'unread',
   '{"typedSupplierName":"עלית","invoiceNumber":"INV-DUP-88","supplierId":"dddddddd-0000-4000-8000-000000000001","existingInvoiceId":"aaaaaaaa-0000-4000-8000-000000000012","invoiceId":"aaaaaaaa-0000-4000-8000-000000000011","demo_seed":true}');

commit;
