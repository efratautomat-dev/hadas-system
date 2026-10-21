-- ════════════════════════════════════════════════════════════════════════════════
-- "החזר חלקי" as a SUPPLIER setting (21.10.2026)
--
-- Beside "בהסדר תשלום" on the supplier card: a supplier marked partial-return has
-- every NEW invoice filed under its month's "החזר חלקי" Drive subfolder by ingest
-- (until now only the Gmail label of that name did this). Existing invoices are
-- moved one by one through the invoice's own mark (updateInvoice re-files the
-- Drive copy), which the UI offers when the setting is switched on.
--
-- The column must also be in suppliers_v: the client reads the VIEW, and a flag
-- missing from it reads as `false` forever — exactly how payment_arrangement was
-- dead on the client until 20260823000000 (see the note there).
--
-- `create or replace view` with the new column APPENDED at the end — Postgres
-- allows that without a drop, so nothing depending on the view is disturbed.
-- ════════════════════════════════════════════════════════════════════════════════
begin;

alter table public.suppliers
  add column if not exists partial_return boolean not null default false;

create or replace view public.suppliers_v with (security_barrier = true) as
select
  id, name, alt_names, email, phone, category, notes, created_at, linked_invoices,
  case when public.current_user_role() = 'manager' then opening_balance      else null::numeric end as opening_balance,
  hp, contact,
  case when public.current_user_role() = 'manager' then opening_balance_date else null::date    end as opening_balance_date,
  active, needs_details,
  payment_arrangement,
  is_consolidated_invoice, pending_completion,
  partial_return
from public.suppliers
where public.current_user_role() is not null;

grant select on public.suppliers_v to anon, authenticated;

commit;
