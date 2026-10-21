-- ════════════════════════════════════════════════════════════════════════════════
-- Statement reconciliation: the owner's ✓ marks and date range (21.10.2026)
--
-- On the statement page she ticks each row of OUR ledger that also appears on the
-- supplier's statement, over a date range she picks to match the paper. Both are
-- kept so that reopening the statement shows where she stopped:
--   { "rows": ["<ledger row id>", …], "from": "YYYY-MM-DD" | "", "to": "YYYY-MM-DD" | "" }
-- Row ids are the ledger engine's own (invoice / payment / reset ids), so a mark
-- follows its row however the ledger is re-sorted. NULL = never touched.
--
-- Nothing reads this to compute a balance or a verdict — it is her working state.
-- ════════════════════════════════════════════════════════════════════════════════
alter table public.vendor_statements
  add column if not exists reconcile_marks jsonb;
