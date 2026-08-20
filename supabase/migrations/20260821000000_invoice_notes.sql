-- ── invoices.notes: a remark on one invoice ──────────────────────────────────
--
-- Some invoices need a sentence that belongs to THEM and to nothing else — the
-- supplier billed the wrong quantity, a credit is expected, do not pay until X.
-- Until now there was nowhere to put it: the supplier card has one shared notes
-- field, and a statement's `resolution_notes` belongs to the statement.
--
-- Same shape as `vendor_statements.resolution_notes`, deliberately: one free-text
-- field on the row, edited where the row is edited. The owner asked for "exactly
-- what statement reconciliation has", including its future send-by-mail /
-- WhatsApp buttons — so this is that field, not a second note log.
--
-- The supplier notes panel COLLECTS this field (src/lib/noteSources.ts) and links
-- back to the invoice, per the rule in CLAUDE.md: a new place that stores free
-- text about a supplier gets one registry entry and appears in the panel.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.invoices
  add column if not exists notes text;

comment on column public.invoices.notes is
  'Free-text remark about this specific invoice, written on the invoice screen. Collected read-only into the supplier notes panel.';

-- ── invoices_v ───────────────────────────────────────────────────────────────
-- ⚠️ Explicit column list, not `select *`. Clients read the VIEW — select on the
-- base table is revoked (20260708000000) — so a column missing here is invisible
-- to the whole frontend. Recreated verbatim from
-- 20260820000000_invoice_approval_gate.sql plus `notes`.
--
-- NOT masked: a remark is not a figure. An employee already cannot see the
-- amounts, and withholding "do not pay until the credit arrives" from the person
-- handling the delivery would defeat the point of writing it down.
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
  awaiting_approval, notes
from public.invoices
where public.current_user_role() is not null;

grant select on public.invoices_v to anon, authenticated;
