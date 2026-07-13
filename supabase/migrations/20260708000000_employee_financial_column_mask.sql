-- ─────────────────────────────────────────────────────────────────────────────
-- Employee financial-column masking (RLS/permissions audit — Gaps #2/#3).
--
-- Problem: employees must not read financial/cost data, but RLS is ROW-level only
-- and cannot hide columns. Column GRANT/REVOKE can't help either: managers and
-- employees share the single `authenticated` Postgres role, so a REVOKE hits both.
--
-- Fix: role-aware VIEWS + REVOKE base-table reads.
--   • public.<t>_v exposes cost columns ONLY when current_user_role()='manager'
--     (else NULL) and passes every other column through unchanged.
--   • The views run with the OWNER's rights (security_invoker is OFF by default),
--     so they can still read the base table after we REVOKE base SELECT from
--     clients. Because the owner bypasses base-table RLS, each view re-implements
--     the "allowed users read" membership gate in its own WHERE clause
--     (current_user_role() is not null == email present in allowed_users).
--   • current_user_role() / auth.email() read the request JWT (a GUC), so they
--     still reflect the ACTUAL caller — not the view owner — inside the view.
--   • REVOKE SELECT on the base tables from anon/authenticated so a direct F12
--     PostgREST call can't bypass the view. service_role keeps full access, so
--     hadas-api / invoices-ingest reads+writes are unaffected (they write the
--     BASE tables; clients only ever READ the *_v views).
--   • security_barrier = true blocks predicate push-down from leaking masked cells.
--
-- Masked (manager-only) columns:
--   invoices        : total_amount, amount_before_vat, vat_amount
--   suppliers       : opening_balance, opening_balance_date
--   delivery_notes  : amount, amount_before_vat, vat_amount
--
-- ⚠️  Column lists below mirror the LIVE dev schema. When a new column is added
--     to any of these tables, add it to the matching view or clients won't see it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── invoices_v ────────────────────────────────────────────────────────────────
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
  gmail_message_id, email_subject, gmail_label_source, month_folder_link, storage_url
from public.invoices
where public.current_user_role() is not null;

-- ── suppliers_v ───────────────────────────────────────────────────────────────
drop view if exists public.suppliers_v;
create view public.suppliers_v with (security_barrier = true) as
select
  id, name, alt_names, email, phone, category, notes, created_at, linked_invoices,
  case when public.current_user_role() = 'manager' then opening_balance      end as opening_balance,
  hp, contact,
  case when public.current_user_role() = 'manager' then opening_balance_date end as opening_balance_date,
  active, needs_details
from public.suppliers
where public.current_user_role() is not null;

-- ── delivery_notes_v ──────────────────────────────────────────────────────────
drop view if exists public.delivery_notes_v;
create view public.delivery_notes_v with (security_barrier = true) as
select
  id, supplier_id, note_number, date,
  case when public.current_user_role() = 'manager' then amount            end as amount,
  status, invoice_id, created_at, archived_at,
  case when public.current_user_role() = 'manager' then amount_before_vat end as amount_before_vat,
  case when public.current_user_role() = 'manager' then vat_amount        end as vat_amount,
  line_items, supplier_name, source_email, received_at, drive_file_link,
  gmail_message_id, email_subject, message_link, storage_url
from public.delivery_notes
where public.current_user_role() is not null;

-- ── Grants: clients read the masking views, never the base tables ─────────────
grant select on public.invoices_v       to anon, authenticated;
grant select on public.suppliers_v      to anon, authenticated;
grant select on public.delivery_notes_v to anon, authenticated;

-- ── REVOKE direct base-table reads so F12 can't bypass the mask ───────────────
-- (INSERT/UPDATE/DELETE grants are untouched — those go via service_role anyway;
--  the manager Invoices screen's direct-delete fallback keeps working.)
revoke select on public.invoices       from anon, authenticated;
revoke select on public.suppliers      from anon, authenticated;
revoke select on public.delivery_notes from anon, authenticated;
