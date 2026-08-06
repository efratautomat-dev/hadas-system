# 07 — Open Issues, TODOs, Temporary Hacks & Inconsistencies

> Recorded, **not fixed**. Each item cites a location. "⚠️ confirm" items need the owner to
> verify against the live system. This is observational — it describes what the code does today.

## Known functional limitations
0. **`invoices-ingest` on PROD is one deploy behind (2026-07-30).**
   The frontend shipped in PR #10 but `supabase functions deploy invoices-ingest` was not run,
   so ingest does not yet complete the three amounts (net / VAT / total) — a document that
   prints only a total lands with `amount_before_vat = 0` and `vat_amount = 0`.
   **Deliberately not blocking:** the total is correct, and the invoice screen completes the
   split the moment the row is opened (that half IS live), so nothing is lost — the DB row is
   just incomplete until someone opens it. Deploy from a machine linked to PROD.
   Also un-verified: the Bizibox export against the real Bizibox importer (structure verified,
   import not). See `spec/LAUNCH-PLAN.md §3a`.

1. **8192-token extraction truncation on very long invoices.**
   `supabase/functions/invoices-ingest/index.ts` (`EXTRACTION_MAX_TOKENS = 8192`). Very long
   invoices (project memory cites invoice `01/011398`) still truncate; retry doesn't help. The
   function detects `stop_reason == "max_tokens"` and reports TRUNCATED. Candidate fix per memory:
   raise to 16000 or cap `line_items`. (See 04 §F3.)

2. **Non-invoice matching logic is stubbed.** — **STATEMENTS FIXED 2026-08-02; delivery
   notes and returns still open.**
   `invoices-ingest/README.md` + `handleNonInvoice`. For **statements** the handler now
   extracts the closing balance and `hp`, resolves the supplier through an ordered chain
   (hp → `suppliers.email` → name → `invoices.email_sender` → orphan) recording which rule
   fired in `match_method`, reconciles against the ledger on arrival and raises
   `statement_mismatch`. See `spec/01-PRD.md §7`. Delivery notes and returns are unchanged —
   they are still inserted without advanced matching, and both still link by **name only**
   (`spec/LAUNCH-PLAN.md` Gap #1 remains open for them).

3. **HTML-login-page link fallback not auto-resolved.**
   `invoices-ingest` body-link path. When an inline invoice link lands on an HTML login page, an
   alert is raised but the link isn't followed/resolved; manual handling required.

3b. **✅ FIXED 2026-07-30 — the three-way ledger disagreement.**
   Items 4 and 5 below were the visible half of a bigger problem: SupplierDetail,
   SupplierLedger and StatementReconciliation each computed the balance their own way
   (measured: 9,000 / 7,000 / 6,000 on one dataset). Now one engine —
   `src/lib/supplierLedger.ts`. See `spec/06-RULES.md §9`. Two latent defects fixed with it:
   a date window that was part of the arithmetic (movements outside it vanished from the
   total), and undated rows absorbed into the opening balance instead of being shown.
   Invoice status likewise now derives in all four screens, not two.
   ✅ **MEASURED 2026-08-06 — nothing to re-check.** The production scan found
   **0** statements marked `תואם` whose difference is no longer zero, and 0 orphans.
   The warning below stands as the method, not as outstanding work.
   ⚠️ **Statements already marked `תואם` may have been matched against a stale
   `our_balance` and need re-checking.** → run `node scripts/statement-drift-report.mjs`
   (read-only; prints every `matched` statement whose difference is no longer zero, and
   refuses to call an empty anonymous read "nothing to review"). Nothing is auto-corrected.

3c. **A FOURTH copy was found on 2026-08-02 — `hadas-api`'s `reconcileStatement`.**
   It computed the balance inline, did **not** exclude `is_duplicate`/`has_error` rows, and
   used a `< 0.01` tolerance where the owner's rule is exactly zero. It now imports the same
   engine. The lesson from 3b held: the copies were found one at a time, each looking
   plausible on its own. `scripts/check-twins.mjs` now fails the build if the frontend engine
   and its Deno twin diverge by a single byte, so the next copy cannot drift silently.
   It also **pins the `vat.ts` pair by SHA** — those two are genuinely *not* byte twins
   (the UI copy carries the `edited` path and display helpers; `completeAmounts` has a
   different signature on each side), though the VAT bands and hole-filling order do agree.
   Touching either fails the check until a human re-reads both and re-pins deliberately.

4. **✅ FIXED 2026-08-02 — statement detail was static demo data.**
   `stmtDetails` (a single hard-coded `VS-002` fixture; every other statement showed
   "אין פירוט זמין לכרטסת זו") is gone. The detail is now a full **page** reading the real
   ledger via `buildLedger`, beside the supplier's own document.
   **Row-level matching is not "not implemented yet" — it is out of scope by decision**
   (`spec/01-PRD.md §7`, decision 2): the AI extracts only the supplier's closing balance
   and the manager reads the detail by eye. Do not reopen this as a gap.

5. **~~Supplier Ledger uses hard-coded data.~~ OUTDATED — corrected 2026-07-30.**
   `SupplierLedger.tsx` reads live hooks, not `mockLedgerEntries`. The real problem was
   different (see 3b): it computed its own ledger with a hard-coded 2026 date window folded
   into the arithmetic. **This entry pointed at the wrong file and cost time during the
   investigation** — kept as a reminder to date-stamp diagnoses.

6. **Settings → Backup tab is a stub.**
   `src/pages/Settings.tsx` — tab exists; export/import logic not implemented.

25. **⚠️ Statuses do not work well — full re-spec required (raised by the owner 2026-08-05).**
   `הועבר לרו״ח` is entered as a CHECKBOX but behaves as a STATUS that overrides every
   other value (`src/lib/invoiceStatus.ts:29`), which reads as "a status that isn't
   updated everywhere". Add to that: four different status vocabularies across the
   tables, a returns vocabulary that ingest and the UI genuinely disagree on (item 16),
   and the mandatory gray StatusBadge fallback missing from three screens.
   **Not a bug to patch — it needs a specification.** Written up with the current
   state and the open questions in `spec/11-STATUS-REDESIGN.md`.

26. **Goods-in → payment pipeline screen — TO BE SPECIFIED (raised 2026-08-05).**
   A single screen following each delivery from arrival to payment. The parts exist
   as separate entities; what is missing is the link between them — above all
   **there is no payment↔invoice relation** today (a payment moves the supplier's
   balance without closing specific invoices), so "this invoice is paid" is not
   currently expressible. Skeleton and open questions in
   `spec/12-GOODS-TO-PAYMENT-PIPELINE.md`. Depends on item 25.

26b. **Data cleanup — measured 2026-08-06, deferred by the owner.**
   ~25 items total: 14 duplicate-invoice groups (only 9 surplus rows still counted,
   ₪24,817), 2 duplicate-supplier groups, 9 receipts (₪42,410 still counted — one of
   which is a NEGATIVE amount and is probably a credit note misread as a receipt).
   **Conclusion: no cleanup screen is warranted at this volume** — the existing tools
   cover it. Full picture, the suspected false positive, and the suggested order in
   `spec/DATA-CLEANUP.md`. Re-measure with `node scripts/data-health.mjs` before
   revisiting that conclusion.

27. **Summary tiles hidden app-wide (owner's decision, 2026-08-05).**
   `SHOW_SUMMARY_CARDS = false` in `src/components/ui/SummaryCards.tsx`. Every call
   site was left in place, so flipping the one constant restores them.
   ⚠️ On six screens those tiles were also the **status filter** (`onClick`/`active`);
   hiding them removed that control. The filter state still exists in each screen —
   only the way to reach it is gone. Decide whether a compact filter row replaces it.

28. **Receipts already in `invoices` — audit, then decide (2026-08-05).**
   Ingest now refuses receipts, but rows that arrived before that are still there,
   counting toward supplier balances as phantom invoices.
   `node scripts/receipt-audit.mjs` (READ-ONLY) lists them with their document links.
   It is a **text heuristic**, not a verdict — it matches `קבלה` across the subject,
   `invoice_type`, number and line items, and deliberately EXCLUDES every spelling of
   `חשבונית מס קבלה`, which is a valid tax invoice and must stay.
   ⚠️ Recommended remedy is `has_error = true`, **not** delete: it removes the row from
   every balance while keeping it visible and auditable (the "shown but not counted"
   rule, `spec/06-RULES.md §9`). Deleting destroys the arrival record and orphans the
   Drive/Storage file.

29. **Dashboard rework — TO BE SPECIFIED, queued LAST (2026-08-05).**
   The owner wants the home screen to be *effective*. Deliberately scheduled after
   the status re-spec and the pipeline, because what a dashboard should show is
   largely decided by those two. Questions captured at the end of
   `spec/12-GOODS-TO-PAYMENT-PIPELINE.md`.

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
