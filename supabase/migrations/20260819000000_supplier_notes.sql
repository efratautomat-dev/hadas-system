-- ── supplier_notes: a small CRM log per supplier ─────────────────────────────
--
-- `suppliers.notes` is a SINGLE text field, overwritten on every edit. It has no
-- history, no date, no author, and no way to tell whether a remark is about a
-- payment, an invoice or a statement. The owner keeps a working log against
-- suppliers in practice, and one blob cannot hold it.
--
-- Notes belong to the SUPPLIER. They are written and read from wherever a
-- supplier is in focus; the supplier screen is where all of them are gathered
-- with their dates and tags.
--
-- `tag` records WHERE the note was written and is derived from the screen, never
-- chosen by hand — a hand-picked tag gets forgotten or mis-picked, and then
-- filtering by it misleads. New screens will produce new tags on their own.
--
-- MANAGER-ONLY, enforced at the data layer and not only by the UI, matching the
-- alerts policy in 20260604120000_employee_rls.sql.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.supplier_notes (
  id           uuid        not null default gen_random_uuid(),
  -- suppliers.id is TEXT ('SUP-001'), not uuid.
  supplier_id  text        not null references public.suppliers(id) on delete cascade,
  body         text        not null,
  tag          text        not null default 'suppliers',
  author_email text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint supplier_notes_pkey primary key (id)
);

comment on column public.supplier_notes.tag is
  'Which screen the note was written on — derived, never chosen by hand. '
  'Vocabulary grows as screens are added; see the CHECK below.';
comment on column public.supplier_notes.author_email is
  'Stamped SERVER-side from the verified JWT, never sent by the client. '
  'NULL only for rows written before that was enforced.';

-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, hence the guard. Dropped and
-- re-added so extending the vocabulary later is a one-line edit here.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'supplier_notes_tag_check') then
    alter table public.supplier_notes drop constraint supplier_notes_tag_check;
  end if;
  alter table public.supplier_notes
    add constraint supplier_notes_tag_check
    check (tag in ('suppliers', 'payments', 'statements'));
end $$;

-- Newest first, per supplier — the only way the panel ever reads this table.
create index if not exists supplier_notes_supplier_created_idx
  on public.supplier_notes (supplier_id, created_at desc);

alter table public.supplier_notes enable row level security;

drop policy if exists "managers manage supplier notes" on public.supplier_notes;
create policy "managers manage supplier notes" on public.supplier_notes
  for all to authenticated
  using      (public.current_user_role() = 'manager')
  with check (public.current_user_role() = 'manager');


-- ── app_settings: manager-only writes ────────────────────────────────────────
--
-- app_settings is the ONLY table in the schema with no RLS at all
-- (dev-schema.sql documents it as "left as-is"). Any signed-in user can rewrite
-- it — today the app logo, and with the approval gate, the amount threshold that
-- decides which invoices need a human. That is a data-layer hole the UI happens
-- to cover, and the UI is the weaker of the two boundaries.
--
-- Reads stay open: the logo is rendered for everyone, and an employee's screens
-- read settings too. Only writes are gated.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.app_settings enable row level security;

drop policy if exists "anyone signed in reads app settings" on public.app_settings;
create policy "anyone signed in reads app settings" on public.app_settings
  for select to authenticated
  using (true);

drop policy if exists "managers write app settings" on public.app_settings;
create policy "managers write app settings" on public.app_settings
  for all to authenticated
  using      (public.current_user_role() = 'manager')
  with check (public.current_user_role() = 'manager');
