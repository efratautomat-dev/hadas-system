# GOODS TRACKING — delivery-notes ↔ invoices (as-built + starting spec)

**Status:** documentation of what exists **today**, as the starting point for a future
goods-tracking feature. It records the current `delivery_notes` model, every endpoint, and how
matching/linking works right now — plus the gaps a real goods-tracking feature would have to close.
No behavior is proposed as built; the "Toward goods tracking" section is forward-looking only.

Related: [`spec/DATA-DICTIONARY.md`](./DATA-DICTIONARY.md) (`delivery_notes` columns),
`docs/04-BUSINESS-LOGIC.md` (ingest rules), `spec/06-RULES.md` (unified status taxonomy).

---

## 1. What a delivery note is here

A **delivery note** (תעודת משלוח) records that *goods physically arrived* from a supplier. In this
system a `delivery_notes` row comes into existence in one of three ways:

1. **Email ingest** — a supplier emails a delivery note; `invoices-ingest` classifies it as
   `תעודת משלוח`, extracts it (Sonnet), and inserts a row. These are the "arrived" notes.
2. **In-app camera capture** — a delivery note photographed via the capture flow, routed through
   the same ingest POST path.
3. **Manual goods receipt** — an employee records that goods came in, entering a supplier + item
   list (often with no note number and no amount). These are the "manual" rows.

The **source** is *derived*, not stored: a row with a `gmail_message_id` is `source='email'`
(arrived); a row without one is `source='manual'` (`useDeliveryNotes.ts`). This mirrors the Returns
screen's derivation.

The business intent behind the table is the classic three-way match: **goods in (delivery note) ↔
bill (invoice) ↔ money out (payment)**. Today only the first link (delivery note ↔ invoice) is
partially built; payments are not part of this linkage.

---

## 2. Data model (current)

Full column list is in [`spec/DATA-DICTIONARY.md#delivery_notes`](./DATA-DICTIONARY.md#delivery_notes).
The columns that matter for goods tracking:

| Column | Role in linking |
|---|---|
| `id` | PK, `DN-<seq>`. |
| `supplier_id` / `supplier_name` | The supplier; matching is always scoped within one supplier. |
| `note_number` | Supplier's delivery-note number. Empty string for manual receipts. |
| `date` | Delivery date; used to order match candidates (most recent first). |
| `amount` / `amount_before_vat` / `vat_amount` | Financials (manager-only via `delivery_notes_v`). |
| `line_items` | **jsonb** — the goods themselves (unlike `invoices.line_items`, which is text). |
| **`invoice_id`** | **The delivery-note ↔ invoice link.** Null = unlinked. |
| `status` | Lifecycle marker (see §3). |
| `gmail_message_id` | Presence ⇒ arrived-by-email; absence ⇒ manual. Drives `source`. |
| `drive_file_link` / `storage_url` | Source document; `drive_file_link` doubles as the soft-link target in manual↔arrived matching (§5). |

Two distinct "links" exist on this table, and they are easy to confuse:

- **`invoice_id`** — links a delivery note to an **invoice** (goods ↔ bill). Set/cleared by the
  `/link` and `/unlink` endpoints.
- **`drive_file_link` + `note_number` copied onto a manual row** — a *soft* link between a **manual
  receipt and its arrived (email) counterpart** (goods-in-hand ↔ supplier's own document). This is
  not an FK; it just points the manual row's "show supplier document" button at the arrived note's
  file. Set by the `/match` endpoint or by editing those two fields.

There is **no FK constraint** on `invoice_id` and no reciprocal pointer on `invoices` — the link is
one-directional (delivery note → invoice) and enforced only in application code.

---

## 3. Status vocabulary (current, inconsistent)

`delivery_notes.status` is written with different values by different code paths, and the UI
normalizes all of them down to two buckets. This is a known rough edge to clean up before building
on top of it.

| Value | Written by | Meaning |
|---|---|---|
| `pending` | table default; manual create (`createDeliveryNote`) | New / awaiting handling. |
| `pending_match` | email ingest (`invoices-ingest`) | Arrived, not yet matched to a manual receipt or invoice. |
| `unlinked` | camera-capture ingest; `/unlink` endpoint | Not linked to an invoice. |
| `linked` | `/link` endpoint | Linked to an invoice. |
| `archived` | (archival flow) | Done / filed away. |

**UI normalization** (`DeliveryNotes.tsx`): `normalizeStatus()` collapses
`pending`/`unlinked`/`ממתינה לשיוך` → **pending** and `archived`/`משויכת` → **archived**;
`deliveryStatusInternal()` then maps onto the unified taxonomy in `spec/06-RULES.md`
(pending → `new`, archived → `done`). Note the ingest value `pending_match` and the `linked` value
are **not** explicitly handled by `normalizeStatus` and fall through to the `pending` default.

> **Gap:** five status strings from four writers, collapsed to two buckets, with `pending_match`
> and `linked` not first-class in the normalizer. A goods-tracking feature needs one agreed
> status enum.

---

## 4. Endpoints (`hadas-api`)

All delivery-note writes go through the `hadas-api` edge function (service-role, RLS bypassed).
Reads go through the `delivery_notes_v` masking view via the anon client (`useDeliveryNotes.ts`).

| Method & path | Handler | What it does |
|---|---|---|
| `GET /delivery-notes` | `getDeliveryNotes` | List notes; optional `?supplier_id=` and `?status=` filters; ordered by `date` desc. |
| `POST /delivery-notes` | `createDeliveryNote` | Create a **manual goods receipt**. Requires only a supplier; defaults `note_number=''`, `date=today`, `amount=0`, `status='pending'`. Resolves/auto-creates the supplier by ח.פ / name. |
| `PUT /delivery-notes/:id` | `updateDeliveryNote` | Update whitelist: `status`, `invoice_id` (via `invoiceId`/`linkedInvoiceId`), `amount`, `date`, `supplier_name`, plus the soft-link fields `drive_file_link` + `note_number`. |
| `PUT /delivery-notes/:id/link` | `linkDeliveryNote` | Set `invoice_id = <id>` and `status = 'linked'`. Requires `invoice_id` in the body. |
| `PUT /delivery-notes/:id/unlink` | `unlinkDeliveryNote` | Clear `invoice_id` and set `status = 'unlinked'`. |
| `POST /delivery-notes/:id/match` | `matchDeliveryNote` | Auto-match an **arrived** note to a **manual** receipt for the same supplier (§5). |
| `DELETE /delivery-notes/:id` | `deleteDeliveryNote` | Delete the row. |

The ingest function (`invoices-ingest`) and the capture POST path insert rows **directly** (not via
these endpoints):
- Email ingest inserts with `status='pending_match'`, full extracted fields, `gmail_message_id`
  set, `invoice_id=null`.
- Camera capture inserts a minimal row with `status='unlinked'`, `note_number=''`, `amount=0`.

Frontend surface: `useDeliveryNotes.ts` exposes `create`, `setMatch`, `update`, `link`, `unlink`,
`remove`; `DeliveryNotes.tsx` is the screen.

---

## 5. How matching works today

There are **two independent matching mechanisms**. Neither compares line items or amounts — both
match purely on supplier + recency, and both are advisory (a human confirms/overrides).

### (a) Delivery note → invoice link (`invoice_id`)
Entirely **manual**, done from the delivery-note detail modal:
1. The modal lists the selected note's supplier's invoices
   (`invoicesData.filter(i => i.supplierId === note.supplierId || i.supplier === note.supplierName)`).
2. The user picks one invoice and confirms → `PUT /delivery-notes/:id/link` sets `invoice_id` and
   `status='linked'`.
3. "בטל שיוך" → `PUT /delivery-notes/:id/unlink` clears it.

There is **no automatic** delivery-note→invoice suggestion — the store owner eyeballs it.

### (b) Manual receipt ↔ arrived note soft-match (`/match`)
`matchDeliveryNote` (AI-suggested, confirmable) reconnects a manually-entered goods receipt with
the supplier's own delivery-note document once it arrives by email:
1. Given an **arrived** note (`gmail_message_id` present), find manual receipts for the **same
   supplier** (`gmail_message_id IS NULL`), most recent first.
2. Pick the most recent one **not already linked** (no `drive_file_link`).
3. Copy the arrived note's `drive_file_link` + `note_number` onto that manual row.

The result: the manual row's "הצג מסמך מספק" button now opens the supplier's document. The user can
confirm/override/unmatch by editing `drive_file_link`/`note_number` (`setMatch` →
`PUT /delivery-notes/:id`). This mirrors how Returns store a supplier credit-note doc on the return
row. In `DeliveryNotes.tsx` the picker is `arrivedForSelected` (arrived notes for the selected
manual row's supplier).

### Dedup at ingest
Email ingest dedups delivery notes before insert: primary key
`(gmail_message_id, note_number, supplier_id)`; fallback `(gmail_message_id, supplier_id)` when the
note has no number. Duplicates are skipped and logged.

---

## 6. What does NOT exist today (gaps)

- **No line-item / quantity reconciliation.** `line_items` (jsonb) is stored but never compared;
  matching ignores *what* and *how much* arrived. There is no per-SKU received-vs-billed tracking.
- **No amount-based matching.** Links are supplier + recency only; amounts are never checked
  against the invoice.
- **No delivery-note→invoice automation.** That link is 100% manual (§5a).
- **No reciprocal link or FK.** `invoice_id` has no FK constraint; `invoices` has no pointer back to
  its delivery notes. Nothing enforces one-note-one-invoice or many-notes-one-invoice.
- **No partial / over / under-delivery model.** No concept of a note being partially received,
  back-ordered, or over-shipped. (`invoices.partial_return` exists but is about returns, not
  deliveries.)
- **No payment leg.** Delivery notes connect to invoices, not to `payments`; the three-way match
  (goods ↔ bill ↔ money) is not closed.
- **Status sprawl** (§3): five values, two buckets, `pending_match`/`linked` not normalized.
- **No goods-level entities.** No products/SKU table; `line_items` are free-form on each document,
  so "how many of item X are on order / received / outstanding across suppliers" is unanswerable.

---

## 7. Toward a goods-tracking feature (forward-looking, not built)

Open design questions and candidate directions — to be decided when the feature is scoped:

1. **One agreed status enum** for `delivery_notes`, replacing the five current strings; make
   `pending_match` and `linked` first-class instead of collapsing them.
2. **Line-item reconciliation.** Normalize `line_items` (align `delivery_notes.line_items` jsonb
   with `invoices.line_items`, currently text — flagged in `docs/02` as an inconsistency to fix),
   then compare received vs billed quantities/amounts and surface discrepancies as alerts.
3. **Assisted delivery-note→invoice matching**, analogous to the credit-note↔return matcher in
   ingest: suggest the likely invoice by supplier + date window + amount, for the owner to confirm.
4. **Cardinality + integrity.** Decide many-notes-to-one-invoice vs one-to-one; add an FK on
   `invoice_id`; consider a reciprocal view of notes-per-invoice on the invoice screen.
5. **Partial / back-order states** so a delivery can be tracked as partially received against an
   order or invoice.
6. **Close the three-way match** by tying the goods→bill link through to `payments`, giving a
   single goods-in / billed / paid status per supplier order.
7. **Products/SKU dimension** (larger): a goods entity so quantities can be tracked across
   documents and suppliers rather than living as free text on each note.

None of §7 is implemented; it records the direction the current model points toward.
