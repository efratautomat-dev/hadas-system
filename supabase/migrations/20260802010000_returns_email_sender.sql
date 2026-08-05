-- ── returns: WHO sent the credit note ─────────────────────────────────────────
-- Ingest already keeps the sending address for every other document type that
-- arrives by email — invoices (`invoices.email_sender`), delivery notes
-- (`delivery_notes.source_email`) and vendor statements
-- (`vendor_statements.email_sender`, 20260802000000). The credit-note path was the
-- one exception: `returns` had no such column, so the address was carried only in
-- the `unmatched_credit_note` alert payload and was LOST outright whenever the
-- credit note actually matched an open return — precisely the rows the owner is
-- most likely to have to chase back to a mailbox.
--
-- NOTE: the base DDL for `returns` is NOT in this folder — the table was created
-- out of band (docs/07-OPEN-ISSUES.md item 18). This migration is therefore
-- strictly ADDITIVE and must never assume it can (re)create the table.

ALTER TABLE returns ADD COLUMN IF NOT EXISTS email_sender TEXT;

COMMENT ON COLUMN returns.email_sender IS
  'From address of the email the supplier credit note arrived on. Written by invoices-ingest when a credit note closes this return; NULL for returns issued by hand in the UI and for rows that predate this column.';
