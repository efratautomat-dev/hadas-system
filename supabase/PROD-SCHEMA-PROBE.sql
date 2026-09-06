-- ============================================================================
-- PROD-SCHEMA-PROBE.sql   —   READ-ONLY. Selects only. Changes nothing.
-- ----------------------------------------------------------------------------
-- `supabase migration list` is NOT a reliable record of what PROD has: several
-- migrations were applied by hand in the SQL editor (see PROD-MIGRATION-CHECKLIST
-- and CUTOVER-SEQUENCE, which deliberately runs 20260708 in three separate
-- pieces). Hand-run SQL never registers a row in supabase_migrations, so the
-- ledger shows "missing" for objects that have existed for weeks.
--
-- Run this in the Supabase SQL editor against PROD before any `db push`. It asks
-- the catalog what actually exists, one row per thing a pending migration would
-- create. Anything already `true` must NOT be created again.
-- ============================================================================

with checks(sort, item, present) as (
  -- ── tables ────────────────────────────────────────────────────────────────
  select 1, 'table  ingest_lock                      (20260719)', to_regclass('public.ingest_lock')            is not null
  union all select 1, 'table  supplier_notes                   (20260819)', to_regclass('public.supplier_notes')         is not null
  union all select 1, 'table  delivery_note_invoices           (20260823)', to_regclass('public.delivery_note_invoices') is not null
  union all select 1, 'table  orders                           (20260823)', to_regclass('public.orders')                 is not null

  -- ── views exist at all ────────────────────────────────────────────────────
  union all select 2, 'view   invoices_v                       (20260708)', to_regclass('public.invoices_v')       is not null
  union all select 2, 'view   suppliers_v                      (20260708)', to_regclass('public.suppliers_v')      is not null
  union all select 2, 'view   delivery_notes_v                 (20260708)', to_regclass('public.delivery_notes_v') is not null
  union all select 2, 'func   current_user_role()              (20260708)',
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='current_user_role')

  -- ── base-table columns ────────────────────────────────────────────────────
  union all select 3, 'col    vendor_statements.email_sender   (20260802)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='vendor_statements' and column_name='email_sender')
  union all select 3, 'col    vendor_statements.match_method   (20260802)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='vendor_statements' and column_name='match_method')
  union all select 3, 'col    returns.email_sender             (20260802)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='returns'           and column_name='email_sender')
  union all select 3, 'col    invoices.awaiting_approval       (20260820)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices'          and column_name='awaiting_approval')
  union all select 3, 'col    invoices.notes                   (20260821)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices'          and column_name='notes')
  union all select 3, 'col    invoices.ledger_approved_at      (20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices'          and column_name='ledger_approved_at')
  union all select 3, 'col    delivery_notes.stage             (20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='delivery_notes'    and column_name='stage')
  union all select 3, 'col    delivery_notes.employee_id       (20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='delivery_notes'    and column_name='employee_id')
  union all select 3, 'col    delivery_notes.intake_source     (20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='delivery_notes'    and column_name='intake_source')
  union all select 3, 'col    suppliers.is_consolidated_invoice(20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='suppliers'         and column_name='is_consolidated_invoice')
  union all select 3, 'col    suppliers.pending_completion     (20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='suppliers'         and column_name='pending_completion')
  union all select 3, 'col    suppliers.payment_arrangement    (20260720)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='suppliers'         and column_name='payment_arrangement')

  -- ── are the VIEWS current? a view can exist and still be the old shape ─────
  union all select 4, 'view   invoices_v HAS awaiting_approval (20260820)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices_v'       and column_name='awaiting_approval')
  union all select 4, 'view   invoices_v HAS notes             (20260821)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices_v'       and column_name='notes')
  union all select 4, 'view   invoices_v HAS ledger_approved_at(20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices_v'       and column_name='ledger_approved_at')
  union all select 4, 'view   suppliers_v HAS payment_arrangem.(20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='suppliers_v'      and column_name='payment_arrangement')
  union all select 4, 'view   delivery_notes_v HAS stage       (20260823)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='delivery_notes_v' and column_name='stage')

  -- ── other shape changes ───────────────────────────────────────────────────
  union all select 5, 'nullable vendor_statements.balance      (20260818)',
      coalesce((select is_nullable = 'YES' from information_schema.columns
                where table_schema='public' and table_name='vendor_statements' and column_name='balance'), false)
  union all select 5, 'bucket branding                         (20260729)', exists(select 1 from storage.buckets where id = 'branding')

  -- ── the lockdown half of 20260708. MUST be false once the mask is live. ────
  union all select 6, 'REVOKE done? invoices SELECT->authenticated (want false)',   has_table_privilege('authenticated','public.invoices','SELECT')
  union all select 6, 'REVOKE done? suppliers SELECT->authenticated (want false)',  has_table_privilege('authenticated','public.suppliers','SELECT')
  union all select 6, 'REVOKE done? delivery_notes SELECT->authenticated (want false)', has_table_privilege('authenticated','public.delivery_notes','SELECT')
)
select item, present from checks order by sort, item;
