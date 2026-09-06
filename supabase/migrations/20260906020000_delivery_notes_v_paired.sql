-- ── The view forgot the column that was added an hour before it ─────────────
--
-- 20260906010000 added `delivery_notes.paired_note_id` and stopped there. The
-- frontend does not read `delivery_notes` — it reads `delivery_notes_v`, because
-- 20260708000000 REVOKEd base-table SELECT from anon/authenticated. A column that
-- is not in the view does not exist as far as every screen is concerned, and it
-- fails in the quietest way there is: `r.paired_note_id` is simply `undefined`,
-- no error, no empty state, nothing in a log.
--
-- The consequence was specific. `pendingPairFor` compares a manual receipt against
-- an emailed note and asks the employee whether they are the same shipment;
-- `paired_note_id` is what remembers her answer of "different deliveries". Read as
-- always-undefined, the answer is never remembered, so the same question returns
-- on every load — the exact failure mode 20260906010000's own comment set out to
-- prevent.
--
-- 20260823000000 wrote the warning about this three lines above its own view
-- definition. Writing it down did not make it happen.
--
-- Definition below is 20260823000000's verbatim, plus `paired_note_id`. Financial
-- masking unchanged: an employee sees the goods and the document, never the
-- amounts.

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
  stage, employee_id, intake_source, paired_note_id
from public.delivery_notes
where public.current_user_role() is not null;

grant select on public.delivery_notes_v to anon, authenticated;
