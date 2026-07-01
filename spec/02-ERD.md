# 02 — ERD / Data Model

> **Base = the verified live schema in `/docs/02-DATA-MODEL.md`. The new build runs against the
> SAME database — do not redesign tables, only note required additions.**
> This document lists ONLY the additions/changes the rebuild requires on top of the live schema.
> For the authoritative column-by-column table definitions, indexes and RLS, read
> `/docs/02-DATA-MODEL.md`.

---

## Tables (unchanged — same production DB)

`suppliers`, `invoices`, `payments`, `returns`, `delivery_notes`, `vendor_statements`,
`alerts`, `employees`, `allowed_users`, `app_settings`, `categories`, `supplier_categories`,
`system_logs`, `ingest_failures`. **Do not redesign these.**

---

## Required additions / changes

### A. `source` field on `returns` and `delivery_notes`

Add a `source` column to **both** tables to drive the two-view UX (PRD §5, §6):

- `source text` with values `manual` | `email`.
- `email` = created by the AI ingest pipeline (shows in the "arrived documents" view).
- `manual` = typed in by staff (shows in the "manual entry" view).
- Backfill: rows that have a `gmail_message_id` / `source_email` → `email`; the rest → `manual`.
- Suggested default for new manual inserts: `manual`.

> `payments` already has a `source` column (`email` for ingest); this mirrors that convention
> onto `returns` and `delivery_notes`.

**Confirmed:** this `source` (`manual` | `email`) addition on **`returns`** and **`delivery_notes`**
**stays** — it is required to drive the two-view / goods-receipt UX.

### B. `line_items` representation → **keep as TEXT** (both tables)

**Decision: keep `line_items` as `text` for BOTH `invoices` and `delivery_notes`. Do NOT migrate
to jsonb.** Line items are captured and rendered as a plain newline-delimited string; there is no
requirement to query or structure them relationally. New writes stay text everywhere.

> The live schema currently has `invoices.line_items` as `text` and `delivery_notes.line_items` as
> `jsonb`, but the ingest already writes a newline-joined string into both — so treating both as
> text matches actual behavior and avoids a needless migration. (Superseded: the earlier
> "unify to jsonb" instruction is dropped.)

### C. `active` flag on `suppliers`

Add `active boolean default true` to **`suppliers`** (mirrors `employees.active`).

- **Inactive suppliers are hidden from the normal suppliers view**, reachable via an
  "inactive" filter / search.
- This **replaces hard supplier deletion** — delete is blocked by `409 HAS_INVOICES` when invoices
  reference the supplier (see `01-PRD.md §2`), so deactivation is the supported way to retire a
  supplier while preserving history.
- Backfill: existing rows → `true`.

### D. Status taxonomy migration

Migrate every status column to the **unified taxonomy** defined in `06-RULES.md`. Old values are
mapped to new ones there (per table). High level:

| Table | Old values | → New |
|---|---|---|
| `invoices` | `ממתין`, sent-to-accountant | `new`, `done` |
| `payments` | `פעיל`, `cancelled` | `new`/`done`, `cancelled` |
| `returns` | `בטיפול`/`אושר`/`הסתיים`/`נדחה` (all) | `new`; `closed` (set when a matching credit note is linked) |
| `delivery_notes` | `pending`, `linked`, `unlinked`, `archived` | `new`, `matched`, `new`, `done` |
| `vendor_statements` | `pending`, `matched`, `mismatch`, `investigating`/`needs_review` | `new`, `matched`, `mismatch`, `in_progress` |
| `alerts` | `unread`, `read`, `resolved` | `new`, `in_progress`, `done` |

See `06-RULES.md` for the exact mapping table, Hebrew labels, colors, and the **StatusBadge
fallback** requirement (unknown status → gray + raw label, never crash).

### E. Category management — **no schema change**

Category management (C10, see `01-PRD.md §9`) uses the **existing** `categories` (name +
`usage_count`) and `supplier_categories` tables — **no new tables or columns required**. Two
behavioral constraints on the existing data:

- **MERGE re-points references:** merging categories must repoint all tagged invoices/records to the
  merged category — no orphaned tags.
- **DELETE must guard or reassign:** deleting a category in use must be blocked or reassign its
  records to another category — **never orphan**.

---

## Notes for the migration

- The DB is shared with production — run additions as additive migrations first (new `source`
  columns and `suppliers.active` nullable / defaulted), backfill, then enforce.
- The status remap should be reversible / run in a transaction. **No `line_items` type migration** —
  it stays `text` (see §B).
- There are **no balance RPCs** in the DB; do not add any. Balance is computed in the frontend
  (see `06-RULES.md §2`).
