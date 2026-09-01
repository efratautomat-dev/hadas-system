-- ============================================================================
-- PROD-SCHEMA-PROBE-2.sql   —   READ-ONLY. Selects only. Changes nothing.
-- ----------------------------------------------------------------------------
-- Probe 1 asked what 20260823 would CREATE. This asks what it DEPENDS ON — the
-- half that decides whether it can run at all.
--
-- 20260823 is NOT wrapped in a transaction. A view that names one column the
-- table does not have fails at that statement, leaving the tables and columns
-- above it already applied: a half-migrated production schema. Every column the
-- three rebuilt views select is listed below, EXCEPT the ones the migration adds
-- itself earlier in the same file.
--
-- Also here: public.employees, the FK target for delivery_notes.employee_id; and
-- vendor_statements.vendor_balance, whose real name probe 1 got wrong (it asked
-- about `balance`, so that row's `false` carried no information).
-- ============================================================================

with required(tbl, col) as (
  select 'delivery_notes'::text, unnest(array['amount','amount_before_vat','archived_at','created_at','date','drive_file_link','email_subject','gmail_message_id','id','invoice_id','line_items','message_link','note_number','received_at','source_email','status','storage_url','supplier_id','supplier_name','vat_amount'])::text
  union all
  select 'invoices'::text, unnest(array['ai_confidence','ai_missing_fields','amount_before_vat','awaiting_approval','category','created_at','drive_file_link','drive_folder_link','email_sender','email_subject','error_reason','execution_log_url','external_link','gmail_label_source','gmail_message_id','has_error','html_content','id','invoice_date','invoice_number','invoice_type','is_duplicate','line_items','message_link','month_folder_link','notes','partial_return','received_at','sender_name','status','storage_url','supplier_id','supplier_name','total_amount','transferred_at','vat_amount'])::text
  union all
  select 'suppliers'::text, unnest(array['active','alt_names','category','contact','created_at','email','hp','id','linked_invoices','name','needs_details','notes','opening_balance','opening_balance_date','phone'])::text
),
missing as (
  select r.tbl, r.col from required r
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=r.tbl and c.column_name=r.col
  )
)
select 'MISSING COLUMN: ' || tbl || '.' || col as item, false as ok from missing
union all select 'all view preconditions present', not exists(select 1 from missing)
union all select 'table employees (FK for delivery_notes.employee_id)', to_regclass('public.employees') is not null
union all select 'vendor_statements.vendor_balance is NULLABLE (20260818)',
  coalesce((select is_nullable='YES' from information_schema.columns
            where table_schema='public' and table_name='vendor_statements'
              and column_name='vendor_balance'), false)
union all select 'rows in delivery_notes: ' || (select count(*) from public.delivery_notes)::text, true
union all select 'delivery_notes with a status the backfill does not map: '
  || (select count(*) from public.delivery_notes
      where status is not null
        and status not in ('pending','pending_match','unlinked','linked','archived'))::text, true
order by ok, item;
