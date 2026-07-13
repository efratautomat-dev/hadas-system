# 04 — Business Logic (the rules behind the scenes)

> The non-obvious calculations, validations, edge cases and magic numbers — many invisible from
> the UI. Each rule cites file + function. Hebrew strings are in `backticks` (matched literally
> in code). Backend line-number references come from reading `invoices-ingest/index.ts`; treat
> exact line numbers as approximate and the **behavior** as authoritative.

---

## A. Invoices

### A1. Invoice status is **derived live, never read from the stored column**
`src/components/Invoices.tsx` (status derivation). Priority order:
1. If `sentToAccountant` (i.e. `transferred_at` is set) → `הועבר לרו״ח` ("sent to accountant", green).
2. Else if **any unresolved alert** (`status !== 'resolved'`) references this invoice (by id or
   `gmailMessageId`) → `בבדיקה` ("under review", blue).
3. Else → `ממתין` ("waiting", amber).

The stored `status` column is considered unreliable (it drifts), so the UI ignores it for the
badge. Alert↔invoice matching checks `gmailMessageId` and several payload id fields
(`invoiceId`, `existingInvoiceId`, `duplicateInvoiceId`, `relatedId`).

### A2. VAT auto-calculation = 17 %
`src/components/Invoices.tsx` (invoice form). On editing pre-VAT amount:
`vat = round(amountBeforeVat * 0.17)`, then `total = amountBeforeVat + vat`. `Math.round`
guards floating-point drift. (17 % is hard-coded — Israeli VAT.)

### A3. Duplicate detection — **frontend pairing**
`src/components/Invoices.tsx`. Two invoices are a duplicate pair when **`invoiceNumber` +
`supplierId` match**. A flagged invoice carries `duplicateFlag = 'כפילות אפשרית'` ("possible
duplicate"). Resolution modal offers three paths:
1. **Mark one primary** → clear the primary's flag, delete the other.
2. **Delete one** → remove it.
3. **Approve both** → clear both flags, set a note `אושר ידנית` ("manually approved").
After resolution, `Layout.tsx` filters alerts to drop any pointing at either invoice id or at
the matching `supplier + invoiceNumber` pair (alert cleanup).

### A4. Duplicate detection — **backend dedup** (`invoices-ingest`)
- **Numbered invoices:** DB unique index `(gmail_message_id, invoice_number, supplier_id)`
  (migration 20260614). A duplicate is **still saved** with `is_duplicate = true` (not dropped)
  and an `invoice_duplicate` alert is raised.
- **Numberless invoices** (`invoice_number = ''`): excluded from that index; deduped in app code
  by `(gmail_message_id, storage_url)`. This lets multiple numberless docs ride one email.

### A5. Invoice delete is a 4-step cascade with a fail-safe
`hadas-api` `deleteInvoice`. Order: **Drive trash → alerts cleanup → Storage remove → DB row.**
Drive failure **aborts the whole delete** (returns 500, nothing else touched) so a retry stays
safe; alerts and Storage removal are best-effort. Deletion always targets the **original**
`invoice.id`, never the (user-editable) number field.

---

## B. Suppliers & ledger

### B1. Supplier balance is computed, not stored (in the list view)
`src/hooks/useSuppliers.ts`. For each supplier:
`balance = opening_balance + Σ(invoices matched by supplier_name) − Σ(payments matched by
supplier_id)`, with **cancelled payments excluded** (`status !== 'cancelled'`). Invoices group
by **name**, payments group by **id** — an intentional asymmetry to watch when names drift.

> Separately, `hadas-api` keeps a supplier balance in sync on **return approval** via the
> `increment/decrement_supplier_balance` RPCs (B3 / returns). ⚠️ NEEDS OWNER CONFIRMATION whether
> the persisted balance and the computed list balance can diverge.

### B2. Ledger running balance
`src/components/SupplierLedger.tsx`. Opening for the chosen range =
`supplierOpeningBalances[id] + Σ(debit − credit) for entries before fromDate`. Each row then
`running += debit − credit`. Rows are **displayed newest-first** but the running total is
computed **chronologically**, so each row still shows the correct cumulative figure.
(Ledger data is currently demo/hard-coded — see 07.)

### B3. Returns adjust supplier balance through RPCs
`hadas-api` `createReturn` / `updateReturn` / `updateReturnStatus`. Status `אושר` ("approved")
is the trigger:
- approve → `decrement_supplier_balance`
- un-approve → `increment_supplier_balance` (by the previous amount)
- approved amount changed → decrement by the **difference**.

---

## C. Supplier matching & creation (ingest)

### C1. Tax-ID (ח.פ) precedence, then fuzzy name (`invoices-ingest`)
1. Normalize `hp` to digits only. If it matches an existing supplier's `hp` → use that supplier
   (authoritative). If the extracted **name differs** from the matched supplier → store an
   `alt_name` and raise a `supplier_details_review` alert.
2. Else fuzzy-match by name with threshold **0.85** (Levenshtein edit distance + token overlap +
   containment bonus).
3. Else an exact case-insensitive name pre-check (catches fuzzy misses).
4. Else **auto-create** the supplier (with extracted ח.פ and category if present) and raise a
   `supplier_incomplete` alert so the owner fills in contact details.
A unique-constraint race during insert is handled by reading back the concurrently-created row.

### C2. Payments-ingest fuzzy matching threshold = 0.8
`payments-ingest`. Same family of scoring, lower threshold (**0.8**). New suppliers are created
**name-only** (no ח.פ from a payment email) and also raise `supplier_incomplete`.

### C3. Category learning
`invoices-ingest`. After a successful invoice insert: upsert `supplier_categories`
(`usage_count++`, `last_used_at`) and upsert the global `categories` table. Precedence for the
invoice's category: **supplier default first, then AI extraction**. A genuinely new category from
the AI is added to `categories` (learned). The per-supplier hint only helps **after** at least
one prior categorized invoice from that vendor (not retroactive).

---

## D. Credit notes & returns

### D1. Credit notes are ingested as **negative invoices**
`invoices-ingest`. When `isCreditNote` is true, amounts are forced negative deterministically:
`total_amount = -abs(total_amount)`, same for `amount_before_vat` and `vat_amount` — the
extractor's sign guess is never trusted. The composite msgid index lets the credit note share a
`gmail_message_id` with the original invoice (different number).

### D2. Credit-note → return matching, ±10 % tolerance
`invoices-ingest` (return/credit handler). An incoming credit note is matched to an **open
return** (status not `הסתיים` / "completed"). Three outcomes:
- **A — clean match:** `|creditAmount − returnAmount| / returnAmount ≤ 0.10` → close the return,
  write `supplier_credit_note_number/date/amount`, set status `הסתיים`.
- **B — amount mismatch > 10 %:** still close the return **but** raise a `return_amount_mismatch`
  alert. (If `existing.amount == 0`, treated as full mismatch, pct = 1.)
- **C — no open return:** raise an `unmatched_credit_note` alert for manual review.

### D3. Return status vocabulary (UI)
`src/components/Returns.tsx`: `אושר` (approved) / `בטיפול` (in progress) / `נדחה` (rejected).
Note the ingest path uses `הסתיים` for "completed" — a **vocabulary mismatch** flagged in 07.

---

## E. Drive month-folder routing (`invoices-ingest`)

### E1. Root + subfolders
Root Drive folder `1ocbxq5-ReY7WutAm48pKHDiaB8rBe6SM`. Type subfolders: invoice `חשבוניות`,
partial-refund `החזר חלקי`, delivery-note `תעודות משלוח`, statement `כרטסות`, return `חזרות`.
Month folders are `{YEAR}/{Hebrew month name}` (e.g. `2026/יוני`).

### E2. The "overflow" rule (late documents)
`monthsBehind = (now.UTCyear − inv.UTCyear)*12 + (now.UTCmonth − inv.UTCmonth)`
(0 = current month, 1 = one month old, ≥2 older, <0 future).
- **On time** → file under the invoice's own month folder.
- **Grace window:** a one-month-old invoice (`monthsBehind == 1`) is still "on time" **if filed
  before the 15th** of the current month.
- **Late** → file into the overflow subfolder of the currently-**active** month, where active
  month = previous month (before the 15th) else this month. Example: June 1 → active is May;
  June 20 → active is June.
- **Partial returns** (`partial_return = true`) route to the partial-refund subfolder of the
  on-time month — but **overflow always wins** for late docs.

### E3. Overflow subfolder name is built from char codes (RTL safety)
`const OVERFLOW_SUBFOLDER = String.fromCharCode(0x05E2,0x05D5,0x05D3,0x05E4,0x05D9,0x05DD)` →
renders as `עודפים` ("surplus"). Built from code points so the Hebrew literal cannot scramble
the source file.

---

## F. AI extraction robustness (`invoices-ingest`)

### F1. Israeli date parsing
Dates are always **DD/MM/YY or DD/MM/YYYY** (day-first, never US month-first): `03/05/26` →
`2026-05-03`. If the parsed year is implausibly old (**< 2023**) → mark `confidence = low` and
add `invoice_date` to `missing_fields`. On century ambiguity (e.g. 1903 vs 2026) prefer the
**current year** (2026).

### F2. JSON repair before parse (`parseJsonRobust`)
1. Extract from a ```json fenced block, then slice between the first `{` and last `}`.
2. Smart/curly quotes → straight quotes.
3. **Gershayim repair:** a plain ASCII `"` flanked by Hebrew letters
   (`/([א-ת])"(?=[א-ת])/g`) → `״` (U+05F4). Prevents a quote inside a Hebrew word (e.g. `בס״ד`,
   `בע״מ`, `ש״ח`) from terminating the JSON string early. The lookahead leaves the right-hand
   letter free so consecutive gershayim all repair.
4. Trailing commas before `}`/`]` removed.
5. Final parse; null → extraction considered failed.

### F3. Truncation guard
`EXTRACTION_MAX_TOKENS = 8192`. If the Anthropic response `stop_reason == "max_tokens"`, a
warning is logged and the body is treated as **truncated** (its failed `JSON.parse` is reported
as truncation, not a generic error). `extractInvoice` retries once with a minimal JSON-only
prompt; if it still fails it throws, noting the response looks TRUNCATED and suggesting a higher
`max_tokens`. **Known limit:** very long invoices still truncate at 8192 (see 07).

### F4. Invoice-only ad gate (`quickInvoiceCheck`)
A cheap Haiku check ("is this a business document or marketing material?"). Only an explicit
`לא` / `no` drops the file; any error or silence **keeps** it (never drop on error). Not applied
to statements, delivery notes, or returns.

### F5. Attachment format gate (Stage 1)
PDFs pass unconditionally. Images must **not** match `logo|signature|image00[1-9]|banner|footer|
header` and must be **≥ 50 KB** (`LOGO_SIZE_THRESHOLD`) — smaller images are treated as
logos/decoration. Bytes are downloaded only after the gate passes. File type is sniffed by
**magic bytes** (`%PDF`, JPEG `FF D8 FF`, PNG `89 50 4E 47`), which override the declared
Content-Type.

### F6. Body-link extraction (when no usable attachment)
Mirrors the legacy N8N logic: decode tracking URLs (icount wraps PDFs in
`track.icount.co.il/CL0/<ENCODED>`, decoded up to 2 rounds), keep links whose anchor text or URL
contains a keyword (`download`, `view`, `invoice`, `חשבונית`, `הורד`, `להורדה`, …), prefer `.pdf`.
**Magic numbers:** max **5** links/email (DoS guard), **20s** per-link fetch timeout, max **5**
redirects (fail fast on tracker loops). The ≥50 KB logo gate also applies to fetched links.

---

## G. Failure tracking & retries (`invoices-ingest`)

### G1. Cost-guarded retry cap
`MAX_INGEST_ATTEMPTS = 2`, tracked per email in `ingest_failures`.
- Attempt 1 fails → log error, leave the email **unlabeled** (next cron retries).
- Attempt 2 (at cap) → park behind Gmail label `פענוח נכשל` ("decoding failed") and raise an
  `invoice_ingest_failed` alert. To re-queue, the owner removes that label in Gmail.
- `last_error` is stored truncated (~500 chars).

### G2. Document-type routing (Stage 2)
Subject-keyword classification first: `כרטסת` → statement; `זיכוי`/`חזרה`/`החזר` → return_doc
(checked **before** invoice); `משלוח`/`הזמנה` → delivery_note; `חשבונית` → invoice; generic
`מסמך` or none → unknown. If unknown, a Haiku classifier picks one (defaults to `invoice` on
error). Credit notes (`זיכוי`) flow through the invoice pipeline as negatives (D1).

### G3. Gmail labels & lookback (`invoices-ingest`)
Source label (test mode): `מסמכים מספקים` (production target is `חשבונית`, still owned by N8N).
Processed: `טופל_ממתין במערכת`. Failed: `פענוח נכשל`. Needs-review: `דורש בדיקה ידנית`.
Partial-refund: `החזר חלקי` (manual only). Rolling **14-day** lookback (`newer_than:14d`) so a
first run never reprocesses all history. ⚠️ NEEDS OWNER CONFIRMATION on the **exact current
source label** (memory notes `ספקים`; code read shows `מסמכים מספקים`).

---

## H. Payments ingest parsing (`payments-ingest`)

- **Mailbox:** `to:h8420785+payments@gmail.com`; processed label `תשלומים שנקלטו`. Idempotency
  via unique `source_message_id`; a `23505` violation is treated as already-ingested.
- HTML normalized to text (block tags → line breaks), emoji/decorations stripped, forwarded
  copies discarded below the separator. Fields: `ספק` (supplier), `סכום`/`סך` (amount),
  `סוג תשלום`/`סוג` (type), `תאריך תשלום` (date), `תאריך ערך` (value date), `אסמכתא` (reference),
  `הערות` (notes).
- **Bizibox payment-type normalization** to a canonical set: `צ'ק`, `עמלה`, `סליקה`, `מזומן`,
  `כרטיס אשראי`, `הרשאה לחיוב חשבון`, `העברה בנקאית`, `הלוואה`, `אחר`. Apostrophe variants
  (`'`, `’`, `‘`, `ʼ`, `׳`, `` ` ``, `´`) are normalized before matching; a legacy map handles
  English aliases (`transfer` → `העברה בנקאית`, `check` → `צ'ק`, …).
- **Amount parsing:** first number, ignoring `₪` and thousands separators (`-?\d[\d,]*(?:\.\d+)?`).
- **Date parsing:** `DD/MM/YYYY` or `D/M/YYYY` → `YYYY-MM-DD`; ISO passthrough.

---

## I. Bizibox export

- A payment is marked exported by `hadas-api` `markBizboxExported` stamping `bizbox_exported_at`
  (idempotent: only when currently null; status deliberately unchanged).
- Export **format** (value date in the date column; supplier + month + notes in the description)
  is implemented in the front-end export utility — most recent commit
  `1e8e6d4 "bizbox export: value date in date column, supplier+month+notes in description"`.
  ⚠️ NEEDS OWNER CONFIRMATION of the exact column layout from the export code
  (`src/pages/Payments.tsx` / a related export helper) — not fully captured here.

---

## J. Alerts

### J1. Alert idempotency
`invoices-ingest`. Alerts dedup by `(type, gmailMessageId)`. Optional `dedupKeys` narrow the
check — e.g. `dedupKeys = ["supplierId"]` lets multiple invoices in **one** email each get their
own `supplier_incomplete` alert instead of being collapsed.

### J2. Alert type → severity bucket (UI)
`src/components/Alerts.tsx` (`ALERT_TYPE_CONFIG`). Four buckets drive color/icon and an unknown
type falls back to a neutral gray badge (defensive). See 06-DESIGN-SYSTEM.md for the bucket
colors and 03-FEATURES.md for routing (`resolveAlertDestination`).

---

## K. Other rules & magic numbers

| Rule | Where | Value |
|---|---|---|
| Signed-URL lifetime for stored docs | `src/lib/storage.ts`, `Invoices.tsx` | **120 s** |
| Logo/decoration image cutoff | `invoices-ingest` | **50 KB** |
| Body-link cap per email | `invoices-ingest` | **5** |
| Per-link fetch timeout | `invoices-ingest` | **20 s** |
| Max redirects on link fetch | `invoices-ingest` | **5** |
| Camera capture max image | `invoices-ingest` | **15 MB** |
| Gmail lookback window | `invoices-ingest` | **14 days** |
| AI extraction max tokens | `invoices-ingest` | **8192** |
| Fuzzy match (invoices / payments) | ingest functions | **0.85 / 0.8** |
| Credit-note amount tolerance | `invoices-ingest` | **±10 %** |
| Return amount tolerance | same | **±10 %** |
| VAT rate | `Invoices.tsx` | **17 %** |
| JWT lookup timeout (invoices-ingest) | `invoices-ingest` | **5 s** |

### K1. Delivery-note status normalization
`src/components/DeliveryNotes.tsx` `normalizeStatus`. Maps both old Hebrew
(`ממתינה לשיוך` / `משויכת`) and new (`pending`/`archived`, plus API `unlinked`/`linked`) onto a
canonical `pending` / `archived` for display. Unlinked = pending, linked = archived.

### K2. Hebrew-in-source safety
The codebase avoids raw Hebrew/RTL in places where it would scramble the file — e.g. the
overflow folder name via `String.fromCharCode` (E3), and the SectionHeader LTR-flex workaround
(see 06). New documentation (these files) keeps exact Hebrew values inside `backticks`.
