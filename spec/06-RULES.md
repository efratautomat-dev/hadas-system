# 06 — Business Rules

> The business rules the rebuild must enforce. Includes the **unified status taxonomy**, the
> balance computation, VAT, duplicate detection, and the alert super-rules.

---

## 1. Unified status taxonomy

Every status column maps to one shared vocabulary. Each status has an **internal English name**,
a **Hebrew label**, and a **color**.

### Base states
| Internal | Hebrew label | Color |
|---|---|---|
| `new` | חדש | blue |
| `in_progress` | בטיפול | orange |
| `done` | טופל | green |
| `cancelled` | בוטל | gray |

### Special states
| Internal | Hebrew label | Color |
|---|---|---|
| `mismatch` | אי-התאמה | red |
| `matched` | תואם | green |
| `closed` | נסגר | green |

> `closed` is the **returns**-specific resolved state (a matching credit note arrived and was
> linked). See the returns rule in §2 and the mapping table below.

### Mapping from current values
| Table | Current value | → Unified |
|---|---|---|
| `invoices` | ממתין | `new` |
| `invoices` | sent-to-accountant | `done` |
| `payments` | פעיל | `new` / `done` |
| `payments` | cancelled | `cancelled` |
| `returns` | (legacy: בטיפול / אושר / הסתיים / נדחה — all) | `new` |
| `returns` | — | `closed` (set when a matching credit note is linked) |
| `delivery_notes` | pending | `new` |
| `delivery_notes` | linked | `matched` |
| `delivery_notes` | unlinked | `new` |
| `delivery_notes` | archived | `done` |
| `vendor_statements` | pending | `new` |
| `vendor_statements` | matched | `matched` |
| `vendor_statements` | mismatch | `mismatch` |
| `vendor_statements` | investigating / needs_review | `in_progress` |
| `alerts` | unread | `new` |
| `alerts` | read | `in_progress` |
| `alerts` | resolved | `done` |

### RULE — StatusBadge fallback (mandatory)
The `StatusBadge` component **MUST** have a fallback: an **unknown status renders gray with the
raw label** and **never crashes**. Never assume the status is one of the known keys. This protects
against un-migrated rows and any future status value.

**Confirmed — all six status-bearing screens use the shared badge with this gray + raw-label
fallback:** Invoices, Payments, Returns, DeliveryNotes, StatementReconciliation, Alerts. No screen
may key on a closed union without the gray fallback path.

---

## 2. Balance computation

```
balance = opening_balance + Σ invoices − Σ (non-cancelled payments)
```

- **Cancelled payments are excluded** from the payments sum.
- **Credit notes are stored as NEGATIVE invoices** and are therefore **already included in
  Σ invoices** — they reduce the balance automatically. There is no separate credit term.
- **Returns themselves do NOT affect the balance directly.** A return is a tracking record; the
  balance only moves when the matching credit note (a negative invoice) is booked. See the
  return↔credit matching rule below.
- **Computed in the frontend** — there are **NO balance RPCs** in the database. The legacy
  `increment_supplier_balance` / `decrement_supplier_balance` calls do not exist in the DB and
  must be removed (see `09-IDEAS.md`, `08-BUGS.md`).

---

## 2a. Return ↔ credit-note matching

When a **credit note (negative invoice) arrives**, auto-check for an **open return** with the
**same supplier** and the **same amount**:

- If a match is found → set that return's status to **`closed`** (נסגר) and **link the two
  documents**: the system-issued return document + the external credit note.
- The matched return row then shows a **"קישור לחשבונית זיכוי"** button that opens the credit-note
  document in the viewer.
- No match → the return stays `new`; the unmatched credit note raises the existing
  `unmatched_credit_note` alert (see `07-ALERTS.md`).

---

## 2b. Supplier link key

Invoices link to suppliers by the supplier's **business number (`hp` / ח.פ)**, **not by name**.

- The AI extraction prompt **must extract the supplier's `hp`** from the invoice.
- Name matching is fragile (renames, whitespace, duplicate names) and is **not** the join key.

---

## 3. VAT

- VAT rate is **17%**.
- Invoices/delivery notes carry `amount_before_vat`, `vat_amount`, `total_amount`. Where only the
  total is known, derive the split with 17%.

---

## 4. Duplicate detection

- Invoices are deduped by the composite unique index
  `(gmail_message_id, invoice_number, supplier_id)` (lets one email carry several invoices, e.g.
  a credit note + its original).
- Numberless documents (`invoice_number = ''`) are excluded from that index and deduped in app
  code by `(gmail_message_id, storage_url)`.
- Payments are deduped by the unique `source_message_id`.
- Detected duplicates are flagged (`is_duplicate`) and raise a duplicate alert.

---

## 4a. AI category selection

- The AI extraction prompt is fed the **current category list from the `categories` table** — **not
  a hard-coded list**. Newly added categories (managed in Settings, see `01-PRD.md §9`) are
  therefore **immediately available** to the AI on the next run.
- When the AI is **unsure**, it may **leave the category empty** rather than invent one.

---

## 5. Alert super-rules

These govern alert lifecycle regardless of type (full catalog in `07-ALERTS.md`):

- **Opened → read:** opening an alert marks it `read` (`in_progress`).
- **Deleted duplicate → resolve both:** when a duplicate is deleted, the duplicate alert **and**
  the originating alert are both **resolved**.
- **Resolved → hidden:** resolved (`done`) alerts are hidden from the main alert view (still
  queryable / auditable, just not in the active queue).

---

## 6. Employee visibility

Role split (`01-PRD.md §1b`): employees get a **supplier-search home**, never the manager
dashboard or global lists. Within a selected supplier they see only that supplier's invoices,
delivery notes and returns — **document/operational data, not the app's financial data**.

**Hidden from employees (the app's own money data):**
- Supplier **balance** and any financial summaries / totals.
- **Payment** amounts and totals.
- The invoice **VAT breakdown** (before-VAT / VAT / total) and per-document amount columns.
- The **editable** invoice page — employees get a **read-only** invoice view (no edit / save).

**Visible to employees (operational):**
- Invoice metadata (number, supplier, date, category, status).
- **Line items** — item names + quantities (needed for goods receipt).
- The **original document** image / PDF (viewing the scanned source is fine).

**DECISION (2026-07-07) — line items stay AS-IS; amounts are NOT stripped from them.**
AI-parsed `line_items` is **free text whose format varies per supplier**, so programmatically
stripping monetary values out of it is fragile and unreliable and would risk hiding item names or
quantities the employee needs. Because the real cost data (balance, payment totals, VAT breakdown,
editable invoice page) is **already** hidden, an **incidental number inside a free-text line item
is acceptable** and we deliberately do **not** attempt to strip it. Likewise, if an amount is
printed on the document image itself, that is just the source document, not app data.
