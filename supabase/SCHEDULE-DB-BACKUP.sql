-- ============================================================================
-- SCHEDULE-DB-BACKUP.sql   —   ⚠️ THIS ONE ACTS. It creates a weekly cron job.
-- ----------------------------------------------------------------------------
-- Schedules `backup-run` for 01:00 UTC every Monday — 03:00 or 04:00 Israel
-- time, i.e. the night between Sunday and Monday (owner's choice, 18.10.2026:
-- "כל ראשון בלילה"; it was Saturday). 03:00 or 04:00 depends on the season. The hour is chosen for one reason beyond being
-- quiet: it is when `invoices-ingest` is least likely to be inserting rows, and
-- a row inserted while a table is being paged is the one race the backup's
-- completeness guard has to fail on.
--
-- WHY IT IS SHAPED THIS WAY — the credentials never leave the database.
-- HADAS_API_KEY cannot be read back from the dashboard, and pasting a secret
-- into a terminal (or a chat) to create one job is how secrets leak. The ingest
-- cron already holds the exact headers this call needs, so this reads them out
-- of cron.job and hands them straight to cron.schedule. Nothing is printed but
-- the job id, and no secret reaches a file, a shell history or a log.
-- (Same approach as REQUEUE-PARKED.sql, for the same reason.)
--
-- ⚠️ RUN A BACKUP BY HAND FIRST. Press "גיבוי עכשיו" in Settings → גיבוי, open
-- the Drive folder, and look at the files. Never schedule a job whose first
-- successful run nobody has seen.
--
-- Requires: pg_net + pg_cron (both already in use by the ingest schedule).
-- Prerequisite: `supabase functions deploy backup-run` and `supabase db push`.
-- ============================================================================

with j as (
  select command from cron.job where jobname = 'invoices-ingest-cron'
),
h as (
  select
    -- Same project, different function: only the last path segment changes.
    regexp_replace(
      (regexp_match(command, $re$url\s*:=\s*'([^']+)'$re$))[1],
      'invoices-ingest$', 'backup-run'
    )                                                                as url,
    (regexp_match(command, $re$'Authorization',\s*'([^']+)'$re$))[1] as auth,
    (regexp_match(command, $re$'x-hadas-key',\s*'([^']+)'$re$))[1]   as key
  from j
)
select cron.schedule(
  'backup-weekly-cron',
  '0 1 * * 1',                      -- Monday 01:00 UTC = Sunday night, Israel
  format($cmd$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', %L,
        'x-hadas-key',   %L
      ),
      -- An empty body means "the weekly backup". The destructive year-end prune
      -- has to be asked for by name (mode: 'year-end-cleanup'), so the cron tick
      -- is structurally incapable of deleting anything.
      body := '{}'::jsonb,
      -- pg_net defaults to FIVE SECONDS. A full dump legitimately runs longer,
      -- and without this the request is recorded as timed out while the function
      -- is still working — which looks exactly like a failure and is not one.
      -- Even at this ceiling the HTTP reply is only a convenience: `backup_runs`
      -- is the record, and it is written by the function itself.
      timeout_milliseconds := 300000
    );
  $cmd$, h.url, h.auth, h.key)
) as job_id
from h;


-- ── Checking it ─────────────────────────────────────────────────────────────
-- select jobname, schedule, active from cron.job where jobname = 'backup-weekly-cron';
--
-- The last few runs as pg_cron saw them (this says whether the REQUEST was made,
-- not whether the backup was complete — for that, read backup_runs):
-- select status, start_time, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'backup-weekly-cron')
--   order by start_time desc limit 5;
--
-- What actually happened, which is the question that matters:
-- select run_date, status, total_rows, file_count, readable_format,
--        quarter_anchor, duration_ms, error_stage, error
--   from public.backup_runs
--   where kind = 'backup'
--   order by started_at desc limit 10;
--
-- ── Removing or moving it ───────────────────────────────────────────────────
-- select cron.unschedule('backup-weekly-cron');
-- Then re-run this file to recreate it. `cron.schedule` with an existing jobname
-- REPLACES that job, so re-running this file is also how the time is changed.
--
-- ⚠️ If this job is ever unscheduled and not recreated, nothing raises an alert:
-- an absent run cannot report itself. The Settings panel turns red when the last
-- successful backup is more than ten days old, and that is the only symptom the
-- system has for a schedule that stopped existing.
