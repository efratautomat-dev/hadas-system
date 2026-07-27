# 01 — Product Requirements (PRD)

> Screen-by-screen product requirements for the Hadas rebuild. For each screen: **purpose**,
> **what the user sees**, **actions**, and **what's NEW vs the current system**. Status values,
> colors and labels follow the unified taxonomy in `06-RULES.md`. The data model is the existing
> production schema — see `02-ERD.md`.

---

## Roles (applies to every screen)

- **Manager** — full access: cost prices, payments, statements, alerts, settings, employees.
- **Employee** (6 of them) — operational only: suppliers, invoices (no cost prices), delivery
  notes, returns. **No** payments, statements, or alerts.

See `06-RULES.md` for the enforcement model (RLS + service-role writes).

---

## 1. Dashboard

- **Purpose:** at-a-glance state of the business — what needs attention today.
- **User sees:** summary cards (total owed, open credits, open alerts, this month's invoice
  count), recent activity, and shortcuts into the screens that need action.
- **Actions:** click through to any flagged item (alert, mismatch, unmatched delivery note).
- **NEW vs current:** surface the two confirmed reports — **debt by supplier** and
  **open credits** — directly as dashboard widgets.

---

## 2. Suppliers (+ SupplierDetail + Ledger)

- **Purpose:** the master list and the per-supplier financial picture.
- **User sees:**
  - **Suppliers list:** searchable table (name, category, balance, contact). Shows **active**
    suppliers by default; inactive ones are hidden and surfaced via an **"inactive" filter/search**.
  - **SupplierDetail:** supplier header (details, tax id, category, opening balance) + tabs.
  - **Ledger:** chronological line of opening balance, invoices (+), credit notes (negative
    invoices, −), payments (−), with a running balance.
- **Actions:** create / edit a supplier; **activate / deactivate** (inactive/active toggle); edit
  opening balance + opening-balance date; view ledger. Hard delete is blocked if invoices reference
  the supplier (`409 HAS_INVOICES`) — **deactivation replaces deletion** for suppliers with history.
- **NEW vs current:**
  - **Active/inactive toggle:** inactive suppliers drop out of the default list and are reachable
    only via the inactive filter — the supported way to retire a supplier while keeping history
    (see `02-ERD.md §C`).
  - Balance is **computed in the frontend** (`opening_balance + Σ invoices − Σ non-cancelled
    payments`) — **no balance RPCs** (the old `increment/decrement_supplier_balance` calls are
    dead — see `06-RULES.md §2`, `09-IDEAS.md`). Credit notes are **negative invoices** already in
    Σ invoices; returns do not move the balance directly. Employees see the ledger **without cost
    prices**.

---

## 3. Invoices

- **Purpose:** every supplier invoice (and credit note as a negative invoice).
- **User sees:** list with supplier, number, date, total, status, duplicate/error flags;
  **two-pane detail view** — the source document on the **right**, every field on the **left**.
- **Actions:** create manual invoice; edit; change status; delete (trashes the Drive file first,
  then cleans alerts + Storage + row); mark "sent to accountant" (→ done);
  **convert charge ⇄ credit note** (`06-RULES.md §2c`).
- **NEW vs current:** status uses the unified taxonomy (`ממתין`→`new`, sent-to-accountant→`done`).
  `line_items` is unified to **jsonb** (see `02-ERD.md`).

### Detail view — CONFIRMED (2026-07-28)

- **Two panes, no preview popup.** The document renders **inline on the right** and is
  **sticky**, so it stays put while the fields on the left scroll — the owner types while
  looking at the scan. The old eye-icon → modal is replaced by **"הגדל"** (full screen) and
  an open-in-new-tab link in the pane header; both still use the shared renderer, so
  multi-page PDFs keep the browser/Drive viewer.
- **Stacks below 1100px** (document above, fields below) rather than squeezing two panes.
- **"אין מסמך מצורף" state** for rows with neither `storage_url` nor `drive_file_link`.
- The pane resolves its URL **on mount** with a **1-hour** signed Storage URL (the old 120s
  preview URL expired mid-review).
- **Two invoice numbers, clearly separated:**
  - **`invoice_number` — "מספר חשבונית של הספק"**: the number printed on the document.
    Editable, and it is the **headline** of the detail view.
  - **`id` — "מספר במערכת"**: the system key (`INV-YYYY-NNN`). **READ-ONLY** — it is the
    target of `PUT /invoices/:id`, so editing it sent the save to a non-existent row and the
    change vanished silently.
- **Total is editable** and derives net + VAT — see `06-RULES.md §3`.

---

## 4. Payments

- **Purpose:** payments made to suppliers (manual or email-ingested).
- **User sees:** list with supplier, amount, type, date, value date, reference, status;
  pending (not-yet-exported) payments highlighted for Bizibox export.
- **Actions:** create manual payment; edit; **cancel** (reversible, `status='cancelled'`);
  delete (hard); mark Bizibox-exported (batch); create payment from an alert.
- **NEW vs current — CONFIRMED:**
  - **`reference` field is OPTIONAL.** Remove the required-validation on the form; the column is
    already nullable.
  - Manager-only screen (employees have no payments access).

---

## 5. DeliveryNotes — **NEW screen**

- **Purpose:** record goods receipts (delivery notes / תעודות משלוח) and match them to invoices.
- **Structure:** **structurally identical to Returns** (same two-view layout, same matching UX).
- **User sees — TWO views:**
  - **(a) "Arrived documents"** — delivery notes that came in **by email**, shown with supplier
    name + AI-parsed fields (number, date, amount, line items) and a link to the source document.
  - **(b) "קליטת סחורה" (goods receipt)** — the real-world case is **goods arriving WITHOUT a
    delivery note**: the employee **enters a supplier and lists the items manually**. This is a
    first-class record and **MUST be persisted to the DB** (`POST /delivery-notes`).
    > ⚠️ Today this is a **bug** — the manual add is local-state only and never persisted
    > (see `08-BUGS.md`). The rebuild must persist it.
  - When a **goods-receipt** row is matched to an **arrived** document, it shows a
    **"Show supplier document"** button linking to the document viewer.
- **Actions:** create a manual goods-receipt entry (persisted); edit; link/unlink to an invoice;
  **accept or correct** the AI-suggested match (matching is AI-suggested, manual correction always
  allowed).
- **NEW vs current:** this whole screen is new. Status: `pending`→`new`, `linked`→`matched`,
  `unlinked`→`new`, `archived`→`done`.

---

## 6. Returns

- **Purpose:** goods returned to suppliers, tracked until a supplier credit note closes the credit.
- **User sees — TWO views (same pattern as DeliveryNotes):**
  - **(a) "Arrived documents"** — credit notes received **by email**, with supplier name +
    AI parsing.
  - **(b) "Manual entry"** — returns logged by staff.
  - A matched row shows the **"קישור לחשבונית זיכוי"** button, which opens the linked credit-note
    document in the viewer.
- **Actions:** create a manual return; edit; **accept/correct AI-suggested match** to an arrived
  credit note; **print the return document**.
- **NEW vs current — CONFIRMED:**
  - **Manual-create form has NO amount field** — the return is **tracking only** (supplier, reason,
    original invoice, detail, employee, date). Amount is set later by the matching credit note.
  - **Status is just `new` (חדש) → `closed` (נסגר).** A return starts `new`; when a credit note
    with the **same supplier + same amount** arrives it auto-matches, links the two documents, and
    flips the return to **`closed`** (see `06-RULES.md §2a`). No `in_progress`/`done`/`cancelled`
    for returns.
  - The **printable return document stays as today**.
  - Two-view + AI matching layout is new.

---

## 7. StatementReconciliation

- **Purpose:** reconcile each supplier's monthly statement against our ledger.
- **User sees:** incoming statements with our balance, vendor balance, diff, status; mismatches
  flagged.
- **Actions:** upload/ingest a statement; investigate; resolve with notes.
- **NEW vs current — CONFIRMED:** **every incoming statement is auto-matched against the supplier
  ledger; on mismatch an alert is created.** Status: `pending`→`new`, `matched`→`matched`,
  `mismatch`→`mismatch`, `investigating`/`needs_review`→`in_progress`. Manager-only.

---

## 8. Alerts

- **Purpose:** the action queue — everything the system flags for a human.
- **User sees:** alert list by severity/color, each with a Hebrew label and a click action
  (see `07-ALERTS.md` for the full type catalog).
- **Actions:** open (→ marks read), resolve, delete; resolved alerts hidden from the main view.
- **NEW vs current:** super-rules formalized (opened→read, deleted-duplicate→resolves both,
  resolved→hidden). Two new types: `supplier_details_review`, `return_amount_mismatch`.
  StatusBadge **must** have a gray fallback (see `06-RULES.md`). Manager-only.

---

## 9. Settings

- **Purpose:** app configuration and admin.
- **User sees:** key/value app settings, employees list, category pool, allowed users.
- **Actions:** manage employees (CRUD), edit settings, manage allowed users / roles.
- **NEW vs current:** Drive folder targets are configured via **env vars**, not in the UI or any
  spec doc (`DRIVE_FOLDER_INVOICES` etc. — see `03-STACK.md`). Manager-only.

### Category management (C10) — **manager-only**

The owner manages the **category list** from Settings.

- **Actions:** **add / edit / delete / merge** categories.
- **Two consumers, one source:** managed categories feed BOTH (1) the **category picker** in manual
  forms (invoices, suppliers) and (2) the **list the AI extraction chooses from** during document
  parsing. Adding a category makes it immediately available to both (see `06-RULES.md` — AI
  category selection).
- **MERGE:** merging two categories into one **re-points** every invoice / record tagged with the
  old category to the merged category — **no orphaned tags**.
- **DELETE:** deleting a category in use is **blocked or requires reassignment** — either prevent
  the delete or prompt to reassign its records to another category. **Never silently orphan.**
  (Confirm exact block-vs-reassign behavior in the build.)
- **Backing store:** the existing `categories` table (name + `usage_count`) and
  `supplier_categories` — **no schema change** (see `02-ERD.md`).

---

## 10. Email ingest (background, surfaced in UI)

- **Purpose:** turn inbound emails into records automatically.
- **Pipelines:** invoices/credit notes, payments, delivery notes, returns, statements — each
  read from a labelled mailbox, extracted with AI, filed to Drive + Storage, deduped, inserted,
  and alerted on low confidence / errors.
- **User sees:** ingested items appear in their respective "arrived documents" views; low-confidence
  or failed items raise alerts.
- **NEW vs current:** delivery notes and returns each gain the **"arrived documents" view** fed by
  the email pipeline, with AI-suggested matching to manual rows.

---

## 11. Permissions

- **Purpose:** enforce the manager / employee split.
- **Behavior:** role comes from `allowed_users(email → role)`. Frontend reads via the authenticated
  anon client (RLS-governed); writes go through `hadas-api` with the service-role key. Employees
  are blocked from payments, statements and alerts at the data layer (RLS), not just the UI.
- **NEW vs current:** documented as a first-class screen-gating contract across all screens above.
