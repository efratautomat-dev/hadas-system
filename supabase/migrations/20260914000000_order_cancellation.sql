-- ── הזמנה שלא תגיע ──────────────────────────────────────────────────────────
--
-- The owner: "על ביטול או דחייה של הזמנת לקוחה, כולל סיבה — לדוגמה אם מהחברה
-- אמרו שהדגם אזל, שזה לא יופיע כל הזמן על המסך אלא רק בסינון הזמנות לא רלוונטיות.
-- תדמיין מחברת אמיתית."
--
-- A real notebook is the whole specification. You do not tear the page out — the
-- customer may ask next month whether it was ever ordered, and a page that was
-- torn out answers nothing. You draw a line through the entry and write WHY, and
-- from then on your eye skips it.
--
-- So: two columns and no deletion.
--
--   cancelled_at   — the line through the entry. Everything reads `is null` to
--                    mean "still live", which is one condition rather than a new
--                    value every existing filter would have to learn.
--   cancel_reason  — required by the API, because a crossed-out line with no
--                    reason is the artefact nobody can act on in three months.
--                    "אזל אצל הספק" and "הלקוחה התחרטה" lead to opposite next
--                    steps, and the difference is only ever in those words.
--
-- NOT a new `status` value: cancellation is not a point on the order's line, it
-- is an exit available from any point on it — before it was ordered, after it was
-- ordered, even after part of it arrived. Folding it into `status` would make
-- every reader choose between "where is this order" and "is it still alive", and
-- the two questions are independent.
--
-- The same two columns serve a plain restock ("אזל אצל הספק") and a customer
-- order ("הלקוחה ויתרה"). One gesture, one place to look.

alter table public.orders
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by  text;

comment on column public.orders.cancelled_at is
  'The line through the entry. NULL = live. Set together with cancel_reason, '
  'never alone — and reversible, because a supplier who calls back tomorrow is '
  'an ordinary Tuesday.';
comment on column public.orders.cancel_reason is
  'WHY it will not arrive, in the words of whoever was told. Required by the API: '
  'a crossed-out line with no reason cannot be acted on later.';

-- The live board's read shape: open orders for a supplier, cancelled ones absent.
create index if not exists orders_live_idx
  on public.orders (supplier_id, date desc)
  where cancelled_at is null;
