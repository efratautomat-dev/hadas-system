# invoices-ingest

Edge Function that pulls invoice emails from Gmail, extracts the data with Anthropic, uploads the attachment to Google Drive, and writes a row into Postgres.

Sibling function: `payments-ingest` (same patterns, same auth header).

---

## TEST MODE

Currently listens on the Gmail label **`ספקים`** (manually populated) instead of the production label `חשבונית`. The existing N8N flow continues to own `חשבונית` in parallel.

To go live:

```ts
// supabase/functions/invoices-ingest/index.ts
const SOURCE_LABEL_NAME = "חשבונית"; // ← change from "ספקים"
```

That's the only line that needs changing — the label ID is resolved at runtime via `labels.list`.

---

## Secrets required

Set under **Supabase → Edge Functions → Secrets**.

| Secret                  | Purpose                                                                          | Status                                                  |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `HADAS_API_KEY`         | Auth header for both ingest functions (`x-hadas-key`)                            | Already set                                             |
| `GMAIL_CLIENT_ID`       | OAuth client                                                                     | Already set                                             |
| `GMAIL_CLIENT_SECRET`   | OAuth client                                                                     | Already set                                             |
| `GMAIL_REFRESH_TOKEN`   | OAuth refresh token — **needs Drive scope** (see below)                          | **Regenerate**                                          |
| `GMAIL_USER_EMAIL`      | Recipient for manager-facing alert emails                                        | Already set                                             |
| `ANTHROPIC_API_KEY`     | For Haiku (classifier) + Sonnet (extractor)                                       | **Add**                                                 |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for DB writes                                               | Already set                                             |

### Adding Drive scope to the refresh token

The existing refresh token only has Gmail scopes — to upload files to Drive you must regenerate it with Drive included.

1. Open the OAuth Playground: <https://developers.google.com/oauthplayground/>
2. ⚙️ → "Use your own OAuth credentials" → paste your `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`.
3. In the left pane select these scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/drive.file`
4. **Authorize APIs** → sign in with the Gmail account.
5. **Exchange authorization code for tokens** → copy the **refresh_token**.
6. Update `GMAIL_REFRESH_TOKEN` in Supabase secrets.

The function uses one token for both Gmail and Drive — no second OAuth client needed.

---

## Gmail labels

The function will **auto-create** these destination labels on first run if they're missing:

- `טופל` — generic "handled" (applied to every processed email)
- `הועבר לרוח` — invoices that were successfully ingested (mirrors N8N convention)
- `תעודות משלוח` — delivery notes
- `כרטסות` — vendor statements
- `חזרות` — return docs
- ~~`דורש בדיקה ידנית`~~ — **no longer applied (2026-08-19).** Ingest raised an
  alert AND labelled the mailbox, so a flagged item sat in two queues and only
  one of them ever got cleared. The alerts screen is the single review queue;
  the mailbox now records only that ingest ran. Old labels are harmless and can
  be deleted by hand.

The **source** label (`ספקים` in test mode, `חשבונית` in production) must already exist — the function will not create it. The source label is **removed** from each message after processing.

If you want to pre-create them manually, just create the labels in Gmail under any parent you like — naming is what matters, not the parent.

---

## Database

Run migration `supabase/migrations/20260520000000_invoices_ingest.sql` before first deploy. It adds:

- `categories` table (free-form tag pool, learned from usage)
- `supplier_categories` table (per-supplier category history → drives AI hint)
- `invoices` columns: `partial_return`, `gmail_message_id`, `email_subject`, `gmail_label_source`, `month_folder_link`
- Unique index on `invoices.gmail_message_id` (idempotency)
- `system_logs` table (every function action logged here for debugging)

---

## Cron schedule

After the function deploys, run this once in the Supabase SQL Editor. The
`Authorization` (legacy anon JWT) and `x-hadas-key` headers must match the
existing `payments-ingest-cron` job — fetch the canonical values any time with
`select command from cron.job where jobname = 'payments-ingest-cron';` and
substitute them for `{ANON_JWT}` and `{HADAS_API_KEY}` below. Do not commit the
real `x-hadas-key` value to the repo.

```sql
select cron.schedule(
  'invoices-ingest-cron',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://jcwphkuwwuxvjibmvgdh.supabase.co/functions/v1/invoices-ingest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer {ANON_JWT}',
      'x-hadas-key',   '{HADAS_API_KEY}'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

To inspect or remove later:

```sql
select * from cron.job where jobname = 'invoices-ingest-cron';
select cron.unschedule('invoices-ingest-cron');
```

---

## Manual trigger

The Invoices page in the UI has a **"סנכרן מיילים"** button that POSTs to this function with the `x-hadas-key` header. Useful for testing without waiting for the 5-minute cron tick.

You can also trigger from the CLI:

```bash
curl -X POST \
  -H "x-hadas-key: $HADAS_API_KEY" \
  https://jcwphkuwwuxvjibmvgdh.supabase.co/functions/v1/invoices-ingest
```

Response shape:

```json
{ "processed": 3, "alerts": 1, "skipped": 2, "errors": [], "ts": "2026-05-20T08:15:30.123Z" }
```

---

## Observability

All function actions write to the `system_logs` table with `source = 'invoices-ingest'`. The **לוגי מערכת** page in the UI (sidebar) is a filterable viewer for that table. Auto-refreshes every 30 seconds.

`makeLogger(supabase, docType?)` takes an optional **category tag**. When present it lands in both places the owner looks — prefixed onto the message (`[כרטסת] …`) and as `context.docType` in the jsonb column, which is filterable. The statement path passes `STATEMENT_LOG_TAG`; the argument is optional, so every other call site is unchanged and untagged.

---

## Vendor statements (כרטסת)

A statement is the only document type that is **reconciled on arrival**, so it has a few rules of its own. All of it lives in the `else` branch of `handleNonInvoice`.

**Extraction** (`extractStatement`) is deliberately narrow — `{"vendor_name":"","hp":"","closing_balance":null,"period":""}`. `closing_balance` is the supplier's final balance due at the foot of the page and is the **only** amount extracted: it is the one figure the reconciliation compares, and the line detail is reviewed by eye against the attached document. When the page has no unambiguous closing balance the model returns `null` — it never guesses, because a guessed balance produces a confident wrong verdict. The amount is rounded to the agora (`round₂`) and is **not** run through `completeAmounts()`; a statement has no VAT split.

Budgets: **2048** tokens on the first attempt, **3072** on the retry. This is the only all-Hebrew, rule-heavy prompt in the file, and Hebrew runs roughly one token per 1–2 characters — the original 512 was exhausted mid-JSON, `parseJsonRobust` found no closing `}`, and because the retry reused the same ceiling it failed identically, so the feature failed **100%** of the time. `max_tokens` is a ceiling and billing is on tokens actually produced, so raising it is not a cost increase. There is **no assistant prefill**: `claude-sonnet-4-6` rejects a last-assistant-turn prefill with HTTP 400, so JSON-only output is enforced by an explicit no-preamble instruction (`STATEMENT_JSON_ONLY`) instead. A response that stops on `max_tokens` now writes a `warn` row to `system_logs`, not just `console.warn`.

> **Exactly one attempt plus one retry, then throw.** No loop, no third call. The throw is caught in `handleNonInvoice`; the row still saves and the email is still labelled processed (only a **DB insert** failure returns `false` and requeues the email).

**On extraction failure** the row is saved with `status = 'needs_review'` and **`vendor_balance = NULL`** (nullable since migration `20260818000000`) — never `0`, which the screen would render as a real ₪0 balance and a gap the size of the whole ledger; `comparableRow` in `StatementReconciliation.tsx` renders `—` for `NULL` and skips the comparison. A `statement_extract_failed` alert is raised, its payload pointing at the **source email** (`messageLink` / `subject`) rather than at a row — an empty statement row tells the owner nothing; the document does.

**Supplier identification** (`resolveStatementSupplier`) is an ordered chain, and which rule fired is recorded in `vendor_statements.match_method`:

| # | signal | column matched | `match_method` |
|---|---|---|---|
| 1 | ח.פ off the document | `suppliers.hp` (exact, digits-only) | `hp` |
| 2 | vendor name off the document | `findBestSupplier`, 0.85 fuzzy (+ `alt_names`) | `name` |
| 3 | the **email subject** | `findBestSupplier`, 0.85 fuzzy (+ `alt_names`) — no format required, the name just has to appear | `subject` |
| 4 | sending address | `suppliers.email` (exact, case-insensitive) | `email` |
| 5 | sending address | the newest `invoices.email_sender` that matches → that invoice's `supplier_id` | `invoice_email` |
| 6 | — | nothing matched → `supplier_id = null` | `none` |

**The document outranks the sender, and that order is load-bearing.** The address steps were briefly promoted above the name on the reasoning that "exact evidence beats a guess" — but an exact match on the sender is evidence of *who sent the file*, not *whose statement it is*. Steps 4–5 remain as a fallback because a statement is a printout of the supplier's *own* bookkeeping and frequently carries neither ח.פ nor a company name we can match. The whole `From` header is stored in `vendor_statements.email_sender`; only the address part is compared.

> **Both address steps are skipped entirely when the sender is the ingest mailbox** (`GMAIL_USER_EMAIL` — config, never a hardcoded address; an unset value logs one `warn` and carries on). The owner scans statements herself and mails them to her own address, so the sender is systematically her. Step 5 additionally filters the `invoices.email_sender` corpus, which is **poisoned**: the camera-capture path stores `capturedBy` as the sender, so every photographed invoice carries an employee's or the owner's address. Rows with `gmail_label_source = 'צילום ידני'` and rows from the ingest mailbox are excluded from that lookup — without it, a self-mailed statement matched whichever supplier was photographed most recently.

> **A statement never creates a supplier.** Every other path (`resolveSupplier`) auto-creates one and raises `supplier_incomplete`. Here that rule inverts: the extracted name is unreliable in exactly the cases where matching failed, so auto-creating would mint an empty card from a mis-read heading — which then becomes a fuzzy-match target for real **invoices** and splits a live supplier's balance in two. An unmatched statement is filed as an **orphan** (`match_method = 'none'`) and the manager assigns it from a dropdown.

**Reconciliation** runs only when the supplier *and* the closing balance are both known. It loads that supplier's invoices, payments and `opening_balance` and calls `buildLedger` from `../_shared/ledgerEngine.ts` — the byte-locked twin of `src/lib/ledgerEngine.ts`, so the server and the screen cannot disagree (`spec/06-RULES.md §9`). `status` is `matched` when the difference is **exactly zero** (no tolerance band) and `mismatch` otherwise; a mismatch raises a `statement_mismatch` alert carrying `statementId` for UI routing. If either side is missing, the row stays `needs_review` with no alert — there is nothing to compare. `our_balance` / `diff` are written as a **record of the filing date only**; nothing reads them back, every screen recomputes live.

`month` now takes the statement's **own** period when the document states one, falling back to the email-received month only when it doesn't (a June כרטסת routinely arrives in July).

---

## Limitations / TODOs

- Delivery notes and returns are matched into their dedicated tables; **statements** are fully handled (see above). Historically this bullet claimed the matching was stubbed — it no longer is.
- A supplier flagged **בהסדר תשלום** gets no automatic verdict: the ledger engine forces such a balance to `0` for display, so a comparison against a real vendor figure would read as a mismatch every time. The true figures are recorded and the row is left `needs_review`. **Pending an owner decision.**
- `returns` has no sender/email column, so the address a credit note arrived from cannot be persisted on the row (it is kept in the `unmatched_credit_note` alert payload only). Needs a migration to fix properly.
- Inline-link emails that hit an HTML login page generate an alert but don't auto-resolve the link.
- The AI extractor decides the category freely from the `categories` table; a per-supplier override is set as a hint only after at least one prior invoice from that supplier has been categorised.
