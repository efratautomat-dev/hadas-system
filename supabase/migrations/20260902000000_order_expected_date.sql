-- ── orders.expected_date ────────────────────────────────────────────────────
--
-- §7.7's question is "מתי מגיע?" — asked of the employee on the phone, by a
-- customer, about an order that has not arrived. `date` answers when it was
-- PLACED, which is not what anyone is asking.
--
-- Nullable and never required: the owner often does not know, and a form that
-- demands a date it cannot know gets a made-up one. Only the orders board reads
-- it, and D22 still holds — nothing here reaches the ledger.

alter table public.orders
  add column if not exists expected_date date;

comment on column public.orders.expected_date is
  'Expected arrival, as told by the supplier. NULL = unknown, which is the common '
  'case. Display only — an order is never a source of truth (D22).';

create index if not exists orders_expected_idx
  on public.orders (expected_date)
  where status = 'order_waiting';
