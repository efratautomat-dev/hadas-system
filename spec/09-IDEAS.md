# 09 — Future Ideas

> Parking lot for ideas that are out of scope for the initial rebuild. Each should become its own
> scoped phase when picked up.

---

## 1. Browser-automation download / link-based invoice capture

Some suppliers don't attach the invoice — they email a **LINK** to it, so auto-ingest fails (no
attachment to extract). Automatically follow those links and fetch the document via browser
automation (**Playwright**).

- **Known link-only suppliers:** **כובעי זיוה**, **RACHELI'S**, **הדסה אבלס / כספית** — their
  invoices arrive as a link and currently fall through auto-ingest.
- **Per-supplier:** each supplier's portal/login differs — automation is configured per supplier.
- **Separate permission-mode build:** runs in its own build / permission mode (credentials,
  headful browser), isolated from the main app.
- Resolves the `invoice_link_failed` alert (type 3 in `07-ALERTS.md`) whose current fallback is
  link-to-email. **Deferred to a separate future phase.**

---

## 2. Kaspit POS integration

Integrate the **Kaspit** point-of-sale system.

- **Separate phase, separate cost.** Not part of the rebuild scope.
- Future inbound data source (sales / stock) to cross-reference goods receipts.

---

## 3. Remove dead balance RPC calls

Remove the dead `increment_supplier_balance` / `decrement_supplier_balance` RPC calls.

- These functions **do not exist** in the live DB — the calls fail / no-op today (see
  `02-ERD.md`, `06-RULES.md`).
- Balance is computed in the frontend; the RPC calls are pure dead weight and should be deleted
  during the rebuild (returns create/update/status side-effects in `hadas-api`). Tracked as a
  concrete bug in `08-BUGS.md`.

---

## 4. Standing-order suppliers

A list of suppliers with **recurring fixed charges** (e.g. internet) that the owner marks
manually. The system **auto-balances** their balance so they never show as in debt for the
expected recurring amount.

- The owner flags a supplier as a standing-order supplier (manual opt-in).
- The system offsets the recurring charge automatically so routine fixed costs don't clutter the
  debt view.
- **⚠️ Design caution:** must be careful **not to hide real debt** — only the expected recurring
  amount should be auto-balanced; anything beyond it must still surface. Scope the exact rule when
  this is picked up.

---

## 5. Manual match correction for delivery notes & returns

The AI-suggested match between a manual goods-receipt (or manual return) and an arrived document is
auto-applied and surfaced via the **'הצג מסמך מספק'** (delivery notes) / **'קישור לחשבונית זיכוי'**
(returns) button. Correction is minimal today: **delivery notes** got a basic picker + **'בטל
התאמה'** in the row detail (piece 2); **returns** has **no** correction UI — and neither has a
prominent, consistent way to CHANGE a wrong match to a different arrived document.

- **Future:** a **'שנה התאמה'** control letting the owner pick a different arrived document (same
  supplier) or unmatch, persisted via `hadas-api`.
- **Deferred** — matching by supplier is usually correct; revisit if mismatches happen in practice.

---

## 6. UI polish — align the 'הצג מסמך מספק' button in delivery-note rows

The **'הצג מסמך מספק'** button on matched manual delivery-note rows isn't aligned within the table
the way the equivalent **'קישור לחשבונית זיכוי'** button is in Returns — it sits inside the supplier
cell rather than a dedicated aligned column. **Fold into the final design pass** (palette + type
scale + component alignment), not a standalone task.

---

## 7. Credit notes / returns dual-tracking ('גם וגם')

Currently a credit note enters **only as a negative invoice** (amounts forced negative in ingest, so
it nets against the supplier balance). This is the **decided, correct behavior for now**.

- **Future:** in addition to the negative-invoice row, also create a separate **RETURN** record for
  the credit note, so it's tracked **both** as a negative invoice **and** as a return entry
  ('גם וגם') — giving the returns view visibility of credit-note activity without changing the
  balance math (the negative invoice remains the single source of the balance impact).
- **⚠️ Design caution:** avoid double-counting the balance — only the negative invoice should move
  the balance; the return record is tracking-only. Scope the exact rule when picked up.
- **Deferred.**

---

## 8. Date-format parse fix (Israeli DD.MM.YYYY)

Israeli dates are day-first (`DD.MM.YYYY` / `DD/MM/YY`), but the extractor sometimes **scrambles**
them — e.g. `03.06.2026` mis-read as `2003-06-26` (treating parts as year/…), producing an
implausible year.

- **Fix:** strengthen the **Israeli-date instruction** in the `extractInvoice` prompt (day-first,
  never US month-first; year is the 4-digit / last field), and **widen the low-confidence date
  rule** from "year before 2023" to **"year is not the current or an adjacent year"** so mis-read
  2003/2024/2025-type years get flagged as low-confidence.
- Complements the ingest **`invoice_old_date` "תאריך חשוד"** check (fires when a date is >3 months
  back — see `06-RULES.md §... old-date rule`), which already catches wrong-year dates at ingest.
- **Deferred — post-VAT work.**

---

## 9. In-app supplier-merge tool + composite hp+name matching

Two related supplier-matching gaps, both currently handled manually / by SQL:

- **Supplier merge is SQL-only.** There is **no in-app merge tool** — merging two duplicate supplier
  cards (re-point invoices / delivery_notes / returns / payments / vendor_statements /
  supplier_categories onto the kept card, fix denormalized `supplier_name`, fold `alt_names` + `hp`,
  delete the duplicate) must be done by hand in SQL. **Future:** a manager-facing merge UI (pick
  keep vs remove, preview record counts, one-click) via a `hadas-api` transaction.
- **Composite `hp` + `name` matching.** Ingest matches suppliers by **`hp` alone** (name is only a
  fallback), so two companies of one owner sharing one עוסק collide onto a single card. Today we work
  around it by clearing `hp` and relying on name (see the LUMIERE / ST FASHION exception in
  `06-RULES.md §7`). **Future:** change `handleInvoiceFile` to support **same `hp` + different name ⇒
  different card**, so the real `hp` can be restored on both cards while they stay separate.
- **Deferred.**

---

## 10. BUG — classification ordering (non-invoice emails without a fetchable file → invoice failure)

The ingest **"no usable file" guard runs BEFORE subject-based doc-type classification**, and that
guard is **hard-coded to `invoice_*` alert types/messages**. So any **non-invoice**
(statement / כרטסת, delivery-note, return) that arrives **without a fetchable file** (no attachment,
attachment filtered by Stage 1, or a link that fails to fetch) is reported as a **failed INVOICE**
(`invoice_link_failed` / `invoice_no_attachment` / `invoice_no_valid_attachment`) and is **never
routed to its correct type** — e.g. "דוח כרטסת מ- חיה אורדמן" never reaches the `vendor_statements`
table.

- **Root cause:** `classifyBySubject` (which maps `כרטסת → statement`, etc.) runs **after** the
  `usableFiles.length === 0` guard — ingest `index.ts` **~line 1811 (guard)** vs **~line 1839
  (classify)**.
- **FIX:** run subject classification **first**, so a failed כרטסת/delivery-note/return raises a
  **type-appropriate** alert (and, where possible, a type-appropriate handling path), not an invoice
  one.
- **Non-urgent** — statements are informational, not VAT invoices; fix **post-VAT**.
