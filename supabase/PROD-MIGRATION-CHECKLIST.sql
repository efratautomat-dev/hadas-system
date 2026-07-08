-- ============================================================================
-- PROD-MIGRATION-CHECKLIST.sql
-- ----------------------------------------------------------------------------
-- Schema + deploy steps applied to DEV (vabfsbrrxfwgdzrbznln / "hadas-dev")
-- during the Suppliers / Payments / Employee rebuild that must be replayed on
-- PROD (jcwphkuwwuxvjibmvgdh / "hadas-system") at cutover.
--
-- Generated 2026-07-07.  All statements are IDEMPOTENT — safe to re-run.
--
-- ⚠️  PROD WAS NOT TOUCHED during the rebuild. Nothing here has been applied to
--     prod by anyone yet — this file is the to-do list, not a record of done work.
-- ⚠️  ORDER MATTERS: run the SQL in §1 FIRST, then (re)deploy the Edge Functions
--     in §4, so the functions' writes to the new columns succeed.
-- ============================================================================


-- ── 1. MANUAL columns added straight to DEV via the SQL editor ───────────────
--     These are the ONLY schema changes NOT captured in supabase/migrations/*.
--     A `supabase db push` will NOT create them, so they must be run explicitly.
--     (Verbatim as applied on dev: active default true, needs_details default false.)

begin;

alter table public.suppliers add column if not exists active        boolean not null default true;
alter table public.suppliers add column if not exists needs_details boolean not null default false;

commit;


-- ── 2. `source` column on returns / delivery_notes — CHECKED: NOT NEEDED ─────
--     Neither table has (or needs) a `source` column. The returns & delivery-
--     notes two-view is derived from gmail_message_id / message_link, not a
--     `source` column. Notes:
--       • delivery_notes.source_email  -> an unrelated email-ADDRESS field.
--       • payments.source              -> already exists via migration 20260519.
--     => No statement required here.


-- ── 3. Everything else = version-controlled migrations (supabase/migrations/*) ─
--     Already idempotent (IF NOT EXISTS). If PROD has not had them applied, run
--     them — easiest via the CLI after linking to prod:
--
--         supabase link --project-ref jcwphkuwwuxvjibmvgdh   # PROD  (careful!)
--         supabase db push
--
--     Migration files (schema / structural):
--       20260513  create_alerts_table
--       20260519  payments_email_ingest        payments.source/email_received_at/source_message_id;
--                                               alerts.title/payload/status; payments unique idx
--       20260520  invoices_ingest              invoices.partial_return/gmail_message_id/email_subject/
--                                               gmail_label_source/month_folder_link; system_logs table
--       20260525  non_invoice_ingest_columns   delivery_notes & returns: drive_file_link/gmail_message_id/
--                                               email_subject/message_link
--       20260527  returns_credit_note_matching returns.supplier_credit_note_number/date/amount
--       20260528  storage_documents            storage_url on invoices/delivery_notes/returns/vendor_statements
--       20260604  employee_rls                 enable RLS + manager/employee policies
--       20260605  documents_read_policy        storage read policy
--       20260614  invoices_composite_msgid_index
--       20260618  ingest_failures              ingest_failures table
--       20260703  invoices_manager_delete_rls  manager-only invoice delete policy
--
--     ⚠️  I could NOT verify which of these prod already has (prod was not touched).
--         Verify prod state before pushing; every file is IF-NOT-EXISTS so re-running
--         is safe.


-- ── 4. Edge Functions deployed to DEV that must be deployed to PROD ──────────
--
--     hadas-api  — CHANGED this rebuild; deploy to prod:
--         supabase functions deploy hadas-api --project-ref jcwphkuwwuxvjibmvgdh
--       Changes:
--         • createReturn ............ amount now optional (tracking-only returns)
--         • deleteInvoice ........... clears is_duplicate on the lone survivor
--                                     (matches by hp/invoice_number, with & without supplier_id)
--         • updateSupplier .......... `active` added to the update allow-list
--         • resolveOrCreateSupplier . hp-primary auto-create + needs_details=true
--         • createPayment / updatePayment / createDeliveryNote — wired to auto-create
--       ⚠️  DEPENDS ON §1 columns (active, needs_details) existing in prod FIRST.
--       ⚠️  Also set the machine key secret on prod (as done on dev):
--             supabase secrets set HADAS_API_KEY=<prod value> --project-ref jcwphkuwwuxvjibmvgdh
--           (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected; GMAIL_*/ANTHROPIC_*
--            only needed if Drive/AI paths run in prod.)
--
--     invoices-ingest  — MODIFIED this rebuild (piece A: hp-primary supplier linking
--       + NAME-FALLBACK flags), committed but NOT yet deployed to dev OR prod. Deploy
--       when ingest is cut over:
--         supabase functions deploy invoices-ingest --project-ref <target>
--
--     (Other functions — payments-ingest, suppliers-list, drive-*, test-api — were
--      NOT changed during this rebuild; no redeploy needed on their account.)
-- ============================================================================
