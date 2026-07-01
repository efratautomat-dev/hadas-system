-- ── delivery_notes: columns for email-ingest pipeline ───────────────────────
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS drive_file_link  TEXT;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS email_subject    TEXT;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS message_link     TEXT;

-- ── returns: columns for email-ingest pipeline ──────────────────────────────
ALTER TABLE returns ADD COLUMN IF NOT EXISTS drive_file_link  TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS email_subject    TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS message_link     TEXT;
