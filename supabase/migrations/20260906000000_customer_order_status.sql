-- ── The customer's own status line ──────────────────────────────────────────
--
-- An order for a customer has TWO lives, and conflating them is how the notebook
-- turns into "המון בלאגן". `status` tracks the goods (ממתינה / הגיעה / הגיעה
-- חלקית) and is produced by events. This tracks the PROMISE to a person, and
-- almost all of it is produced by someone picking up a phone:
--
--   customer_waiting    ממתינה                 — written down, nothing done yet
--   customer_ordered    הוזמנה מהספק           — actually ordered
--   customer_arrived    הגיעה לחנות            — ⚡ THE ONLY AUTOMATIC ONE
--   customer_notified   נמסרה הודעה ללקוחה     — she was called
--   customer_delivered  נמסר                   — she has it
--
-- `customer_arrived` is set by the API when the goods land, because it is the one
-- step the system can witness. Every other step happened in a conversation the
-- system was not part of, and inferring those would put words in someone's mouth
-- — a customer marked "notified" who was never called is worse than one marked
-- nothing at all.
--
-- Nullable: an order with no customer has no customer status, and a default here
-- would give every restock a promise it never made.

alter table public.orders
  add column if not exists customer_status text;

do $$
begin
  if exists (select 1 from information_schema.constraint_column_usage
             where table_name = 'orders' and constraint_name = 'orders_customer_status_check') then
    alter table public.orders drop constraint orders_customer_status_check;
  end if;
  alter table public.orders
    add constraint orders_customer_status_check
    check (customer_status is null or customer_status in (
      'customer_waiting', 'customer_ordered', 'customer_arrived',
      'customer_notified', 'customer_delivered'
    ));
end $$;

-- Existing customer orders start at the beginning of the line rather than nowhere:
-- a blank status in a notebook reads as "nobody has looked at this", which is a
-- different claim from "waiting".
update public.orders
   set customer_status = 'customer_waiting'
 where customer_name is not null
   and customer_status is null;

comment on column public.orders.customer_status is
  'The promise to a person, separate from `status` which tracks the goods. Only '
  'customer_arrived is set automatically (when the goods land); the rest are '
  'marked by hand, because they happened in a conversation.';

create index if not exists orders_customer_open_idx
  on public.orders (customer_status)
  where customer_name is not null;
