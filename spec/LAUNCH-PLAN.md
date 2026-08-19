# Hadas v2 — Launch Plan & Resume Doc

> **⚠️ For "where we are" today, read [`spec/CURRENT-STATE.md`](./CURRENT-STATE.md) — not this.**
> This file is the v2 launch plan: the original scope, the cutover route, and the deployment log
> of that effort. It is history plus release procedure, no longer the live status. Companion docs: `docs/00-INDEX.md` (reverse-engineered current
> system), `docs/04-BUSINESS-LOGIC.md` (non-obvious rules), `spec/10-SECURITY.md`,
> `supabase/PROD-MIGRATION-CHECKLIST.sql` (the executable cutover checklist).

**Environments (never mix):**
- **DEV** — Supabase project `vabfsbrrxfwgdzrbznln` ("hadas-dev"). All rebuild work happened here.
  `hadas-v2` repo is linked to this. Frontend runs on demo/dev data.
- **PROD** — Supabase project `jcwphkuwwuxvjibmvgdh` ("hadas-system"). **UNTOUCHED** by the rebuild.
  Still running the legacy system + a parallel N8N flow on the `חשבונית` Gmail label.

---

## 1. DONE — completed slices (in DEV)

All built, `tsc -b` green, deployed to the DEV Supabase project, and committed. Each was a
discrete user-directed slice ending in a checkpoint commit.

- **Alerts** — unified alert model, dedup/idempotency super-rules, resolve→hidden, deep-link routing.
- **Balances** — computed `opening_balance + Σ invoices − Σ non-cancelled payments`; credit notes
  are negative invoices (already netted). Shared helper front + back (`computeOurBalance`).
- **Returns** — tracking-only returns; credit-note matching (same supplier + amount).
- **Payments / BizBox** — payments CRUD, cancel (reversible) vs delete, BizBox export stamp,
  upcoming/future payments, value-date urgency.
- **Suppliers** — active/inactive (deactivate replaces hard delete), employee-scoped view,
  hp-primary auto-create + `needs_details` flag + `supplier_incomplete` alert, card/table toggle,
  clickable rows, ח.פ search.
- **Categories** — managed pool (`categories`), rename/merge/delete-with-reassign (never orphans),
  feeds the AI extraction list.
- **Delivery notes** — two-view split (arrived-by-email vs manual goods-receipt), manual↔arrived
  matching, employee manual goods-receipt create.
- **Statement reconciliation** — auto-match every vendor statement vs our ledger on arrival;
  MATCH→`matched`, MISMATCH→`mismatch` + `statement_mismatch` alert; never auto-fixes.
- **Permissions / RLS hardening** — employees blocked at the DB layer, not just the UI:
  - hadas-api WRITE role-gate: employees may only `POST /returns` + `POST /delivery-notes`; 403 on
    everything else (`authenticate()` derives role from `allowed_users` by verified JWT email).
  - DB financial-column mask: role-aware views `invoices_v` / `suppliers_v` / `delivery_notes_v`
    expose cost columns only to managers; base-table SELECT REVOKEd from anon/authenticated
    (migration `20260708000000_employee_financial_column_mask.sql`).
  - payments / vendor_statements / alerts already manager-only via RLS (migration `20260604`).
- **Full design pass / white-label** —
  - `src/brand.config.ts` = the ONE file to reskin a client (appName, tabTitle, logoPath, palette);
    applied to CSS vars at runtime by `src/lib/applyBrand.ts`; Tailwind tokens point at the vars.
  - Font **Heebo** globally, RTL preserved.
  - Fixed functional status tokens `src/theme/status.ts` (blue=new, orange=in_progress, yellow=check,
    green=done/matched, red=mismatch/urgent) — brand-independent.
  - Shared primitives: `ui/Button.tsx` (one canonical button, variants primary/secondary/outline/
    ghost/danger, 44px), `ui/tableStyles.ts` (unified data tables), `ui/SummaryCards.tsx` (one
    summary-tile family across every screen).
  - Unified tables + summary cards across Invoices / Payments / Returns / DeliveryNotes /
    Statements / Suppliers / Alerts; redesigned Dashboard + Employee view; RTL fixes; Settings
    non-persisting tabs show a clean "not available" state.
- **Dashboard** — KPI tiles clickable, correct fixed status colors (new=blue), banners RTL + soft,
  alerts-table column overflow fixed, delivery-notes newest-first sort.

---

## 2. BEFORE PROD — must-fix supplier-matching gaps

Full analysis: see the supplier-matching audit (every resolve path traced). Order of matching today:
invoice + credit-note ingest = **hp-primary → fuzzy-name (0.85) → create** ✅. The gaps:

### MUST FIX before cutover
- **Gap #2 — manual / reclassify paths use EXACT name, not fuzzy.**
  `hadas-api` `resolveOrCreateSupplier` (manual payment/goods-receipt) and `reclassifyDocument` use
  `.eq("name", …)`. A name-only existing supplier with a slightly different spelling → **miss →
  duplicate**. Fix: use the same fuzzy matcher (`findBestSupplier`, threshold 0.85) as ingest.
- **Gap #4 — manual supplier add has NO dedup.**
  `POST /suppliers` (`createSupplier`) inserts unconditionally. Fix: run hp-primary + fuzzy-name
  dedup and warn/merge instead of blindly creating.
- **Gap #5 — hp not back-filled onto name-only suppliers.**
  When a doc that HAS ח.פ matches an existing hp-less supplier by name, the supplier stays hp-less.
  Fix: on a name-match where the incoming doc carries an hp the supplier lacks, write the hp onto
  the supplier (so future docs dedupe by hp).

### LOWER PRIORITY (nice-to-have)
- **Gap #1 — delivery-note & statement ingest ignore hp.**
  `extractDeliveryNote` / `extractStatement` don't capture ח.פ, so those link by name only. Fix:
  add `hp` to those extraction prompts and pass it into `resolveSupplier` to make them hp-primary.
- **Gap #3 — fuzzy match ignores `alt_names`.**
  The invoice path RECORDS alternate spellings (`appendAltName`) but `findBestSupplier` only scores
  against `suppliers.name`. Fix: also score against `alt_names` so recorded aliases help matching.

---

## 3. PROD CUTOVER — steps

Execute in order (the SQL must land before the functions that write the new columns):

1. **DB schema** — run `supabase/PROD-MIGRATION-CHECKLIST.sql` against the PROD DB. It captures:
   - §1 manual columns added out-of-band on dev (`suppliers.active`, `suppliers.needs_details`).
   - §3 version-controlled migrations (`supabase/migrations/*`, all idempotent) — including
     `20260604` employee RLS and `20260708` financial-column mask (§5a).
   - ⚠️ DEV's migration history table is empty (schema applied out-of-band); verify prod state
     before `db push`, or apply the SQL directly.
2. **Edge Functions → PROD:**
   - `supabase functions deploy hadas-api --project-ref jcwphkuwwuxvjibmvgdh` (includes the §5b
     write role-gate).
   - `supabase functions deploy invoices-ingest --project-ref jcwphkuwwuxvjibmvgdh` — **required
     for document upload/capture** (the in-app camera posts here; if missing → HTTP 404). See
     checklist §4.
   - (payments-ingest / suppliers-list / drive-* unchanged this rebuild.)
3. **Secrets on PROD** (checklist §4): `HADAS_API_KEY`, `ANTHROPIC_API_KEY`, `GMAIL_CLIENT_ID/
   SECRET/REFRESH_TOKEN`, `DRIVE_FOLDER_*`. (`SUPABASE_URL`/`SERVICE_ROLE_KEY` auto-injected.)
   Without ANTHROPIC/GMAIL/DRIVE, ingest + camera capture fail (this is why upload works in prod
   but not dev — dev leaves them unset by design).
4. **Storage** — ✅ **DONE 2026-07-30** (see §3a). Create the **`branding`** storage bucket on PROD (used by Settings → system-logo
   upload: `storage.from('branding')` + `app_settings.app_logo_url`). Dev only has `documents`, so
   logo upload is dev-broken; prod needs the bucket. (`documents` bucket + read policy also required.)
5. **Frontend env (Vercel)** — point PROD build at the PROD Supabase: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` = prod values; `VITE_DEMO_MODE=false`.
6. **Final security check** — walk `spec/10-SECURITY.md`: confirm employee JWT is blocked at the DB
   (base-table reads = 42501, payments/statements/alerts = 0 rows, writes 403 except the two
   allowlisted), `allowed_users` correct, no service key in the client bundle, RLS on all sensitive
   tables. Re-run the minted-JWT F12 test against prod.

---

## 3a. DEPLOYMENT LOG — 2026-07-30 (PR #10)

What actually shipped, what did not, and how the push was made to work — recorded because
the last round hit two "how did I do this last time?" walls that nothing in the repo answered.

### Shipped to prod (merged to `main`, Vercel built)
- VAT **18% keyed on the invoice date** (17% for pre-2025 invoices), amounts to the **agora**,
  and **all three amounts always filled** when an invoice is opened (`06-RULES.md §3`).
- Credit-note sign correction (`§2c`), two-way amount editing, two-pane invoice view.
- Bizibox export now **fills Bizibox's own template** instead of imitating it (`§8`), plus
  Settings → **ייצוא לביזיבוקס** to upload a revised template without a deploy.
- Supplier form as its own page; supplier detail rebuilt around six section cards
  (`01-PRD.md §2`); layout chrome cut from 38% of the screen to 25%.
- Lint 71 → 33, and two real defects found on the way (see the commit body of `be5543a`).

### Run manually on PROD by the owner
- The `branding` storage bucket + policies — see `supabase/migrations/20260729000000_*.sql`.
  **This closes §3 step 4 below**, which had been an unenforced manual checklist item; it is
  also why the system-logo upload had been broken all along.
  > The owner keeps TEST and PROD as **two separate Supabase projects** and runs PROD SQL
  > herself. This machine has never been linked to PROD, has no Supabase CLI and no
  > `supabase login` — keep it that way.

### NOT deployed — still pending
- `supabase functions deploy invoices-ingest` — three-amount completion **at ingest**.
  **Not blocking:** invoices still ingest correctly and the total is right; only the
  net/VAT split arrives empty, and the invoice screen fills it the moment the row is
  opened (that half IS live). Deploy from a machine linked to PROD when convenient.

### Verified structurally, NOT against the real system
- **Bizibox import.** The generated file is byte-identical to the template in 15 of its 16
  parts, validations intact. Only a real import proves it fixes the original symptom
  (4 cheques imported, 10 bank transfers silently dropped). **Test with the client and
  count rows in vs rows out.** Note the export **stamps payments as exported**, so a test
  run removes them from the next batch.

### Pushing from THIS server (the thing that was not written down)
The server had no GitHub credentials at all — no SSH key, no credential helper, no token —
because the original pushes were made from the owner's own laptop, where the credentials
live. Nothing was lost; it simply was never here. Fixed permanently:

```bash
ssh-keygen -t ed25519 -C "hadas-server" -f ~/.ssh/hadas_github -N ""
cat ~/.ssh/hadas_github.pub        # add at github.com/settings/keys
git remote set-url origin git@github.com:efratautomat-dev/hadas-system.git
```

with a matching `~/.ssh/config` block (`Host github.com` → `IdentityFile ~/.ssh/hadas_github`,
`IdentitiesOnly yes`). The private key never leaves the server; only the public half is pasted
into GitHub. Pushes from here now just work.

### Release route
`prod-cutover` → PR → `main`. `main` is the Vercel **production branch**, so the merge is what
reaches the client — the client's URL never changes. Pushing `prod-cutover` alone deploys
nothing. This was PR #10; #1–#9 followed the same route.

---

## 4. EXISTING-PROD FIXES — fold into NEW code before cutover (never patch the OLD system)

These are real defects in the live/legacy data or flow. Fix them **in the v2 codebase** so they're
resolved at cutover — do NOT hack the old system.

- **⚠️ Unparsed-invoice backfill (highest priority here).** The **Anthropic API token failed for
  ~2 days**, so invoices that arrived in that window were ingested **without AI parsing** (filed
  but missing extracted fields). Task:
  1. Identify the affected invoices (by received-at window / empty extracted fields / low
     `ai_confidence` / `has_error`).
  2. Re-run extraction on them through the v2 `invoices-ingest` pipeline (re-fetch the source from
     Gmail/Drive/Storage → extract → update rows), idempotently.
- **Alert-related cleanups** — carry the improved alert model/tooling forward so legacy alert quirks
  don't reappear (dedup, resolve→hidden, correct routing). Enumerate specific legacy alert bugs
  here as they're found.

---

## 5. POST-LAUNCH

- **Clear the ~80 pending alerts in prod** using the new, improved alert tooling (bulk triage,
  correct deep-links, reclassify, resolve).
- **N8N automations** (scheduled/cron that POLL `hadas-api`; use webhooks only later for real-time):
  - **3rd of month** → email suppliers.
  - **15th of month** → email the accountant.
  - **Later: POS (Kaspit) integration** as an inbound data source (sales/stock) to cross-reference
    goods receipts. Separate phase/cost (see `spec/09-IDEAS.md §2`).
- **Standing-order suppliers (הוראת קבע)** — mark suppliers with recurring fixed charges; system
  auto-balances the expected recurring amount to ~0 so routine costs don't clutter the debt view.
  ⚠️ Must NOT hide real debt — only the expected recurring amount is auto-offset (`spec/09-IDEAS.md §4`).
- **Backup export** — replace the placeholder export with a real full-data Excel/Drive backup
  (Settings → גיבוי currently shows "not available").
- **Settings tabs** — implement real persistence for Profile / Preferences / Notifications (they
  currently show the "not available" state; handlers preserved behind `SHOW_LEGACY`).
- **Invoice status logic explainer** — document/expose how the live-derived invoice status is
  computed (transferred → under-review-if-alert → waiting) for the owner.

---

## 6. DEV ENVIRONMENT — permanent, keep separate FOREVER

- `hadas-v2` (this repo) is the **permanent dev/test environment**, running on demo data and
  connected to the **DEV** Supabase project `vabfsbrrxfwgdzrbznln`.
- **Never collapse dev into prod.** Dev and prod stay fully separate always — separate Supabase
  projects, separate secrets, separate Gmail/Drive identities.
- Demo mode (`VITE_DEMO_MODE=true` / `?demo=1`) runs 100% fictitious data, hard-disabled in prod
  builds — safe for demos/marketing.
- Plan: host dev on my own server for demos / marketing / testing improvements **before** they go
  to prod. New features get built + verified here first, then cut over.

---

## 7. CLONING — duplicate & customize for a new client (for myself)

The app is white-label by design. To stand up a new client:

1. **Copy the repo** (fresh git history or a new branch/repo).
2. **Rebrand — edit ONE file, `src/brand.config.ts`:**
   - `appName`, `tabTitle` (Hebrew system name).
   - `logoPath` — drop the client's logo into `public/` (e.g. `public/acme-logo.png`) and set
     `logoPath: '/acme-logo.png'`. (Also replace `public/favicon.png` for the browser-tab icon —
     that's separate from `logoPath`.)
   - `colors` — primary / primaryDark / secondary / accent / surfaces. Everything (buttons, headers,
     active states, tables, cards, PDF header) follows automatically. Status/functional colors in
     `src/theme/status.ts` stay fixed — do NOT rebrand those.
   - Sanity: run the app, hard-refresh, confirm the whole UI + tab title reskin (see the white-label
     swap we tested).
3. **Fresh Supabase project** for the client:
   - Create the project; apply `supabase/migrations/*` (+ the manual columns / storage buckets from
     `PROD-MIGRATION-CHECKLIST.sql`): tables, RLS, `invoices_v`/`suppliers_v`/`delivery_notes_v`
     views, `documents` + `branding` buckets.
   - Deploy the Edge Functions (`hadas-api`, `invoices-ingest`, and any others in use).
   - Set the client's secrets: `HADAS_API_KEY`, `ANTHROPIC_API_KEY`, `GMAIL_*`, `DRIVE_FOLDER_*`.
   - Seed `allowed_users` (manager + employees) and `categories`.
4. **Point the client build** at their Supabase: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_DEMO_MODE=false`.
5. **Per-client wiring** — their Gmail labels, Drive folders, BizBox/accountant details, VAT (Israeli
   rate bands in `src/lib/vat.ts` — 18% since 1.1.2025; a non-Israeli client needs its own
   bands), and any standing-order/automation config.
6. **Verify** — run the security check (§3.6) and a smoke test of ingest + capture + the two
   employee writes before handing over.
