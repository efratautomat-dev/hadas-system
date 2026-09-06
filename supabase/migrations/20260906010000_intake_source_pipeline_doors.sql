-- ── Two doors the constraint never learned about ────────────────────────────
--
-- 20260823 added `intake_source` with a CHECK listing the three ways a delivery
-- could then be created: email, manual, photo. Two more were added afterwards, in
-- the API, and the constraint was never widened with them:
--
--   'order'   — an order opens its pipeline the moment it is placed
--   'invoice' — an invoice that arrived before its goods opens one too
--
-- Both are rejected in production with 23514. The order path is the worse of the
-- two because its insert error was never read: the row was refused, the order was
-- created anyway with no pipeline behind it, and the API answered 201. That is
-- precisely the "I see no row that is just an order" the owner reported once
-- already for a different cause — this would have reproduced it live, with
-- nothing in the logs.
--
-- A SEPARATE migration rather than an edit to 20260823: that file may already be
-- applied, and an amended migration is one that runs on some environments and not
-- others. This is additive and re-runnable.

do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'delivery_notes_intake_source_check') then
    alter table public.delivery_notes drop constraint delivery_notes_intake_source_check;
  end if;
  alter table public.delivery_notes
    add constraint delivery_notes_intake_source_check
    check (intake_source is null or intake_source in (
      'email', 'manual', 'photo', 'order', 'invoice'
    ));
end $$;

comment on column public.delivery_notes.intake_source is
  'Which door this row came through. `order` and `invoice` are rows the pipeline '
  'opened ITSELF — neither describes a delivery that happened, which is why their '
  'note_number is empty and why naming the door matters.';
