# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Starting a session? Read `spec/CURRENT-STATE.md` first** — the live picture of what is
> in production, what is waiting on the owner, and what is next. `spec/00-INDEX.md` maps
> the rest of `spec/`. This file describes how the system works; those describe where it
> currently stands and what is planned.

## What this is

**Hadas** is a Hebrew / RTL invoice & supplier-management system for a single retail
business. Supplier invoices, payments, delivery notes, returns/credit-notes and vendor
statements arrive by **email**; a Supabase Edge Function (`invoices-ingest`) pulls them from
labeled Gmail, classifies + extracts them with **Anthropic Claude** (Haiku classifier + Sonnet
extractor), files source files in **Google Drive** and **Supabase Storage**, and writes
structured rows to **Supabase Postgres**. A **React + Vite** frontend (on Vercel) lets the owner
and employees review everything, talking to a `hadas-api` CRUD Edge Function.

The `docs/` folder is a reverse-engineered spec of the system as it stands (start at
`docs/00-INDEX.md`); `spec/` holds the forward-looking PRD/design. **`docs/04-BUSINESS-LOGIC.md`
is the most important file to read before touching ingest/invoice/return logic** — it captures
the non-obvious rules (status derivation, dedup, credit-note matching, Drive overflow routing,
AI/JSON repair) that are invisible from the UI.

## Commands

```bash
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # tsc -b (typecheck) then vite build -> dist/
npm run lint       # check-twins THEN eslint . (see "Twinned files" below)
npm run check:twins # the twin guard on its own
npm run preview    # preview the production build

npx playwright test                              # run the demo-walkthrough E2E (boots dev server, demo mode)
npx playwright test e2e/demo-walkthrough.spec.ts # run a single spec

node scripts/statement-drift-report.mjs          # READ-ONLY: which `תואם` statements no longer reconcile
```

There is **no unit-test runner**. The only tests are Playwright E2E under `e2e/`
(a marketing walkthrough in demo mode) and a template test in `tests/`.

⚠️ **`npm run lint` does not exit 0** — there is a pre-existing baseline of **32 eslint
errors** (measured 19.08.2026) in `src/`, unrelated to any recent work. Check that your change adds none rather
than expecting green. The `check-twins` half *does* pass and must stay passing.

### Backend (Supabase, deployed via CLI — not part of `npm`)

```bash
supabase functions deploy <name>   # deploy an edge function (hadas-api, invoices-ingest, ...)
supabase db push                   # apply supabase/migrations/*.sql
```

Edge functions run on **Deno** (not Node) — different runtime, different imports. `.vercelignore`
excludes `supabase/` so backend code never ships to Vercel.

## Architecture

### Two-runtime split
- **Frontend** (`src/`): React 19 + TypeScript + Vite + Tailwind. Entry
  `index.html` (`<html lang="he" dir="rtl">`) → `src/main.tsx` → `src/App.tsx`.
- **Backend** (`supabase/functions/`): Deno/TypeScript Edge Functions. All use the
  **service-role key → bypass RLS** and do their own auth.

### Frontend data layer
- `src/hooks/` — **one hook per resource** (`useSuppliers`, `useInvoices`, `usePayments`,
  `useReturns`, `useStatements`, `useDeliveryNotes`, `useAlerts`, `useEmployees`, `useAuth`).
  Reads generally go through the Supabase **anon** client (RLS-enforced); writes go through
  `hadas-api`.
- `src/lib/api.ts` — thin HTTP wrapper over `hadas-api`. Every call fetches a fresh Supabase JWT
  (`supabase.auth.getSession()`) and sends `Authorization: Bearer <token>`. Also exposes
  `captureDocument()` → `invoices-ingest`.
- `src/lib/supabase.ts` — client factory that returns the real client OR a demo stub.
- `src/components/` are screens (Invoices, Suppliers, Returns, DeliveryNotes, Alerts, …);
  `src/pages/` holds Payments, Settings, SystemLogs. `src/utils/pdf/` generates print PDFs.

### Auth & roles
`useAuth` resolves a Supabase-authenticated user to a **role** (`manager` vs `employee`).
`App.tsx` routes employees to a restricted `EmployeeDashboard`; managers get the full `Layout`.
RLS enforces the same boundary at the DB (defense in depth). `hadas-api` accepts either
`x-hadas-key` (machines/cron) **or** a Bearer JWT whose email is in `allowed_users`.
(**The header is on its way out** — the owner decided 2026-08-25 that all authentication
becomes JWT-only; open questions and rollout in `spec/10-SECURITY.md`.)

⚠️ **`hadas-api` runs on the service-role key, so it bypasses RLS AND the `_v` masking
views.** A handler that reads a base table gets the unmasked row — `invoices_v` /
`suppliers_v` / `delivery_notes_v` are simply not in the path. **Every route an employee
may call (see `employeeMayAccess`) must re-apply the mask by hand.** This is not
hypothetical: the pipeline's match-suggestion endpoint shipped reading
`invoices.total_amount` from the base table and returned employees the figures the view
exists to hide. Nothing enforces this — read the handler as if the views did not exist,
because for that handler they do not.

### Ingest pipeline (`invoices-ingest`)
The heart of the system. Gmail (labeled) → **subject type classification** → format/logo gate → magic-byte type sniff →
Haiku content classification (only if the subject was inconclusive) → Sonnet extraction → robust
JSON repair → supplier match/create → dedup → Drive + Storage upload → DB insert → alerts. Also
serves an in-app **camera capture** POST mode. Details and every magic number are in
`docs/04-BUSINESS-LOGIC.md` and `docs/05-API.md`.

**Subject classification runs FIRST, before the "no usable document" guard** — keep it that
way. When the guard ran first it was hard-coded to `invoice_*` alerts, so a כרטסת whose file
couldn't be fetched was reported as a failed *invoice* and never reached `vendor_statements`
(`spec/09-IDEAS.md §10`).

**Statements** (`כרטסת`) are reconciled at ingest: Sonnet extracts only the supplier's
**closing balance** (plus `hp` and the period — never the rows), the supplier is resolved by
hp → `suppliers.email` → name → `invoices.email_sender` → orphan, with the route recorded in
`match_method`, and the balance is compared against `buildLedger` with **no tolerance band**,
raising `statement_mismatch` on a gap. A statement never creates a supplier card. See
`spec/01-PRD.md §7`.

## Conventions that will bite you

- **RTL / Hebrew.** The app is Hebrew-first, `dir="rtl"`. Hebrew status strings are matched
  **literally** in code (e.g. `אושר`, `ממתין`, `הסתיים`) — don't "clean up" or translate them.
  In docs they're wrapped in backticks to preserve exact bytes.
- **Hebrew-in-source hazard.** Raw Hebrew string literals can scramble a source file's visual
  order. The overflow folder name is built via `String.fromCharCode(...)` for exactly this reason
  (`docs/04` §E3). Be cautious adding Hebrew literals near LTR code/JSX.
- **Derived, not stored, status.** Invoice status badges are **computed live** in
  `Invoices.tsx` (transferred → under-review-if-alert → waiting); the stored `status` column is
  considered unreliable and ignored for display. Same pattern for supplier balances (computed in
  `useSuppliers.ts`).
- **VAT rate is keyed on the invoice date**, not on "today" — Israeli VAT is **18% since
  1.1.2025** and **17%** before it. Never reintroduce a bare `0.17` / `0.18`; use
  `vatRateFor(date)`. Amounts are computed to the **agora** (`round₂`), never to whole shekels,
  and **all three** (net / VAT / total) are always filled by `completeAmounts()` — holes only,
  so a figure read off the document is never overwritten. See `spec/06-RULES.md §3`.
- **Twinned files: `run npm run lint` decides, not your memory.** Vite can't import from
  `supabase/` and Deno can't import from `src/`, so some rules exist twice on purpose.
  `scripts/check-twins.mjs` (part of `npm run lint` AND `npm run build`) is the
  enforcement. It skips the pairs when the whole `supabase/` tree is absent — the
  Vercel build excludes it via `.vercelignore`, so there is nothing to compare
  there. A twin missing from a tree that DOES exist still fails. The pairs:
  - `src/lib/ledgerEngine.ts` ↔ `supabase/functions/_shared/ledgerEngine.ts` — the balance
    rule, **byte-identical below the header**. The check fails on one character of drift.
    `src/lib/supplierLedger.ts` is a thin wrapper adding `displayDate`; screens import that.
    Four independent copies of this rule caused the bug in `spec/06-RULES.md §9` — the guard
    is why a fifth cannot appear quietly.
  - `src/lib/vat.ts` ↔ `supabase/functions/_shared/vat.ts` — **not** byte twins and not
    expected to be: the UI copy carries the `edited` path and display helpers, and
    `completeAmounts` has a different signature on each side. The VAT bands and hole-filling
    order *do* agree. The pair is pinned by SHA, so touching either fails the check until
    someone re-reads both sides and re-pins on purpose.
- **Israeli dates are day-first** (`DD/MM/YY`), never US month-first — in both ingest parsing and
  the UI.
- **Credit notes are negative invoices** — amounts forced negative in ingest, never trusting the
  extractor's sign.
- **The approval gate counts and marks; it never hides.** An invoice over
  `app_settings.invoice_approval_threshold` (compared **pre-VAT**, via `Math.abs`
  so a large credit note is caught too) is filed normally and **still moves the
  supplier's balance** — it carries `invoices.awaiting_approval` and the ledger
  flags the row via `pendingApproval`. That flag is modelled on `undated`, NOT on
  `excluded`: `excluded` zeroes debit/credit, `undated` counts and surfaces. A
  balance that quietly omits a real, filed invoice shows less than is owed, which
  is the worse of the two errors — so the fix is always a louder mark, never a
  smaller number. An empty threshold means the gate is OFF; never default it to a
  figure nobody chose. Rejection reuses `deleteInvoice` and is destructive
  (row + Drive→trash + Storage + sibling alerts), so it stays behind a second
  confirmation.
- **A new place to write notes must be REGISTERED, not just built.** The supplier
  notes panel is a cross-section: every note the system holds about a supplier
  appears in one column, whichever screen it was written on, each one carrying a
  link back to the exact record it came from. `src/lib/noteSources.ts` is the
  single list that makes that true — table, supplier column, how to read the text
  and a date out of a row, and the navigation intent that reopens it. **Adding a
  screen or column that stores free text about a supplier means adding one entry
  there**, and the panel picks up its filter chip, tag, counts and back-link with
  no further change. Two rules the entries must keep: a collected note is
  READ-ONLY in the panel (it is edited where it was written — two editable copies
  of one string is two sources of truth), and `open()` must land on the record
  itself, never on its list. A note taken out of its context is half the
  information. If a new source can't express itself in that shape, widen the
  shape — do not special-case it inside the panel or the hook.
  ⚠️ **A source on `invoices`, `suppliers` or `delivery_notes` must name the `_v`
  VIEW, not the base table.** `20260708000000_employee_financial_column_mask.sql`
  REVOKEs base-table SELECT from `anon`/`authenticated`. Getting this wrong fails
  *silently* — `loadDerived` skips a failing source — and the demo cannot catch it,
  because `demoClient` has no permissions and aliases `_v` back to the base table.
  The supplier-card note shipped this way and never appeared in production.
- **Return vocabulary mismatch:** UI uses `אושר`/`בטיפול`/`נדחה`; ingest closes returns with
  `הסתיים`. Both are live — don't unify them without checking `docs/07-OPEN-ISSUES.md`.

## Demo mode

`src/lib/demo.ts` gates `DEMO_MODE`. It runs the app on 100% fictitious data from
`demo-seed.json`, bypasses auth, and stubs every DB read/write (`src/lib/demoClient.ts`) —
**it never touches the real Supabase project**. There are two ways in:

- **Local** — `VITE_DEMO_MODE=true` or `?demo=1`. Dev server only; no password. Used by the
  marketing walkthrough and the Playwright E2E.
- **Standalone** — `VITE_DEMO_STANDALONE=true`, set at build time by `.env.demo` via
  `npm run build:demo`. This is the public demo at `incontrol.ctrlplusf.com`: a production
  build, so it additionally shows a password gate and a manager/employee role switcher
  (`DEMO_STANDALONE`).

Two demo behaviours are worth knowing before you touch either: `app_settings` is the **one
table whose writes are real** in demo mode (`src/lib/demoSettings.ts`, sessionStorage-backed) —
because the logo upload lands there and a demo that announces a save it discarded is worse
than one without the button; and the standalone build **renames itself** via the four
`VITE_BRAND_*` overrides in `src/brand.config.ts`. That is also why `brand` now separates
`appName` (the product) from `greetingName` (the person the dashboard greets) — they were the
same string only because Hadas the system is named after Hadas the owner.

The `import.meta.env.PROD` guard still holds for the local path — neither the env flag nor the
URL param can switch a production build into demo mode. `VITE_DEMO_STANDALONE` is the single
key that opens one, and it lives only in `.env.demo`. **Never add it to the Vercel project** —
that would point the real system at fictitious rows. The role switcher works by having
`demoClient` serve `allowed_users` live from `demoGate.getDemoRole()`, so `useAuth`,
`ProtectedRoute` and every screen stay untouched. Full picture: `docs/08-DEMO-DEPLOYMENT.md`.

## Product tiers

`src/lib/tiers.ts` is the single definition of the three levels the system is sold at
(`basic` / `advanced` / `custom`) — which screens, dashboard tiles and alerts each one
includes. Tiers are cumulative by construction, so moving a feature between levels is one
edit there. **`currentTier()` returns `custom` outside the standalone demo**, so production
and the local `?demo=1` walkthrough keep seeing everything; only the public demo is tiered,
where the password at the door decides which level the visitor browses.

⚠️ **Hiding a nav item is never enough.** Anything that *points at* a gated screen advertises
a feature the viewer cannot open — dashboard tiles and banners, whole dashboard panels, the
Bizibox tab in Settings, the employee dashboard's cards, and history-restored navigation
(guarded in `Layout.renderPage`). Alerts are filtered inside `useAlerts` rather than at each
call site, so the feed, the alerts screen, its counters and the sidebar badge cannot drift
apart; an alert type missing from the map stays **visible**, because hiding a warning nobody
classified is worse than showing one. Adding a screen means adding it to a tier AND checking
who points at it.

## Two deployment targets — every change ships to both

The frontend is deployed **twice**, and both must move together:

| Target | What it is | How it deploys |
|---|---|---|
| **Vercel** | the real system the business runs on (real Supabase, behind login) | push to `main` |
| **`incontrol.ctrlplusf.com`** | the public demo — static, fictitious data, no DB | build + sync on the Contabo server |

`npm run deploy` does both in one command and reports on each. Deploying only one produces a
demo that shows a system nobody uses, or a business running code nobody can demonstrate.
`npm run deploy:demo` / `:vercel` exist for the deliberate one-sided case, and say so loudly.
The demo half only works **on the server that hosts it** (`/home/runner/hadas-demo`), since
publishing is a local file sync. Runbook and troubleshooting: `docs/08-DEMO-DEPLOYMENT.md`.

## Environment

Frontend (`import.meta.env`, build-time, set in Vercel — not committed): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_DEMO_MODE`. Edge functions (`Deno.env.get`, runtime) include
`HADAS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, the `GMAIL_*` OAuth trio, and `ANTHROPIC_API_KEY`.
See `.env.example` and `docs/01-ARCHITECTURE.md` §5 for the full name-only list.

## Notes

- Root-level `may_*.json`, `mayfix_*.json`, `overflow_live.json` are **captured output** of
  `drive-migrate` runs, not application data.
- `migration/` is a one-time Airtable-CSV → SQL importer (`generate.cjs`, `inspect.cjs`).
- Anthropic models in use: `claude-haiku-4-5-20251001` (classify) and `claude-sonnet-4-6`
  (extract, `max_tokens = 8192`). A legacy **N8N** flow still runs in parallel on the production
  `חשבונית` Gmail label during cutover.
