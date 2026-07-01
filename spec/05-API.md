# 05 — API (Target Contract)

> API documentation the owner can build external automations on (e.g. scheduled supplier emails).
> Each Edge Function endpoint is documented with **method, path, auth, request, response**. This
> restates the existing contract in `/docs/05-API.md` as the **target contract** for the rebuild.
> All endpoints are Supabase Edge Functions under `https://<project>.supabase.co/functions/v1/`.
> No secrets, keys or tokens appear here.

---

## Auth model

| Auth | How |
|---|---|
| **Machine** | `x-hadas-key: <HADAS_API_KEY>` header (from env / secret store). |
| **User** | `Authorization: Bearer <Supabase JWT>` — verified, then email must exist in `allowed_users`. |

`hadas-api` accepts either. Unauthorized → `401 {"error":"Unauthorized"}`. CORS allows `*` with
methods `GET, POST, PUT, DELETE, OPTIONS`. The DB client uses the **service-role** key →
bypasses RLS. The frontend sends the **Bearer JWT** (no `x-hadas-key`).

---

## 1. `hadas-api` — main CRUD API

Path base: `/functions/v1/hadas-api` (stripped before routing). `verify_jwt: false`.

### Suppliers
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/suppliers` | `{name*, hp?, category?, contact?, email?, phone?, openingBalance?, notes?}` | `201 {id}` |
| PUT | `/suppliers/:id` | any create field (camelCase) | `{success:true}` |
| DELETE | `/suppliers/:id` | — | `{success:true}` or `409 {code:"HAS_INVOICES"}` |

### Invoices
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/invoices` | invoice fields (camel/snake); supplier required | `201 {id}` |
| PUT | `/invoices/:id` | invoice fields | `{success:true}` |
| PUT | `/invoices/:id/status` | `{status*}` | `{success:true}` |
| DELETE | `/invoices/:id` | — | `{success:true, drive, alerts}` |

DELETE order: ① trash Drive file (abort all on failure → 500), ② best-effort delete related
alerts, ③ best-effort remove Storage copy, ④ delete DB row. `sentToAccountant: bool` →
`transferred_at`.

### Payments
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/payments` | `{amount*, date*, type?, ref?, valueDate?, notes?, status?, supplier? \| supplier_id?}` | `201 {id}` |
| PUT | `/payments/:id` | same fields | `{success:true}` |
| POST | `/payments/from-alert` | `{alertId*, supplierId*}` | `{success:true, paymentId}` |
| POST | `/payments/mark-bizbox-exported` | `{ids: string[]}` | `{success:true, count}` |
| PUT | `/payments/:id/cancel` | — | `{success:true}` (`status='cancelled'`, reversible) |
| DELETE | `/payments/:id` | — | `{success:true}` (hard delete) |

`ref` (reference) is **optional** (rebuild change — see `01-PRD.md`). `mark-bizbox-exported`
stamps `bizbox_exported_at` only where null; does **not** change status.

### Delivery Notes
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/delivery-notes` | `{supplier_name*, note_number*, date*, amount*, amount_before_vat?, vat_amount?, line_items?, source_email?, received_at?}` | `201 {id}` |
| GET | `/delivery-notes?supplier_id=&status=` | — | array |
| PUT | `/delivery-notes/:id` | `{status?, invoiceId? \| linkedInvoiceId?, amount?, date?, supplierName?}` | `{success:true}` |
| PUT | `/delivery-notes/:id/link` | `{invoice_id*}` | `{success:true}` |
| PUT | `/delivery-notes/:id/unlink` | — | `{success:true}` |
| DELETE | `/delivery-notes/:id` | — | `{success:true}` |

Supplier found by name or auto-created. Status values follow the unified taxonomy
(`02-ERD.md` / `06-RULES.md`).

### Returns
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/returns` | `{supplierId*, amount*, reason*, dateIso?, detail?, originalInvoiceId?, status?, employeeId?}` | `201 {id}` |
| PUT | `/returns/:id` | same fields | `{success:true}` |
| PUT | `/returns/:id/status` | `{status*}` | `{success:true}` |

> **Rebuild note:** the legacy `decrement/increment_supplier_balance` RPC side-effects on the
> `אושר` status do **not exist in the DB** and must be removed (see `09-IDEAS.md`). Balance is
> computed in the frontend. The manual-create form removes the **amount field** (PRD §6); the
> API still accepts `amount` (set by AI matching / arrived credit notes).

### Statements (`vendor_statements`)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/statements` | `{supplierId* (or supplier_id), month?, ourBalance?, vendorBalance?, diff?, status?, uploadedAt?}` | `201 {id}` |
| PUT | `/statements/:id/resolve` | `{status?, ourBalance?, vendorBalance?, diff?}` | `{success:true}` |

On ingest, auto-match against the ledger; on mismatch create an alert (PRD §7).

### Alerts
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/alerts` | `{type*, message*, details?}` | `201 {id}` |

Read / mark-read / resolve / delete happen client-side via the anon client.

### Employees
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/employees` | — | array (ordered by name) |
| POST | `/employees` | `{name*, role?, phone?, active?}` | `201 {id}` |
| PUT | `/employees/:id` | `{name?, role?, phone?, active?}` | `{success:true}` |
| DELETE | `/employees/:id` | — | `{success:true}` |

Unmatched → `404 {"error":"Not Found"}`; thrown errors → `500` with `details`.

---

## 2. `invoices-ingest`

Path: `/functions/v1/invoices-ingest`. `verify_jwt: false`. Auth: `x-hadas-key` or Bearer JWT.

- **Cron / manual** (empty body): scans the labelled mailbox, runs the full extraction pipeline.
- **Camera capture** (POST): `{source:"camera", docType:"invoice"|"delivery_note"|"return_doc",
  imageBase64, filename?, mimeType?, capturedBy?}`. Max 15MB.
- **Response:** `{processed, alerts, skipped, errors: string[], ts}`.

---

## 3. `payments-ingest`

Path: `/functions/v1/payments-ingest`. `verify_jwt: false`. Auth: `x-hadas-key` or Bearer JWT.
Scans the payments mailbox, extracts the payment, matches/creates the supplier, inserts a
`pending`, `source='email'` payment keyed by `source_message_id`.
**Response:** `{processed, alerts, skipped, errors, ts}`.

---

## 4. `suppliers-list`

Path: `/functions/v1/suppliers-list`. Auth: `x-hadas-key`. Read-only.
Returns suppliers with a non-empty email: `{count, suppliers:[{id, name, email}]}` (ordered by
name). **Intended for mailing/automation** — e.g. the owner's scheduled supplier emails.

---

## 5. `test-api`

Path: `/functions/v1/test-api`. `verify_jwt: true` (valid JWT required). Health check →
`{message:"Hello from Hadas API!", status:"ok"}`.

---

## Operational tooling (not part of the public contract)

`drive-migrate` and `drive-probe` are operational/diagnostic Drive tools gated by a query-param
token (not `HADAS_API_KEY`). They are not part of the automation-facing API and may be retired in
the rebuild. Their tokens and any folder IDs stay in env only.

---

## Frontend client contract

Base URL `${VITE_SUPABASE_URL}/functions/v1/hadas-api`. Every call attaches a fresh Supabase JWT
(`Authorization: Bearer`). Exposes `api.post/put/delete(path, body)` and `captureDocument(...)`
(→ `invoices-ingest`). Demo mode short-circuits to a synthetic `{id:'demo-<ts>'}`.
