-- ── Two ways a balance stops being wrong ────────────────────────────────────
--
-- Both of these exist because the ledger is arithmetic and the shop is not. The
-- arithmetic is right and the number it produces is still not what is owed —
-- once because the history is a mess nobody will ever untangle, once because a
-- supplier does not issue invoices at all. Neither is fixed by editing rows: the
-- rows are true. What is missing is a place to say so.
--
-- ── 1. ledger_resets ────────────────────────────────────────────────────────
--
-- "יש ספקים נוצר אצלם בלאגן והכרטסת מאופסת אבל בגלל הרבה חשבוניות זה לא נראה."
-- The balance is already settled in life; the ledger keeps carrying an argument
-- that ended, buried under enough invoices that nobody can see where.
--
-- A ROW, not a rewrite. Every invoice and payment before the line stays exactly
-- as it was — visible, countable, still adding up to what it always did. What the
-- reset records is a DECISION: as of this day, this supplier is square, and here
-- is why. The engine turns that into one correcting entry.
--
-- `reason` is NOT NULL and that is the point of the feature. A balance that jumps
-- to zero with no explanation is a worse artefact than the mess it cleaned up —
-- in six months the only question anyone asks about this line is "why", and a
-- nullable column is a promise to not have the answer.
--
-- `reset_on` is a DATE and separate from `created_at`: one is the day the balance
-- is declared square, the other is when somebody pressed the button. They are the
-- same day today and will not be the day someone back-dates a reset to the end of
-- a quarter.
--
-- MANAGER-ONLY at the data layer, matching supplier_notes. Employees never see a
-- balance (the `_v` masking views), so they have nothing to reset — and `reason`
-- is free text that will contain figures.
--
-- ── 2. payments.receipt_settled_at ──────────────────────────────────────────
--
-- "יש ספקים בודדים שמשלמים תמורת קבלה." No invoice is ever issued, so the debit
-- side of the pair does not exist. The payment stands alone as a credit and the
-- ledger reads as though the supplier owes US money.
--
-- Marking the receipt makes the payment contribute nothing — the same count-zero
-- treatment `is_duplicate` gets, and deliberately NOT the same column: that one
-- means "suspected duplicate or error", and this is a payment that was correct,
-- documented, and closed. Keeping the two apart is what stops the duplicate
-- counter from filling up with rows that are nothing of the sort.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.ledger_resets (
  id           uuid        not null default gen_random_uuid(),
  -- suppliers.id is TEXT ('SUP-001'), not uuid.
  supplier_id  text        not null references public.suppliers(id) on delete cascade,
  reset_on     date        not null default current_date,
  reason       text        not null,
  author_email text,
  created_at   timestamptz not null default now(),
  constraint ledger_resets_pkey primary key (id)
);

comment on table public.ledger_resets is
  'A declared zero point for one supplier''s ledger. The rows before it are '
  'untouched; the engine inserts a single correcting entry on reset_on.';
comment on column public.ledger_resets.reset_on is
  'The day the balance is declared 0. Movements dated ON this day are zeroed too '
  '— the reset sits after them, because "as of today" includes today.';
comment on column public.ledger_resets.reason is
  'Required. The only thing anyone will want from this row in six months.';
comment on column public.ledger_resets.author_email is
  'Stamped SERVER-side from the verified JWT, never sent by the client.';

-- The only way the ledger ever reads this table: everything for one supplier,
-- in date order.
create index if not exists ledger_resets_supplier_idx
  on public.ledger_resets (supplier_id, reset_on);

alter table public.ledger_resets enable row level security;

drop policy if exists "managers manage ledger resets" on public.ledger_resets;
create policy "managers manage ledger resets" on public.ledger_resets
  for all to authenticated
  using      (public.current_user_role() = 'manager')
  with check (public.current_user_role() = 'manager');


-- ── The receipt that closes a payment ───────────────────────────────────────

alter table public.payments
  add column if not exists receipt_settled_at timestamptz;

alter table public.payments
  add column if not exists receipt_settled_by text;

-- Which delivery the receipt was recorded from. Not a foreign key on purpose:
-- delivery_notes.id is written by ingest from several sources and a row can be
-- dismantled by the pipeline, which must not cascade into a payment's history.
alter table public.payments
  add column if not exists receipt_delivery_note_id text;

comment on column public.payments.receipt_settled_at is
  'A receipt was issued for this payment instead of an invoice, so it contributes '
  'nothing to the balance. NOT is_duplicate: this payment is correct and closed.';

create index if not exists payments_receipt_open_idx
  on public.payments (supplier_id)
  where receipt_settled_at is null;


-- ── The delivery side of the same event ─────────────────────────────────────
--
-- The pipeline row is what the owner is looking at when she marks the receipt, and
-- it is what has to stop asking for an invoice that is never coming.

alter table public.delivery_notes
  add column if not exists receipt_settled_at timestamptz;

comment on column public.delivery_notes.receipt_settled_at is
  'Closed by a receipt rather than by an invoice. The pipeline stage moves to '
  'in_ledger and the row stops waiting for a document that does not exist.';


-- ── delivery_notes_v, again ─────────────────────────────────────────────────
--
-- 20260906020000 exists because the previous migration added a column and left
-- the view behind. Adding one here without rebuilding the view would repeat that
-- within a day. Definition is 20260906020000's, plus receipt_settled_at.

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
  stage, employee_id, intake_source, paired_note_id, receipt_settled_at
from public.delivery_notes
where public.current_user_role() is not null;

grant select on public.delivery_notes_v to anon, authenticated;
