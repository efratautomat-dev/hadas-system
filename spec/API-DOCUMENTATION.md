# hadas-api — API Documentation (for n8n / server-to-server integration)

> Reference for wiring the Hadas backend into automations (n8n via MCP, cron, scripts).
> Source of truth: `supabase/functions/hadas-api/index.ts`. Companion: `docs/05-API.md`.

---

## 1. Base URL

The API is a Supabase Edge Function, reached at `/functions/v1/hadas-api` on the project host:

```
PROD:  https://jcwphkuwwuxvjibmvgdh.supabase.co/functions/v1/hadas-api
DEV:   https://vabfsbrrxfwgdzrbznln.supabase.co/functions/v1/hadas-api
```

The function strips the `/functions/v1/hadas-api` prefix, so routes below are relative to the base
(e.g. `POST {base}/invoices`).

---

## 2. Authentication

`authenticate()` accepts **two** identities:

1. **`x-hadas-key: <HADAS_API_KEY>`** — server-to-server (n8n / cron). Trusted → treated as
   **manager (full access)**. **This is what n8n should use.**
2. **`Authorization: Bearer <user-JWT>`** — a Supabase-authenticated user; role resolved from
   `allowed_users` by the JWT's verified email (`employee` = restricted; anything else = manager).

**Supabase gateway:** the function is deployed with JWT verification **on** (default), so the
platform ALSO requires a valid `apikey` / `Authorization: Bearer <ANON_KEY>` to reach the function.

### Headers to send from n8n (both)
```
apikey: <SUPABASE_ANON_KEY>       # satisfies the Supabase gateway
x-hadas-key: <HADAS_API_KEY>      # hadas-api trusted-manager auth
Content-Type: application/json
```

### Role gate
Employees may only `POST /returns` and `POST /delivery-notes`; every other write and **all GETs**
return `403 {"error":"Forbidden — manager role required"}`. `x-hadas-key` is always manager, so it
is unaffected.

### Request body convention
Handlers accept **camelCase** (frontend) **and** snake_case (N8N/direct); camelCase wins on conflict.

### Common responses
- `401 {"error":"Unauthorized"}` — bad/missing auth
- `403 {"error":"Forbidden — manager role required","role":"employee"}` — employee hitting a gated route
- `404 {"error":"Not Found"}` — unknown path/method
- `500 {"error":"Internal Server Error","details":"..."}`

> **IMPORTANT — this is a WRITE API.** The only GET/read endpoints are `/delivery-notes`,
> `/employees`, `/categories`. There is **no GET for invoices, suppliers, payments, returns,
> statements, or alerts** — those reads go directly to Supabase PostgREST (see §12).

---

## 3. Suppliers

### POST /suppliers — create a supplier
Runs hp-primary + fuzzy-name dedup (may return an existing match / warn).
```
POST {base}/suppliers
{ "name": "כובעי זיוה", "hp": "514237890", "category": "כובעים",
  "contact": "משה", "email": "a@b.co.il", "phone": "03-1234567" }
→ 201 { "id": "<uuid>" }
```

### PUT /suppliers/:id — update
Whitelist: `name, hp, category, contact, email, phone, opening_balance, notes, alt_names,
linked_invoices, active, needs_details`.
```
PUT {base}/suppliers/<id>     { "active": false }        → 200 { "success": true }
```

### DELETE /suppliers/:id — delete
Blocked if the supplier has invoices.
```
DELETE {base}/suppliers/<id>  → 200 { "success": true }
                              → 409 { "error": "Supplier has invoices", "code": "HAS_INVOICES" }
```

---

## 4. Invoices

### POST /invoices — create manual invoice
`supplier` (or `supplierId`/`supplier_name`/`supplier_id`) required.
```
POST {base}/invoices
{ "supplier": "כובעי זיוה", "invoiceNumber": "1234", "invoiceDate": "2026-06-30",
  "amountBeforeVat": 100, "vat": 17, "amount": 117, "category": "כובעים" }
→ 201 { "id": "<uuid>" }
→ 400 { "error": "supplier is required" }
```

### PUT /invoices/:id — update
On an `invoiceDate` change, re-files the Drive copy into the correct year/month folder and refreshes
folder links (needs Drive configured; skips gracefully otherwise).
```
PUT {base}/invoices/<id>      { "invoiceDate": "2026-06-15" }
→ 200 { "success": true, "drive": "moved" }
   // drive: "moved" | "unchanged" | "skipped_no_file" | "skipped_no_creds" | "move_failed"
```

### PUT /invoices/:id/status — set status
```
PUT {base}/invoices/<id>/status   { "status": "ממתין" }   → 200 { "success": true }
```

### DELETE /invoices/:id — delete
Trashes the Drive file, removes the Storage copy + related alerts, unflags a duplicate sibling.
```
DELETE {base}/invoices/<id>
→ 200 { "success": true, "drive": "deleted"|"skipped"|..., "alerts": N, "unflagged": bool }
```

---

## 5. Payments

```
POST   {base}/payments                          create a payment            → 201 { "id": "<uuid>" }
POST   {base}/payments/from-alert               create from an alert        { "alertId", "supplierId" }
POST   {base}/payments/mark-bizbox-exported     stamp bizbox export
PUT    {base}/payments/:id/cancel               cancel (reversible)         → 200 { "success": true }
PUT    {base}/payments/:id                      update
DELETE {base}/payments/:id                      delete
```

---

## 6. Delivery notes

### GET /delivery-notes — list (READ; supports query params)
```
GET {base}/delivery-notes           → 200 [ { ...note }, ... ]
```

### Writes
```
POST   {base}/delivery-notes                 create (employee-allowed)
PUT    {base}/delivery-notes/:id             update
DELETE {base}/delivery-notes/:id             delete
PUT    {base}/delivery-notes/:id/link        link to an invoice   { "driveFileLink"?, "note_number"? }
PUT    {base}/delivery-notes/:id/unlink      unlink
POST   {base}/delivery-notes/:id/match       auto-match an arrived note to a manual goods-receipt
```

---

## 7. Returns

```
POST {base}/returns                create (employee-allowed; amount optional / tracking-only)
                                   { "supplierId", "reason", "dateIso"?, "amount"?, "detail"?, "employeeId"? } → 201
PUT  {base}/returns/:id            update
PUT  {base}/returns/:id/status     set status  { "status": "אושר"|"בטיפול"|"נדחה" }
```
(No DELETE, no GET.)

---

## 8. Statements (vendor statement reconciliation)

```
POST {base}/statements                 create
PUT  {base}/statements/:id/resolve     resolve   { "vendorBalance"? }
POST {base}/statements/:id/reconcile    re-run reconciliation vs our ledger
```

---

## 9. Employees

```
GET    {base}/employees        list (READ)      → 200 [ {...}, ... ]
POST   {base}/employees        create
PUT    {base}/employees/:id    update
DELETE {base}/employees/:id    delete
```

---

## 10. Alerts

```
POST {base}/alerts             create only   { "type", "title", "message", "payload"? }  → 201
```
(No GET/PUT/DELETE. Reading/resolving alerts is done directly against the `alerts` table — set
`status='resolved', resolved=true` to close.)

---

## 11. Categories

```
GET    {base}/categories                 list (READ)   → 200 [ { "name", "usage_count" }, ... ]
POST   {base}/categories                 create
POST   {base}/categories/merge           merge         { "fromId", "intoId" }
PUT    {base}/categories/:id             rename        { "name" }
DELETE {base}/categories/:id?reassignTo=<name>   delete (reassign if in use)
```

---

## 12. Documents

```
POST {base}/documents/reclassify         reclassify a misfiled document into the correct table
```

---

## 13. Reading data NOT exposed by hadas-api (Supabase PostgREST)

hadas-api exposes almost no reads. For invoices/suppliers/payments/etc., query Supabase PostgREST
directly. Use the **service-role key** (server-side, bypasses RLS) or a **manager JWT**.

```
Base:    https://<ref>.supabase.co/rest/v1
Headers: apikey: <KEY>    Authorization: Bearer <KEY>

# Invoices by date range + status (role-aware view; managers see cost columns):
GET /invoices_v?invoice_date=gte.2026-06-01&invoice_date=lte.2026-06-30&status=eq.ממתין
    &select=id,supplier_name,invoice_date,total_amount,status

# Invoices by supplier:
GET /invoices_v?supplier_id=eq.<id>&select=*

# Suppliers + email (for supplier-emailing automations):
GET /suppliers_v?active=eq.true&select=id,name,email,phone
```

---

## 14. GAPS — endpoints the n8n automations need that DON'T exist yet

Planned automations and what's missing:

### 3rd of month — email all suppliers ("request documents")
- **List suppliers + emails:** MISSING in hadas-api (no `GET /suppliers`). *Workaround now:* PostgREST
  `GET /suppliers_v` (§13).
- **Send the email ("request documents"):** **MISSING — net-new.** No email-sending endpoint exists;
  Gmail send lives only inside `invoices-ingest` / `payments-ingest`, not exposed here.

### 15th of month — email the accountant a summary/package
- **Query invoices for the period:** MISSING (no `GET /invoices`). *Workaround now:* PostgREST
  `GET /invoices_v?invoice_date=gte…&lte…` (§13).
- **Build the summary/package (period totals, per-supplier):** **MISSING — net-new** reporting step.
- **Email the accountant:** **MISSING — net-new** email action.

### General — query invoices by date range / supplier / status
- MISSING as a hadas-api endpoint. *Workaround now:* PostgREST `invoices_v` filters (§13). A dedicated
  `GET /invoices` is optional (nice-to-have) since PostgREST already covers it.

### Summary of build items (prioritize after VAT)
| Gap | Type | Note |
|---|---|---|
| `GET /invoices` (date/supplier/status) | optional | PostgREST `invoices_v` covers this today |
| `GET /suppliers` (list + emails) | optional | PostgREST `suppliers_v` covers this today |
| `POST /notify/suppliers` (request-docs email) | **net-new** | no email action exists |
| `POST /notify/accountant` (monthly package + email) | **net-new** | needs aggregation + email |
| Reporting/summary endpoint (period/per-supplier totals) | **net-new** | for the 15th package |

**Bottom line:** the **read** side of every automation is doable **today** via Supabase PostgREST
(`invoices_v` / `suppliers_v`) with no hadas-api change. The genuinely missing pieces are the **two
email actions** (suppliers, accountant) and an optional **summary endpoint**.
