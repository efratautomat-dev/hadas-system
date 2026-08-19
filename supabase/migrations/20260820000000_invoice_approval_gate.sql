-- ── invoice approval gate: a big invoice waits for the owner ─────────────────
--
-- An invoice whose PRE-VAT amount passes a threshold is no longer accepted
-- silently. Ingest still files it — the document, the Drive copy, the row, the
-- ledger movement are all real and stay real — but it is MARKED as awaiting the
-- owner's decision and raises an alert carrying every detail needed to make that
-- decision without opening anything else.
--
-- Two choices the owner made, both recorded here because they are invisible from
-- the schema:
--
--   • PRE-VAT. The threshold is about the size of the purchase, not about what
--     the tax adds to it. A ₪19,000 invoice does not become a big one because
--     18% VAT pushed the total over ₪20,000.
--
--   • A WAITING INVOICE STILL COUNTS in the supplier's balance, and is marked.
--     The alternative on the table was two balances ("approved" / "including
--     pending"). Counting-and-marking avoids the danger the docs warned about —
--     a balance that shows less than is actually owed — without putting two
--     numbers on screen for the same supplier.
--
-- WHY A NEW COLUMN AND NOT `status`: `invoices.status` is dead. Nothing displays
-- it; `deriveInvoiceStatus` computes the badge live and ignores the stored value
-- (src/lib/invoiceStatus.ts). Overloading a column the app already distrusts
-- would make the gate as unreliable as the thing it rides on.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.invoices
  add column if not exists awaiting_approval boolean not null default false;

comment on column public.invoices.awaiting_approval is
  'Pre-VAT amount passed app_settings.invoice_approval_threshold at ingest; the owner has not yet approved or rejected it. The row COUNTS in the balance and is flagged in the ledger.';

-- Waiting invoices are the ones anyone ever filters for; the settled ones are
-- the overwhelming majority, so index only the flagged rows.
create index if not exists idx_invoices_awaiting_approval
  on public.invoices (awaiting_approval)
  where awaiting_approval;

-- ── invoices_v ───────────────────────────────────────────────────────────────
-- ⚠️ invoices_v is an EXPLICIT column list, not `select *`. A new column that is
-- not added here is invisible to every client, because clients read the view and
-- SELECT on the base table is revoked. Recreated verbatim from
-- 20260708000000_employee_financial_column_mask.sql plus the new column.
--
-- awaiting_approval is NOT masked: it is a workflow flag, not a figure. An
-- employee already cannot see the amount that triggered it.
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
  awaiting_approval
from public.invoices
where public.current_user_role() is not null;

grant select on public.invoices_v to anon, authenticated;

-- ── the threshold ────────────────────────────────────────────────────────────
-- Lives in app_settings so the owner can move it without a deploy, in the same
-- key/value table as the logo. Seeded at ₪20,000 — the figure the gate was asked
-- for. An EMPTY or absent value turns the gate OFF rather than defaulting to
-- something nobody chose: a threshold is a business decision, and guessing one
-- would silently hold up invoices the owner never meant to stop.
--
-- `on conflict do nothing` — re-running must never reset a threshold the owner
-- has since changed.
insert into public.app_settings (key, value)
values ('invoice_approval_threshold', '20000')
on conflict (key) do nothing;

-- RLS on app_settings (reads open to signed-in users, writes manager-only) was
-- added in 20260819000000_supplier_notes.sql. Nothing to do here.
