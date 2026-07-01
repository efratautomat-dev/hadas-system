# 05 — API (Edge Functions)

> All endpoints are Supabase Edge Functions under `https://<project>.supabase.co/functions/v1/`.
> `verify_jwt` settings come from `supabase/config.toml`. Hebrew status/label strings are shown
> in `backticks` to preserve exact values. No secrets are printed.

## `verify_jwt` per function (`config.toml`)
| Function | `verify_jwt` | Auth accepted |
|---|---|---|
| `test-api` | **true** | Supabase JWT only |
| `hadas-api` | false | `x-hadas-key` **or** `Authorization: Bearer <jwt>` |
| `payments-ingest` | false | `x-hadas-key` or Bearer JWT |
| `invoices-ingest` | false | `x-hadas-key` or Bearer JWT (5s timeout on JWT lookup) |
| `suppliers-list` | *(not in config.toml — see note)* | `x-hadas-key` |
| `drive-migrate` | *(not in config.toml)* | `?key=` query token (hard-coded) |
| `drive-probe` | *(not in config.toml)* | `?key=` query token (hard-coded) |

> ⚠️ NEEDS OWNER CONFIRMATION — `suppliers-list`, `drive-migrate`, `drive-probe` have no entry
> in `config.toml`. Supabase defaults `verify_jwt` to **true** unless overridden, which would
> conflict with their custom auth; confirm whether they are deployed with `--no-verify-jwt`.

---

## 1. `hadas-api` — main CRUD API (`supabase/functions/hadas-api/index.ts`)

### Auth (`isAuthorized`)
Two accepted paths:
1. **`x-hadas-key`** header equal to `HADAS_API_KEY` (machine / N8N / cron).
2. **`Authorization: Bearer <jwt>`** — verified via `supabase.auth.getUser(token)`, then the
   user's email must exist in `allowed_users`.

Unauthorized → `401 {"error":"Unauthorized"}`. CORS allows `*` with headers
`authorization, x-client-info, apikey, content-type, x-hadas-key` and methods
`GET, POST, PUT, DELETE, OPTIONS`. The DB client is created with the **service-role** key
(`SUPABASE_SERVICE_ROLE_KEY`, falling back to legacy `HADAS_SERVICE_KEY`) → **bypasses RLS**.

Path is normalized by stripping `/functions/v1/hadas-api` (or `/hadas-api`) and trailing slash.

### Endpoints

#### Suppliers
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/suppliers` | `{name*, hp?, category?, contact?, email?, phone?, openingBalance?, notes?}` | `201 {id}` |
| PUT | `/suppliers/:id` | any of the create fields (camelCase) | `{success:true}` |
| DELETE | `/suppliers/:id` | — | `{success:true}` or **`409 {code:"HAS_INVOICES"}`** if any invoice references the supplier |

`openingBalance` maps to `opening_balance` (default `0`). Update is whitelist-only.

#### Invoices
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/invoices` | invoice fields (camelCase **or** snake_case); supplier required | `201 {id}` |
| PUT | `/invoices/:id` | invoice fields | `{success:true}` |
| PUT | `/invoices/:id/status` | `{status*}` | `{success:true}` |
| DELETE | `/invoices/:id` | — | `{success:true, drive, alerts}` |

- `invoiceToRow` maps a large field set both ways. snake_case is applied first, then camelCase
  **overrides** it (so an edited frontend value wins over the stale snake_case that rides along).
- `sentToAccountant: boolean` → `transferred_at` timestamp (or null).
- **DELETE order:** ① trash Drive file (`driveTrashFile` → sets `trashed:true`, recoverable;
  404 treated as success). **If Drive deletion fails, the whole delete ABORTS** (returns 500,
  nothing else removed). ② best-effort delete alerts whose `payload` references the invoice
  (`invoiceId` / `existingInvoiceId` / `duplicateInvoiceId` / `gmailMessageId`). ③ best-effort
  remove the Storage copy (`storage_url`). ④ delete the DB row. `drive` is `"deleted"` or
  `"skipped"` (manual invoices with no Drive link).

#### Payments
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/payments` | `{amount*, date*, type?, ref?, valueDate?, notes?, status?, supplier? \| supplier_id?}` | `201 {id}` |
| PUT | `/payments/:id` | same fields | `{success:true}` |
| POST | `/payments/from-alert` | `{alertId*, supplierId*}` | `{success:true, paymentId}` |
| POST | `/payments/mark-bizbox-exported` | `{ids: string[]}` | `{success:true, count}` |
| PUT | `/payments/:id/cancel` | — | `{success:true}` (sets `status='cancelled'`, `cancelled_at`) |
| DELETE | `/payments/:id` | — | `{success:true}` (hard delete) |

- `supplier` name is resolved to `supplier_id` via `resolveSupplierIdByName` (exact name match).
- `from-alert`: reads `alert.payload ?? alert.details`, inserts a payment from that payload;
  a `23505` unique violation (already ingested) is treated as success; then best-effort marks
  the Gmail message with label `תשלומים שנקלטו` and removes `UNREAD`; finally resolves the alert
  (`status='resolved', resolved=true`).
- `mark-bizbox-exported`: stamps `bizbox_exported_at = now()` only where it is currently null
  (`.is(...,null)` guard), **without** changing `status` (pending payments must keep showing
  until paid).
- **cancel** (`status='cancelled'`, reversible) is distinct from **DELETE** (row removed).

> Note: the frontend `api.ts` historically referenced `/payments/bizbox-exported`; the **router
> path is `/payments/mark-bizbox-exported`**. Confirm the client calls the correct path (07).

#### Delivery Notes
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/delivery-notes` | `{supplier_name*, note_number*, date*, amount*, amount_before_vat?, vat_amount?, line_items?, source_email?, received_at?}` | `201 {id}` |
| GET | `/delivery-notes?supplier_id=&status=` | — | array |
| PUT | `/delivery-notes/:id` | `{status?, invoiceId? \| linkedInvoiceId?, amount?, date?, supplierName?}` | `{success:true}` |
| PUT | `/delivery-notes/:id/link` | `{invoice_id*}` | `{success:true}` (`status='linked'`) |
| PUT | `/delivery-notes/:id/unlink` | — | `{success:true}` (`invoice_id=null, status='unlinked'`) |
| DELETE | `/delivery-notes/:id` | — | `{success:true}` |

- On create, the supplier is found by name or **auto-created** (name only). New note starts
  `status='unlinked'`. `notes`/`isoDate` are intentionally not persisted (no columns).

#### Returns
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/returns` | `{supplierId*, amount*, reason*, dateIso?, detail?, originalInvoiceId?, status?, employeeId?}` | `201 {id}` |
| PUT | `/returns/:id` | same fields | `{success:true}` |
| PUT | `/returns/:id/status` | `{status*}` | `{success:true}` |

- `dateIso` → `date` column; `originalInvoiceId` → `invoice_id`.
- **Balance side-effects via RPC** (status `אושר` = "approved"):
  - create with `status='אושר'` → `decrement_supplier_balance(supplierId, amount)`.
  - update non-`אושר` → `אושר` → decrement by new amount.
  - update `אושר` → non-`אושר` → `increment_supplier_balance` by the **previous** amount.
  - update `אושר` → `אושר` with changed amount → decrement by the **difference**.
  - `/status` route applies the same approve/unapprove logic on the previous amount.
- There is **no DELETE** route for returns in the router.

#### Statements (`vendor_statements`)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/statements` | `{supplierId* (or supplier_id), month?, ourBalance?, vendorBalance?, diff?, status?, uploadedAt?}` | `201 {id}` |
| PUT | `/statements/:id/resolve` | `{status?, ourBalance?, vendorBalance?, diff?}` | `{success:true}` |

- Defaults: `our_balance` 0, `diff` 0, `status` `pending`, `uploaded_at` now. `supplier_name`
  is intentionally not stored (no column; derived from `supplier_id` in the UI).

#### Alerts
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/alerts` | `{type*, message*, details?}` | `201 {id}` |

(Read / mark-read / resolve / delete of alerts happen client-side via the anon client, not here.)

#### Employees
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/employees` | — | array (ordered by name) |
| POST | `/employees` | `{name*, role?, phone?, active?}` | `201 {id}` |
| PUT | `/employees/:id` | `{name?, role?, phone?, active?}` | `{success:true}` |
| DELETE | `/employees/:id` | — | `{success:true}` |

Unmatched path/method → `404 {"error":"Not Found"}`; thrown errors → `500` with `details`.

---

## 2. `invoices-ingest` (`supabase/functions/invoices-ingest/index.ts`)

**Path:** `/functions/v1/invoices-ingest` · **verify_jwt:** false · **Auth:** `x-hadas-key`
or Bearer JWT (5-second hard timeout on the `getUser` round-trip; fails closed on timeout).

Two trigger modes:
- **Cron / manual (no body or empty JSON):** scans Gmail for the source label, processes each
  email through the full pipeline (see 04-BUSINESS-LOGIC.md for every rule).
- **Camera capture (POST):** body `{ source:"camera", docType:"invoice"|"delivery_note"|
  "return_doc", imageBase64, filename?, mimeType?, capturedBy? }`. Skips Gmail fetch, the
  logo-size gate, the type classifier and the ad-check; reuses AI extraction, Drive + Storage
  upload, dedup, DB insert and alerts. Max image 15MB; MIME sniffed from bytes; synthetic
  `gmail_message_id = "capture-<uuid>"`; `gmail_label_source = צילום ידני`.

**Response shape:** `{ processed, alerts, skipped, errors: string[], ts }`.

> The frontend wrapper `captureDocument()` (`src/lib/api.ts`) returns a higher-level
> `{ ok, outcome: 'created'|'alerted'|'skipped'|'error', docType, captureId, error? }` — confirm
> exact mapping against the live function response (the raw function returns the counters above).

Models used: `claude-haiku-4-5-20251001` (classification, ~16 tokens; statements ~256 tokens)
and `claude-sonnet-4-6` (extraction, `max_tokens = 8192`).

---

## 3. `payments-ingest` (`supabase/functions/payments-ingest/index.ts`)

**Path:** `/functions/v1/payments-ingest` · **verify_jwt:** false · **Auth:** `x-hadas-key`
or Bearer JWT. Scans the payments mailbox (`to:h8420785+payments@gmail.com`), extracts the
payment template, fuzzy-matches/creates the supplier, and inserts a `pending`, `source='email'`
payment keyed by `source_message_id` (unique). Processed mail gets label `תשלומים שנקלטו`.
**Response:** same `{ processed, alerts, skipped, errors, ts }` shape. See 04 for parsing rules.

---

## 4. `suppliers-list` (`supabase/functions/suppliers-list/index.ts`)

**Path:** `/functions/v1/suppliers-list` · **Auth:** `x-hadas-key`. Read-only.
Returns suppliers having a non-empty email: `{ count, suppliers: [{id, name, email}] }`
(ordered by name). Intended for mailing/automation. Uses service-role key (fallback
`HADAS_SERVICE_KEY`).

---

## 5. `drive-migrate` (`supabase/functions/drive-migrate/index.ts`) — operational tool

**Auth:** `?key=<hard-coded token>` query parameter (NOT Supabase auth, NOT `HADAS_API_KEY`).
**Query params:** `key`, `month` (`YYYY-MM`, default `2026-05`), `dryRun` (default `true`),
`phase` (`overflow` | `may-fix`). Copies each month's invoice source files into the correct
per-month Drive folder; classifies links as FILE vs FOLDER; marks empty folders BROKEN.
**Response:** `{ month, dryRun, total, summary{willCopy, already, broken, viaFolder}, report[] }`.
The saved `may_*.json` / `mayfix_*.json` / `overflow_live.json` in the repo root are outputs of
this endpoint. See 07-OPEN-ISSUES.md (date-range `-31` bug, hard-coded token).

---

## 6. `drive-probe` (`supabase/functions/drive-probe/index.ts`) — diagnostics

**Auth:** `?key=<hard-coded token>`. Read-only Drive inspector. **Query params:** `source`,
`target` (slash-separated folder paths), `id` (comma-separated folder IDs, to sidestep
slash-in-name ambiguity). Returns file listings per resolved folder, plus `ROOT_CHILDREN`
when no path is given (used to discover exact RTL/slash folder names).

---

## 7. `test-api` (`supabase/functions/test-api/index.ts`)

**Path:** `/functions/v1/test-api` · **verify_jwt:** true (valid JWT required).
Health check → `{ message: "Hello from Hadas API!", status: "ok" }`.

---

## Frontend client (`src/lib/api.ts`)
- Base URL: `${VITE_SUPABASE_URL}/functions/v1/hadas-api`.
- Every call fetches a fresh Supabase JWT via `supabase.auth.getSession()` and sends
  `Authorization: Bearer <token>` (the app no longer sends `x-hadas-key`).
- Exposes `api.post/put/delete(path, body)` and `captureDocument(...)` (→ `invoices-ingest`).
- In **demo mode** it short-circuits and returns a synthetic `{ id: 'demo-<ts>' }` without any
  network call.
