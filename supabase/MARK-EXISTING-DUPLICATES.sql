-- ============================================================================
-- MARK-EXISTING-DUPLICATES.sql
-- ----------------------------------------------------------------------------
-- The duplicate check added on 07.09.2026 runs at INGEST — it marks a note as it
-- arrives. It is forward-only by nature, so every pair already sitting in the
-- table is unmarked, and that is what the owner is looking at when she says she
-- sees no alert on the ones that came twice.
--
-- This is the one-time pass over the history. Pure SQL: no model, no Gmail, no
-- cost, and it can be run again at any time without changing anything further.
--
-- ⚠️ IT MARKS. IT NEVER DELETES. Which of two rows is the real delivery is a
-- judgement about physical goods — two deliveries from one supplier in a week are
-- ordinary, and a note re-sent by a supplier is not. The oldest row in each group
-- is left alone and the later ones are flagged, because the first arrival is the
-- one everything else was already linked to. Unpicking the wrong one is done from
-- the goods screen, by a person, with "פירוק".
--
-- Run PART 1 first and read it. Nothing changes until PART 2.
-- ============================================================================


-- ── PART 1 · READ-ONLY — what is actually there ─────────────────────────────
-- Groups of notes sharing a supplier AND a note number. Blank numbers are
-- excluded: a note with no number cannot be compared this way, and grouping the
-- blanks together would "find" a duplicate for every supplier at once.

select
  d.supplier_name,
  d.note_number,
  count(*)                                   as rows_in_group,
  min(d.created_at)::date                    as first_seen,
  max(d.created_at)::date                    as last_seen,
  count(distinct d.gmail_message_id)         as distinct_emails,
  sum(case when d.stage = 'awaiting_invoice' then 1 else 0 end) as still_waiting
from public.delivery_notes d
where coalesce(d.note_number, '') <> ''
  and d.supplier_id is not null
group by d.supplier_id, d.supplier_name, d.note_number
having count(*) > 1
order by count(*) desc, d.supplier_name;

-- `distinct_emails` is the column worth reading. 2 or more means the note really
-- did arrive twice — which is exactly the case the old dedup could not see,
-- because it keyed on the Gmail message id. A group where it reads 1 came from
-- one email and is a different problem.
--
-- `still_waiting` says how many of the group are stuck in "ממתין לחשבונית". A
-- group of 2 where one is waiting is the classic shape: the real one closed, the
-- copy is still asking for an invoice that does not exist.


-- ── PART 2 · ⚠️ THIS ONE ACTS — mark the later rows ─────────────────────────
-- Keeps the EARLIEST row of each group untouched and flags the rest, pointing
-- each one at the row it repeats. Re-runnable: a row already marked is updated to
-- the same values.

with ranked as (
  select
    d.id,
    first_value(d.id) over (
      partition by d.supplier_id, d.note_number
      order by d.created_at, d.id
    ) as keeper_id,
    row_number() over (
      partition by d.supplier_id, d.note_number
      order by d.created_at, d.id
    ) as seq
  from public.delivery_notes d
  where coalesce(d.note_number, '') <> ''
    and d.supplier_id is not null
)
update public.delivery_notes t
   set is_duplicate = true,
       duplicate_of = r.keeper_id
  from ranked r
 where t.id = r.id
   and r.seq > 1
returning t.id, t.supplier_name, t.note_number, t.duplicate_of, t.stage;

-- The RETURNING list is every row that was just flagged. It should match the
-- groups from PART 1, minus one row per group.


-- ── PART 3 · undo, if a group turns out to be genuine ───────────────────────
-- Two real deliveries that happen to carry one number (it happens — some
-- suppliers reuse them per year). Clears the flag for one supplier's number:
--
--   update public.delivery_notes
--      set is_duplicate = false, duplicate_of = null
--    where supplier_id = 'SUP-0xx' and note_number = '12345';
