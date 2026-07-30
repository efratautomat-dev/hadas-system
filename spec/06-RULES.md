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

## 2c. Credit-note sign correction (mis-classified credit notes)

Ingest decides the sign at intake: a credit note (`docType === "return_doc"`) has all three
amounts forced negative with `-Math.abs`, never trusting the extractor
(`invoices-ingest/index.ts`). When the **classifier misses** one, the credit note lands as a
**positive charge** and *increases* the supplier's debt instead of reducing it.

The manager corrects this from the invoice screen — **"סמן כזיכוי"** (and the reverse,
**"סמן כחשבונית חיוב"**), behind a confirmation that shows the before → after total and the
direction the balance will move.

- **The sign and `invoice_type` are ONE unit.** Both are produced together by
  `applyCreditSign` (`src/lib/creditNote.ts`) and written in a single update, so a row can
  never be negative while typed as `חשבונית`.
- **Conversion is IDEMPOTENT** — it uses the same `-Math.abs` convention as ingest, never
  `* -1`. Applying it twice cannot bounce the sign back.
- **Sign is owned solely by that action.** Editing an amount field re-stamps the row's
  existing sign, so **typing a minus into the form cannot flip a row** — this is what makes
  the double-minus bug impossible.
- **`isCreditInvoice` keys on the AMOUNT, not on `invoice_type`** — the amount is what drives
  the balance (`supplierBalance.ts`) and the ledger, and legacy rows carry a negative total
  with `invoice_type` unset.
- **Reversible**, and it changes no other field. No migration and no `hadas-api` change were
  needed: `invoice_type` and the three amount columns are already in the update allowlist.

---

## 3. VAT

- VAT rate is **18%** as of **1.1.2025**. It was **17%** before that (from 1.10.2015).
- Invoices/delivery notes carry `amount_before_vat`, `vat_amount`, `total_amount`. Where only the
  total is known, derive the split with the rate above.

### RULE — the rate is keyed on the INVOICE DATE, never on "today"

The rate is set by law and changes on a date, so a single constant is always wrong for half the
data: left at 17% it mis-splits today's invoices; bumped to 18% it retroactively mis-splits every
invoice issued before 2025. The owner still back-enters and corrects older invoices, so **both
directions matter.**

`src/lib/vat.ts` holds the bands (newest first) and `vatRateFor(date)` returns the rate in force
on that date. The invoice form derives its rate from `form.invoiceDate`, and the hint under the
total shows which rate is being applied, so the number is never silently wrong.

| Band | Rate |
|---|---|
| from `2025-01-01` | 18% |
| `2015-10-01` – `2024-12-31` | 17% |

A date that is empty, unparseable, or in a new invoice falls back to **today's** rate; a date
older than the oldest band falls back to the oldest rate rather than throwing. **When the rate
changes again, add one row at the top of `VAT_BANDS` — nothing else changes.**

**Two copies, one rule.** The frontend is bundled by Vite from `src/` and the edge functions run
on Deno with `supabase/` excluded from the frontend build, so neither side can import the other.
The band table therefore exists twice — `src/lib/vat.ts` and `supabase/functions/_shared/vat.ts` —
as a deliberate mirror. **They must be changed together**, and a parity test compares them across
160,000 cases.

### RULE — all THREE amounts are ALWAYS filled

An invoice carries `amount_before_vat`, `vat_amount` and `total_amount`. A supplier document
rarely prints all three, and the AI extractor returns `0` for whatever it could not read — so rows
used to arrive with holes. `completeAmounts()` closes them, in **two** places:

1. **At ingest** (`extractInvoice` / `extractDeliveryNote`), so the row reaches the **database**
   complete, not just the screen. This is what makes exports and reports whole.
2. **When a row is opened** in the invoice form, which also repairs rows ingested before this rule.

**Holes only.** A figure that WAS read off the document is never overwritten by a calculation —
the document is the authority. Completion is therefore idempotent.

| Known | Derivation |
|---|---|
| net + gross | `vat = gross − net` |
| vat + gross | `net = gross − vat` |
| net + vat | `gross = net + vat` |
| gross only | `net = round₂(gross ÷ (1 + rate))`, then **`vat = gross − net`** |
| net only | `vat = round₂(net × rate)`, then `gross = net + vat` |
| vat only | `net = round₂(vat ÷ rate)`, then `gross = net + vat` |
| nothing | all three `0` |

Where **two** amounts are known the third is their exact difference or sum — the rate is not used
at all, so a document that was billed at a non-standard or exempt rate is reproduced faithfully.
**A zero VAT is a legitimate value** (exempt / foreign supplier): net = gross yields `vat = 0`
rather than an invented VAT.

Completion works on **magnitudes**; the credit/charge sign is owned by §2c (`applyCreditSign` in
the frontend, `-Math.abs` in ingest), so filling amounts can never flip a credit note into a charge.

### RULE — the amount fields are edited in BOTH directions

The invoice form lets the manager type **any one** of the three, because the number printed on a
supplier document is sometimes the net, sometimes the VAT and sometimes only the total. **The
typed field is authoritative and is never overwritten**; the other two are recomputed from it.

| Typed | Derivation |
|---|---|
| `amount_before_vat` | `vat = round₂(net × rate)`, then `total = net + vat` |
| `vat_amount` | `total = net + vat` — the **net is kept** (editing VAT means correcting it, not the net). With no net yet, `net = round₂(vat ÷ rate)`. |
| `total_amount` (gross) | `net = round₂(gross ÷ (1 + rate))`, then **`vat = gross − net`** |

`rate = vatRateFor(invoice_date)` — see the band table above.

**The gross direction takes VAT as the REMAINDER, never as a second rounding.** Rounding both
net and VAT independently lets `net + vat` land away from the gross the supplier actually billed.
Taking the remainder guarantees **`net + vat === gross` exactly**, and the rounding residue is
absorbed into VAT.

Every amount edit re-stamps the row's existing credit/charge sign (see §2c) — so an amount edit
can never flip a credit note into a charge.

### RULE — amounts are calculated to the AGORA (2 decimals)

Every derivation rounds with `round₂` = `Math.round(n × 100) / 100`. Israeli invoices are billed
to the agora, so rounding to whole shekels would discard real money on every split. The `×100 / ÷100`
also pins the binary-float dust (`0.1 + 0.2 = 0.30000000000000004`) that would otherwise accumulate
through the chained derivations.

- The three form inputs use `step="0.01"`.
- The "net + VAT ≠ total" warning fires above **half an agora** (`0.005`), so it flags a genuine
  inconsistency in the document and never a rounding artefact.
- Display shows agorot when there are any, and does **not** pad a whole-shekel total with `.00`.

Verified: across ~342,000 derived values at both rates, every result is exactly 2 decimals and
`net + vat === gross` to the agora.

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

---

## 7. Supplier-matching exceptions (data)

The ingest pipeline matches an incoming invoice to a supplier by **ח.פ / עוסק (`hp`) alone** — a
tax-id match is authoritative; **name (`findBestSupplier`, 0.85 fuzzy) is only a fallback used when
`hp` is absent or unmatched** (see `handleInvoiceFile`). So two supplier cards that share the same
`hp` will collide: the pipeline picks whichever card the query returns first (no `ORDER BY` → effectively
arbitrary) and funnels **both** companies' invoices onto that one card. Name does **not** disambiguate.

### EXCEPTION (2026-07-13) — LUMIERE (SUP-027) & ST FASHION (SUP-018), shared עוסק 315297390
- **LUMIERE (`SUP-027`)** and **ST FASHION (`SUP-018`)** are **two SEPARATE companies of the same
  owner** that legally share **ONE עוסק number: `315297390`**. They must stay as two distinct cards.
- Because the pipeline keys on `hp` alone, keeping both with `hp = 315297390` would funnel both
  companies' invoices onto a single card. So we **deliberately CLEARED the `hp` column on BOTH cards**.
- With `hp` blank, matching **falls back to name** (`findBestSupplier`, 0.85). Since **`LUMIERE`** vs
  **`ST FASHION`** are distinct names, each invoice routes to the correct card and they **stay separate**.
- The **real עוסק `315297390` is kept for reference here (and in the cards' notes), NOT in the `hp`
  column.** Do not "restore" it to `hp` without the code change below.
- **Trade-off:** these two lose `hp`-based dedup (a mistyped/variant name could spawn a duplicate) —
  keep their `name`/`alt_names` aligned with how the extractor reads each vendor.
- **FUTURE:** consider a code change to `handleInvoiceFile` supporting **composite `hp`+`name`
  matching** (same `hp`, different name ⇒ different card). That would let the real `hp` be restored
  on both cards while keeping them separate.

---

## 8. Bizibox export — FILL the template, never imitate it

**CONFIRMED (2026-07-29) by the owner's own experiment.** An export of 4 cheques +
10 bank transfers imported only the 4 cheque rows. The identical rows pasted into a
**freshly downloaded Bizibox template** imported in full. So the discriminator is the
**WORKBOOK**, not the row values — and Bizibox revises its template over time, which
is what makes a bundled copy go stale.

Ruled out along the way, each by evidence rather than assumption:
- **The type name.** Every Hebrew literal was dumped byte-for-byte: `העברה בנקאית`
  is exactly 12 chars with a single `U+0020` in both the frontend and ingest. Clean.
- **The אסמכתא column.** A transfer WITH a reference still failed.
- **The date.** The transfers were future-dated.

### The rules

- The export **loads Bizibox's own template file and writes rows into it**
  (`src/lib/bizboxWrite.ts`). It does **not** build a workbook from scratch.
- The workbook is **never re-serialised**. ExcelJS's round-trip expands the
  template's `dataValidation` ranges per cell and re-groups them into
  **overlapping** ranges (`A2:A75` alongside `A10:A75`) — which Excel treats as
  damaged content — and drops the template's drawings. The `.xlsx` is edited as
  the zip of XML it is: **only `xl/worksheets/sheet1.xml` changes; the other 15
  parts stay byte-identical.**
- Rows are written **by header NAME**, in whatever order the template declares, so
  a reordered or renamed column is fixed by uploading a new template alone.
  Positional writing would silently put values in the wrong columns.
- Written rows inherit the template's **per-cell styles** (column C carries a date
  format) and the row's own attributes (`ht`, `customHeight`).
- `<row>` elements are re-emitted in **ascending `r` order** — appending at the end
  produces a file Excel reports as damaged.
- Empty values still emit a **styled empty cell**, matching the template's shape.
- Strings are written **inline** (`t="inlineStr"`), so `sharedStrings.xml` is never
  touched and its existing indices cannot be corrupted.

### Updating the template — Settings → ייצוא לביזיבוקס

The template is read from **Storage first** (`branding/bizbox-template.xlsx`), and
falls back to the copy bundled at `public/add_tazrim_template.xlsx`. The owner
downloads a new template from Bizibox and uploads it there; the next export uses it.
**No code change and no deploy.** The upload is **validated before it replaces**
anything — an unreadable template would break the export on the day payments go out.

> The template's own dropdowns declare closed vocabularies: `סוג_פעולה` is
> `הוצאה,הכנסה` and `סוג_תשלום` is **`שיק,העברה בנקאית,אחר`** — note `שיק`, not
> `צ'ק`. The app writes nine internal payment types, seven of which are outside
> that list. Cheques import today regardless, so **this was NOT changed** — but it
> is the first thing to look at if rows start failing again.
