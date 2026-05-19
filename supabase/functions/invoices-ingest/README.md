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
- `דורש בדיקה ידנית` — anything the classifier or extractor couldn't handle confidently

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

After the function deploys, run this once in the Supabase SQL Editor (replace `{ANON_KEY}` and `{HADAS_API_KEY}` with the real values):

```sql
select cron.schedule(
  'invoices-ingest-cron',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://jcwphkuwwuxvjibmvgdh.supabase.co/functions/v1/invoices-ingest',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'Authorization',  'Bearer {ANON_KEY}',
      'x-hadas-key',    '{HADAS_API_KEY}'
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

---

## Limitations / TODOs

- Non-invoice doc types (delivery notes, statements, returns) are uploaded to Drive but the **matching logic into their dedicated tables is stubbed**. Look for `TODO` comments in `handleNonInvoice`.
- Inline-link emails that hit an HTML login page generate an alert but don't auto-resolve the link.
- The AI extractor decides the category freely from the `categories` table; a per-supplier override is set as a hint only after at least one prior invoice from that supplier has been categorised.
