-- ── vendor_statements: WHO sent the statement, and HOW we matched it ──────────
-- The statement screen needs to explain itself: it shows the sending address and
-- a Hebrew label for the matching route, plus a "change supplier" override.
--
-- NOTE: the base DDL for vendor_statements is NOT in this folder — the table was
-- created out of band (docs/07-OPEN-ISSUES.md item 18). This migration is therefore
-- strictly ADDITIVE and must never assume it can (re)create the table.

ALTER TABLE vendor_statements ADD COLUMN IF NOT EXISTS email_sender TEXT;
ALTER TABLE vendor_statements ADD COLUMN IF NOT EXISTS match_method TEXT;

COMMENT ON COLUMN vendor_statements.email_sender IS
  'From address of the email the statement arrived on. Populated by invoices-ingest; NULL for manually created statements.';

COMMENT ON COLUMN vendor_statements.match_method IS
  'How the supplier was resolved for this statement: hp (company number), name, email (supplier email), invoice_email (sender seen on a previous invoice), manual (assigned by hand in the UI), none (unmatched / orphan). NULL = pre-existing row, route unknown.';

-- CHECK explicitly permits NULL so the rows that predate this migration stay valid.
-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, hence the guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_statements_match_method_check'
  ) THEN
    ALTER TABLE vendor_statements
      ADD CONSTRAINT vendor_statements_match_method_check
      CHECK (
        match_method IS NULL
        OR match_method IN ('hp', 'name', 'email', 'invoice_email', 'manual', 'none')
      );
  END IF;
END $$;
