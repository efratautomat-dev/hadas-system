-- ============================================================================
-- REQUEUE-PARKED.sql   —   ⚠️ THIS ONE ACTS. It is not a probe.
-- ----------------------------------------------------------------------------
-- Sends {"source":"requeue"} to invoices-ingest: parked emails lose their FAILED
-- label and their ingest_failures row, so the next cron tick ingests them again.
-- Capped at REQUEUE_MAX_MESSAGES (50) per call, over REQUEUE_LOOKBACK_DAYS (120).
--
-- WHY IT IS SHAPED THIS WAY — the credentials never leave the database.
-- HADAS_API_KEY cannot be read back from the dashboard, and pasting a secret into
-- a terminal (or a chat) to fire one request is how secrets leak. The cron job
-- already holds the exact headers this call needs, so this reads them from
-- cron.job and hands them straight to net.http_post. Nothing is printed but a
-- request id, and no secret is written to a file, a shell history, or a log.
--
-- Requires: pg_net + pg_cron (both already in use by the ingest schedule).
-- ============================================================================

with j as (
  select command from cron.job where jobname = 'invoices-ingest-cron'
),
h as (
  select
    (regexp_match(command, $re$url\s*:=\s*'([^']+)'$re$))[1]        as url,
    (regexp_match(command, $re$'Authorization',\s*'([^']+)'$re$))[1] as auth,
    (regexp_match(command, $re$'x-hadas-key',\s*'([^']+)'$re$))[1]   as key
  from j
)
select net.http_post(
  url     := h.url,
  headers := jsonb_build_object(
               'Content-Type',  'application/json',
               'Authorization', h.auth,
               'x-hadas-key',   h.key
             ),
  body    := '{"source":"requeue"}'::jsonb,
  -- pg_net defaults to 5s and gave up mid-call on the first run, recording
  -- timed_out with a NULL status while the function ran to completion anyway.
  -- The requeue talks to Gmail once per parked message, so it is legitimately
  -- slow; 60s covers a full batch of 50.
  timeout_milliseconds := 60000
) as request_id
from h;


-- ── Then, a few seconds later, read the reply ───────────────────────────────
-- pg_net is asynchronous: the call above only queues the request and returns its
-- id. The response arrives separately. Run this next, with the id it printed:
--
--   select status_code, content::text
--   from net._http_response
--   where id = <request_id>;
--
-- 200 with a JSON body naming `requeued` is success. If `requeued` comes back as
-- exactly 50, the cap was hit — run the statement above again for the next batch.
