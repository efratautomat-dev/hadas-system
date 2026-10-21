-- ════════════════════════════════════════════════════════════════════════════════
-- ✓ on our ledger: "this movement of ours appears on the supplier's statement too"
-- (owner's decision, 21.10.2026)
--
-- On the statement page she ticks each row of OUR ledger that she found on the
-- supplier's paper. A tick is a FACT about that invoice / payment, not about one
-- statement: it is certain and it stays — the next statement, and every earlier
-- one, show the same row ticked. So the mark is keyed by the supplier and the
-- ledger row (the engine's own row id: the invoice id or the payment id), never by
-- a statement.
--
-- No FK to suppliers, on purpose (the note_handled precedent): merge_suppliers()
-- re-points and removes a supplier, and an FK here would either block that merge or
-- cascade the marks away with it. A mark left under a merged-away id is invisible,
-- which is the lesser harm.
--
-- Nothing reads this to compute a balance or a verdict — it is her working state.
-- Written only by hadas-api (service role, manager-only route); read by managers.
-- ════════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.ledger_marks (
  supplier_id text        not null,
  row_id      text        not null,
  marked_at   timestamptz not null default now(),
  marked_by   text,
  primary key (supplier_id, row_id)
);

alter table public.ledger_marks enable row level security;

drop policy if exists "managers read ledger marks" on public.ledger_marks;
create policy "managers read ledger marks" on public.ledger_marks
  for select to authenticated
  using (public.current_user_role() = 'manager');

commit;
