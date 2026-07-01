-- Cost guard for invoices-ingest: track per-email extraction failures so the
-- 5-minute cron stops re-processing (and re-billing Anthropic for) a document
-- that fails every time. After MAX_INGEST_ATTEMPTS the email is parked behind a
-- Gmail label and an alert is raised for manual handling.
create table if not exists public.ingest_failures (
  gmail_message_id text        primary key,
  attempts         integer     not null default 0,
  last_error       text,
  last_attempt_at  timestamptz not null default now()
);

-- Edge Functions use the service-role key (bypasses RLS). No client access is
-- needed, so enable RLS with no policies -> table is service-role-only.
alter table public.ingest_failures enable row level security;
