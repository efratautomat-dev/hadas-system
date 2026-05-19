-- ── Categories tag system (free-form, learned from usage) ────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE NOT NULL,
  usage_count integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- ── Supplier↔Category history (for AI default suggestion) ────────────────────
CREATE TABLE IF NOT EXISTS supplier_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  text NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  category     text NOT NULL,
  usage_count  integer DEFAULT 1,
  last_used_at timestamptz DEFAULT now(),
  UNIQUE(supplier_id, category)
);

-- ── invoices: new columns for email-ingest pipeline ──────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS partial_return     boolean DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gmail_message_id   text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_subject      text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gmail_label_source text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS month_folder_link  text;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_gmail_message_id_uidx
  ON invoices (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- ── system_logs: developer-facing diagnostics ────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
  id         bigserial PRIMARY KEY,
  timestamp  timestamptz DEFAULT now(),
  source     text NOT NULL,
  level      text NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message    text NOT NULL,
  context    jsonb,
  message_id text
);
CREATE INDEX IF NOT EXISTS system_logs_timestamp_idx   ON system_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS system_logs_source_level_idx ON system_logs (source, level);

-- ── Seed initial categories ──────────────────────────────────────────────────
INSERT INTO categories (name) VALUES
  ('ספקים ביגוד'),
  ('ספקים כיסויי ראש ומטפחות'),
  ('ספקים בגדי ים'),
  ('ספקים שונות'),
  ('הוצאות ניהול'),
  ('הוצאות משרד'),
  ('תשלומי מעמ'),
  ('תשלומי מס הכנסה'),
  ('משכורות'),
  ('שונות')
ON CONFLICT (name) DO NOTHING;
