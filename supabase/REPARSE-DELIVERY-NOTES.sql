-- ============================================================================
-- REPARSE-DELIVERY-NOTES.sql   —   ⚠️ PART 2 ACTS. It is not a probe.
-- ----------------------------------------------------------------------------
-- The one-time re-analysis of delivery notes ALREADY IN THE DATABASE. Every note
-- filed before the pipeline existed has its document attached and nothing read
-- out of it; now that the extractor asks for the priced table, there is something
-- to go back for.
--
-- ONE ATTEMPT PER NOTE, as the owner asked. `delivery_notes.reparsed_at` is
-- stamped at the end of every attempt — success OR failure — so a document that
-- cannot be read costs exactly one model call and never returns. That column is
-- also the cursor: each call continues where the last one stopped.
--
-- WHAT IT WILL AND WILL NOT CHANGE:
--   ✔ fills line_items with the item/quantity/unit-price table
--   ✔ fills note_number, date and the amounts ONLY where they are empty
--   ✘ never changes the supplier — that could move a balance in a batch job
--   ✘ never creates or deletes a row
--   ✘ raises no alerts and runs no duplicate check over the history
--
-- WHY IT IS SHAPED THIS WAY — the credentials never leave the database.
-- Same pattern as REQUEUE-PARKED.sql: HADAS_API_KEY cannot be read back from the
-- dashboard, and pasting a secret into a terminal to fire one request is how
-- secrets leak. The cron job already holds the exact headers, so this reads them
-- from cron.job and hands them straight to net.http_post.
-- ============================================================================


-- ── PART 1 · READ-ONLY — how much work is there ─────────────────────────────

select
  count(*) filter (where storage_url is not null and reparsed_at is null) as waiting,
  count(*) filter (where storage_url is not null and reparsed_at is not null) as done,
  count(*) filter (where storage_url is null) as no_document,
  count(*) as total
from public.delivery_notes;

-- `waiting` ÷ 8 is roughly how many times PART 2 has to be run.
-- `no_document` can never be re-read: the row has no file attached, so there is
-- nothing to point a model at. Those stay as they are.


-- ── PART 2 · ⚠️ ONE BATCH. Run, wait, read the reply, repeat ────────────────

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
  -- 8 documents per call. Each one is a model call against a scan, and the edge
  -- function has a wall clock — a bigger batch does not fail cleanly, it fails
  -- halfway, and the rows it did not reach look identical to the ones it did.
  -- The endpoint caps this at 20 whatever is sent.
  body    := '{"source":"reparse","limit":8}'::jsonb,
  timeout_milliseconds := 150000
) as request_id
from h;


-- ── PART 3 · the reply, a minute later ──────────────────────────────────────
-- pg_net is asynchronous: PART 2 only queues the request and returns its id.
-- Run this with that id:
--
--   select status_code, content::text
--   from net._http_response
--   where id = <request_id>;
--
-- The body reads:
--   { "attempted": 8, "read": 7, "filled": 6, "failed": 1, "remaining": 214 }
--
--   read      — the extractor returned something usable
--   filled    — something was actually written to the row (a hole was closed)
--   failed    — one attempt, spent; those rows are stamped and will not return
--   remaining — how many are left. Run PART 2 again until this reaches 0.
--
-- `failed` being non-zero is expected and is not a reason to stop: these are old
-- scans, some of them are photographs of photocopies, and "מה שיצליח יצליח" is
-- exactly the instruction.
--
-- To watch it from the other side, the function logs one line per batch:
--   select created_at, level, message from public.system_logs
--    where message like 'reparse%' order by created_at desc limit 20;
