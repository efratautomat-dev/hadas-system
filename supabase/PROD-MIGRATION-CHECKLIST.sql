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
--     Schema changes NOT captured in supabase/migrations/* (added out-of-band on
--     dev). A `supabase db push` will NOT create them, so run them explicitly.
--       • suppliers.active / suppliers.needs_details — active default true,
--         needs_details default false (verbatim as applied on dev).
--       • returns.detail / returns.employee_id — written by hadas-api returnToRow
--         (createReturn / updateReturn). employee_id (uuid FK->employees) backs the
--         employee-role feature whose ONLY write path is POST /returns, so if prod's
--         legacy `returns` lacks it, employee return-creation 42703-fails right after
--         the hadas-api deploy. Both nullable — matching dev.

begin;

alter table public.suppliers add column if not exists active        boolean not null default true;
alter table public.suppliers add column if not exists needs_details boolean not null default false;

alter table public.returns   add column if not exists detail      text;
alter table public.returns   add column if not exists employee_id uuid;

-- returns.employee_id -> employees FK (match dev). Guarded DO block so it stays
-- idempotent and won't error if `employees` is absent or the FK already exists.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'employees')
     and not exists (select 1 from pg_constraint where conname = 'returns_employee_id_fkey')
  then
    alter table public.returns
      add constraint returns_employee_id_fkey
      foreign key (employee_id) references public.employees (id);
  end if;
end $$;

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
--       20260708  employee_financial_column_mask  role-aware *_v views + REVOKE base reads
--                                                  (see §5 — REQUIRES the hadas-api role-gate too)
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
--         • updateInvoice ........... on invoice-date change, re-files the Drive copy
--                                     into the correct year/month (overflow) folder and
--                                     refreshes month_folder_link / drive_folder_link,
--                                     via the shared _shared/drive-filing module (task 2)
--       ⚠️  DEPENDS ON §1 columns (active, needs_details) existing in prod FIRST.
--       ⚠️  Also set the machine key secret on prod (as done on dev):
--             supabase secrets set HADAS_API_KEY=<prod value> --project-ref jcwphkuwwuxvjibmvgdh
--           (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected; GMAIL_*/ANTHROPIC_*
--            only needed if Drive/AI paths run in prod.)
--
--     invoices-ingest  — MODIFIED this rebuild: (piece A) hp-primary supplier linking
--       + NAME-FALLBACK flags; (task 2) refactored to import the year/month/overflow
--       folder-resolution logic from _shared/drive-filing.ts. DEPLOYED TO DEV on
--       2026-07-12 (this session); NOT yet on prod.
--       ⚠️  SHARED MODULE — task 2 moved the filing rules into
--           supabase/functions/_shared/drive-filing.ts, now imported by BOTH
--           hadas-api (date-change re-file) and invoices-ingest. The module bundles
--           into each function at deploy, so BOTH must be (re)deployed to prod
--           TOGETHER for the single source of truth to take effect (deploying only
--           one leaves the other on its old bundle).
--       ⚠️  REQUIRED FOR DOCUMENT UPLOAD/CAPTURE. The in-app camera/upload flow
--           (CaptureDocument → captureDocument() → POST /functions/v1/invoices-ingest,
--           source:'camera') runs the SAME pipeline as email ingest. If this function
--           is not deployed, the upload POST returns HTTP 404 and capture fails.
--           (This is exactly why upload works in prod but not in dev — see below.)
--       Deploy invoices-ingest to prod (and set its secrets):
--         supabase functions deploy invoices-ingest --project-ref jcwphkuwwuxvjibmvgdh
--       ⚠️  CONFIRM these secrets are set on PROD (the camera/upload + email pipeline
--           need them; dev intentionally leaves them UNSET, which is why capture 404s/fails
--           in dev): ANTHROPIC_API_KEY (Haiku classify + Sonnet extract), GMAIL_CLIENT_ID,
--           GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and DRIVE_FOLDER_* (Drive filing).
--             supabase secrets set ANTHROPIC_API_KEY=<...> GMAIL_CLIENT_ID=<...> \
--               GMAIL_CLIENT_SECRET=<...> GMAIL_REFRESH_TOKEN=<...> \
--               DRIVE_FOLDER_INVOICES=<...> DRIVE_FOLDER_DELIVERY=<...> \
--               DRIVE_FOLDER_RETURNS=<...> DRIVE_FOLDER_STATEMENTS=<...> \
--               --project-ref jcwphkuwwuxvjibmvgdh
--           (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
--
--     (Other functions — payments-ingest, suppliers-list, drive-*, test-api — were
--      NOT changed during this rebuild; no redeploy needed on their account.)
--
--
-- ── 5. EMPLOYEE PERMISSION HARDENING (RLS/permissions audit) — DEV, replay on PROD ─
--     Two coordinated changes close the employee-role gaps. BOTH are required;
--     the DB mask (5a) is useless without the API role-gate (5b) and vice-versa.
--
--   5a. DB-layer financial-column mask — migration 20260708_employee_financial_column_mask.
--       Creates role-aware views invoices_v / suppliers_v / delivery_notes_v that expose
--       cost columns (invoices total/before-VAT/VAT, suppliers opening_balance[_date],
--       delivery_notes amount[/before-VAT/VAT]) ONLY to managers, then REVOKEs SELECT on
--       the three BASE tables from anon+authenticated so a direct PostgREST/F12 call can't
--       bypass the mask. Frontend reads were repointed to the *_v views (writes still hit
--       the base tables via hadas-api's service role — unaffected by the REVOKE).
--       ⚠️  The view column lists mirror the LIVE schema — if a new column is added to any
--           of the 3 tables, add it to the matching view or clients won't see it.
--       ⚠️  Depends on public.current_user_role() from migration 20260604 (employee_rls).
--
--   5b. hadas-api WRITE role-gate — code change (commit "security(gap#1)"), deploy with §4.
--       hadas-api derives the caller's role from allowed_users by their verified JWT email;
--       employees are allowlisted to POST /returns ONLY and get 403 on every other write
--       and on all GETs. x-hadas-key machine calls stay full-access (manager). Ships with
--       the same `supabase functions deploy hadas-api` in §4 — no separate step.
--
--     Verified on DEV with minted employee + manager JWTs:
--       • employee → 403 on all writes except POST /returns; 403 on all GETs
--       • employee → BASE invoices/suppliers/delivery_notes reads = 42501 permission denied
--       • employee → *_v views: rows visible but cost columns NULL
--       • employee → payments/vendor_statements/alerts = 0 rows (RLS, migration 20260604)
--       • manager  → *_v views return full financials; all writes reach their handlers


-- ── 6. STORAGE BUCKET — "branding" (manual; NOT created by any migration) ────
--     Settings -> system-logo upload writes to storage.from('branding') and stores
--     the PUBLIC url in app_settings.app_logo_url (Settings.tsx uses getPublicUrl),
--     so the bucket must be PUBLIC. Dev only ever had the private "documents" bucket
--     (created by migration 20260528, §3); "branding" was never created on dev either,
--     which is why logo upload is dev-broken — prod needs it. Idempotent.
--     (The private "documents" bucket + its read policy ARE covered by migrations
--      20260528 / 20260605 listed in §3 — no separate step needed for those.)

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do update set public = true;
-- ============================================================================
