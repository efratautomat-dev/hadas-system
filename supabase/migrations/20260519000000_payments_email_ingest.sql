-- ── payments: columns for email-ingest idempotency ───────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source             TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS email_received_at  TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source_message_id  TEXT;

-- Unique index ensures each Gmail message is ingested at most once
CREATE UNIQUE INDEX IF NOT EXISTS payments_source_message_id_uidx
  ON payments (source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ── alerts: new columns required by payments-ingest ───────────────────────────
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title   TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status  TEXT NOT NULL DEFAULT 'unread';
