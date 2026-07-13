# STATUS-REVIEW — Code vs `/docs` vs `/spec`

> A three-way review of where the **current codebase** stands against the **reverse-engineered
> current-system docs** (`/docs`) and the **target rebuild spec** (`/spec`).
> Read-only analysis — no source file was modified.
> Generated 2026-07-01.

**Legend:** ✅ matches spec · ⚠️ partial / diverges · ❌ not built / conflicts · 📄 doc-only note

Sources cross-checked: live source under `src/` and `supabase/functions/`, the current-system
docs in `/docs`, and the target spec in `/spec`. Line references are to files as they stand in the
working tree today.

---

## PART 1 — Current state overview (screen by screen)

High-level status of each area against the spec. Deep-dives on the four flagged items are in
PART 2; genuine open decisions are in PART 3.

### Screens

- [ ] **Dashboard** — ⚠️ exists; spec wants the two confirmed widgets (debt-by-supplier, open
  credits) surfaced directly. Not verified as present in this pass.
- [x] **Suppliers / SupplierDetail / Ledger** — ⚠️ balance is computed in the frontend
  (`src/hooks/useSuppliers.ts:38-54`) as `opening_balance + Σ invoices − Σ (non-cancelled
  payments)`, matching the spec's "no balance RPCs" intent **for invoices+payments**. BUT
  **returns are not subtracted** anywhere in that computation, and `SupplierLedger.tsx` reads
  hard-coded `mockLedgerEntries` (docs/07 #5). Invoices are matched to suppliers by **name string**;
  payments by **id** (fragile — see PART 3).
- [x] **Invoices** — ⚠️ built. Status is **derived live in the frontend** into three Hebrew strings
  (`הועבר לרו״ח` / `בבדיקה` / `ממתין`, `Invoices.tsx:23-25,49-55`), ignoring the stored column;
  spec wants the unified `new`/`done` taxonomy. `line_items` handled as **text** end-to-end
  (see PART 2.3). No gray StatusBadge fallback on the invoice badge.
- [x] **Payments** — ✅ mostly aligned. `reference`/`ref` is **optional to save** (required only to
  BizBox-export, `Payments.tsx:327,470,1051-1062`) — matches spec §4. Status vocabulary is English
  `paid`/`pending`/`cancelled` (not unified). No gray badge fallback (closed union).
- [ ] **DeliveryNotes (spec: two-view + AI matching)** — ❌ diverges. Screen exists
  (`DeliveryNotes.tsx`) but its toggle is **pending-only vs all-including-archive**, NOT
  arrived-from-email vs manual. No AI-suggested matching UX. **Manual add is local-state only**
  (`addNote` → `setNotes(...)`, never calls the API, `:167-184`) — manual delivery notes are **not
  persisted**. No `source` column (uses `source_email`).
- [ ] **Returns (spec: two-view + AI matching, drop amount field)** — ❌ diverges. Screen exists
  (`Returns.tsx`) as a **single list**; no arrived/manual split, no AI-match accept/correct.
  Manual-create form still includes the amount field. Status is Hebrew `אושר`/`בטיפול`/`נדחה`.
  No `source` column.
- [ ] **StatementReconciliation (spec: auto-reconcile + alert)** — ❌ see PART 2.1 & 2.2. Single
  list, hard-coded demo detail rows, no auto-matching, no mismatch alert.
- [x] **Alerts** — ⚠️ built. Statuses normalized to `new`/`read`/`resolved` (`useAlerts.ts:36`,
  legacy `unread`→`new`). Super-rules (opened→read, resolved→hidden) partially present; the two new
  types (`supplier_details_review`, `return_amount_mismatch`) and `statement_mismatch` auto-raise
  are not wired (statements don't auto-alert — PART 2.2).
- [x] **Settings** — ⚠️ built; Backup tab is a stub (docs/07 #6).
- [x] **Email ingest** — ⚠️ `invoices-ingest` + `payments-ingest` run; non-invoice matching
  (delivery notes / statements / returns) is stubbed (docs/07 #2). Runs in **test mode** on a
  non-production Gmail label (docs/07 #7 — and see PART 3 on which label).

### Cross-cutting

- **Status taxonomy** — ❌ not unified. Invoices & returns use Hebrew; payments, statements,
  alerts, delivery_notes use assorted English tokens. Spec §06-RULES wants one shared
  `new`/`in_progress`/`done`/`cancelled` + `matched`/`mismatch` vocabulary.
- **StatusBadge gray fallback (mandatory, 06-RULES §1)** — ⚠️ present only in
  `StatementReconciliation` (falls back to `pending`, not gray+raw-label) and `DeliveryNotes`.
  **Absent** in Invoices, Payments, Returns badges (closed unions, would not render an unknown
  status).
- **`source` column (spec 02-ERD §A)** — ⚠️ only `payments` has it. `returns` and `delivery_notes`
  do **not** (delivery_notes uses `source_email` = sender address, a different thing).
- **Auth** — ✅ frontend sends Bearer JWT, `hadas-api` accepts JWT or `x-hadas-key` (matches spec
  05-API). Legacy `HADAS_SERVICE_KEY` fallback still wired (docs/07 #10).

---

## PART 2 — Flagged mismatches (code now vs spec wants)

### 2.1 — Statement two-view

**Spec wants** (01-PRD §5/§6/§7, 10): DeliveryNotes, Returns and — by the same pattern —
statement/arrived-document surfaces present **two views**: an **"arrived documents"** view fed by
the email ingest (supplier + AI-parsed fields + link to source doc) and a **"manual entry"** view,
with AI-suggested matching between them.

**Code does now:** `StatementReconciliation.tsx` renders a **single table** (`רשימת כרטסות`,
`:476-615`) with five status stat-cards as filters (`:385-397`) and one supplier search bar. There
is **no** arrived-vs-manual split and **no** matching UX. The only nod to email origin is the
`needs_review` status ("Default status for statements ingested from email", `:47-49`). The
`DetailModal` shows a side-by-side our-ledger vs vendor-ledger, but that detail is **hard-coded mock
data**: `stmtDetails` contains a single entry `'VS-002'` (`:53-67`); every other statement shows
"אין פירוט זמין לכרטסת זו" (`:228`). Confirmed by docs/07 #4.

**Gap:** two-view layout + AI-matching not built; statement detail is demo data, not backend-driven.

---

### 2.2 — Statement auto-reconcile

**Spec wants** (01-PRD §7, 05-API "Statements", 07-ALERTS): on ingest, **every incoming statement
is auto-matched against the supplier ledger; on mismatch an alert is created** (`statement_mismatch`,
red, routes to StatementReconciliation).

**Code does now:** `hadas-api` `createStatement` (`index.ts:550-570`) is a **bare insert** — no
ledger lookup, no comparison, no alert. `diff` and `status` come straight from the request body
(defaults `0` / `"pending"`). `resolveStatement` (`:572-584`) only writes the fields the client
supplies. No reconciliation logic exists in the function, and the ingest path for statements is part
of the stubbed non-invoice handler (docs/07 #2).

**Gap:** auto-match-on-ingest and mismatch-alert creation are entirely unimplemented; reconciliation
is manual and client-driven.

---

### 2.3 — `line_items` → jsonb

**Spec wants** (02-ERD §B, 01-PRD §3): unify `line_items` to **jsonb** for both `invoices` and
`delivery_notes`; migrate `invoices.line_items` text→jsonb; new writes use jsonb everywhere to remove
per-screen render branching.

**Code does now:** `line_items` is treated as **text** end-to-end — there is **no
`JSON.parse`/`JSON.stringify` of `line_items` anywhere** in the repo.

| Location | Behavior |
|---|---|
| `invoices-ingest/index.ts:1733` (→ invoices) | `extracted.line_items.join("\n")` — AI `string[]` joined to a **newline-delimited text string** |
| `invoices-ingest/index.ts:2303` (→ delivery_notes) | same `join("\n")` — a plain **string written into the jsonb column** |
| `hadas-api index.ts:138,159` (invoiceToRow) | passed through verbatim, no serialization |
| `hadas-api index.ts:374,393` (createDeliveryNote) | `line_items ?? null` pass-through |
| `src/hooks/useInvoices.ts:38` | read as a **string** (`r.line_items ?? ''`) |
| `Invoices.tsx:415` | edited in a plain textarea bound to a string |

**Gap:** `invoices.line_items` is text in the DB (docs/02-DATA-MODEL) and text in code.
`delivery_notes.line_items` is **jsonb** in the DB but the ingest feeds it a **newline-joined
string** (not a structured array) — so neither side is truly structured jsonb yet. Spec's unify-to-
jsonb migration + structured writes are not done.

---

### 2.4 — Dead balance RPCs

**Spec wants** (09-IDEAS §3, 02-ERD §note, 06-RULES §2, 05-API returns-note): **remove** the dead
`increment_supplier_balance` / `decrement_supplier_balance` RPC calls — the functions do **not exist**
in the live DB; balance is computed in the frontend.

**Code does now:** six live call sites remain, all in the returns handlers of
`supabase/functions/hadas-api/index.ts`, all gated on the Hebrew literal `"אושר"`:

| Line | Handler | Trigger | Call |
|---|---|---|---|
| 488 | `createReturn` | create with `status === "אושר"` | `decrement_supplier_balance` |
| 511 | `updateReturn` | prev≠אושר → new=אושר | `decrement_supplier_balance` |
| 513 | `updateReturn` | prev=אושר → new≠אושר | `increment_supplier_balance` (prev.amount) |
| 516 | `updateReturn` | stays אושר, amount changed | `decrement_supplier_balance` (diff) |
| 537 | `updateReturnStatus` | prev≠אושר → אושר | `decrement_supplier_balance` |
| 539 | `updateReturnStatus` | prev=אושר → ≠אושר | `increment_supplier_balance` |

Errors are not checked, so the calls **silently no-op** against the live DB (only two SQL functions
exist — `get_my_role`, `current_user_role`; docs/02-DATA-MODEL:349-364, docs/07 #19). The effective
balance is the frontend computation in `useSuppliers.ts`, which **does not subtract returns at all**.

**Gap:** the calls are dead weight and should be deleted per spec — but note the side-effect they
*intended* (approved returns reducing supplier balance) is **not reflected anywhere** once removed.
That is a real open decision (PART 3).

---

## PART 3 — Conflicts & open decisions

Cases where code, `/docs`, and `/spec` don't line up and it's **not obvious which is correct**.
Options are presented neutrally — the owner decides.

### C1 — How should approved returns affect the supplier balance?

- **Spec (06-RULES §2):** "Approved returns / credits reduce the balance (they are credits)."
- **Spec (09-IDEAS §3, 05-API):** delete the return balance-RPC side-effects.
- **Code (`useSuppliers.ts:38-54`):** frontend balance = `opening_balance + Σ invoices −
  Σ payments`. **Returns are not subtracted.** The only (dead) mechanism that ever touched returns
  was the non-existent RPCs.

**The conflict:** removing the dead RPCs (spec) leaves the spec's own "returns reduce balance" rule
with **no implementation**. Options:
- **(a)** Add returns to the frontend balance formula (`− Σ approved returns`) and delete the RPCs.
- **(b)** Delete the RPCs and treat returns as ledger-only (visible in the ledger, not in the
  headline balance) — matches today's actual behavior.
- **(c)** Reintroduce a real DB function/trigger to adjust a stored balance (contradicts the
  "no balance RPCs / compute in frontend" decision).
> Decision needed: **which of a/b/c** is the intended balance semantics for returns.

### C2 — `delivery_notes.line_items`: jsonb column fed a plain string

- **Docs (02-DATA-MODEL:182):** `delivery_notes.line_items` is **jsonb**.
- **Spec (02-ERD §B):** unify both to structured **jsonb**.
- **Code (`invoices-ingest:2303`):** writes `extracted.line_items.join("\n")` — a **newline string**
  into that jsonb column (stored as a JSON string scalar, not an array).

**The conflict:** the column is already jsonb, but nothing writes structured jsonb into it; and
`invoices.line_items` is text. Options for the unify migration:
- **(a)** Standardize on a structured jsonb **array of item objects** everywhere (change both writers
  + readers). Highest value, most work.
- **(b)** Keep it a jsonb **string** for now (minimal change) and defer structuring.
- **(c)** Standardize on **text** everywhere instead of jsonb (contradicts spec, but matches the
  simpler current invoice handling).
> Decision needed: the **canonical `line_items` shape** (structured array vs string) before writing
> the migration.

### C3 — Return status vocabulary (`אושר`/`בטיפול`/`נדחה` vs `הסתיים` vs unified)

- **Code UI (`Returns.tsx:14`, `useReturns.ts:5`):** `אושר` / `בטיפול` / `נדחה`.
- **Code ingest (`invoices-ingest`):** closes returns with `הסתיים` and treats "open" as
  `!= הסתיים` — a **fourth** value the UI doesn't render (docs/07 #16).
- **Spec (06-RULES §1):** map to unified `in_progress` / `done` / `cancelled` — and the balance-RPC
  branches key on the literal `"אושר"`, which the taxonomy migration would rename.

**The conflict:** three different vocabularies in play (UI, ingest, spec). A status migration must
reconcile `הסתיים` and `אושר` → a single "done/approved" state **and** update the `"אושר"` literal
in the (soon-to-be-removed) RPC branches. Coupled with C1.
> Decision needed: the **single canonical return-status set** and the mapping for `הסתיים`.

### C4 — StatusBadge fallback: mandatory rule vs current closed unions

- **Spec (06-RULES §1, mandatory):** every StatusBadge renders an **unknown status gray with the raw
  label** and never crashes.
- **Code:** only `StatementReconciliation` (falls back to `pending`, *not* gray+raw) and
  `DeliveryNotes` (gray fallback) partially comply. `Invoices`, `Payments`, `Returns` badges use
  closed unions with **no** unknown-fallback.

**The conflict:** current code doesn't satisfy the mandatory rule, and even the two that "fall back"
don't do the gray+raw-label behavior the spec requires. Not a "which is right" ambiguity so much as a
**confirm the rule is binding for all six screens** (it appears to be — spec calls it mandatory).
> Decision needed: confirm all badges must migrate to the shared gray+raw-label fallback component.

### C5 — Which Gmail source label is actually deployed?

- **Project memory:** invoices-ingest test label is `ספקים`.
- **Docs (07 #7):** the code read shows `מסמכים מספקים`; memory says `ספקים` — "these disagree —
  verify which is deployed."
- **Spec (03-STACK):** going live = switching to the production `חשבונית` label (owned by N8N today).

**The conflict:** three candidate labels (`ספקים`, `מסמכים מספקים`, `חשבונית`) and no repo-only way
to know which is live. Not code-vs-spec so much as **unverifiable deploy state**.
> Decision needed: owner confirms the **exact current source label** and the cutover trigger.

### C6 — Supplier↔invoice join key: name-string vs id

- **Code (`useSuppliers.ts`):** invoices summed to a supplier by **`supplier_name` string match**;
  payments by **`supplier_id`**. The balance mixes two join keys.
- **Spec (02-ERD):** treats suppliers as id-keyed; docs/02 notes name-matching fragility.

**The conflict:** name-based matching is fragile (rename / whitespace / duplicate names silently drop
invoices from the balance). Options:
- **(a)** Migrate invoice→supplier matching to `supplier_id` (requires invoices to carry a reliable
  FK; confirm the column is populated).
- **(b)** Keep name-matching (matches today's behavior; accept fragility).
> Decision needed: whether the rebuild standardizes the supplier join on `id`.

### C7 — Manual delivery-note create is not persisted (likely a bug, not a design choice)

- **Code (`DeliveryNotes.tsx:167-184`):** `addNote` only does `setNotes(prev => [newNote, ...prev])`
  — it never calls the API, so manually-added delivery notes vanish on reload.
- **Spec (01-PRD §5, 05-API):** manual delivery notes are first-class rows created via
  `POST /delivery-notes`.

**The conflict:** current behavior contradicts the spec and looks like an oversight rather than an
intended local-only mode. Listed here because the two-view rebuild depends on manual rows being real
persisted records to match against arrived documents.
> Decision needed: confirm this is a bug to fix in the rebuild (wire `addNote` → `POST
> /delivery-notes`), not intentional.

### C8 — No DELETE route for returns, and BizBox export path name

- **Docs (07 #15):** `hadas-api` has POST/PUT/PUT-status for returns but **no DELETE**, while the
  Returns UI exposes delete actions — how is deletion performed today? (anon client? unimplemented?)
- **Docs (07 #14):** router exposes `POST /payments/mark-bizbox-exported` (`:816`); some client code
  referenced `/payments/bizbox-exported` — confirm `src/lib/api.ts` calls the exact path or the stamp
  silently 404s.
- **Spec (05-API):** documents the returns endpoints without a DELETE and the
  `mark-bizbox-exported` path as canonical.

**The conflict:** a UI action (return delete) with no matching endpoint, and a path-name drift risk on
BizBox export. Both are ⚠️-confirm items in docs/07, not resolved in spec.
> Decision needed: define the returns-delete contract, and verify the BizBox export path end-to-end.

---

## Appendix — quick mismatch checklist

- [ ] Statement two-view built (PART 2.1) — **not built**
- [ ] Statement auto-reconcile + mismatch alert (PART 2.2) — **not built**
- [ ] `line_items` unified to structured jsonb (PART 2.3) — **text everywhere; dn column jsonb but fed a string**
- [ ] Dead balance RPCs removed (PART 2.4) — **6 calls remain**
- [ ] `source` column on returns & delivery_notes (02-ERD §A) — **missing on both**
- [ ] Unified status taxonomy (06-RULES §1) — **mixed Hebrew/English per table**
- [ ] Mandatory gray StatusBadge fallback on all screens (06-RULES §1) — **partial (2 of 6)**
- [x] Payments `reference` optional to save (01-PRD §4) — **done**
- [x] Frontend balance for invoices+payments, no effective RPC (06-RULES §2) — **done (returns excluded — see C1)**
