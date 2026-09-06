-- ============================================================================
-- PROD-POST-DEPLOY-CHECK.sql   —   READ-ONLY. Selects only. Changes nothing.
-- ----------------------------------------------------------------------------
-- "Look at the logs" is useless advice against a debug-level feed. This asks the
-- four questions that actually decide whether the deploy is healthy, and prints
-- them as a short report instead of rows to skim:
--
--   1. is the ingest running at all, and when did it last run
--   2. every error and warning it raised — newest first, nothing else
--   3. how delivery notes are distributed across the new `stage` column, which is
--      the proof that the migration and the new function agree
--   4. how many emails are parked in ingest_failures right now
--
-- Run it in the SQL editor any time after a deploy.
-- ============================================================================

with recent as (
  select "timestamp" as ts, level, message
  from public.system_logs
  where source = 'invoices-ingest'
    and "timestamp" > now() - interval '4 hours'
),
head as (
  select 0 as ord, 'שורות לוג ב-4 השעות האחרונות: ' || count(*)::text as line from recent
  union all
  select 1, 'שגיאות: '  || (count(*) filter (where level = 'error'))::text
          || '  ·  אזהרות: ' || (count(*) filter (where level = 'warn'))::text
          || '  ·  מידע: '   || (count(*) filter (where level = 'info'))::text  from recent
  union all
  select 2, 'הריצה האחרונה: ' || coalesce(to_char(max(ts), 'HH24:MI  DD/MM'), 'לא רצה כלל') from recent
),
probs as (
  select 10 + row_number() over (order by ts desc) as ord,
         to_char(ts, 'HH24:MI') || '  [' || level || ']  ' || left(message, 200) as line
  from recent
  where level in ('error', 'warn')
  limit 25
),
probs_hdr as (
  select 9 as ord,
         case when exists (select 1 from recent where level in ('error','warn'))
              then '── שגיאות ואזהרות, החדשות למעלה ──'
              else '── אין שגיאות ואין אזהרות ──' end as line
),
stages as (
  select 100 as ord, '── תעודות משלוח לפי שלב בפייפליין ──' as line
  union all
  select 101, '   ' || coalesce(stage, '(ריק)') || ' : ' || count(*)::text
  from public.delivery_notes group by stage
),
parked as (
  select 200 as ord, '── מיילים מחונים ──' as line
  union all
  select 201, '   ממתינים כרגע: ' || (select count(*) from public.ingest_failures)::text
  union all
  select 202, '   מהם ניסיון אחרון ב-4 השעות האחרונות: '
              || (select count(*) from public.ingest_failures
                  where last_attempt_at > now() - interval '4 hours')::text
)
select line as "דוח"
from (
  select * from head
  union all select * from probs_hdr
  union all select * from probs
  union all select * from stages
  union all select * from parked
) r
order by ord, line;
