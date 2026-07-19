-- Single-flight lease for invoices-ingest. The gmail_message_id dedup is a racy
-- check-then-insert, so two overlapping runs (cron + manual, or a slow run still
-- going when the next tick fires) can double-process an email → duplicate
-- invoices/suppliers. ingestInvoices claims this one row atomically at the top of
-- a run; a concurrent run finds a fresh lease and exits. A 10-minute TTL (enforced
-- in the edge function via locked_at) lets a crashed run self-heal.
create table if not exists ingest_lock (
  id        smallint primary key default 1,
  holder    text,
  locked_at timestamptz not null default 'epoch',
  constraint ingest_lock_singleton check (id = 1)
);

-- Seed the single row (free = locked_at at epoch).
insert into ingest_lock (id, holder, locked_at)
  values (1, null, 'epoch')
  on conflict (id) do nothing;
