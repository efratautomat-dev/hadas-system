# 02 — Data Model

> **SCHEMA SOURCE: live DB verified on 2026-06-28 via information_schema / pg_indexes / pg_proc
> (read-only).**
> Every table, column, type, nullability, default and index below is reconciled to the live
> `public` schema. Where the live schema diverges from the committed migrations, **the live DB
> wins** and the difference is noted. Hebrew default values are preserved verbatim in `backticks`.

Type shorthand: `timestamptz` = `timestamp with time zone`. "Null" column = `is_nullable`
(`YES` → nullable, `NO` → NOT NULL).

### Migration history (context only — live schema above is authoritative)
| File | Added |
|---|---|
| `20260513000000_create_alerts_table.sql` | `alerts` (live shape has since evolved — see note) |
| `20260519000000_payments_email_ingest.sql` | `payments` ingest cols; `alerts` `title/payload/status` |
| `20260520000000_invoices_ingest.sql` | `categories`, `supplier_categories`, `system_logs`; `invoices` ingest cols; seed categories |
| `20260525000000_non_invoice_ingest_columns.sql` | `delivery_notes` + `returns` ingest cols |
| `20260527000000_returns_credit_note_matching.sql` | `returns` credit-note cols |
| `20260528000000_storage_documents.sql` | `storage_url` cols; private `documents` bucket |
| `20260604120000_employee_rls.sql` | `current_user_role()` + RLS policies |
| `20260605000000_documents_read_policy.sql` | storage.objects read policy |
| `20260614000000_invoices_composite_msgid_index.sql` | composite unique index on invoices |
| `20260618000000_ingest_failures.sql` | `ingest_failures` |
| `20260802000000_vendor_statements_sender_and_match_method.sql` | `vendor_statements.email_sender` + `match_method` (+ CHECK) |
| `20260802010000_returns_email_sender.sql` | `returns.email_sender` |

(Migrations between `20260618000000` and `20260802000000` are omitted here — RLS,
storage and RPC changes that add no columns; see `supabase/migrations/` for the full list.)

Tables that exist only outside the migrations (`suppliers`, `employees`, `allowed_users`,
`app_settings`, and the base columns of `invoices`/`payments`/`returns`/`delivery_notes`/
`vendor_statements`) are now fully documented from the live schema below.

---

## Tables

### `suppliers`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NO | `'SUP-' || lpad(nextval('suppliers_seq'),3,'0')` — **PK** |
| `name` | text | NO | |
| `alt_names` | text | YES | |
| `email` | text | YES | |
| `phone` | text | YES | |
| `category` | text | YES | |
| `notes` | text | YES | |
| `created_at` | timestamptz | YES | `now()` |
| `linked_invoices` | integer | YES | `0` |
| `opening_balance` | numeric | YES | `0` |
| `hp` | text | YES | tax id (ח.פ) |
| `contact` | text | YES | |
| `opening_balance_date` | date | YES | |

Indexes: `suppliers_pkey` UNIQUE(`id`).
Referenced as a text FK by invoices, payments, returns, delivery_notes, vendor_statements,
supplier_categories. Note `id` is a human-readable text key (`SUP-001`).

---

### `invoices`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NO | `'INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoices_seq'),3,'0')` — **PK** |
| `supplier_id` | text | YES | FK→suppliers |
| `invoice_number` | text | YES | |
| `invoice_date` | date | YES | |
| `supplier_name` | text | YES | |
| `total_amount` | numeric | YES | |
| `amount_before_vat` | numeric | YES | |
| `vat_amount` | numeric | YES | |
| `category` | text | YES | |
| `line_items` | **text** | YES | (note: **text**, not jsonb — see inconsistencies) |
| `status` | text | YES | `ממתין` |
| `invoice_type` | text | YES | |
| `external_link` | text | YES | |
| `drive_file_link` | text | YES | |
| `drive_folder_link` | text | YES | |
| `message_link` | text | YES | |
| `sender_name` | text | YES | |
| `email_sender` | text | YES | |
| `received_at` | timestamptz | YES | |
| `ai_confidence` | text | YES | |
| `ai_missing_fields` | text | YES | |
| `is_duplicate` | boolean | YES | `false` |
| `has_error` | boolean | YES | `false` |
| `error_reason` | text | YES | |
| `execution_log_url` | text | YES | |
| `html_content` | text | YES | |
| `transferred_at` | timestamptz | YES | set when "sent to accountant" |
| `created_at` | timestamptz | YES | `now()` |
| `partial_return` | boolean | YES | `false` |
| `gmail_message_id` | text | YES | idempotency key |
| `email_subject` | text | YES | |
| `gmail_label_source` | text | YES | `צילום ידני` for camera capture |
| `month_folder_link` | text | YES | |
| `storage_url` | text | YES | in-bucket path, not a URL |

Indexes:
- `invoices_pkey` UNIQUE(`id`)
- `idx_invoices_supplier` (`supplier_id`)
- `idx_invoices_date` (`invoice_date`)
- `idx_invoices_duplicate` (`is_duplicate`) **WHERE** `is_duplicate = true` (partial)
- `invoices_msg_invnum_supplier_uidx` **UNIQUE**(`gmail_message_id, invoice_number, supplier_id`)
  **WHERE** `gmail_message_id IS NOT NULL AND invoice_number IS NOT NULL AND invoice_number <> ''
  AND supplier_id IS NOT NULL` — lets one email carry several invoices with different numbers
  (credit note + original). Numberless docs (`invoice_number=''`) are excluded and deduped in app
  code by `(gmail_message_id, storage_url)`. (See 04 §A4.)

---

### `payments`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NO | `'PAY-' || lpad(nextval('payments_seq'),4,'0')` — **PK** |
| `supplier_id` | text | YES | FK→suppliers |
| `amount` | numeric | NO | |
| `payment_type` | text | NO | |
| `payment_date` | date | NO | |
| `value_date` | date | YES | |
| `reference` | text | YES | |
| `notes` | text | YES | |
| `status` | text | YES | `פעיל` |
| `cancelled_at` | timestamptz | YES | |
| `created_by` | text | YES | |
| `created_at` | timestamptz | YES | `now()` |
| `source` | text | YES | `email` for ingest |
| `email_received_at` | timestamptz | YES | |
| `source_message_id` | text | YES | Gmail id — idempotency |
| `bizbox_exported_at` | timestamptz | YES | Bizibox export stamp |

Indexes:
- `payments_pkey` UNIQUE(`id`)
- `payments_source_message_id_uidx` **UNIQUE**(`source_message_id`) **WHERE** not null
- `idx_payments_date` (`payment_date`)
- `idx_payments_supplier` (`supplier_id`)

> The app treats `cancelled` as a distinct status value (`cancelPayment` writes it), even though
> the column default is `פעיל`. Confirm the live status vocabulary in use.

---

### `returns`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NO | `'RET-' || lpad(nextval('returns_seq'),4,'0')` — **PK** |
| `supplier_id` | text | YES | FK→suppliers |
| `amount` | numeric | NO | |
| `reason` | text | NO | |
| `invoice_id` | text | YES | original invoice |
| `date` | date | YES | `CURRENT_DATE` |
| `status` | text | YES | `בטיפול` |
| `created_by` | text | YES | |
| `created_at` | timestamptz | YES | `now()` |
| `detail` | text | YES | |
| `employee_id` | **uuid** | YES | FK→employees |
| `drive_file_link` | text | YES | |
| `gmail_message_id` | text | YES | |
| `email_subject` | text | YES | |
| `message_link` | text | YES | |
| `supplier_credit_note_number` | text | YES | set when a credit note closes the return |
| `supplier_credit_note_date` | date | YES | |
| `supplier_credit_note_amount` | numeric | YES | |
| `storage_url` | text | YES | |
| `email_sender` | text | YES | From address of the credit-note email that closed the return |

Indexes: `returns_pkey` UNIQUE(`id`); `idx_returns_supplier` (`supplier_id`).

`email_sender` (migration `20260802010000`) completes the set: every document type that
arrives by email now keeps its sending address on the row — `invoices.email_sender`,
`delivery_notes.source_email`, `vendor_statements.email_sender` and now this one. It is
written by `invoices-ingest` on the **UPDATE** that closes a matched return (the
credit-note path never inserts a `returns` row), and is whitelisted in `hadas-api`'s
`returnToRow` so a hand correction can carry it too. An **unmatched** credit note has no
return row at all, so its address stays in the `unmatched_credit_note` alert payload
(`senderEmail`) — that is the only place it can live.
UI status vocabulary: `אושר` / `בטיפול` / `נדחה`; the ingest path also uses `הסתיים` ("completed").
(Vocabulary mismatch flagged in 07.)

---

### `delivery_notes`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NO | `'DN-' || lpad(nextval('delivery_notes_seq'),4,'0')` — **PK** |
| `supplier_id` | text | YES | FK→suppliers |
| `note_number` | text | NO | |
| `date` | date | NO | |
| `amount` | numeric | YES | |
| `status` | text | YES | `pending` (English; UI normalizes `linked`/`unlinked`/`archived`) |
| `invoice_id` | text | YES | linked invoice |
| `created_at` | timestamptz | YES | `now()` |
| `archived_at` | timestamptz | YES | |
| `amount_before_vat` | numeric | YES | |
| `vat_amount` | numeric | YES | |
| `line_items` | **jsonb** | YES | (note: **jsonb**, unlike invoices.line_items) |
| `supplier_name` | text | YES | |
| `source_email` | text | YES | |
| `received_at` | timestamptz | YES | |
| `drive_file_link` | text | YES | |
| `gmail_message_id` | text | YES | |
| `email_subject` | text | YES | |
| `message_link` | text | YES | |
| `storage_url` | text | YES | |

Indexes: `delivery_notes_pkey` UNIQUE(`id`); `idx_delivery_notes_status` (`status`).

---

### `vendor_statements`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | NO | `'STMT-' || lpad(nextval('statements_seq'),4,'0')` — **PK** |
| `supplier_id` | text | YES | FK→suppliers |
| `month` | text | NO | `YYYY-MM` |
| `vendor_balance` | numeric | NO | |
| `our_balance` | numeric | YES | |
| `diff` | numeric | YES | |
| `status` | text | YES | `pending` (English — see inconsistencies) |
| `uploaded_at` | timestamptz | YES | `now()` |
| `resolved_at` | timestamptz | YES | |
| `resolution_notes` | text | YES | |
| `storage_url` | text | YES | |
| `drive_file_link` | text | YES | |
| `email_sender` | text | YES | From address of the email it arrived on |
| `match_method` | text | YES | how the supplier was resolved — CHECK `hp`/`name`/`email`/`invoice_email`/`manual`/`none`, NULL allowed |

Indexes:
- `vendor_statements_pkey` UNIQUE(`id`)
- `idx_statements_supplier` (`supplier_id`)
- `idx_statements_status` (`status`) **WHERE** `status = 'mismatch'` (partial)

App status vocabulary: `matched` / `mismatch` / `pending` / `investigating` / `needs_review`.

---

### `alerts`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` — **PK** |
| `type` | text | NO | |
| `title` | text | NO | |
| `message` | text | YES | |
| `severity` | text | NO | `'info'` |
| `status` | text | NO | `'unread'` |
| `context_data` | jsonb | YES | |
| `related_entity` | text | YES | |
| `related_id` | text | YES | |
| `action_url` | text | YES | |
| `created_at` | timestamptz | NO | `now()` |
| `read_at` | timestamptz | YES | |
| `resolved_at` | timestamptz | YES | |
| `payload` | jsonb | YES | structured routing data |

Indexes: `alerts_pkey` UNIQUE(`id`); `idx_alerts_created_at` (`created_at DESC`);
`idx_alerts_status` (`status`); `idx_alerts_type` (`type`).

> **Drift note:** the live table no longer has the early-migration `details` (jsonb) or
> `resolved` (boolean) columns; it uses `payload` + `context_data` and `status`/`read_at`/
> `resolved_at` instead. Code that reads `alert.details` (e.g. `hadas-api` `createPaymentFromAlert`
> reads `alert.payload ?? alert.details`) tolerates the absence.

---

### `employees`
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` — **PK** |
| `name` | text | NO | |
| `role` | text | YES | |
| `phone` | text | YES | |
| `active` | boolean | NO | `true` |
| `created_at` | timestamptz | NO | `now()` |

Indexes: `employees_pkey` UNIQUE(`id`).

---

### `allowed_users` — authorization source of truth
| Column | Type | Null | Default |
|---|---|---|---|
| `email` | text | NO | **PK** |
| `role` | text | NO | `manager` / `employee` |
| `created_at` | timestamptz | NO | `now()` |

Indexes: `allowed_users_pkey` UNIQUE(`email`).

---

### `app_settings` — key/value app configuration
| Column | Type | Null | Default |
|---|---|---|---|
| `key` | text | NO | **PK** |
| `value` | text | YES | |
| `updated_at` | timestamptz | NO | `now()` |

Indexes: `app_settings_pkey` UNIQUE(`key`).

---

### `categories` — free-form tag pool (learned from usage)
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` — **PK** |
| `name` | text | NO | UNIQUE |
| `usage_count` | integer | YES | `0` |
| `created_at` | timestamptz | YES | `now()` |

Indexes: `categories_pkey` UNIQUE(`id`); `categories_name_key` UNIQUE(`name`).
Seeded names (migration `20260520`): `ספקים ביגוד`, `ספקים כיסויי ראש ומטפחות`, `ספקים בגדי ים`,
`ספקים שונות`, `הוצאות ניהול`, `הוצאות משרד`, `תשלומי מעמ`, `תשלומי מס הכנסה`, `משכורות`, `שונות`.

---

### `supplier_categories` — per-supplier category history → AI hint
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` — **PK** |
| `supplier_id` | text | NO | FK→suppliers (ON DELETE CASCADE per migration) |
| `category` | text | NO | |
| `usage_count` | integer | YES | `1` |
| `last_used_at` | timestamptz | YES | `now()` |

Indexes: `supplier_categories_pkey` UNIQUE(`id`);
`supplier_categories_supplier_id_category_key` **UNIQUE**(`supplier_id, category`).

---

### `system_logs` — developer diagnostics (SystemLogs page)
| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | NO | `nextval('system_logs_id_seq')` — **PK** |
| `timestamp` | timestamptz | YES | `now()` |
| `source` | text | NO | e.g. `invoices-ingest`, `payments-ingest` |
| `level` | text | NO | migration defines CHECK in (`debug`,`info`,`warn`,`error`) |
| `message` | text | NO | |
| `context` | jsonb | YES | |
| `message_id` | text | YES | correlates rows to one email |

Indexes: `system_logs_pkey` UNIQUE(`id`); `system_logs_timestamp_idx` (`timestamp DESC`);
`system_logs_source_level_idx` (`source, level`).

---

### `ingest_failures` — cost guard for repeated extraction failures
| Column | Type | Null | Default |
|---|---|---|---|
| `gmail_message_id` | text | NO | **PK** |
| `attempts` | integer | NO | `0` (cap `MAX_INGEST_ATTEMPTS = 2`) |
| `last_error` | text | YES | |
| `last_attempt_at` | timestamptz | NO | `now()` |

Indexes: `ingest_failures_pkey` UNIQUE(`gmail_message_id`). RLS enabled, no policies → service-role only.

---

## Storage
- Private bucket **`documents`** (`public = false`), created in migration `20260528`.
- Object path convention: `{docType}/{YYYY}/{MM}/{filename}` (e.g. `invoices/2026/05/foo.pdf`).
- `storage_url` columns hold the **in-bucket path**, not a URL. Viewers mint a short-lived
  **signed URL** (`createSignedUrl(path, 120)` — 120 s, `src/lib/storage.ts`).

---

## Database functions (pg_proc, schema `public`)
**Exactly two functions exist — both are SECURITY DEFINER role helpers, both `language sql`,
`STABLE`:**

| Function | Returns | Body |
|---|---|---|
| `get_my_role()` | text | `SELECT role FROM public.allowed_users WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')` |
| `current_user_role()` | text | `select role from public.allowed_users where email = auth.email() limit 1` (`SET search_path = public`) |

**There are NO balance-calculation RPCs in the database.** Supplier balances are **computed in the
frontend** (`src/hooks/useSuppliers.ts`: `opening_balance + Σ invoices − Σ payments`, cancelled
excluded — see 04 §B1). 

> ⚠️ Note for rebuild: `hadas-api` returns logic calls `supabase.rpc('decrement_supplier_balance')`
> / `increment_supplier_balance` — **these functions do not exist in the live DB**, so those RPC
> calls fail / no-op. The only effective balance is the frontend computation. Track in 07.

---

## Row-Level Security (RLS)

> Policy definitions below are from `20260604120000_employee_rls.sql` /
> `20260605000000_documents_read_policy.sql`. Live `pg_policies` were not re-dumped in this pass;
> the helper functions they reference (`current_user_role()`, and now also `get_my_role()`) are
> confirmed present above.

**Architecture the policies rely on:**
- Frontend **reads** go through the anon client → governed as role `authenticated`.
- Frontend **writes** go through `hadas-api` with the **service-role** key → **RLS bypassed**.
- **Exception:** alert mark-read / resolve / delete run via the anon client (`useAlerts.ts`).
- Role source of truth: `allowed_users(email → role)`; `employee` = employee, else manager.

| Table | Policy | For role | Ops | USING | WITH CHECK |
|---|---|---|---|---|---|
| `payments` | managers read payments | authenticated | SELECT | `current_user_role() = 'manager'` | — |
| `vendor_statements` | managers read vendor_statements | authenticated | SELECT | `current_user_role() = 'manager'` | — |
| `alerts` | managers manage alerts | authenticated | ALL | `current_user_role() = 'manager'` | `current_user_role() = 'manager'` |
| `suppliers` | allowed users read suppliers | authenticated | SELECT | `current_user_role() IS NOT NULL` | — |
| `invoices` | allowed users read invoices | authenticated | SELECT | `current_user_role() IS NOT NULL` | — |
| `delivery_notes` | allowed users read delivery_notes | authenticated | SELECT | `current_user_role() IS NOT NULL` | — |
| `returns` | allowed users read returns | authenticated | SELECT | `current_user_role() IS NOT NULL` | — |
| `employees` | allowed users read employees | authenticated | SELECT | `current_user_role() IS NOT NULL` | — |
| `allowed_users` | users read own allowed_users row | authenticated | SELECT | `email = auth.email()` | — |
| `storage.objects` | authenticated read documents bucket | authenticated | SELECT | `bucket_id = 'documents'` | — |
| `ingest_failures` | *(none — RLS enabled, no policy)* | — | — | service-role only | — |

Effective access:
- **Manager**: reads everything above; full alert management; reads documents.
- **Employee**: reads suppliers / invoices / delivery_notes / returns / employees; **no** access
  to payments, vendor_statements, or alerts.
- The documents-read policy grants any authenticated user read access to **all** documents
  (not folder/role-scoped).

---

## ⚠️ INCONSISTENCIES TO RESOLVE IN REBUILD
- **`line_items` type mismatch:** `invoices.line_items` is **text** while
  `delivery_notes.line_items` is **jsonb**. Pick one representation for both.
- **Status-language mismatch:** `vendor_statements.status` defaults to the English `pending`,
  while other tables use Hebrew status defaults (`invoices.status` `ממתין`, `payments.status`
  `פעיל`, `returns.status` `בטיפול`). Standardize the status vocabulary across tables.
