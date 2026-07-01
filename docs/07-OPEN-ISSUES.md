# 07 — Open Issues, TODOs, Temporary Hacks & Inconsistencies

> Recorded, **not fixed**. Each item cites a location. "⚠️ confirm" items need the owner to
> verify against the live system. This is observational — it describes what the code does today.

## Known functional limitations
1. **8192-token extraction truncation on very long invoices.**
   `supabase/functions/invoices-ingest/index.ts` (`EXTRACTION_MAX_TOKENS = 8192`). Very long
   invoices (project memory cites invoice `01/011398`) still truncate; retry doesn't help. The
   function detects `stop_reason == "max_tokens"` and reports TRUNCATED. Candidate fix per memory:
   raise to 16000 or cap `line_items`. (See 04 §F3.)

2. **Non-invoice matching logic is stubbed.**
   `invoices-ingest/README.md` + `handleNonInvoice` (delivery_notes / statements / returns).
   Documents are extracted, supplier-resolved and inserted, but advanced matching is incomplete;
   look for TODO comments in that handler.

3. **HTML-login-page link fallback not auto-resolved.**
   `invoices-ingest` body-link path. When an inline invoice link lands on an HTML login page, an
   alert is raised but the link isn't followed/resolved; manual handling required.

4. **Statement reconciliation row-matching is demo/hard-coded.**
   `src/components/StatementReconciliation.tsx` (`stmtDetails`). The matched/unmatched ledger rows
   in the detail modal are static demo data, not backend-driven. Real reconciliation matching is
   not implemented end-to-end.

5. **Supplier Ledger uses hard-coded data.**
   `src/components/SupplierLedger.tsx` reads `mockLedgerEntries` + `supplierOpeningBalances`
   rather than a live ledger source.

6. **Settings → Backup tab is a stub.**
   `src/pages/Settings.tsx` — tab exists; export/import logic not implemented.

## Cutover / production-readiness
7. **N8N still owns the production `חשבונית` label.**
   `invoices-ingest` runs in **test mode** on a different source label while the legacy N8N flow
   keeps processing `חשבונית` in parallel. Going live = changing the source-label constant.
   ⚠️ confirm the **exact current source label**: project memory says `ספקים`; the code read in
   this pass shows `מסמכים מספקים`. These disagree — verify which is deployed. (04 §G3.)

8. **`employee_rls.sql` carries a "do not apply to production" warning.**
   `supabase/migrations/20260604120000_employee_rls.sql` instructs running
   `docs/rls-inspection.sql` first to check for conflicting policies. ⚠️ confirm whether the RLS
   migration is actually applied in production.

9. **Documents bucket read policy is not role/folder-scoped.**
   `20260605000000_documents_read_policy.sql` grants every authenticated user read access to
   **all** documents. The migration comment flags this as a future tightening point once employee
   RLS is live.

## Auth / secrets
10. **Legacy `HADAS_SERVICE_KEY` fallback still wired.**
    `hadas-api/index.ts` and `suppliers-list` fall back to `HADAS_SERVICE_KEY` if
    `SUPABASE_SERVICE_ROLE_KEY` is absent. Dead/transitional — candidate for removal (per memory).

11. **`HADAS_API_KEY` was exposed and rotated (2026-06-18).**
    Per project memory. ⚠️ confirm cron / N8N callers use the rotated key. No secret values appear
    in this repo dump; a loose file in the working tree named like
    `how <hash>\357\200\272.env` (`git status` untracked) ⚠️ should be inspected and removed if it
    contains credentials — **not read in this documentation pass.**

12. **`drive-migrate` and `drive-probe` use a hard-coded `?key=` token.**
    `supabase/functions/drive-migrate/index.ts`, `drive-probe/index.ts`. Auth is a literal token
    in source, not an env secret. These are operational tools; `drive-probe` is intentionally kept
    deployed (read-only) per memory.

13. **`suppliers-list` / `drive-migrate` / `drive-probe` missing from `config.toml`.**
    No `[functions.*]` block → Supabase would default `verify_jwt=true`, conflicting with their
    custom auth. ⚠️ confirm deploy flags (05, top table).

## API / client mismatches
14. **Bizibox export path name.**
    Router exposes `POST /payments/mark-bizbox-exported` (`hadas-api/index.ts:816`). Some notes /
    older client code referenced `/payments/bizbox-exported`. ⚠️ confirm `src/lib/api.ts` /
    `usePayments.ts` call the exact router path, else the stamp silently 404s.

15. **No DELETE route for returns.**
    `hadas-api` router has POST/PUT/PUT-status for returns but no DELETE, while the Returns UI
    exposes delete actions. ⚠️ confirm how deletion is performed (anon client? unimplemented?).

## Data-model inconsistencies
16. **Return status vocabulary mismatch.**
    UI uses `אושר`/`בטיפול`/`נדחה` (`Returns.tsx`); ingest closes returns with `הסתיים` and looks
    for "open" as `!= הסתיים` (`invoices-ingest`). The two vocabularies don't line up — a return
    closed by ingest may not map cleanly to a UI status.

17. **Category list drift (UI 9 vs seeded 10).**
    `Suppliers.tsx` hard-codes 9 category colors; migration `20260520` seeds 10 (adds `תשלומי מעמ`
    and full `ספקים כיסויי ראש ומטפחות`). New AI-learned categories also land in the table but not
    the UI color map → fall back to a default color.

18. **Base-table DDL absent from migrations.**
    `suppliers`, `employees`, `allowed_users`, and the original columns of `invoices`/`payments`/
    `delivery_notes`/`returns`/`vendor_statements` are not in `supabase/migrations/`. They were
    created earlier / out of band. The data model in 02 reconstructs them from code usage and
    flags every gap. ⚠️ The rebuild needs the real DDL captured from the live DB.

19. **`decrement/increment_supplier_balance` RPCs not in repo.**
    Called by `hadas-api` returns logic; SQL definitions are not committed. ⚠️ capture from live.

## Dead / template / stray artifacts
20. **Root `README.md` is the generic Vite template** — no project-specific content.
21. **Loose `*.json` reports in repo root** (`may_dryrun.json`, `may_live.json`, `mayfix_dry*.json`,
    `mayfix_live.json`, `overflow_live.json`) — captured `drive-migrate` output, not app data;
    clutter that could be moved out of the repo root.
22. **`drive-migrate` `-31` date-range bug.**
    Per project memory: month range built as `YYYY-MM-01`..`YYYY-MM-31` mis-handles months
    without 31 days; blocked migrating months other than May. Location:
    `supabase/functions/drive-migrate/index.ts` month-range query.
23. **Many `console.log`/`console.error` left in hooks and components** (auth flow, CRUD ops,
    preview failures, alert-navigation). Useful for debugging; noisy for production.
24. **Working-tree WIP not yet committed** (from `git status` at session start): modified
    `Alerts.tsx`, `Dashboard.tsx`, `Layout.tsx`, `StatementReconciliation.tsx`, `mockData.ts`,
    `api.ts`, `supabase.ts`, plus many untracked new files (`demoData.ts`, `demo.ts`, `storage.ts`,
    `drive-migrate/`, `drive-probe/`, `ingest_failures` migration, `e2e/`, `migration/`). This
    documentation reflects the working-tree state, which is **ahead of the last commit**.

---

### Note on method
This pass did not run, build, or query anything (read-only). Items marked ⚠️ require the owner to
confirm against the live Supabase project, Vercel deployment, Gmail labels, and cron config — none
of which are fully verifiable from the repo alone.
