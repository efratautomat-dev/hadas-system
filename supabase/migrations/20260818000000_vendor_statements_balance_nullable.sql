-- ── vendor_statements: an UNKNOWN vendor balance must be NULL, not 0 ──────────
--
-- `vendor_balance` was NOT NULL, so when ingest could not read the closing balance
-- off a כרטסת it had to write 0. The reconciliation screen then compared a real
-- ledger balance against a fabricated ₪0 and displayed a gap the size of the whole
-- account — a confident, wrong verdict, which is exactly what the statement rules
-- exist to prevent (spec/06-RULES.md §9).
--
-- The frontend ALREADY handles NULL correctly: `comparableRow` in
-- src/components/StatementReconciliation.tsx treats `vendor_balance == null` as
-- "not comparable" and renders `—`. This migration is what makes that live code
-- reachable.
--
-- NOTE: the base DDL for vendor_statements is NOT in this folder — the table was
-- created out of band (docs/07-OPEN-ISSUES.md item 18). This migration is therefore
-- strictly ADDITIVE and must never assume it can (re)create the table. Everything
-- below is idempotent and safe to re-run.

-- 1. Allow "unknown". DROP NOT NULL is a no-op when the constraint is already gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'vendor_statements'
      AND  column_name  = 'vendor_balance'
      AND  is_nullable  = 'NO'
  ) THEN
    ALTER TABLE vendor_statements ALTER COLUMN vendor_balance DROP NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN vendor_statements.vendor_balance IS
  'Closing balance as stated BY THE SUPPLIER on the statement. NULL = not known '
  '(extraction failed, or the document carries no unambiguous closing figure) — '
  'never coerce to 0: the UI renders NULL as "—" and skips the comparison.';

-- Existing rows keep their 0. They are indistinguishable from a genuine zero
-- balance and are NOT rewritten here — a data fix would be guesswork. New rows
-- from invoices-ingest carry NULL, and those rows are also flagged by a
-- `statement_extract_failed` alert.

-- 2. `match_method` gains 'subject' — the supplier name found in the EMAIL SUBJECT.
--    The chain is now: hp -> name (document) -> subject -> email -> invoice_email -> none.
--    A CHECK constraint pinned the old vocabulary (migration 20260802000000), so the
--    insert would fail with the new value until this runs. Postgres has no
--    ADD CONSTRAINT ... IF NOT EXISTS, hence drop-then-add (idempotent).
ALTER TABLE vendor_statements
  DROP CONSTRAINT IF EXISTS vendor_statements_match_method_check;

ALTER TABLE vendor_statements
  ADD CONSTRAINT vendor_statements_match_method_check
  CHECK (
    match_method IS NULL
    OR match_method IN ('hp', 'name', 'subject', 'email', 'invoice_email', 'manual', 'none')
  );

COMMENT ON COLUMN vendor_statements.match_method IS
  'How the supplier was resolved for this statement: hp (company number), name '
  '(name read off the document), subject (supplier name found in the email subject), '
  'email (supplier email), invoice_email (sender seen on a previous invoice), manual '
  '(assigned by hand in the UI), none (unmatched / orphan). NULL = pre-existing row, '
  'route unknown.';
