-- ============================================================================
-- backup_runs — the record of every weekly database backup to Google Drive.
-- ----------------------------------------------------------------------------
-- WHY A TABLE AND NOT JUST A LOG LINE.
-- The HTTP response of a backup run is a convenience; this table is the record.
-- pg_cron fires the run through pg_net, which reports a timeout long before a
-- full dump finishes, and nobody is watching at 04:00 on a Saturday anyway. The
-- only question that matters afterwards — "did last week's backup happen, and was
-- it complete?" — has to be answerable from the database, not from a reply nobody
-- received.
--
-- It is also the LEASE. A unique partial index on (kind) WHERE status='running'
-- means claiming the lease IS the insert: a second run fails at the database
-- rather than after a check that another process already passed. `ingest_lock`
-- does check-then-write and carries the race this avoids.
--
-- `kind` lets the destructive year-end prune share the table on purpose: a prune
-- belongs in the same chronological list as the backups it pruned, and the
-- Settings panel then renders one history instead of two.
--
-- Idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.backup_runs (
  id            uuid        not null default gen_random_uuid(),
  kind          text        not null default 'backup'
                              constraint backup_runs_kind_check
                              check (kind in ('backup', 'cleanup')),
  status        text        not null
                              constraint backup_runs_status_check
                              check (status in ('running', 'ok', 'failed')),
  -- Israel-local calendar date, NOT a UTC date. It names the Drive folder, it is
  -- the same-day idempotency key, and it is the alert's dedup key — so a run at
  -- 04:00 Israel time must not be filed under the previous day.
  run_date      date        not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  triggered_by  text        not null
                              constraint backup_runs_triggered_by_check
                              check (triggered_by in ('cron', 'manual')),
  -- Stamped SERVER-side from the verified JWT by hadas-api; null for cron, which
  -- has no human behind it.
  actor_email   text,

  drive_folder_id     text,
  drive_folder_link   text,
  -- Set only on the run that promoted a quarterly anchor, e.g. 'רבעון 3 2026'.
  quarter_anchor      text,
  quarter_folder_link text,

  total_rows    integer,
  file_count    integer,
  bytes         integer,
  -- Which human-readable artifact the run actually produced. 'xlsx' when the
  -- workbook was written, 'csv' when the spreadsheet library could not load in
  -- the edge runtime and the per-table CSVs were written instead, 'none' when
  -- neither worked. The JSON files are the restorable artifact and are not
  -- optional, so they have no flag.
  readable_format text      constraint backup_runs_readable_format_check
                              check (readable_format in ('xlsx', 'csv', 'none')),
  -- Per-table census + warnings, carrying the Hebrew label with each count so the
  -- panel never needs a label map of its own that could drift from the function's.
  summary       jsonb,
  error         text,
  -- Which step failed, e.g. 'read:invoices' / 'upload' / 'quarter-copy'. A failure
  -- that says where it stopped is a failure somebody can act on.
  error_stage   text,

  constraint backup_runs_pkey primary key (id)
);

comment on table public.backup_runs is
  'One row per backup (or year-end prune) attempt. The authoritative record of '
  'whether the weekly Drive backup ran and whether it was complete — the HTTP '
  'reply is not, because pg_net times out before a full dump finishes.';
comment on column public.backup_runs.run_date is
  'Israel-local date. Names the Drive folder, keys same-day idempotency, and '
  'dedups the failure alert. Never derive it from a UTC date.';
comment on column public.backup_runs.summary is
  'Per-table {table,label,rows,expected} plus warnings[] and excluded[]. Carries '
  'the Hebrew label so the UI needs no label map that could drift from the function.';
comment on column public.backup_runs.readable_format is
  'xlsx | csv | none — which readable artifact was produced. The per-table JSON '
  'is mandatory and therefore unflagged.';

-- The lease. Claiming it IS the insert; a concurrent run fails here rather than
-- after a check the other process already passed.
create unique index if not exists backup_runs_single_running
  on public.backup_runs (kind) where status = 'running';

-- The panel reads the newest rows; the function asks "was there an ok run today"
-- and "what was the last ok run of the previous quarter".
create index if not exists backup_runs_started_idx
  on public.backup_runs (started_at desc);
create index if not exists backup_runs_kind_date_idx
  on public.backup_runs (kind, run_date desc);

-- ── Access ──────────────────────────────────────────────────────────────────
-- SELECT for managers, and NO write policy at all: the only writer is the
-- backup-run edge function on the service-role key, which bypasses RLS.
--
-- Manager-only because `summary` is a per-table row census of every financial
-- table and `drive_folder_link` points straight at the unmasked dump — exactly
-- what invoices_v / suppliers_v / delivery_notes_v exist to keep from an employee.
alter table public.backup_runs enable row level security;

drop policy if exists "managers read backup runs" on public.backup_runs;
create policy "managers read backup runs" on public.backup_runs
  for select to authenticated
  using (public.current_user_role() = 'manager');


-- ── The guard against a table nobody classified ─────────────────────────────
-- A table added in 2027 that is in neither the backup list nor the explicit
-- exclusion list would be silently absent from every backup, and nobody would
-- find out until a restore. The run diffs this against its own two lists and
-- raises `backup_table_unlisted` on a surprise.
--
-- security definer because information_schema is filtered by the caller's
-- privileges, and the service-role caller must see the whole public schema.
create or replace function public.backup_table_inventory()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select table_name::text
  from information_schema.tables
  where table_schema = 'public'
    and table_type   = 'BASE TABLE'
  order by table_name
$$;

comment on function public.backup_table_inventory() is
  'Every base table in public. Diffed by backup-run against its own in/out lists '
  'so a table added later cannot go unbacked-up unnoticed.';

revoke all on function public.backup_table_inventory() from public;
grant execute on function public.backup_table_inventory() to service_role;
