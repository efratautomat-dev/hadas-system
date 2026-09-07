-- ============================================================================
-- CLEAR-RESOLVED-INGEST-FAILURES.sql
-- ----------------------------------------------------------------------------
-- The dashboard's "מיילים שלא נכנסו למערכת" counter reads `ingest_failures`. The
-- table used to record failure and never resolution: a row was deleted by exactly
-- one path (the requeue sweep), so an email that failed on Monday and succeeded on
-- Tuesday kept its row forever, indistinguishable from a live problem.
--
-- That was FIXED — `markProcessed` now deletes the row when an email finally
-- lands. But the fix only works forward. The rows that were already there stayed,
-- and they are what the counter has been showing ever since. The comment in
-- `invoices-ingest` names the number: "Production carried eleven such rows, of
-- which every one was an incident already closed."
--
-- ⚠️ THIS DELETES ONLY WHAT DEMONSTRABLY LANDED. A failure row is removed only if
-- a document carrying the same gmail_message_id exists in one of the three tables
-- that carry it.
-- Anything with no document behind it STAYS — that is a real email that never got
-- in, and it is the entire reason the counter exists. Emptying the table wholesale
-- would silence the feature instead of fixing it.
--
-- ⚠️ `vendor_statements` HAS NO gmail_message_id COLUMN, so a כרטסת email that
-- failed and later succeeded cannot be recognised here and its row will stay.
-- That is the safe direction of the error — keeping a row that is stale costs a
-- glance, deleting one that is real loses a document — but it means a leftover
-- marked "באמת לא נכנס" is worth opening in Gmail before believing it.
--
-- Run PART 1 and read it. Nothing changes until PART 2.
-- ============================================================================


-- ── PART 1 · READ-ONLY — which rows are stale, and which are real ───────────

with landed as (
  select gmail_message_id from public.invoices         where gmail_message_id is not null
  union select gmail_message_id from public.delivery_notes   where gmail_message_id is not null
  union select gmail_message_id from public.returns          where gmail_message_id is not null
)
select
  f.gmail_message_id,
  f.attempts,
  f.last_attempt_at::date as last_try,
  case when l.gmail_message_id is not null
       then 'נקלט בסוף — שריד'
       else 'באמת לא נכנס — להשאיר'
  end                     as verdict,
  left(coalesce(f.last_error, ''), 90) as error_head
from public.ingest_failures f
left join landed l on l.gmail_message_id = f.gmail_message_id
order by (l.gmail_message_id is null), f.last_attempt_at desc;

-- Everything marked "שריד" is an incident that closed itself. Everything marked
-- "באמת לא נכנס" is a document the system still does not have — those are worth
-- opening in Gmail, and PART 2 leaves them alone.


-- ── PART 2 · ⚠️ THIS ONE ACTS — remove only the resolved rows ───────────────

with landed as (
  select gmail_message_id from public.invoices         where gmail_message_id is not null
  union select gmail_message_id from public.delivery_notes   where gmail_message_id is not null
  union select gmail_message_id from public.returns          where gmail_message_id is not null
)
delete from public.ingest_failures f
using landed l
where l.gmail_message_id = f.gmail_message_id
returning f.gmail_message_id, f.attempts, f.last_attempt_at::date as last_try;

-- The RETURNING list is exactly what was cleared. The counter on the dashboard
-- drops by that many, and what remains is a real queue again.
--
-- Re-runnable and safe: a second run finds nothing left to delete.
