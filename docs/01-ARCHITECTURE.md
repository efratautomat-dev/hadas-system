# 01 — Architecture

> Reverse-engineering documentation of the **Hadas** system as it exists in the repo today.
> Hebrew strings are shown in `backticks` to preserve their exact value (they are matched
> literally in code). Secret values are never printed — only variable **names** appear, with
> values shown as `[REDACTED]`.

---

## 1. What the system is

Hadas is a Hebrew / RTL **invoice & supplier management** system for a single business
(a clothing/retail operation). It automates the capture of supplier invoices, payments,
delivery notes, returns/credit-notes and vendor statements that arrive by **email**, runs
them through **AI extraction**, files the source documents in **Google Drive**, stores the
structured data in **Supabase Postgres**, and surfaces everything in a React web app for the
owner ("הדס" / Hadas) and her employees.

---

## 2. Stack

### Frontend
| Concern | Choice | Version (from `package.json`) |
|---|---|---|
| UI framework | React | 19.2.x |
| Language | TypeScript | ~6.0 |
| Build tool | Vite | 8.0.x |
| CSS | Tailwind CSS | 3.4.x |
| Icons | lucide-react | 1.14.x |
| Spreadsheets | ExcelJS + XLSX | 4.4 / 0.18 |
| E2E tests | Playwright | 1.60.x |
| Lint | ESLint + typescript-eslint | 10.x / 8.x |

Entry point: `index.html` (`<html lang="he" dir="rtl">`) → `src/main.tsx` → `src/App.tsx`.

### Backend
| Concern | Choice |
|---|---|
| Database | Supabase Postgres |
| Auth | Supabase Auth (email magic-link / OTP) |
| Server logic | Supabase **Edge Functions** (Deno / TypeScript) |
| File storage | Supabase Storage (private bucket `documents`) + Google Drive |
| AI extraction | Anthropic Claude API (Haiku classifier + Sonnet extractor) |

Supabase project ref: `jcwphkuwwuxvjibmvgdh` (from `supabase/.temp/linked-project.json`).

---

## 3. Hosting & deploy flow

### Frontend → Vercel
- Built with `npm run build` → `tsc -b` (typecheck) then `vite build` → `dist/`.
- Deployed to **Vercel**, auto-deploying on push to `main` (per project memory; the repo has
  no `vercel.json`, so Vercel uses its default Vite preset).
- `.vercelignore` excludes the `supabase/` folder so backend code is never shipped to Vercel.
- Frontend env vars (`VITE_*`) are configured in the Vercel dashboard, **not** in the repo.

> ⚠️ NEEDS OWNER CONFIRMATION — There is no committed Vercel config or CI workflow proving the
> deploy pipeline; "auto-deploy on push to main" is taken from prior project notes, not the repo.

### Frontend → the demo server (second target)
Vercel is **not** the only place this frontend is deployed. The same repo also builds a
standalone, DB-less demo (`npm run build:demo`, driven by `.env.demo`) that is served at
**https://incontrol.ctrlplusf.com** from a Contabo VPS, behind the Traefik proxy already
running there. `npm run deploy` ships one change to **both** targets; a change that reaches
only one of them leaves the demo showing a system that no longer exists.

Everything about that target — server, proxy, the `VITE_DEMO_STANDALONE` build flag, the
password gate and its (deliberately limited) security posture — is in
**[08-DEMO-DEPLOYMENT.md](./08-DEMO-DEPLOYMENT.md)**.

### Backend → Supabase
- Edge Functions deployed with the Supabase CLI: `supabase functions deploy <name>`.
- DB schema applied with `supabase db push` against `supabase/migrations/`.
- `invoices-ingest` and `payments-ingest` are triggered on a schedule (Postgres **pg_cron**
  → `net.http_post(...)` with an `x-hadas-key` header) — see
  `supabase/functions/invoices-ingest/README.md`. The README cites a 5-minute interval.

### One-time data import
`migration/generate.cjs` converts Airtable CSV exports (`suppliers.csv.csv`,
`invoices.csv.csv`) into `01_suppliers.sql` / `02_invoices.sql` for a single seed load;
`migration/inspect.cjs` validates the CSVs before generation.

---

## 4. Repo layout (depth ~3)

```
hadas/
├── index.html                     # RTL Hebrew shell, lang="he" dir="rtl"
├── package.json                   # deps + scripts (dev/build/lint/preview)
├── vite.config.ts                 # Vite + React plugin
├── tsconfig*.json                 # base / app / node TS configs
├── tailwind.config.js             # brand color tokens + Rubik font
├── postcss.config.js              # tailwind + autoprefixer
├── eslint.config.js               # lint rules
├── playwright.config.ts           # E2E config, baseURL localhost:5173, reads CI env
├── README.md                      # GENERIC Vite template readme (not project-specific)
├── .env / .env.local              # Supabase frontend creds (gitignored) [REDACTED]
├── .vercelignore                  # excludes supabase/ from Vercel
│
├── public/
│   ├── logo.png, store-logo.png.jpeg, favicon.*  # branding
│   ├── icons.svg
│   ├── add_tazrim_template.xlsx   # supplier-import spreadsheet template
│   └── demo/sample-invoice.html   # demo-mode sample document
│
├── src/
│   ├── main.tsx, App.tsx, App.css, index.css     # bootstrap + global styles
│   ├── components/                # screens & shared UI (see 03-FEATURES.md)
│   │   ├── Layout.tsx, Sidebar.tsx, SectionHeader.tsx
│   │   ├── Dashboard.tsx, Suppliers.tsx, SupplierDetail.tsx, SupplierLedger.tsx
│   │   ├── Invoices.tsx, DeliveryNotes.tsx, Returns.tsx, Alerts.tsx
│   │   ├── CaptureDocument.tsx, PdfPreviewModal.tsx, StatementReconciliation.tsx
│   │   ├── Login.tsx, ProtectedRoute.tsx, WaitingScreen.tsx
│   │   ├── SearchableSelect.tsx
│   │   └── employee/EmployeeDashboard.tsx, EmployeeSupplierView.tsx
│   ├── pages/                     # Payments.tsx, Settings.tsx, SystemLogs.tsx
│   ├── hooks/                     # data layer (one hook per resource) — see 03/04
│   │   ├── useAuth.ts, useSuppliers.ts, useInvoices.ts, usePayments.ts
│   │   ├── useDeliveryNotes.ts, useReturns.ts, useStatements.ts, useAlerts.ts
│   │   ├── useEmployees.ts, useAppLogo.tsx, index.ts
│   ├── lib/
│   │   ├── supabase.ts            # client factory (real OR demo stub)
│   │   ├── api.ts                 # hadas-api HTTP wrapper + captureDocument()
│   │   ├── demo.ts                # DEMO_MODE gate
│   │   ├── demoClient.ts          # stubbed Supabase client for demo
│   │   └── storage.ts             # open stored doc (signed URL or direct)
│   ├── data/
│   │   ├── mockData.ts            # fallback mock data + shared TS types
│   │   └── demoData.ts            # demo-seed.json adapter
│   └── utils/pdf/                 # pdfConfig.ts, returnPdf.ts, statementPdf.ts, index.ts
│
├── supabase/
│   ├── config.toml                # edge function enable + verify_jwt per function
│   ├── .temp/                     # CLI state (linked-project.json → project ref)
│   ├── functions/
│   │   ├── hadas-api/             # main CRUD REST API for the frontend
│   │   ├── invoices-ingest/      # Gmail→AI→Drive→DB invoice pipeline (+camera) + README.md
│   │   ├── payments-ingest/      # payment-email extractor
│   │   ├── suppliers-list/       # read-only supplier export (id/name/email)
│   │   ├── drive-migrate/         # one-off Drive folder reorg tool (token-gated)
│   │   ├── drive-probe/           # read-only Drive discovery tool (token-gated)
│   │   └── test-api/              # health check (verify_jwt = true)
│   └── migrations/                # 10 timestamped SQL migrations (see 02-DATA-MODEL.md)
│
├── migration/                     # one-time Airtable→SQL import (generate.cjs, inspect.cjs, *.csv, *.sql)
├── e2e/demo-walkthrough.spec.ts   # Playwright marketing walkthrough (demo mode)
├── tests/example.spec.ts          # template test
├── docs/                          # THIS documentation + rls-inspection.sql + xlsx template
├── demo-seed.json                 # fictitious demo dataset (suppliers/invoices/...)
├── drive_tree.mjs                 # standalone Google Drive tree-walker (OAuth)
└── may_dryrun.json, may_live.json, mayfix_dry*.json, mayfix_live.json, overflow_live.json
                                   # saved JSON reports from drive-migrate runs (May cleanup)
```

> The loose `*.json` files in the repo root (`may_*.json`, `mayfix_*.json`, `overflow_live.json`)
> are **captured output of `drive-migrate` runs**, not application data. See 07-OPEN-ISSUES.md.

---

## 5. Environment variables (names only — values `[REDACTED]`)

### Frontend (Vite, build-time, `import.meta.env`)
| Name | Used in | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts`, `src/lib/api.ts` | Supabase project URL / API base |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` | anon key for the browser client |
| `VITE_DEMO_MODE` | `src/lib/demo.ts` | enables demo mode in dev builds only |

### Edge Functions (Deno, runtime, `Deno.env.get`)
| Name | Used in | Purpose |
|---|---|---|
| `HADAS_API_KEY` | hadas-api, invoices-ingest, payments-ingest, suppliers-list | shared `x-hadas-key` secret for machine callers |
| `SUPABASE_URL` | all functions | Postgres/REST base |
| `SUPABASE_SERVICE_ROLE_KEY` | all functions | service-role DB access (bypasses RLS) |
| `HADAS_SERVICE_KEY` | fallback in hadas-api / suppliers-list | legacy service key; fallback during transition |
| `GMAIL_CLIENT_ID` | ingest + drive functions, hadas-api | Google OAuth client id |
| `GMAIL_CLIENT_SECRET` | ingest + drive functions, hadas-api | Google OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | ingest + drive functions, hadas-api | OAuth refresh token (Gmail + Drive scopes) |
| `GMAIL_USER_EMAIL` | invoices-ingest | manager email for alert notifications |
| `ANTHROPIC_API_KEY` | invoices-ingest | Claude API key |

### Tooling
| Name | Used in | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | `drive_tree.mjs` | standalone Drive scanner OAuth |
| `CI` | `playwright.config.ts` | CI-aware test config |

> `drive-migrate` and `drive-probe` are additionally gated by a **hard-coded token** passed as
> a `?key=` query parameter (not one of the env vars above). See 05-API.md and 07-OPEN-ISSUES.md.

---

## 6. Third-party integrations

| Integration | Where wired | Notes |
|---|---|---|
| **Supabase** | `src/lib/supabase.ts`, all edge functions, `supabase/` | DB, Auth, Edge Functions, Storage |
| **Vercel** | hosting (no repo config) | frontend host, auto-deploy on push |
| **Google Gmail API** | invoices-ingest, payments-ingest, hadas-api (`gmailMarkProcessed`) | reads labeled mailboxes, applies/removes labels |
| **Google Drive API v3** | invoices-ingest (upload), hadas-api (`driveTrashFile`), drive-migrate, drive-probe, `drive_tree.mjs` | source-document filing; root folder `1ocbxq5-ReY7WutAm48pKHDiaB8rBe6SM` |
| **Anthropic Claude** | invoices-ingest | `claude-haiku-4-5-20251001` (classify), `claude-sonnet-4-6` (extract); endpoint `api.anthropic.com/v1/messages`, version `2023-06-01`, `max_tokens` 8192 |
| **N8N** | *external, not in repo* | **legacy** automation still owning the production `חשבונית` Gmail label; this edge-function pipeline runs in parallel on a test label during cutover |
| **Bizibox / BizBox** | hadas-api `markBizboxExported`, payments-ingest type normalization | external accounting system; payments are stamped `bizbox_exported_at` and normalized to a Bizibox payment-type vocabulary |

See **05-API.md** for endpoint-level detail and **04-BUSINESS-LOGIC.md** for the ingest rules.
