-- ============================================================================
-- hadas-dev — full production schema recreation
-- ----------------------------------------------------------------------------
-- Source of truth: docs/02-DATA-MODEL.md (live schema verified 2026-06-28 via
--   information_schema / pg_indexes / pg_proc). This recreates the REAL
--   production DB shape — including tables created outside the migrations
--   folder — on a fresh empty Supabase project.
--
-- This is the CURRENT production schema, NOT the v2 target. It intentionally
--   keeps the documented quirks verbatim: Hebrew status defaults, invoices.line_items
--   as TEXT vs delivery_notes.line_items as JSONB, vendor_statements.status default
--   'pending' (English). Do NOT "fix" these here — the rebuild migrates them later.
--
-- There are NO balance RPCs (increment/decrement_supplier_balance) — they do
--   not exist in production and are deliberately omitted.
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS; DROP POLICY IF EXISTS
--   before CREATE POLICY; ON CONFLICT DO NOTHING seeds).
--
-- Order: extensions -> sequences -> tables -> indexes -> functions -> RLS
--   -> storage -> seeds.
--
-- Notes on faithful-but-runnable choices (identical stored result):
--   * Text-id defaults cast the sequence value to text — lpad(nextval(...)::text,
--     n,'0') — because lpad(bigint,...) has no implicit cast in Postgres. The doc
--     writes it without the cast for brevity; the produced ids (SUP-001, ...) are
--     identical.
--   * Foreign keys are derived from the doc's "FK->suppliers / FK->employees"
--     annotations and the supplier_categories ON DELETE CASCADE note. If the live
--     DB lacks any of these constraint objects, they are safe to drop — they only
--     add referential integrity, no column/type change.
-- ============================================================================

begin;

-- ─── Extensions ──────────────────────────────────────────────────────────────
-- gen_random_uuid() (uuid PKs on alerts / employees / categories / supplier_categories)
create extension if not exists pgcrypto;

-- ─── 1. Sequences (text-id + bigint id defaults depend on these) ─────────────
create sequence if not exists suppliers_seq;
create sequence if not exists invoices_seq;
create sequence if not exists payments_seq;
create sequence if not exists returns_seq;
create sequence if not exists delivery_notes_seq;
create sequence if not exists statements_seq;
create sequence if not exists system_logs_id_seq;

-- ─── 2. Tables ───────────────────────────────────────────────────────────────

-- suppliers ------------------------------------------------------------------
create table if not exists public.suppliers (
  id                    text        not null default 'SUP-' || lpad(nextval('suppliers_seq')::text, 3, '0'),
  name                  text        not null,
  alt_names             text,
  email                 text,
  phone                 text,
  category              text,
  notes                 text,
  created_at            timestamptz default now(),
  linked_invoices       integer     default 0,
  opening_balance       numeric     default 0,
  hp                    text,                       -- tax id (ח.פ)
  contact               text,
  opening_balance_date  date,
  -- Present on PROD but missing from this file until 2026-08-23. Two migrations that
  -- put them into suppliers_v (20260708000000, 20260720000000) therefore FAILED when
  -- the chain was replayed on a database built from here — the concrete form of
  -- `docs/07-OPEN-ISSUES.md` item 18 (base-table DDL absent from migrations).
  -- Verified by replaying every migration in order against a clean Postgres 16.
  active                boolean     not null default true,
  needs_details         boolean     not null default false,
  payment_arrangement   boolean     not null default false,
  constraint suppliers_pkey primary key (id)
);

-- employees ------------------------------------------------------------------
create table if not exists public.employees (
  id          uuid        not null default gen_random_uuid(),
  name        text        not null,
  role        text,
  phone       text,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  constraint employees_pkey primary key (id)
);

-- invoices -------------------------------------------------------------------
create table if not exists public.invoices (
  id                  text        not null default 'INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoices_seq')::text, 3, '0'),
  supplier_id         text        references public.suppliers(id),
  invoice_number      text,
  invoice_date        date,
  supplier_name       text,
  total_amount        numeric,
  amount_before_vat   numeric,
  vat_amount          numeric,
  category            text,
  line_items          text,                          -- TEXT (not jsonb) — per live schema
  status              text        default 'ממתין',   -- Hebrew default, verbatim
  invoice_type        text,
  external_link       text,
  drive_file_link     text,
  drive_folder_link   text,
  message_link        text,
  sender_name         text,
  email_sender        text,
  received_at         timestamptz,
  ai_confidence       text,
  ai_missing_fields   text,
  is_duplicate        boolean     default false,
  has_error           boolean     default false,
  error_reason        text,
  execution_log_url   text,
  html_content        text,
  transferred_at      timestamptz,                   -- set when "sent to accountant"
  created_at          timestamptz default now(),
  partial_return      boolean     default false,
  gmail_message_id    text,                          -- idempotency key
  email_subject       text,
  gmail_label_source  text,                          -- 'צילום ידני' for camera capture
  month_folder_link   text,
  storage_url         text,                          -- in-bucket path, not a URL
  -- Pre-VAT amount passed the approval threshold at ingest and the owner has not
  -- decided yet. The row still COUNTS in the balance; the ledger flags it.
  awaiting_approval   boolean     not null default false,
  -- Free-text remark about THIS invoice (collected into the supplier notes panel).
  notes               text,
  constraint invoices_pkey primary key (id)
);

-- payments -------------------------------------------------------------------
create table if not exists public.payments (
  id                  text        not null default 'PAY-' || lpad(nextval('payments_seq')::text, 4, '0'),
  supplier_id         text        references public.suppliers(id),
  amount              numeric     not null,
  payment_type        text        not null,
  payment_date        date        not null,
  value_date          date,
  reference           text,
  notes               text,
  status              text        default 'פעיל',    -- Hebrew default, verbatim
  cancelled_at        timestamptz,
  created_by          text,
  created_at          timestamptz default now(),
  source              text,                          -- 'email' for ingest
  email_received_at   timestamptz,
  source_message_id   text,                          -- Gmail id — idempotency
  bizbox_exported_at  timestamptz,                   -- Bizibox export stamp
  constraint payments_pkey primary key (id)
);

-- returns --------------------------------------------------------------------
create table if not exists public.returns (
  id                            text        not null default 'RET-' || lpad(nextval('returns_seq')::text, 4, '0'),
  supplier_id                   text        references public.suppliers(id),
  amount                        numeric     not null,
  reason                        text        not null,
  invoice_id                    text,                        -- original invoice
  date                          date        default current_date,
  status                        text        default 'בטיפול', -- Hebrew default, verbatim
  created_by                    text,
  created_at                    timestamptz default now(),
  detail                        text,
  employee_id                   uuid        references public.employees(id),
  drive_file_link               text,
  gmail_message_id              text,
  email_subject                 text,
  message_link                  text,
  supplier_credit_note_number   text,                        -- set when a credit note closes the return
  supplier_credit_note_date     date,
  supplier_credit_note_amount   numeric,
  storage_url                   text,
  constraint returns_pkey primary key (id)
);

-- delivery_notes -------------------------------------------------------------
create table if not exists public.delivery_notes (
  id                  text        not null default 'DN-' || lpad(nextval('delivery_notes_seq')::text, 4, '0'),
  supplier_id         text        references public.suppliers(id),
  note_number         text        not null,
  date                date        not null,
  amount              numeric,
  status              text        default 'pending',  -- English (UI normalizes linked/unlinked/archived)
  invoice_id          text,                           -- linked invoice
  created_at          timestamptz default now(),
  archived_at         timestamptz,
  amount_before_vat   numeric,
  vat_amount          numeric,
  line_items          jsonb,                          -- JSONB (unlike invoices.line_items)
  supplier_name       text,
  source_email        text,
  received_at         timestamptz,
  drive_file_link     text,
  gmail_message_id    text,
  email_subject       text,
  message_link        text,
  storage_url         text,
  constraint delivery_notes_pkey primary key (id)
);

-- vendor_statements ----------------------------------------------------------
create table if not exists public.vendor_statements (
  id                text        not null default 'STMT-' || lpad(nextval('statements_seq')::text, 4, '0'),
  supplier_id       text        references public.suppliers(id),
  month             text        not null,            -- YYYY-MM
  vendor_balance    numeric     not null,
  our_balance       numeric,
  diff              numeric,
  status            text        default 'pending',   -- English default, verbatim (see inconsistencies)
  uploaded_at       timestamptz default now(),
  resolved_at       timestamptz,
  resolution_notes  text,
  storage_url       text,
  drive_file_link   text,
  constraint vendor_statements_pkey primary key (id)
);

-- alerts ---------------------------------------------------------------------
create table if not exists public.alerts (
  id              uuid        not null default gen_random_uuid(),
  type            text        not null,
  title           text        not null,
  message         text,
  severity        text        not null default 'info',
  status          text        not null default 'unread',
  context_data    jsonb,
  related_entity  text,
  related_id      text,
  action_url      text,
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  resolved_at     timestamptz,
  payload         jsonb,                              -- structured routing data
  constraint alerts_pkey primary key (id)
);

-- allowed_users (authorization source of truth) ------------------------------
create table if not exists public.allowed_users (
  email       text        not null,
  role        text        not null,                  -- 'manager' / 'employee'
  created_at  timestamptz not null default now(),
  constraint allowed_users_pkey primary key (email)
);

-- app_settings (key/value app configuration) ---------------------------------
create table if not exists public.app_settings (
  key         text        not null,
  value       text,
  updated_at  timestamptz not null default now(),
  constraint app_settings_pkey primary key (key)
);

-- categories (free-form tag pool) --------------------------------------------
create table if not exists public.categories (
  id           uuid        not null default gen_random_uuid(),
  name         text        not null,
  usage_count  integer     default 0,
  created_at   timestamptz default now(),
  constraint categories_pkey primary key (id),
  constraint categories_name_key unique (name)
);

-- supplier_categories (per-supplier category history -> AI hint) -------------
create table if not exists public.supplier_categories (
  id            uuid        not null default gen_random_uuid(),
  supplier_id   text        not null references public.suppliers(id) on delete cascade,
  category      text        not null,
  usage_count   integer     default 1,
  last_used_at  timestamptz default now(),
  constraint supplier_categories_pkey primary key (id),
  constraint supplier_categories_supplier_id_category_key unique (supplier_id, category)
);

-- supplier_notes (per-supplier CRM log) --------------------------------------
-- A LIST of dated, authored notes, unlike suppliers.notes which is one
-- overwritable blob. `tag` records which screen the note was written on and is
-- derived there, never chosen by hand. Manager-only at the data layer — see
-- migration 20260819000000.
create table if not exists public.supplier_notes (
  id            uuid        not null default gen_random_uuid(),
  supplier_id   text        not null references public.suppliers(id) on delete cascade,
  body          text        not null,
  tag           text        not null default 'suppliers',
  author_email  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint supplier_notes_pkey primary key (id),
  constraint supplier_notes_tag_check check (tag in ('suppliers', 'payments', 'statements'))
);
create index if not exists supplier_notes_supplier_created_idx
  on public.supplier_notes (supplier_id, created_at desc);

-- system_logs (developer diagnostics) ----------------------------------------
create table if not exists public.system_logs (
  id          bigint      not null default nextval('system_logs_id_seq'),
  "timestamp" timestamptz default now(),
  source      text        not null,                  -- e.g. invoices-ingest / payments-ingest
  level       text        not null,
  message     text        not null,
  context     jsonb,
  message_id  text,                                  -- correlates rows to one email
  constraint system_logs_pkey primary key (id),
  constraint system_logs_level_check check (level in ('debug','info','warn','error'))
);

-- ingest_failures (cost guard for repeated extraction failures) --------------
create table if not exists public.ingest_failures (
  gmail_message_id  text        not null,
  attempts          integer     not null default 0, -- cap MAX_INGEST_ATTEMPTS = 2
  last_error        text,
  last_attempt_at   timestamptz not null default now(),
  constraint ingest_failures_pkey primary key (gmail_message_id)
);

-- ─── 3. Indexes (PKs above are implicit; these are the rest) ─────────────────

-- invoices
create index if not exists idx_invoices_supplier on public.invoices (supplier_id);
create index if not exists idx_invoices_date     on public.invoices (invoice_date);
create index if not exists idx_invoices_duplicate on public.invoices (is_duplicate)
  where is_duplicate = true;
create unique index if not exists invoices_msg_invnum_supplier_uidx
  on public.invoices (gmail_message_id, invoice_number, supplier_id)
  where gmail_message_id is not null
    and invoice_number is not null
    and invoice_number <> ''
    and supplier_id is not null;

-- payments
create unique index if not exists payments_source_message_id_uidx
  on public.payments (source_message_id)
  where source_message_id is not null;
create index if not exists idx_payments_date     on public.payments (payment_date);
create index if not exists idx_payments_supplier on public.payments (supplier_id);

-- returns
create index if not exists idx_returns_supplier on public.returns (supplier_id);

-- delivery_notes
create index if not exists idx_delivery_notes_status on public.delivery_notes (status);

-- vendor_statements
create index if not exists idx_statements_supplier on public.vendor_statements (supplier_id);
create index if not exists idx_statements_status   on public.vendor_statements (status)
  where status = 'mismatch';

-- alerts
create index if not exists idx_alerts_created_at on public.alerts (created_at desc);
create index if not exists idx_alerts_status     on public.alerts (status);
create index if not exists idx_alerts_type       on public.alerts (type);

-- system_logs
create index if not exists system_logs_timestamp_idx    on public.system_logs ("timestamp" desc);
create index if not exists system_logs_source_level_idx on public.system_logs (source, level);

-- ─── 4. Functions (SECURITY DEFINER role helpers — exactly two) ──────────────

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
as $$
  select role from public.allowed_users
  where lower(email) = lower(auth.jwt() ->> 'email')
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.allowed_users where email = auth.email() limit 1
$$;

-- ─── 5. Row-Level Security ───────────────────────────────────────────────────
-- Reads go through the anon client (role `authenticated`); writes go through
-- hadas-api with the service-role key (RLS bypassed). Policies enforce the
-- manager/employee split at the data layer.
-- (Tables without documented policies — categories,
--  supplier_categories, system_logs — are left as-is, matching the doc.)

alter table public.payments          enable row level security;
alter table public.vendor_statements enable row level security;
alter table public.alerts            enable row level security;
alter table public.suppliers         enable row level security;
alter table public.invoices          enable row level security;
alter table public.delivery_notes    enable row level security;
alter table public.returns           enable row level security;
alter table public.employees         enable row level security;
alter table public.allowed_users     enable row level security;
alter table public.ingest_failures   enable row level security;  -- no policy => service-role only

-- manager-only reads
drop policy if exists "managers read payments" on public.payments;
create policy "managers read payments" on public.payments
  for select to authenticated
  using (current_user_role() = 'manager');

drop policy if exists "managers read vendor_statements" on public.vendor_statements;
create policy "managers read vendor_statements" on public.vendor_statements
  for select to authenticated
  using (current_user_role() = 'manager');

-- alerts: full manager management
drop policy if exists "managers manage alerts" on public.alerts;
create policy "managers manage alerts" on public.alerts
  for all to authenticated
  using (current_user_role() = 'manager')
  with check (current_user_role() = 'manager');

-- allowed-user (manager or employee) reads
drop policy if exists "allowed users read suppliers" on public.suppliers;
create policy "allowed users read suppliers" on public.suppliers
  for select to authenticated
  using (current_user_role() is not null);

drop policy if exists "allowed users read invoices" on public.invoices;
create policy "allowed users read invoices" on public.invoices
  for select to authenticated
  using (current_user_role() is not null);

drop policy if exists "allowed users read delivery_notes" on public.delivery_notes;
create policy "allowed users read delivery_notes" on public.delivery_notes
  for select to authenticated
  using (current_user_role() is not null);

drop policy if exists "allowed users read returns" on public.returns;
create policy "allowed users read returns" on public.returns
  for select to authenticated
  using (current_user_role() is not null);

drop policy if exists "allowed users read employees" on public.employees;
create policy "allowed users read employees" on public.employees
  for select to authenticated
  using (current_user_role() is not null);

-- allowed_users: a user may read only their own row
drop policy if exists "users read own allowed_users row" on public.allowed_users;
create policy "users read own allowed_users row" on public.allowed_users
  for select to authenticated
  using (email = auth.email());

-- ─── 6. Storage (private documents bucket + read policy) ─────────────────────

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Any authenticated user may read objects in the documents bucket
-- (not folder/role-scoped — documented as a future tightening point).
drop policy if exists "authenticated read documents bucket" on storage.objects;
create policy "authenticated read documents bucket" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents');

-- ─── 7. Seeds (reference data only — the ~10 default categories) ─────────────
insert into public.categories (name) values
  ('ספקים ביגוד'),
  ('ספקים כיסויי ראש ומטפחות'),
  ('ספקים בגדי ים'),
  ('ספקים שונות'),
  ('הוצאות ניהול'),
  ('הוצאות משרד'),
  ('תשלומי מעמ'),
  ('תשלומי מס הכנסה'),
  ('משכורות'),
  ('שונות')
on conflict (name) do nothing;

commit;

-- ============================================================================
-- End of hadas-dev schema.
-- ============================================================================
