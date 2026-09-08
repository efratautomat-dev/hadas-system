-- ── One attempt per historical note, and a record that it was made ──────────
--
-- "אני גם רוצה להריץ את כל התעודות משלוח הקיימות לפענוח כמובן עם הגבלת נסיון
-- אחד מה שיצליח יצליח."
--
-- Every delivery note filed before the pipeline shipped is in the database with
-- its document attached and nothing read out of it — they arrived before there
-- was an extractor, and the extractor has never been pointed backwards. Now that
-- the prompt asks for the priced table (20260907010000's sibling change), there
-- is something worth going back for.
--
-- `reparsed_at` is what makes "one attempt" true rather than aspirational. It is
-- stamped at the END of every attempt, SUCCESS OR FAILURE — a note whose document
-- is corrupt, whose file is missing, or whose extraction throws is marked exactly
-- like one that worked. Without that, a failing document is retried by every
-- subsequent batch, forever, at the cost of a model call each time; the run would
-- converge on nothing but its own failures.
--
-- It is also the CURSOR. The batch selects `where reparsed_at is null`, so calling
-- the endpoint again continues where the last call stopped, with no offset to keep
-- track of and no risk of a batch boundary skipping a row.
--
-- ⚠️ DELIBERATELY NOT ADDED TO `delivery_notes_v`. The rule earned three times
-- this week is that a new column must be followed into the view — but that rule
-- exists because the SCREENS read only the view. This column is server-side
-- bookkeeping that no screen reads or should read: it answers "has the re-run
-- touched this row", which is a question about a maintenance job, not about a
-- delivery. Putting it in the view would widen the employee-visible surface for
-- nothing.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.delivery_notes
  add column if not exists reparsed_at timestamptz;

comment on column public.delivery_notes.reparsed_at is
  'The one-time re-analysis touched this row. Stamped on FAILURE too — that is '
  'what makes "one attempt" a guarantee instead of a hope. Also the batch cursor.';

-- The queue, exactly as the endpoint reads it: never attempted, has a stored
-- document to read. Partial so it stays small as the run progresses — at the end
-- of the run the index is empty, which is the point.
create index if not exists delivery_notes_reparse_queue_idx
  on public.delivery_notes (received_at desc)
  where reparsed_at is null and storage_url is not null;
