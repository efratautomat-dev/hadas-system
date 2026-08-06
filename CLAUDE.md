# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Starting a session? Read `spec/CURRENT-STATE.md` first.** It is the live picture —
> what is in production, what is waiting on the owner, and what is next. This file
> describes how the system works; that one describes where it currently stands.

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

⚠️ **`npm run lint` does not exit 0** — there is a pre-existing baseline of **31 eslint
errors** in `src/`, unrelated to any recent work. Check that your change adds none rather
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
- **Return vocabulary mismatch:** UI uses `אושר`/`בטיפול`/`נדחה`; ingest closes returns with
  `הסתיים`. Both are live — don't unify them without checking `docs/07-OPEN-ISSUES.md`.

## Demo mode

`src/lib/demo.ts` gates `DEMO_MODE`, enabled by `VITE_DEMO_MODE=true` or `?demo=1`. It runs the
app on 100% fictitious data from `demo-seed.json`, bypasses auth, and stubs every DB read/write
(`src/lib/demoClient.ts`) — **it never touches the real Supabase project**. Hard-disabled in any
production build (`import.meta.env.PROD` guard), so it only works against the local dev server.

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
