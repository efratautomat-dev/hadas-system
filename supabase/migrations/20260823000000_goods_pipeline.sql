-- ── Goods → ledger pipeline: one state machine, many-to-many, and an approval gate ──
--
-- Chapters 6–7 of the intermediate spec. Today goods arriving, delivery notes,
-- invoices and the ledger are four separate piles and the owner holds the thread in
-- her head. This migration lays the model for one pipeline —
--   סחורה → חשבונית → אישור → בכרטסת
-- — that every entry path converges on: email ingest, camera capture, manual entry,
-- an order marked "הגיע", or an invoice that arrives before any goods.
--
-- Idempotent — safe to re-run. VERIFIED, not assumed: replayed against a clean
-- Postgres 16 over rows carrying all five legacy status values, then re-run after the
-- "app" had advanced two of them. Nothing moved, no duplicate link rows, no second
-- approval stamp. The backfill keys on `stage is null`, which is what makes that true.
--
-- ⚠️ DEPLOY ORDER IS FIXED: migrations → functions → merge to `main`. In any other
--    order ingest writes to columns that do not exist yet.
--
-- ⚠️ TWO DIFFERENT THINGS ARE CALLED "AWAITING APPROVAL". `invoices.awaiting_approval`
--    is the existing ₪20K gate (20260820000000) and is NOT touched here. The pipeline's
--    approval is `invoices.ledger_approved_at` plus the `awaiting_approval` STAGE on the
--    delivery note. They coexist and never read each other.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- ═══ 1. delivery_notes — the pipeline stage ═════════════════════════════════════════
--
-- A NEW column beside `status`, not a replacement. `status` carries five values from
-- four writers (`pending`, `pending_match`, `unlinked`, `linked`, `archived`); it stays
-- readable through the transition and simply stops being written. Keeping both is what
-- makes going back possible without losing anything.

-- Added NULLABLE and with NO default on purpose. The backfill below then keys on
-- `stage is null`, which is the only guard that makes a re-run truly safe: with a
-- default, every re-run would recompute stage from the STALE `status` column and
-- could drag a row the app had since advanced (or unlinked) back to where `status`
-- still says it is. The default and NOT NULL are applied AFTER the backfill.
alter table public.delivery_notes
  add column if not exists stage text;

comment on column public.delivery_notes.stage is
  'Pipeline state machine. Replaces the five-value `status` vocabulary; `status` is '
  'kept readable during the transition and is no longer written.';

-- ADD CONSTRAINT has no IF NOT EXISTS, hence the guard (same shape as
-- 20260819000000_supplier_notes.sql). Dropped and re-added so extending the
-- vocabulary later is a one-line edit here.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'delivery_notes_stage_check') then
    alter table public.delivery_notes drop constraint delivery_notes_stage_check;
  end if;
  alter table public.delivery_notes
    add constraint delivery_notes_stage_check
    check (stage in ('awaiting_goods', 'awaiting_invoice', 'awaiting_approval', 'in_ledger'));
end $$;

-- Who physically received the goods. The UI has always POSTed `employee_id`
-- (useDeliveryNotes.ts) and hadas-api has always dropped it, because the column did
-- not exist — so this was silently unrecorded. `returns` already has the same column.
alter table public.delivery_notes
  add column if not exists employee_id uuid references public.employees(id);

-- How the row came into being. Deliberately NOT named `source`: the frontend hook
-- already derives a field called `source` from `gmail_message_id` AFTER spreading the
-- DB row, so a column by that name would be silently overwritten and never seen.
-- Deriving also cannot tell a typed receipt from a photographed one, which §6.5 needs.
alter table public.delivery_notes
  add column if not exists intake_source text;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'delivery_notes_intake_source_check') then
    alter table public.delivery_notes drop constraint delivery_notes_intake_source_check;
  end if;
  alter table public.delivery_notes
    add constraint delivery_notes_intake_source_check
    check (intake_source is null or intake_source in ('email', 'manual', 'photo'));
end $$;

-- ── Backfill from the old vocabulary ───────────────────────────────────────────────
-- pending / pending_match / unlinked → awaiting an invoice to be attached
-- linked                             → paired, awaiting the owner's approval
-- archived                           → already done
--
-- ⚠️ `linked → awaiting_approval` assumes the old state is equivalent. It is worth one
--    pass over the converted rows to confirm (spec §6.3).
update public.delivery_notes
   set stage = case
         when status = 'archived' then 'in_ledger'
         when status = 'linked'   then 'awaiting_approval'
         else 'awaiting_invoice'
       end
 where stage is null;   -- first run only; never re-derives a stage the app has moved

-- Now that every existing row carries a stage, pin the shape for new ones. A delivery
-- row created without an explicit stage is one where goods are in hand and no invoice
-- is attached yet, which is `awaiting_invoice`. The invoice-first case
-- (`awaiting_goods`) is always set explicitly by the code that creates it.
alter table public.delivery_notes alter column stage set default 'awaiting_invoice';
alter table public.delivery_notes alter column stage set not null;

update public.delivery_notes
   set intake_source = case when gmail_message_id is not null then 'email' else 'manual' end
 where intake_source is null;

create index if not exists delivery_notes_stage_idx on public.delivery_notes (stage);


-- ═══ 2. delivery_note_invoices — the link, many-to-many ═════════════════════════════
--
-- §6.b: several delivery notes to one invoice is COMMON (a consolidated invoice), and
-- several invoices to one note is rare but real. `delivery_notes.invoice_id` can only
-- express one-to-one, has no FK, and has no reciprocal pointer on `invoices`.
--
-- This table is the source of truth for the link from here on. `invoice_id` is kept and
-- mirrored on write during the transition so nothing that still reads it breaks.
--
-- The money does NOT come from here: §6.c fixes the ledger amount to the INVOICE,
-- counted once, however many notes hang off it. A note without an invoice moves no money.

create table if not exists public.delivery_note_invoices (
  delivery_note_id text        not null references public.delivery_notes(id) on delete cascade,
  invoice_id       text        not null references public.invoices(id)       on delete cascade,
  created_at       timestamptz not null default now(),
  created_by       text,
  constraint delivery_note_invoices_pkey primary key (delivery_note_id, invoice_id)
);

comment on table public.delivery_note_invoices is
  'Delivery note ↔ invoice, many-to-many. Source of truth for the link; '
  'delivery_notes.invoice_id is a transition-period mirror.';

-- ⚠️ FOR WHOEVER WIRES THE API (step 4): the ON DELETE CASCADE above removes the link
--    row when an invoice is deleted — which the ₪20K rejection path does
--    (`DELETE /invoices/:id`). It does NOT reset the delivery note, so the note is left
--    at stage `awaiting_approval` pointing at an invoice that no longer exists. Deciding
--    the resulting stage is the application's job, not a trigger's: a note whose invoice
--    was rejected goes back to `awaiting_invoice`. Verified against Postgres 16 —
--    deleting one of two linked invoices left one link row and an unchanged note.

-- Reverse lookup: "which notes does this invoice cover?" — the consolidated-invoice
-- case, where approving once must close every note attached to it.
create index if not exists delivery_note_invoices_invoice_idx
  on public.delivery_note_invoices (invoice_id);

-- Carry the existing one-to-one links across. on conflict do nothing keeps re-runs safe.
insert into public.delivery_note_invoices (delivery_note_id, invoice_id, created_by)
select dn.id, dn.invoice_id, 'migration:20260823000000'
  from public.delivery_notes dn
  join public.invoices i on i.id = dn.invoice_id
 where dn.invoice_id is not null
on conflict do nothing;


-- ═══ 3. invoices — the gate into the ledger ═════════════════════════════════════════
--
-- §6.e: an invoice enters the ledger only once a human has approved the pair.
--
-- ⚠️ THE BACKFILL BELOW IS NOT OPTIONAL. Without it every invoice ever filed becomes
--    "awaiting approval" the moment this ships, and every supplier in the business gets
--    a banner covering years of history — which would make the message meaningless on
--    the day it is introduced. Everything that already exists counts as approved; the
--    gate applies from here forward.
--
-- A pending invoice STILL COUNTS in the balance and is merely marked — the owner's
-- decision, and the same rule the ₪20K gate follows (ledgerEngine.ts). A balance that
-- quietly omits a real, filed invoice shows less than is owed, which is the worse error.

alter table public.invoices
  add column if not exists ledger_approved_at timestamptz;
alter table public.invoices
  add column if not exists ledger_approved_by text;

comment on column public.invoices.ledger_approved_at is
  'Pipeline approval into the ledger (§6.e). NOT the ₪20K gate — that is '
  '`awaiting_approval`. NULL = still awaiting approval; the row is counted and marked.';

update public.invoices
   set ledger_approved_at = coalesce(received_at, created_at, now()),
       ledger_approved_by = 'migration:20260823000000'
 where ledger_approved_at is null;

create index if not exists invoices_ledger_pending_idx
  on public.invoices (supplier_id) where ledger_approved_at is null;


-- ═══ 4. suppliers — two pipeline flags ══════════════════════════════════════════════

-- §6.9: a consolidated-invoice supplier bills periodically for many deliveries. Its
-- notes must NOT raise the 7-day "no invoice yet" alert; they wait for the periodic
-- invoice, and only 3 months of silence is worth reporting.
alter table public.suppliers
  add column if not exists is_consolidated_invoice boolean not null default false;

-- `payment_arrangement` exists on prod (hadas-api reads and writes it) but is absent
-- from dev-schema.sql, and section 7 below puts it into suppliers_v. Without this guard
-- the view would fail to create on any environment rebuilt from dev-schema, taking the
-- whole migration with it. No-op where the column is already there.
alter table public.suppliers
  add column if not exists payment_arrangement boolean not null default false;

-- §6.8: an employee opening a delivery for an unknown supplier creates a skeleton
-- behind the scenes; the manager is alerted to complete it. The delivery is already
-- attached by the time she does.
alter table public.suppliers
  add column if not exists pending_completion boolean not null default false;


-- ═══ 5. orders — the entry point (chapter 7) ════════════════════════════════════════
--
-- Replaces the WhatsApp group. The owner posts a supplier + free text; employees mark
-- "הגיע" when the goods land, which FEEDS the pipeline above.
--
-- 🔑 §7.i / D22 — AN ORDER IS NOT A SOURCE OF TRUTH. It is an indication: a supplier may
--    add goods nobody ordered, or drop goods off with no order at all. Quantity and
--    money are settled by the delivery note / manual entry against the invoice, never
--    from here. Nothing in this table may ever reach the ledger.
--
-- Customer fields ship NOW even though their full UX is phase B (D21) — adding columns
-- later to a table already in use is the more expensive half.

create sequence if not exists orders_seq;

create table if not exists public.orders (
  id               text        not null default 'ORD-' || lpad(nextval('orders_seq')::text, 4, '0'),
  supplier_id      text        references public.suppliers(id),
  supplier_name    text,
  description      text,                                   -- free text, as in the WhatsApp group
  date             date        not null default current_date,
  -- §7.3 lists the three states in Hebrew. Stored here as ENGLISH KEYS, matching
  -- `delivery_notes.stage` in §6.3 — one convention inside one feature — with the
  -- Hebrew living in StatusBadge, where every other Hebrew label already lives.
  -- Prefixed because that badge map is shared across entities and a bare
  -- `waiting` would be one future collision away from an order showing a
  -- delivery's label.
  status           text        not null default 'order_waiting',
  arrived_at       timestamptz,
  -- §7.j: what arrived differs from what was ordered. DOCUMENTATION ONLY — it has no
  -- accounting effect; the difference is settled at invoice matching.
  arrived_differs  boolean     not null default false,
  -- Set when "הגיע" opens/links a delivery row. That row, not this one, is in the pipeline.
  delivery_note_id text        references public.delivery_notes(id) on delete set null,
  -- Private customer orders — replaces the paper notebook (§7.8). Manual for now;
  -- a customer-club link is a later idea.
  customer_name    text,
  customer_phone   text,
  customer_status  text,
  created_by       text,
  created_at       timestamptz not null default now(),
  constraint orders_pkey primary key (id)
);

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'orders_status_check') then
    alter table public.orders drop constraint orders_status_check;
  end if;
  alter table public.orders
    add constraint orders_status_check
    check (status in ('order_waiting', 'order_arrived', 'order_partial'));
end $$;

-- §7.7: open orders for a supplier, nearest date first. The board's only read shape.
create index if not exists orders_supplier_status_idx
  on public.orders (supplier_id, status, date desc);


-- ═══ 6. RLS ═════════════════════════════════════════════════════════════════════════
--
-- Reads go through the anon client under RLS; writes go through hadas-api with the
-- service-role key, which bypasses RLS. So these policies gate SELECT — same shape as
-- delivery_notes in 20260604120000_employee_rls.sql.
--
-- Employees read both: the orders board IS the employee screen, and the link table
-- carries no figures. Neither table has money columns, so no masking view is needed —
-- unlike invoices / suppliers / delivery_notes, whose base-table SELECT is revoked.

alter table public.orders enable row level security;
drop policy if exists "allowed users read orders" on public.orders;
create policy "allowed users read orders" on public.orders
  for select to authenticated
  using (public.current_user_role() is not null);

alter table public.delivery_note_invoices enable row level security;
drop policy if exists "allowed users read delivery_note_invoices" on public.delivery_note_invoices;
create policy "allowed users read delivery_note_invoices" on public.delivery_note_invoices
  for select to authenticated
  using (public.current_user_role() is not null);

grant select on public.orders                 to anon, authenticated;
grant select on public.delivery_note_invoices to anon, authenticated;


-- ═══ 7. Views ═══════════════════════════════════════════════════════════════════════
--
-- ⚠️ THE STEP THAT IS EASIEST TO FORGET. Clients read the VIEWS — base-table SELECT is
--    revoked for these three (20260708000000) — so a new column that is not listed here
--    is invisible to the entire frontend, and it fails SILENTLY. The supplier-card note
--    shipped that way once and never appeared in production.
--
-- Each view below is its latest definition verbatim plus the new columns.

-- ── delivery_notes_v ────────────────────────────────────────────────────────────────
-- From 20260708000000, plus stage / employee_id / intake_source. Financial masking
-- unchanged: an employee sees the goods and the document, never the amounts.
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
  stage, employee_id, intake_source
from public.delivery_notes
where public.current_user_role() is not null;

grant select on public.delivery_notes_v to anon, authenticated;

-- ── invoices_v ──────────────────────────────────────────────────────────────────────
-- From 20260821000000, plus ledger_approved_at / ledger_approved_by.
--
-- NOT masked: these are timestamps and an email, not figures. An employee confirming
-- that goods match an invoice needs to see whether it has already been approved —
-- and §6.7 lets her approve. The amounts stay masked exactly as before, so her
-- approval screen compares goods and document, never money.
drop view if exists public.invoices_v;
create view public.invoices_v with (security_barrier = true) as
select
  id, supplier_id, invoice_number, invoice_date, supplier_name,
  case when public.current_user_role() = 'manager' then total_amount      end as total_amount,
  case when public.current_user_role() = 'manager' then amount_before_vat end as amount_before_vat,
  case when public.current_user_role() = 'manager' then vat_amount        end as vat_amount,
  category, line_items, status, invoice_type, external_link, drive_file_link,
  drive_folder_link, message_link, sender_name, email_sender, received_at,
  ai_confidence, ai_missing_fields, is_duplicate, has_error, error_reason,
  execution_log_url, html_content, transferred_at, created_at, partial_return,
  gmail_message_id, email_subject, gmail_label_source, month_folder_link, storage_url,
  awaiting_approval, notes,
  ledger_approved_at, ledger_approved_by
from public.invoices
where public.current_user_role() is not null;

grant select on public.invoices_v to anon, authenticated;

-- ── suppliers_v ─────────────────────────────────────────────────────────────────────
-- From 20260720000000, plus the two pipeline flags — AND `payment_arrangement`, which
-- has never been in this view.
--
-- ⚠️ That omission is a live bug, not housekeeping. hadas-api writes and reads
--    `payment_arrangement` server-side, but the client reads the VIEW, so
--    `useSuppliers.ts` has always resolved it to `false`. Every "בהסדר תשלום" display
--    in the frontend — the supplier card pill, the ledger banner, the statement verdict
--    — is therefore dead, and the ledger's display-zero for such a supplier never fires
--    on the client. It is fixed here because the pipeline's cross-screen balance check
--    cannot pass while one figure is computed from a flag the client cannot see.
drop view if exists public.suppliers_v;
create view public.suppliers_v with (security_barrier = true) as
select
  id, name, alt_names, email, phone, category, notes, created_at, linked_invoices,
  case when public.current_user_role() = 'manager' then opening_balance      else null::numeric end as opening_balance,
  hp, contact,
  case when public.current_user_role() = 'manager' then opening_balance_date else null::date    end as opening_balance_date,
  active, needs_details,
  payment_arrangement,
  is_consolidated_invoice, pending_completion
from public.suppliers
where public.current_user_role() is not null;

grant select on public.suppliers_v to anon, authenticated;
