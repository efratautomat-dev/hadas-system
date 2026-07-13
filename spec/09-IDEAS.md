# 09 — Future Ideas

> Parking lot for ideas that are out of scope for the initial rebuild. Each should become its own
> scoped phase when picked up.

---

## 1. Browser-automation download

Automatically follow broken/failed supplier download links and fetch the document via browser
automation (**Playwright**).

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
