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

---

## Invoice approval against goods — TO BE SPECIFIED (raised 2026-07-30)

The owner's idea, recorded here for a proper spec session — **not designed yet**.

**Shape:** an invoice does not enter the ledger on arrival. It waits for the manager to
approve it against the goods actually received. Anything incomplete, duplicated or
suspicious stays in the waiting pile, surfaced as a red alert:
*"קיימים נתונים שממתינים לבדיקת מנהל"*.

**Why it is the right direction:** it attacks the root the §9 fixes only contain. Today every
row lands in the balance the moment it arrives — undated, duplicated or not. §9 makes those
rows *visible*; approval would stop them entering unexamined in the first place.

### The open question a spec must answer

If a waiting invoice is excluded from the balance, **the balance the manager sees is no longer
what is owed** — the supplier is due the money whether or not it has been approved. That is a
mistake in the opposite direction, and arguably worse: under-stating debt is harder to notice
than over-stating it.

**Suggested resolution, to be confirmed:** show **two** figures side by side — `מאושר` and
`כולל ממתינות` — with the gap between them. The red alert then carries a precise meaning:
*"3 חשבוניות בסך 12,400 ₪ ממתינות לבדיקה"*. Nothing disappears; what is in doubt is explicit.

### Also to be decided
- What blocks approval automatically (missing date? duplicate flag? low AI confidence? a
  missing delivery note?) versus what is only flagged.
- Whether an approved invoice is immutable, and who may un-approve.
- Whether approval belongs to the manager only, or an employee may confirm goods receipt
  while the manager approves the money.
- How this interacts with §2a (return ↔ credit-note matching) and with the Bizibox export —
  does a waiting invoice export?
- Backfill: what happens to everything already in the ledger at switch-on.

### NARROWER VARIANT the owner raised 2026-08-09 — an AMOUNT THRESHOLD

Same feature, much smaller blast radius: **only invoices above ~₪20,000 wait.**
Everything below keeps entering automatically, exactly as today.

**Shape as described:**
- Invoice arrives over the threshold → does NOT enter automatically.
- An alert is raised carrying **all the extracted details** and asking: approve?
- **Approve** → the invoice enters the ledger normally.
- **Reject** → the document is removed from the system *and from Drive*.

**Why this variant is the stronger starting point:** it sidesteps the open question
above. If every invoice waits, the balance stops reflecting what is owed, and the
doc already notes that under-stating debt is harder to notice than over-stating it.
With a threshold, only large invoices wait — the distortion is bounded, countable,
and each waiting item is big enough to be obvious. It is also shippable without
first solving goods-matching, which the full version depends on.

**DECIDED 2026-08-09 — reject DELETES, behind a second confirmation.**
The concern was raised that deleting the Drive copy destroys the evidence of what
the supplier sent, against the "shown but not counted" principle the rest of the
system follows. The owner's answer, and it is a good one: **these invoices are
usually mistakes** — that is the whole reason for the gate — and nothing is
deleted by the system on its own. Every deletion passes through a human decision
on an alert that shows the full extracted detail.

So: **reject → delete from the system and from Drive**, gated by a second
"are you sure?" confirmation before it happens. Two deliberate human actions, on
a document a human has just read in full.

**DECIDED — an unreadable amount needs no special handling.**
`invoice_low_confidence` already covers it: ingest fires that alert whenever the
extractor is unsure, emails the manager, and files the invoice as `נדרש בירור`
(`invoices-ingest/index.ts:1516-1528`). An invoice whose total could not be read
therefore reaches a human through that queue rather than this one. Verified in
code, not assumed.

**DECIDED — this ships independently.** No dependency on the goods→payment
pipeline or on the status re-spec. It can be built whenever the owner wants it.

**Also to decide for this variant:**
- The exact threshold, and whether it is configurable in Settings rather than a
  constant in code.
- Which amount it tests — the total, or the pre-VAT figure. (A ₪20K net invoice is
  ₪23.6K gross; the two cross the line at different points.)
- Whether a waiting invoice counts toward the supplier balance meanwhile
  (see the two-figure `מאושר` / `כולל ממתינות` resolution above).
- Whether an approved-then-regretted invoice can be un-approved.

**Owner: to be specified together before any implementation.**

---

## 11. Alerts are DELETED, so the trail of what ingest failed on is gone (raised by the owner 2026-08-23)

**How it surfaced.** Recovering the delivery notes that failed extraction, the
plan was to identify them from their alerts — the parked-failure alert carries
`payload.gmailMessageId`, the subject and `lastError`, and `lastError` literally
reads `extractDeliveryNote failed after retry`. That query returned **nothing**.
The rows had been deleted. Meanwhile 27 delivery notes that DID ingest were
sitting in the table unseen since **2022-12-06**, so the failures they were
mixed in with are not recent either.

**The problem.** An alert is the only record that ingest ever tried and failed
on a given email. Deleting it destroys:
- which emails were parked, and why (`lastError`)
- the `gmailMessageId` needed to re-queue them
- any way to measure how long a class of failure has been running

The row is also the cheapest audit the system has — a few hundred bytes.

**The owner's proposal:** *don't delete — mark as not-viewed / dismissed.* An
alert leaves the queue when it is handled, but the row survives.

**What exists today.** `alerts` already has `status` (`unread` / `read` /
`resolved`) plus a legacy `resolved` boolean, and `useAlerts` exposes
`markRead` / `markResolved` **and** `remove` (a hard `delete`). `hadas-api`
also deletes alerts outright when an invoice is deleted
(`hadas-api/index.ts:436`). So the soft path is already built; deletion is a
second, destructive path beside it.

**To decide before implementing:**
1. Does `remove` become a status write (`dismissed`), or does it stay and only
   get hidden behind a confirmation?
2. What happens to the sibling-alert deletion when an invoice is rejected —
   there the alert points at a row that no longer exists.
3. Does the alerts screen need a "show dismissed" view, or is the history for
   queries only?
4. Retention — do dismissed alerts age out, and after how long?

**Related:** §10 below/above (the same class of loss: a non-invoice failure
reported as an invoice failure, which is what made these unfindable by type in
the first place — fixed 2026-08-23, alerts are now typed per document).
