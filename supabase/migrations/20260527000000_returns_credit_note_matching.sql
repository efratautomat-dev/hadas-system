-- Match supplier credit notes to existing returns instead of inserting new rows.
-- The fields below are populated when an incoming credit note closes a return.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS supplier_credit_note_number TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS supplier_credit_note_date   DATE;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS supplier_credit_note_amount NUMERIC;

-- Already added in 20260525000000_non_invoice_ingest_columns.sql; re-asserted for safety.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS drive_file_link  TEXT;
