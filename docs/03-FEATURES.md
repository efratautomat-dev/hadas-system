# 03 — Features (screen by screen)

> What the user sees, what they can do, and which components / hooks / endpoints back each
> screen. Navigation is driven by a `navStack` in `src/components/Layout.tsx` (deep-linking from
> alerts pushes state onto this stack). Hebrew labels in `backticks` are exact UI strings.
> See 04-BUSINESS-LOGIC.md for the rules and 05-API.md for the endpoints.

## Auth & roles (gate around everything)
- **Login** (`src/components/Login.tsx`): logo + email field; submits
  `supabase.auth.signInWithOtp({ email, emailRedirectTo: window.location.origin })` (magic-link /
  OTP). `origin` is dynamic so it works on Vercel and localhost.
- **useAuth** (`src/hooks/useAuth.ts`): registers `onAuthStateChange` **before** `getSession`
  (to catch the magic-link hash), then looks up the user's email in `allowed_users` for the role.
  Email not found → sign out + `unauthorizedError`. Roles: `manager` (full app) vs `employee`
  (read-only employee views). `ProtectedRoute.tsx` gates manager-only access.
- **Employee views** (`src/components/employee/EmployeeDashboard.tsx`,
  `EmployeeSupplierView.tsx`): neutral greeting, supplier search, read-only invoices / deliveries
  / returns per supplier; no edit/delete. `EmployeeSection = 'invoices'|'deliveries'|'returns'`.

## Shell: Layout / Sidebar / SectionHeader
- **Layout** (`Layout.tsx`): RTL root (`direction:'rtl'`), collapsible sidebar (256 / 200 / 72 /
  0 px by breakpoint), header greeting (hour-based: `בוקר טוב` / `צהריים` / `ערב` / `לילה`),
  search, alerts bell, back button. Owns `navStack`, alert deep-link resolution (resolves an
  invoice id on demand from `gmailMessageId`), duplicate-resolution alert cleanup, and persisted
  Alerts scroll position (`useRef`).
- **Sidebar** (`Sidebar.tsx`): 12 nav items — dashboard, capture, alerts, suppliers, ledger,
  invoices, payments, deliveries, returns, reconciliation, system-logs, settings; new-alerts
  count as a red badge; user initials avatar.
- **SectionHeader** (`SectionHeader.tsx`): RTL-safe card header — sets container `direction:'ltr'`
  so flex children order by DOM order, restores `rtl` inside each cluster. Prevents the recurring
  "RTL `justify-between` flips title to the wrong side" bug.

---

## Dashboard (`src/components/Dashboard.tsx`)
- **Sees:** hour-based greeting `… הדס`; stat cards (active suppliers, pending invoices, monthly
  payments, open returns); recent unresolved alerts.
- **Does:** click an alert / supplier / invoice to deep-link into the relevant screen.
- **Data:** `useInvoices`, `useDeliveryNotes`, `usePayments`, `useSuppliers`, `useReturns`,
  `useStatements`, `useAlerts`. Routing via `resolveAlertDestination` (from Alerts).

## Suppliers (`Suppliers.tsx` + `SupplierDetail.tsx`)
- **Sees:** searchable supplier list, 9 color-coded categories, detail panel (invoices, payments,
  computed balance).
- **Does:** create / edit supplier; view ledger / payments / invoices.
- **Data:** `useSuppliers` (balance = opening + invoices − payments, B1). Writes via
  `POST/PUT /suppliers`. Required on create: name, hp, category, contact email/phone;
  `openingBalance` optional (default 0).

## Supplier Ledger (`SupplierLedger.tsx`)
- **Sees:** supplier picker, date range, ledger table (opening balance, invoice/payment/credit
  rows, running balance), print.
- **Does:** select supplier + range; print via `statementPdf` util.
- **Data:** currently **hard-coded demo ledger entries** + `supplierOpeningBalances` (see 07).
  Running balance per B2.

## Invoices (`Invoices.tsx`)
- **Sees:** invoice list (supplier, number, date, amount, **derived** status badge A1, duplicate
  flag); filters (all / duplicates / status); detail view; document preview.
- **Does:** create / edit / delete; mark duplicate / resolve duplicate (3 paths, A3); set quality
  (`ai_confidence` → `גבוהה`/`בינונית`/`נמוכה`); mark sent-to-accountant; open supplier; preview
  document.
- **Data:** `useInvoices`, `useSuppliers`, `useAlerts`. Writes via `POST/PUT/DELETE /invoices`
  and `PUT /invoices/:id/status`. Preview prefers a Storage signed URL (`createSignedUrl(path,120)`)
  then falls back to `driveFileLink`.

## Payments (`src/pages/Payments.tsx`)
- **Sees:** payments list (supplier, amount, type, date, ref, status); supplier filter; Bizibox
  export status; add/edit modal.
- **Does:** create / edit / delete; cancel (reversible) vs delete (hard); export to Bizibox
  (stamps `bizbox_exported_at`, I). Future-dated payments show a `תשלום עתידי` warning.
- **Data:** `usePayments`, `useSuppliers`. Writes via `/payments`, `/payments/:id`,
  `/payments/:id/cancel`, `/payments/mark-bizbox-exported`. Statuses `paid`/`pending`/`cancelled`.

## Delivery Notes (`DeliveryNotes.tsx`)
- **Sees:** delivery-note list (supplier, date, amount, status); filters pending/archived/all.
- **Does:** create / edit / delete; link / unlink to an invoice. Status normalized (K1).
- **Data:** `useDeliveryNotes`, `useInvoices`, `useSuppliers`. Writes via `/delivery-notes` +
  `/link` / `/unlink`.

## Returns (`Returns.tsx`)
- **Sees:** returns list (supplier, date, amount, reason, status `אושר`/`בטיפול`/`נדחה`); detail
  with credit-note info.
- **Does:** create / edit / delete-status; set status (drives balance RPCs, B3); link to original
  invoice; record supplier credit note (number/date/amount).
- **Data:** `useReturns`, `useSuppliers`, `useInvoices`, `useEmployees`. Writes via `/returns`,
  `/returns/:id`, `/returns/:id/status`.

## Statement Reconciliation (`StatementReconciliation.tsx`)
- **Sees:** vendor statements (supplier, month, our balance, vendor balance, diff status); detail
  modal with our-rows vs vendor-rows and matched/unmatched flags.
- **Does:** open detail, update vendor balance, change status, print, view source file.
- **Data:** `useStatements`, `useSuppliers`. Statuses `matched`/`mismatch`/`pending`/
  `investigating`/`needs_review` (unknown → fallback badge). **Row-match detail is hard-coded
  demo data** (`stmtDetails`) — real matching not yet backend-driven (see 07). View file via
  `src/lib/storage.ts`. Writes via `POST /statements`, `PUT /statements/:id/resolve`.

## Alerts (`Alerts.tsx`)
- **Sees:** filterable alerts (by status new/read/resolved, by 4 type buckets), each card with
  type badge, status, date, description, actions.
- **Does:** mark read / resolved / delete; click to navigate to the related record; create a
  supplier from a `supplier_incomplete` alert (then `POST /payments/from-alert` + resolve).
- **Data:** `useAlerts` (anon client — subject to RLS, J/RLS). `ALERT_TYPE_CONFIG` maps 15+ types
  to buckets; `resolveAlertDestination` routes each type to its screen with prefill.

## Capture Document (`CaptureDocument.tsx`)
- **Sees:** document-type picker (invoice / delivery note / return / credit), camera or file
  picker, preview, upload.
- **Does:** pick type, choose an image, upload. Both "return" and "credit" map to
  `docType = return_doc`.
- **Data:** `captureDocument()` → `invoices-ingest` with `source:"camera"` (see 05 §2). Manager-
  only for now.

## Settings (`src/pages/Settings.tsx`)
- **Sees:** tabs — profile, preferences, notifications, backup, employees.
- **Does:** edit business profile; color/date prefs; notification toggles; manage employees
  (CRUD); logo via `useAppLogo`; backup tab (**stub**, see 07).
- **Data:** `useEmployees` (→ `/employees`), `useAppLogo`.

## System Logs (`src/pages/SystemLogs.tsx`)
- **Sees:** paginated `system_logs` (50/page, auto-refresh every 30 s on page 1); filters by
  source / level / date / `message_id`; color-coded levels.
- **Does:** filter, paginate, expand `context`.
- **Data:** direct `supabase.from('system_logs')` query (read).

---

## Shared components
- **PdfPreviewModal** (`PdfPreviewModal.tsx`): iframe PDF viewer; accepts a direct URL, a Drive
  link (→ `/preview` transform), or a pre-minted signed URL.
- **SearchableSelect** (`SearchableSelect.tsx`): reusable RTL dropdown with search.
- **WaitingScreen** (`WaitingScreen.tsx`): loading spinner.

## Demo & fallback behavior
- **Demo mode** (`src/lib/demo.ts`, `demoClient.ts`, `data/demoData.ts`, `demo-seed.json`):
  enabled only in dev via `VITE_DEMO_MODE=true` or `?demo=1` (hard-disabled in prod builds since
  `import.meta.env.PROD`). A stubbed Supabase client serves `demo-seed.json`; a `manager`
  `demoUser` is injected so the full UI renders without login. Used for the marketing walkthrough
  (`e2e/demo-walkthrough.spec.ts`).
- **Mock fallback (non-demo):** if Supabase read fails or returns 0 rows, `useInvoices`,
  `useSuppliers`, `usePayments`, `useAlerts` fall back to `mockData`. `useReturns`,
  `useStatements`, `useEmployees`, `useDeliveryNotes` have **no** fallback (empty + error) to
  avoid showing misleading mock data (see 07).
