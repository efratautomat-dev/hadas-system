# DATA DICTIONARY — `public` schema

Every table in the `public` schema, with each column's type and a one-line plain-language
description of what it holds. Grouped by table.

> **Sources.** Baseline is the live schema verified **2026-06-28** (`docs/02-DATA-MODEL.md` /
> `supabase/dev-schema.sql`, reconciled to `information_schema` / `pg_indexes` / `pg_proc`).
> Post-baseline additions are folded in from migrations `20260703`–`20260720` and
> `supabase/PROD-MIGRATION-CHECKLIST.sql`, and flagged **[added post-2026-06-28]** on the affected
> column/table. Where the live DB and the committed migrations disagree, the live DB wins.
>
> **Type shorthand:** `timestamptz` = `timestamp with time zone`. "Null" = whether the column is
> nullable (YES = nullable, NO = NOT NULL). Hebrew default values are preserved verbatim in
> backticks; they are matched literally in code — do not translate them.

Quick index: [suppliers](#suppliers) · [invoices](#invoices) · [payments](#payments) ·
[returns](#returns) · [delivery_notes](#delivery_notes) · [vendor_statements](#vendor_statements) ·
[alerts](#alerts) · [employees](#employees) · [allowed_users](#allowed_users) ·
[app_settings](#app_settings) · [categories](#categories) ·
[supplier_categories](#supplier_categories) · [system_logs](#system_logs) ·
[ingest_failures](#ingest_failures) · [ingest_lock](#ingest_lock) ·
[views](#masking-views) · [functions](#database-functions) · [storage](#storage)

---

## suppliers
One row per vendor the business buys from. Human-readable text PK (`SUP-001`). Referenced as a
text FK by invoices, payments, returns, delivery_notes, vendor_statements, supplier_categories.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | text | NO | **PK.** Human-readable supplier id, default `SUP-` + zero-padded sequence (`SUP-001`). |
| `name` | text | NO | Canonical supplier display name. |
| `alt_names` | text[] | YES | Alternate spellings/aliases used to match incoming documents to this card. **[added post-2026-06-28: was scalar `text`, converted to `text[]` in migration `20260720`]** |
| `email` | text | YES | Supplier contact email. |
| `phone` | text | YES | Supplier phone number. |
| `category` | text | YES | Default expense/product category for this supplier. |
| `notes` | text | YES | Free-text notes about the supplier. |
| `created_at` | timestamptz | YES | Row creation time (`now()`). |
| `linked_invoices` | integer | YES | Denormalized invoice-count counter (default `0`). |
| `opening_balance` | numeric | YES | Starting balance carried in when the supplier was first entered (default `0`). |
| `hp` | text | YES | Israeli tax id / company number (ח.פ). |
| `contact` | text | YES | Named contact person at the supplier. |
| `opening_balance_date` | date | YES | Date the opening balance is measured as of. |
| `active` | boolean | NO | Whether the supplier is active (default `true`); inactive cards are hidden from pickers. **[added post-2026-06-28]** |
| `needs_details` | boolean | NO | Flag: auto-created card missing key details, needs a human to complete it (default `false`). **[added post-2026-06-28]** |

**Indexes:** `suppliers_pkey` UNIQUE(`id`).

---

## invoices
One row per supplier invoice (or credit note — stored as a negative invoice). Text PK
(`INV-2026-001`). Display status is **computed live** in the UI; the stored `status` column is
considered unreliable.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | text | NO | **PK.** `INV-<year>-<seq>` (e.g. `INV-2026-001`). |
| `supplier_id` | text | YES | FK → `suppliers.id`. |
| `invoice_number` | text | YES | Supplier's own invoice number. |
| `invoice_date` | date | YES | Invoice date (day-first source, stored as ISO date). |
| `supplier_name` | text | YES | Denormalized supplier name as it appeared on the document. |
| `total_amount` | numeric | YES | Gross total incl. VAT (negative for credit notes). |
| `amount_before_vat` | numeric | YES | Net amount before VAT. |
| `vat_amount` | numeric | YES | VAT portion (Israeli VAT — 18% since 1.1.2025, 17% before; rate by invoice date, see `06-RULES.md §3`). |
| `category` | text | YES | Expense/product category assigned to the invoice. |
| `line_items` | **text** | YES | Extracted line items as text (note: **text**, not jsonb — differs from delivery_notes). |
| `status` | text | YES | Stored status, default `ממתין` ("waiting"). **Display status is derived, not read from here.** |
| `invoice_type` | text | YES | Document sub-type (e.g. invoice vs credit note). |
| `external_link` | text | YES | External reference URL. |
| `drive_file_link` | text | YES | Google Drive link to the source file. |
| `drive_folder_link` | text | YES | Google Drive link to the containing folder. |
| `message_link` | text | YES | Deep-link back to the source Gmail message. |
| `sender_name` | text | YES | Display name of the email sender. |
| `email_sender` | text | YES | Email address the document arrived from. |
| `received_at` | timestamptz | YES | When the source email was received. |
| `ai_confidence` | text | YES | Extractor's self-reported confidence. |
| `ai_missing_fields` | text | YES | Fields the extractor could not populate. |
| `is_duplicate` | boolean | YES | Flagged as a duplicate of another invoice (default `false`). |
| `has_error` | boolean | YES | Ingest/extraction error flag (default `false`). |
| `error_reason` | text | YES | Human-readable error explanation. |
| `execution_log_url` | text | YES | Link to the ingest run log. |
| `html_content` | text | YES | Raw HTML body of the source email, if any. |
| `transferred_at` | timestamptz | YES | Set when the invoice is "sent to the accountant". |
| `created_at` | timestamptz | YES | Row creation time (`now()`). |
| `partial_return` | boolean | YES | Marks an invoice that had a partial return (default `false`). |
| `gmail_message_id` | text | YES | Gmail message id — idempotency key for ingest dedup. |
| `email_subject` | text | YES | Subject line of the source email. |
| `gmail_label_source` | text | YES | Gmail label the doc came from; `צילום ידני` for in-app camera capture. |
| `month_folder_link` | text | YES | Drive link to the month folder the file was filed into. |
| `storage_url` | text | YES | In-bucket storage path (not a URL). |

**Indexes:**
- `invoices_pkey` UNIQUE(`id`)
- `idx_invoices_supplier` (`supplier_id`)
- `idx_invoices_date` (`invoice_date`)
- `idx_invoices_duplicate` (`is_duplicate`) **WHERE** `is_duplicate = true` (partial)
- `invoices_msg_invnum_supplier_uidx` **UNIQUE**(`gmail_message_id, invoice_number, supplier_id`)
  **WHERE** all three are present and `invoice_number <> ''` — lets one email carry several
  numbered invoices (credit note + original); numberless docs are deduped in app code.

---

## payments
One row per payment made to a supplier. Text PK (`PAY-0001`). Some rows are ingested from email.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | text | NO | **PK.** `PAY-<seq>` (e.g. `PAY-0001`). |
| `supplier_id` | text | YES | FK → `suppliers.id`. |
| `amount` | numeric | NO | Payment amount. |
| `payment_type` | text | NO | Payment method (transfer, cheque, etc.). |
| `payment_date` | date | NO | Date the payment was made. |
| `value_date` | date | YES | Bank value date. |
| `reference` | text | YES | Cheque/transfer reference number. |
| `notes` | text | YES | Free-text notes. |
| `status` | text | YES | Payment status, default `פעיל` ("active"); the app also writes a `cancelled` state. |
| `cancelled_at` | timestamptz | YES | When the payment was cancelled. |
| `created_by` | text | YES | Who recorded the payment. |
| `created_at` | timestamptz | YES | Row creation time (`now()`). |
| `source` | text | YES | Origin of the row; `email` for ingested payments. |
| `email_received_at` | timestamptz | YES | When the source email was received. |
| `source_message_id` | text | YES | Gmail message id — idempotency key. |
| `bizbox_exported_at` | timestamptz | YES | Timestamp the payment was exported to Bizibox. |

**Indexes:**
- `payments_pkey` UNIQUE(`id`)
- `payments_source_message_id_uidx` **UNIQUE**(`source_message_id`) **WHERE** not null
- `idx_payments_date` (`payment_date`)
- `idx_payments_supplier` (`supplier_id`)

---

## returns
One row per goods return / credit request to a supplier. Text PK (`RET-0001`). A supplier credit
note can later close a return.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | text | NO | **PK.** `RET-<seq>` (e.g. `RET-0001`). |
| `supplier_id` | text | YES | FK → `suppliers.id`. |
| `amount` | numeric | NO | Returned amount (positive). |
| `reason` | text | NO | Reason for the return. |
| `invoice_id` | text | YES | The original invoice the return is against. |
| `date` | date | YES | Return date (default `CURRENT_DATE`). |
| `status` | text | YES | Return status, default `בטיפול` ("in progress"). |
| `created_by` | text | YES | Who recorded the return. |
| `created_at` | timestamptz | YES | Row creation time (`now()`). |
| `detail` | text | YES | Extended free-text detail. |
| `employee_id` | uuid | YES | FK → `employees.id` (who handled it). |
| `drive_file_link` | text | YES | Drive link to the supplier's credit-note document. |
| `gmail_message_id` | text | YES | Gmail message id of the closing credit note. |
| `email_subject` | text | YES | Subject of the source email. |
| `message_link` | text | YES | Deep-link to the source Gmail message. |
| `supplier_credit_note_number` | text | YES | Credit-note number issued by the supplier when the return is closed. |
| `supplier_credit_note_date` | date | YES | Date of that credit note. |
| `supplier_credit_note_amount` | numeric | YES | Amount of that credit note. |
| `storage_url` | text | YES | In-bucket storage path of the credit-note doc. |

**Indexes:** `returns_pkey` UNIQUE(`id`); `idx_returns_supplier` (`supplier_id`).

> **Status vocabulary mismatch:** the UI uses `אושר` / `בטיפול` / `נדחה`; the ingest path also
> closes returns with `הסתיים`. Both are live.

---

## delivery_notes
One row per goods delivery note (תעודת משלוח) — arrived by email or entered manually as a goods
receipt. Text PK (`DN-0001`). This is the core table for the future goods-tracking feature — see
`spec/GOODS-TRACKING.md`.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | text | NO | **PK.** `DN-<seq>` (e.g. `DN-0001`). |
| `supplier_id` | text | YES | FK → `suppliers.id`. |
| `note_number` | text | NO | Supplier's delivery-note number (empty string for manual receipts). |
| `date` | date | NO | Delivery-note date. |
| `amount` | numeric | YES | Gross amount on the note. |
| `status` | text | YES | Lifecycle status, default `pending`; values seen: `pending` / `pending_match` / `unlinked` / `linked` / `archived` (UI normalizes to pending/archived). |
| `invoice_id` | text | YES | The invoice this note is linked to (the goods↔invoice link). |
| `created_at` | timestamptz | YES | Row creation time (`now()`). |
| `archived_at` | timestamptz | YES | When the note was archived. |
| `amount_before_vat` | numeric | YES | Net amount before VAT. |
| `vat_amount` | numeric | YES | VAT portion. |
| `line_items` | **jsonb** | YES | Extracted line items as JSONB (note: **jsonb**, unlike invoices.line_items which is text). |
| `supplier_name` | text | YES | Denormalized supplier name from the document. |
| `source_email` | text | YES | Email address the note arrived from. |
| `received_at` | timestamptz | YES | When the source email was received. |
| `drive_file_link` | text | YES | Drive link to the source file; also the "soft-link" target used in manual↔arrived matching. |
| `gmail_message_id` | text | YES | Gmail message id — presence means the row arrived by email (vs manual). |
| `email_subject` | text | YES | Subject of the source email. |
| `message_link` | text | YES | Deep-link to the source Gmail message. |
| `storage_url` | text | YES | In-bucket storage path. |

**Indexes:** `delivery_notes_pkey` UNIQUE(`id`); `idx_delivery_notes_status` (`status`).

---

## vendor_statements
One row per monthly supplier statement (כרטסת), used to reconcile the vendor's balance against
ours. Text PK (`STMT-0001`).

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | text | NO | **PK.** `STMT-<seq>` (e.g. `STMT-0001`). |
| `supplier_id` | text | YES | FK → `suppliers.id`. |
| `month` | text | NO | Statement month as `YYYY-MM`. |
| `vendor_balance` | numeric | NO | Balance the supplier claims. |
| `our_balance` | numeric | YES | Balance we computed on our side. |
| `diff` | numeric | YES | Difference between the two balances. |
| `status` | text | YES | Reconciliation status, default `pending` (English); app also uses `matched` / `mismatch` / `investigating` / `needs_review`. |
| `uploaded_at` | timestamptz | YES | When the statement was uploaded (`now()`). |
| `resolved_at` | timestamptz | YES | When the mismatch was resolved. |
| `resolution_notes` | text | YES | Notes on how a mismatch was resolved. |
| `storage_url` | text | YES | In-bucket storage path. |
| `drive_file_link` | text | YES | Drive link to the statement file. |

**Indexes:**
- `vendor_statements_pkey` UNIQUE(`id`)
- `idx_statements_supplier` (`supplier_id`)
- `idx_statements_status` (`status`) **WHERE** `status = 'mismatch'` (partial)

---

## alerts
One row per system alert/notification surfaced in the Alerts screen. UUID PK.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | NO | **PK** (`gen_random_uuid()`). |
| `type` | text | NO | Alert type/category discriminator. |
| `title` | text | NO | Short alert title. |
| `message` | text | YES | Longer alert body. |
| `severity` | text | NO | `info` / warning / error (default `info`). |
| `status` | text | NO | Lifecycle status, default `unread`. |
| `context_data` | jsonb | YES | Arbitrary structured context for rendering. |
| `related_entity` | text | YES | Entity type the alert points at (e.g. invoice, payment). |
| `related_id` | text | YES | Id of that related entity. |
| `action_url` | text | YES | In-app link to act on the alert. |
| `created_at` | timestamptz | NO | Creation time (`now()`). |
| `read_at` | timestamptz | YES | When the alert was marked read. |
| `resolved_at` | timestamptz | YES | When the alert was resolved. |
| `payload` | jsonb | YES | Structured routing data (e.g. for one-click payment creation). |

**Indexes:** `alerts_pkey` UNIQUE(`id`); `idx_alerts_created_at` (`created_at DESC`);
`idx_alerts_status` (`status`); `idx_alerts_type` (`type`).

---

## employees
One row per staff member. UUID PK.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | NO | **PK** (`gen_random_uuid()`). |
| `name` | text | NO | Employee name. |
| `role` | text | YES | Employee's job role/title. |
| `phone` | text | YES | Phone number. |
| `active` | boolean | NO | Whether the employee is active (default `true`). |
| `created_at` | timestamptz | NO | Creation time (`now()`). |

**Indexes:** `employees_pkey` UNIQUE(`id`).

---

## allowed_users
Authorization source of truth: which emails may use the app and at what role. Email PK.

| Column | Type | Null | Description |
|---|---|---|---|
| `email` | text | NO | **PK.** Authorized user email. |
| `role` | text | NO | `manager` or `employee`. |
| `created_at` | timestamptz | NO | Creation time (`now()`). |

**Indexes:** `allowed_users_pkey` UNIQUE(`email`).

---

## app_settings
Key/value store for app configuration. Key PK.

| Column | Type | Null | Description |
|---|---|---|---|
| `key` | text | NO | **PK.** Setting name. |
| `value` | text | YES | Setting value (string-encoded). |
| `updated_at` | timestamptz | NO | Last update time (`now()`). |

**Indexes:** `app_settings_pkey` UNIQUE(`key`).

---

## categories
Free-form tag pool of expense/product categories, learned from usage. UUID PK. Seeded with ~10
default Hebrew categories.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | NO | **PK** (`gen_random_uuid()`). |
| `name` | text | NO | Category name (**UNIQUE**). |
| `usage_count` | integer | YES | How many times the category has been used (default `0`). |
| `created_at` | timestamptz | YES | Creation time (`now()`). |

**Indexes:** `categories_pkey` UNIQUE(`id`); `categories_name_key` UNIQUE(`name`).
**Seeded names:** `ספקים ביגוד`, `ספקים כיסויי ראש ומטפחות`, `ספקים בגדי ים`, `ספקים שונות`,
`הוצאות ניהול`, `הוצאות משרד`, `תשלומי מעמ`, `תשלומי מס הכנסה`, `משכורות`, `שונות`.

---

## supplier_categories
Per-supplier category history, used to suggest a default category to the AI extractor. UUID PK.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | NO | **PK** (`gen_random_uuid()`). |
| `supplier_id` | text | NO | FK → `suppliers.id` (ON DELETE CASCADE). |
| `category` | text | NO | A category this supplier has been tagged with. |
| `usage_count` | integer | YES | Times this (supplier, category) pair was used (default `1`). |
| `last_used_at` | timestamptz | YES | When the pair was last used (`now()`). |

**Indexes:** `supplier_categories_pkey` UNIQUE(`id`);
`supplier_categories_supplier_id_category_key` **UNIQUE**(`supplier_id, category`).

---

## system_logs
Developer-facing diagnostic log (SystemLogs page). Bigint PK.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | bigint | NO | **PK** (`nextval('system_logs_id_seq')`). |
| `timestamp` | timestamptz | YES | Log time (`now()`). |
| `source` | text | NO | Emitting component (e.g. `invoices-ingest`, `payments-ingest`). |
| `level` | text | NO | Severity — CHECK in (`debug`, `info`, `warn`, `error`). |
| `message` | text | NO | Log message. |
| `context` | jsonb | YES | Structured context payload. |
| `message_id` | text | YES | Correlates log rows belonging to one email. |

**Indexes:** `system_logs_pkey` UNIQUE(`id`); `system_logs_timestamp_idx` (`timestamp DESC`);
`system_logs_source_level_idx` (`source, level`).

---

## ingest_failures
Cost guard: tracks repeated extraction failures per email so ingest stops retrying. Gmail-message
PK. RLS enabled with no policy → service-role only.

| Column | Type | Null | Description |
|---|---|---|---|
| `gmail_message_id` | text | NO | **PK.** The email that keeps failing. |
| `attempts` | integer | NO | Number of failed attempts (default `0`; cap `MAX_INGEST_ATTEMPTS = 2`). |
| `last_error` | text | YES | Most recent error message. |
| `last_attempt_at` | timestamptz | NO | Time of the last attempt (`now()`). |

**Indexes:** `ingest_failures_pkey` UNIQUE(`gmail_message_id`).

---

## ingest_lock
**[added post-2026-06-28 — migration `20260719`]** Single-row advisory lease that serializes
`invoices-ingest` runs so overlapping runs don't double-process an email. Singleton (`id = 1`).

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | smallint | NO | **PK.** Always `1` (CHECK `id = 1` — singleton row). |
| `holder` | text | YES | Identifier of the run currently holding the lease (null = free). |
| `locked_at` | timestamptz | NO | When the lease was claimed (`epoch` = free); a 10-minute TTL lets a crashed run self-heal. |

**Indexes:** `ingest_lock_pkey` UNIQUE(`id`). RLS: service-role only.

---

## Masking views
**[added post-2026-06-28 — migration `20260708`]** Role-aware views that hide financial columns
from employees. Frontend **reads** go through these `*_v` views; base-table SELECT is REVOKEd from
`anon`/`authenticated` so a direct PostgREST call can't bypass the mask. Cost columns return `NULL`
unless `current_user_role() = 'manager'`; every other column passes through unchanged. Each view
also re-applies the "allowed users" gate in its `WHERE` (`current_user_role() IS NOT NULL`).

| View | Wraps | Manager-only (else NULL) columns |
|---|---|---|
| `invoices_v` | `invoices` | `total_amount`, `amount_before_vat`, `vat_amount` |
| `suppliers_v` | `suppliers` | `opening_balance`, `opening_balance_date` |
| `delivery_notes_v` | `delivery_notes` | `amount`, `amount_before_vat`, `vat_amount` |

> ⚠️ When a new column is added to a masked base table, it must also be added to the matching view
> or clients won't see it.

---

## Database functions
Schema `public`, from `pg_proc`.

| Function | Returns | Kind | Purpose |
|---|---|---|---|
| `get_my_role()` | text | `sql`, STABLE, SECURITY DEFINER | Role of the caller by JWT email (`allowed_users`). |
| `current_user_role()` | text | `sql`, STABLE, SECURITY DEFINER, `search_path=public` | Role of the caller by `auth.email()`; used throughout RLS + masking views. |
| `merge_suppliers(p_from text, p_into text)` | jsonb | `plpgsql`, SECURITY DEFINER | **[added post-2026-06-28 — migration `20260720`]** Atomically merges one supplier card into another: re-points every FK table, folds the removed name into the kept card's `alt_names`, carries `hp` when missing, deletes the removed card; returns per-table moved counts. EXECUTE granted to `service_role` only (hadas-api enforces the manager gate). |

> **Note:** there are **no** balance-calculation RPCs. Supplier balances are computed in the
> frontend (`opening_balance + Σ invoices − Σ payments`, cancelled excluded). Legacy
> `increment_supplier_balance` / `decrement_supplier_balance` RPC calls in `hadas-api` reference
> functions that do **not** exist in the DB and no-op.

---

## Storage
- Private bucket **`documents`** (`public = false`).
- Object path convention: `{docType}/{YYYY}/{MM}/{filename}` (e.g. `invoices/2026/05/foo.pdf`).
- The various `storage_url` columns hold the **in-bucket path**, not a URL. Viewers mint a
  short-lived signed URL (`createSignedUrl(path, 120)`, 120 s).
