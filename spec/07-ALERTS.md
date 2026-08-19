# 07 — Alerts Specification

> The full alerts spec: the **11 live alert types** plus **2 additional** types
> (`supplier_details_review`, `return_amount_mismatch`). Each has a type key, Hebrew label, and a
> click action. Severity is shown by color. Super-rules govern lifecycle.

---

## Color code (severity)

| Color | Meaning |
|---|---|
| **red** | urgent — broken ingest / duplicates |
| **orange** | action — a human action is required |
| **yellow** | check — worth a look / verify |
| **gray** | info — informational |

Unknown types fall back to a **neutral gray badge showing the raw type string** — never crashes
(see `06-RULES.md`, StatusBadge fallback rule).

---

## The 11 live alert types

| # | Type key | Hebrew label | Color | Click action |
|---|---|---|---|---|
| 1 | `invoice_ingest_failed` | פענוח נכשל — טיפול ידני | red | open the invoice for manual handling / re-queue |
| 2 | `invoice_duplicate` | כפילות | red | open the existing (original) invoice |
| 3 | `invoice_link_failed` | הורדה נכשלה | yellow | route to the original Gmail thread (`payload.messageLink`) to re-download manually — **see deferral note below** |
| 4 | `supplier_incomplete` | ספק – חסר פרטים | orange | open the supplier to fill in missing details |
| 5 | `unmatched_credit_note` | זיכוי ללא חזרה | orange | open returns for manual review / matching |
| 6 | `statement_save_failed` | שמירת כרטסת נכשלה | orange | retry / open statement reconciliation |
| 7 | `invoice_low_confidence` | וודאות נמוכה | yellow | open the invoice to verify AI extraction |
| 8 | `document_misclassified` | מסמך לא חשבונית | yellow | open the document to re-classify |
| 9 | `invoice_no_attachment` | ללא קובץ | yellow | open the source email / attach manually |
| 10 | `invoice_no_valid_attachment` | ללא קובץ תקין | yellow | open the source email / attach a valid file |
| 11 | `invoice_old_date` | תאריך מוקדם | gray | open the invoice to confirm the date |

> Legacy alias: `duplicate_invoice` routes identically to `invoice_duplicate`.

---

## The 2 additional types

| Type key | Hebrew label | Color | Click action |
|---|---|---|---|
| `supplier_details_review` | ספק – לבדיקת פרטים | orange | open the supplier to review AI-suggested detail changes |
| `return_amount_mismatch` | פער בהחזר | red/urgent | open the return to reconcile the amount against the arrived credit note |

> `statement_mismatch` (אי-התאמת כרטסת, red) is **now raised for real** by statement
> reconciliation on ingest (PRD §7), not only by mock data. It routes to the SPECIFIC
> statement via `payload.statementId`, and as of 2026-08-02 carries an `urgent` bucket so it
> appears in the type filter.

---

## Statement extraction failure (added 2026-08-18)

| Type key | Hebrew label | Color | Click action |
|---|---|---|---|
| `statement_extract_failed` | פענוח כרטסת נכשל — טיפול ידני | red | open the SPECIFIC statement (`payload.statementId`) — the document is shown beside the supplier picker and the vendor-balance field |

Raised when Sonnet could not read the כרטסת at all: the row reaches `vendor_statements` but
with **no supplier and no balance**, so nothing reconciles and the statement is inert until a
human reads the document. It is the כרטסת twin of `invoice_ingest_failed` — broken ingest,
hence **red/urgent**, and it must read as "this one needs a human", not as a routine state.

Routing note: it does **not** use the `*_no_file` route (open the source email). Those types
have nothing saved anywhere; here the row and the file both exist and only the *reading* of the
file failed, so the statement detail — the one screen carrying the document, the supplier
assignment and the vendor-balance input together — is the useful destination. Fallbacks, in
order: `payload.storagePath` (open the stored file), then the reconciliation screen. The alert
card's own "פתח מייל מקורי" button still appears whenever `payload.messageLink` is set.

> Extraction had been failing on **every** statement in production since launch, silently.
> Once ingest is fixed these should be rare.

---

## The 3 no-file types for non-invoice documents (added 2026-08-02)

| Type key | Hebrew label | Color | Click action |
|---|---|---|---|
| `statement_no_file` | כרטסת ללא קובץ | yellow | open the source email — nothing was saved anywhere |
| `delivery_note_no_file` | תעודת משלוח ללא קובץ | yellow | open the source email |
| `return_no_file` | זיכוי/חזרה ללא קובץ | yellow | open the source email |

These exist because subject classification now runs **before** the "no usable document"
guard (`09-IDEAS.md §10`). Previously that guard was hard-coded to `invoice_*`, so a כרטסת
whose file could not be fetched was reported as a failed **invoice** and never reached
`vendor_statements` at all. The specific cause rides in the Hebrew message and in
`payload.reason` (`filtered` / `link_failed` / `no_attachment`) rather than multiplying the
type keys. There is no row to open for any of them — the email is the only place to act.

---

## Gmail source labels (ingest → alerts)

The ingest pipeline that raises these alerts reads from **exactly two** Gmail labels — **all other
labels are not relevant** to the rebuild:

| Label | Content | Route |
|---|---|---|
| `מסמכים מספקים` | main documents (invoices etc.) | standard invoice ingest pipeline |
| `החזר חלקי` | partial-credit notes | **same ingest route as invoices**, tagged as **partial-credit**, filed into its **own Drive subfolder** |

> `החזר חלקי` is processed exactly like an invoice (classify → extract → file → dedupe → insert),
> only tagged as a partial-credit note and routed to a dedicated Drive subfolder. Its arrival
> drives the return↔credit matching in `06-RULES.md §2a`.

---

## Super-rules (lifecycle)

These apply to all alert types (also in `06-RULES.md`):

- **Opened → read.** Opening an alert marks it `read` (`in_progress`).
- **Deleted duplicate → resolve both.** Deleting a duplicate resolves the duplicate alert **and**
  the originating alert.
- **Resolved → hidden.** Resolved (`done`) alerts drop out of the main alert view (still
  auditable, just not in the active queue).
- **Idempotency.** Alerts dedup by `(type, gmailMessageId)`; optional `dedupKeys` (e.g.
  `["supplierId"]`) allow several invoices in one email to each raise their own alert.

---

## Deferred: browser-automation for failed download links (type 3)

For `invoice_link_failed`, automatically following / re-downloading a broken supplier download
link via **browser automation is DEFERRED to a separate future phase** (see `09-IDEAS.md`). Until
then, the **fallback is link-to-email**: the alert routes the user to the original Gmail thread so
the attachment can be fetched manually.
