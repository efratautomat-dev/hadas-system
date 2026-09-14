-- ── הערה על תעודת משלוח, ומתג "טופל" לכל הערה ──────────────────────────────
--
-- Two of the thirteen the owner sent, and they belong in one migration because
-- they are the same subject from two sides: what the system lets a person WRITE
-- about a supplier, and how a person says she is DONE with something written.


-- ═══ 1. delivery_notes.notes ════════════════════════════════════════════════
--
-- "כתיבת הערות גם בתוך מסך הסחורה" (#8), and it is the one place free text about
-- a supplier could not be written. `src/lib/noteSources.ts` says so in its own
-- words at the bottom of the file: delivery_notes has no notes column at all,
-- only `line_items`, which is the document's contents and not a remark someone
-- made — "adding a notes field to that screen is the moment it earns an entry
-- above". This is that moment.
--
-- It matters most exactly where it was missing. The goods page is where somebody
-- stands with the pallet in front of her and sees that two boxes are crushed or
-- that one item is short — the knowledge that is lost if she has nowhere to put
-- it before she walks away. §11 of the same batch says it plainly: with an
-- invoice attached nothing needs recording, "רק אם יש בעיה הן רושמות הערות".

alter table public.delivery_notes
  add column if not exists notes text;

comment on column public.delivery_notes.notes is
  'A remark about THIS delivery — what was short, what was damaged, what the '
  'driver said. Not line_items, which is the document''s own contents. Surfaces '
  'in the supplier notes panel through noteSources.';


-- ── delivery_notes_v, with the new column ───────────────────────────────────
--
-- Fourth time a column has to be followed into the view. The rule is written in
-- 20260823's header, in 20260906020000, in 20260907010000 and in spec/STATUS.md,
-- and it STILL has to be done by hand each time: the frontend reads only the
-- view, and a column missing from it is invisible with no error anywhere.
--
-- ⚠️ And the notes panel reads `delivery_notes_v` — never the base table, which
-- REVOKEs select from anon/authenticated. A source registered against the base
-- table fails silently and the demo cannot catch it (demoClient aliases _v back).
--
-- `notes` is NOT masked. A remark about crushed boxes is not a figure, and the
-- employee who wrote it is the one who needs to read it back.

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
  is_duplicate, duplicate_of, notes
from public.delivery_notes
where public.current_user_role() is not null;

grant select on public.delivery_notes_v to anon, authenticated;


-- ═══ 2. "טופל" ══════════════════════════════════════════════════════════════
--
-- "לכל הערה תוסיף מתג קטן של טופל שיהיה אפשר ללחוץ ידנית וזה יקפל את ההערה, זאת
-- אומרת לא יציג אותה פתוחה" (#13).
--
-- The panel is a cross-section: notes written in it, and notes COLLECTED from
-- five other tables, read-only, each edited where it was written. So "handled"
-- cannot be a column — there is no single table to put it on, and adding one to
-- each source would mean five migrations and five API routes for one toggle.
--
-- One table keyed by (source, record) instead. It holds the ANSWER, not the
-- note: the note stays exactly where it was written, untouched, and this says a
-- person looked at it and is done. Which is also why it is reversible in one
-- click — "handled" is a judgement, and judgements get revisited.
--
-- Not per-user on purpose. Two people working the same supplier are working the
-- same list; a note one of them has dealt with is dealt with.

create table if not exists public.note_handled (
  -- Matches `noteSources.key`, plus 'manual' for notes written in the panel.
  source_key  text        not null,
  -- The id of the row the note came from: a payment, a return, an invoice, a
  -- statement, a delivery, a supplier card, or a supplier_notes row.
  record_id   text        not null,
  -- Denormalised so the panel fetches one supplier's answers in one query rather
  -- than one per note.
  supplier_id text        not null references public.suppliers(id) on delete cascade,
  handled_at  timestamptz not null default now(),
  handled_by  text,
  constraint note_handled_pkey primary key (source_key, record_id)
);

comment on table public.note_handled is
  'Which notes a person has marked as dealt with. Holds the ANSWER, never the '
  'note — collected notes stay read-only in the panel and are edited where they '
  'were written. Reversible: a judgement, not a fact.';

create index if not exists note_handled_supplier_idx
  on public.note_handled (supplier_id);

alter table public.note_handled enable row level security;

-- Same shape as supplier_notes: anyone signed in may read and write. A note
-- carries no figure, and an employee marking her own remark as handled is the
-- ordinary case rather than an exception.
drop policy if exists "signed-in users read handled marks" on public.note_handled;
create policy "signed-in users read handled marks" on public.note_handled
  for select to authenticated using (true);

drop policy if exists "signed-in users write handled marks" on public.note_handled;
create policy "signed-in users write handled marks" on public.note_handled
  for all to authenticated using (true) with check (true);
