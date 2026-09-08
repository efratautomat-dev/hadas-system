-- ── A fourth door: the handwritten sheet ────────────────────────────────────
--
-- The owner, testing the pipeline: "אני רוצה שיהיה סימון האם התעודה הגיעה ממסמך,
-- מהקלדה או מצילום כתב יד", and immediately after it the case that shows why —
-- "יש סחורה שאני רואה פענוח אבל אין מסמך, איפה המקור להסיק שזו הקלדה?".
--
-- Today there is no way to answer her. The handwritten-sheet door saves through
-- POST /delivery-notes without naming itself, so it takes the endpoint's default
-- — 'manual' — the same value typing the lines in by hand produces. Two intakes
-- with opposite evidence collapsed into one word:
--
--   typed   — a person's own reading of goods on a pallet. No document exists and
--             none is missing.
--   sheet   — a MODEL's reading of a photograph. The photo is the only thing that
--             can check it, and if it is not there the reading stands on nothing.
--
-- A row showing extracted items and no document is normal in the first case and a
-- loss in the second, and the screen could not tell them apart. So the door gets
-- its own value and the reading keeps its provenance.
--
-- Additive and re-runnable, and a separate file rather than an edit to
-- 20260906010000 for the same reason that one gives: an amended migration is one
-- that ran on some environments and not on others.

do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'delivery_notes_intake_source_check') then
    alter table public.delivery_notes drop constraint delivery_notes_intake_source_check;
  end if;
  alter table public.delivery_notes
    add constraint delivery_notes_intake_source_check
    check (intake_source is null or intake_source in (
      'email', 'manual', 'photo', 'sheet', 'order', 'invoice'
    ));
end $$;

comment on column public.delivery_notes.intake_source is
  'Which door this row came through: email · photo · sheet · manual · order · '
  'invoice. The first three were made FROM a document, so a missing file on one '
  'of them is a loss and the screen says so; the last three never had one. '
  '`order` and `invoice` are rows the pipeline opened ITSELF and describe no '
  'delivery that happened — which is why their note_number is empty.';


-- ── Rows already on file ────────────────────────────────────────────────────
--
-- Email ingest never wrote the column at all: every delivery that arrived in the
-- mailbox carries NULL, and the frontend guessed 'email' from the presence of a
-- gmail_message_id. That guess is now wrong for one case — the camera path gives
-- itself a synthetic `capture-…` id, so every photographed delivery has been
-- reading as "הגיע במייל" since the day capture shipped.
--
-- Backfilled here rather than left to the fallback, so the value on the row is
-- the value the screen shows. Only NULLs are touched; nothing already recorded is
-- overwritten.

update public.delivery_notes
   set intake_source = case
         when gmail_message_id like 'capture-%' then 'photo'
         when gmail_message_id is not null      then 'email'
         else 'manual'
       end
 where intake_source is null;
