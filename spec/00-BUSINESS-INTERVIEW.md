# 00 — Business Interview

> **Source business interview — basis for PRD & RULES.**
> This is the raw business context captured from the owner. The PRD (`01-PRD.md`) and
> RULES (`06-RULES.md`) are derived from this document.

---

## The business

- **Store:** "Hadas" — a clothing store.
- **Scale:** ~100 active suppliers, ~80 invoices per month.
- **Central entity:** the **goods receipt** (קבלת סחורה). Everything the system does ultimately
  revolves around what arrived from a supplier, whether it matches what was ordered/invoiced,
  and what is still owed or credited.

---

## Core needs

1. **Full supplier management + ledger**
   - Maintain every supplier's details (contact, tax id, category, opening balance).
   - A running ledger per supplier: opening balance, invoices add debt, payments reduce it,
     credits/returns reduce it. Always know what is owed to whom.

2. **Goods receipt & matching**
   - Record what physically arrived (delivery notes) and match it against the corresponding
     invoice and/or order.
   - Surface anything that does not line up.

3. **Discrepancy logging**
   - When a delivery, invoice, or statement does not match expectations, log the discrepancy
     so it can be investigated and closed.

4. **Returns with credit tracking**
   - Record goods returned to a supplier and track the **credit** owed back until a supplier
     credit note closes it.

5. **AI email ingest**
   - Invoices, payments, delivery notes, returns and statements arrive by email. The system
     reads those emails, extracts the structured data with AI, files the document, and creates
     the corresponding record — with human review where confidence is low.

6. **Bizibox export**
   - Produce an export (Excel) for the bookkeeper's Bizibox system.

7. **Role separation**
   - **Manager:** full access, including cost prices and payments.
   - **6 employees:** operational access only — **no cost prices**, no payments, no statements.

---

## Integrations

- **Kaspit POS** — point-of-sale. **Future** integration (separate phase).
- **Bizibox** — bookkeeping. **No API** — integration is via **Excel export** only.

---

## Reports needed

- **Debt by supplier** — how much is owed to each supplier right now.
- **Open credits** — returns/credits not yet closed by a supplier credit note.

---

## Design / brand notes (see `04-DESIGN.md`)

- Hebrew, RTL throughout. Brand red, 🪷 lotus logo.
