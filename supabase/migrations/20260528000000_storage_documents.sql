-- The bucket "documents" is PRIVATE. storage_url holds the in-bucket path
-- (e.g. "invoices/2026/05/foo.pdf"), not a publicly-fetchable URL. Viewers
-- generate a short-lived signed URL on demand via:
--   supabase.storage.from('documents').createSignedUrl(path, expiresInSeconds)
ALTER TABLE invoices          ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE delivery_notes    ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE returns           ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE vendor_statements ADD COLUMN IF NOT EXISTS storage_url TEXT;

-- Create the private "documents" bucket (idempotent).
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;
