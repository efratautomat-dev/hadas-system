-- ── The same delivery note, twice ───────────────────────────────────────────
--
-- "כפילויות זה גרוע כי נפתחות 2 שורות חייב התראה."
--
-- Delivery-note dedup only ever looked WITHIN one email: the key was
-- `gmail_message_id + note_number + supplier_id`, which catches the same message
-- being processed twice and nothing else. A supplier who resends the note, a note
-- that arrives once directly and once forwarded, the legacy N8N flow running in
-- parallel during cutover — every one of those produces a second email, a
-- different message id, and therefore a second row.
--
-- Two rows for one delivery is worse here than in most tables, because each row
-- opens its own PIPELINE. One of them gets the invoice and closes; the other waits
-- for a document that will never come, and sits in "ממתין לחשבונית" forever,
-- indistinguishable from a real delivery that is genuinely missing its invoice.
--
-- ⚠️ INVOICES HAVE HAD THE ANSWER SINCE THE BEGINNING. `is_duplicate` on
-- `invoices` is set by a cross-email check on (supplier_id, invoice_number), an
-- `invoice_duplicate` alert is raised, and the ledger counts the row as ZERO while
-- still showing it. This migration gives delivery notes the same two columns so
-- the same rule can be written for them. It is not a new idea — it is the existing
-- idea reaching the table that was missed.
--
-- KEEP AND MARK, never delete. Same principle as the approval gate and as
-- `excluded` in the ledger engine: which of the two rows is the real delivery is a
-- judgement about physical goods, and the system does not have it. It flags both
-- and lets a person decide — the pipeline already has "פירוק" for the loser.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.delivery_notes
  add column if not exists is_duplicate boolean not null default false;

alter table public.delivery_notes
  add column if not exists duplicate_of text;

comment on column public.delivery_notes.is_duplicate is
  'A note with this number already existed for this supplier, from a DIFFERENT '
  'email. Marked, never deleted — which of the two is the real delivery is a '
  'judgement about goods, not about data.';
comment on column public.delivery_notes.duplicate_of is
  'The delivery_notes.id this row appears to repeat. Not a foreign key: the '
  'original may be dismantled by the pipeline, and that must not cascade into '
  'the record that it once looked like a duplicate.';

-- The whole point of the new check: does this supplier already have a note with
-- this number, in any email? Partial, because a note with no number cannot be
-- compared this way and there is no sense indexing the blanks.
create index if not exists delivery_notes_supplier_number_idx
  on public.delivery_notes (supplier_id, note_number)
  where note_number is not null and note_number <> '';


-- ── delivery_notes_v, with the two new columns ──────────────────────────────
--
-- Third time in two days that a column had to be followed into the view. The
-- rule is now written in three places (20260823's header, 20260906020000, and
-- spec/STATUS.md) and it still has to be DONE each time: the frontend reads only
-- the view, and a column missing from it is invisible with no error anywhere.
--
-- Definition is 20260907000000's, plus is_duplicate / duplicate_of. NOT masked:
-- these are flags about document identity, not figures. An employee who is
-- looking at goods needs to see that the row she is standing in front of may be
-- a repeat — that is a fact about the delivery, not about money.

drop view if exists public.delivery_notes_v;
create view public.delivery_notes_v with (security_barrier = true) as
select
  id, supplier_id, note_number, date,
  case when public.current_user_role() = 'manager' then amount            end as amount,
  status, invoice_id, created_at, archived_at,
  case when public.current_user_role() = 'manager' then amount_before_vat end as amount_before_vat,
  case when public.current_user_role() = 'manager' then vat_amount        end as vat_amount,
  line_items, supplier_name, source_email, received_at, drive_file_link,
  gmail_message_id, email_subject, message_link, storage_url,
  stage, employee_id, intake_source, paired_note_id, receipt_settled_at,
  is_duplicate, duplicate_of
from public.delivery_notes
where public.current_user_role() is not null;

grant select on public.delivery_notes_v to anon, authenticated;
