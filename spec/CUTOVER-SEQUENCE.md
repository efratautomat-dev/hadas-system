# Hadas v2 — PROD Cutover Sequence (zero-downtime)

> Step-by-step order for the actual prod cutover. Companion to
> `supabase/PROD-MIGRATION-CHECKLIST.sql` (the *what*); this file is the **safe ordering** (the
> *when*). Prod = `jcwphkuwwuxvjibmvgdh`. Dev = `vabfsbrrxfwgdzrbznln` (never mix).

## The core rule

The old prod frontend is currently live and reads **directly** from the base tables
(`invoices` / `suppliers` / `delivery_notes`) as the `authenticated` role. The masking migration's
`REVOKE SELECT` removes that privilege outright — PostgREST then returns `42501 permission denied`,
and **only the new code reads from the `*_v` views**.

**Therefore: the REVOKE must be the VERY LAST step, after the new frontend is already live.**
Running it any earlier breaks the live client's reads (real downtime). Everything else below is
additive and safe to stage ahead of time.

## ⚠️ The migration that must be SPLIT

`supabase/migrations/20260708000000_employee_financial_column_mask.sql` bundles **CREATE VIEW +
GRANT** (safe/additive) together with the **REVOKE** (breaking) in one file. Do **not** let a
blanket `supabase db push` apply it early — that runs the REVOKE with the old app still live.
Split it:

- **Early half** = lines **34–78**: the three `drop view … / create view …` blocks + the three
  `grant select on …_v to anon, authenticated;`.
- **Final step** = lines **83–85**: the three `revoke select on public.{invoices,suppliers,delivery_notes}
  from anon, authenticated;`.

---

## The 6 ordered steps

### 1. Additive schema — old app keeps working (still reads base tables)
- Run **§1** of the checklist (`suppliers.active` / `suppliers.needs_details`;
  `returns.detail` / `returns.employee_id` + guarded FK).
- Apply the **§3** version-controlled migrations **EXCEPT `20260708`**. This includes `20260604`
  (defines `public.current_user_role()` + enables RLS with allowed-user SELECT policies — required
  by the views). ⚠️ Before this, confirm prod's `allowed_users` is populated so the RLS SELECT
  policies keep the live manager's reads working.
- Run **§6** (create the public `branding` storage bucket).
- **Old-app impact: none** — base-table SELECT is still granted.

### 2. Create the masking VIEWS + GRANTs (additive)
- Run **only the CREATE VIEW + GRANT half** of `20260708` (lines **34–78**).
- **Do NOT run the REVOKEs yet.**
- Old app ignores `*_v`; the views now exist for the new app. No breakage.

### 3. Deploy the new Edge Functions
- Set prod secrets: `HADAS_API_KEY`, `ANTHROPIC_API_KEY`, `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`
  / `GMAIL_REFRESH_TOKEN`, `DRIVE_FOLDER_*`.
- Deploy **hadas-api + invoices-ingest TOGETHER** (they share `_shared/drive-filing.ts`; each bundles
  its own copy at deploy). New hadas-api is a backward-compatible superset — the still-live old
  frontend keeps working against it. Requires §1 columns (done in step 1).
  ```
  supabase functions deploy hadas-api       --project-ref jcwphkuwwuxvjibmvgdh
  supabase functions deploy invoices-ingest --project-ref jcwphkuwwuxvjibmvgdh
  ```

### 4. Deploy the new frontend
- Point the prod Vercel build at prod Supabase: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` =
  prod values, `VITE_DEMO_MODE=false`.
- After the swap, the live client runs new code: reads `*_v` (created in step 2), writes via the new
  hadas-api (step 3). **Base-table SELECT is still granted**, so any lingering old-code sessions
  during the deploy swap also still read fine. **No downtime.**

### 5. Run the REVOKE — LAST (the actual lockdown)
- Now that the live client is fully on new code reading `*_v`, run **only the 3 REVOKE statements**
  (lines **83–85** of `20260708`):
  ```sql
  revoke select on public.invoices       from anon, authenticated;
  revoke select on public.suppliers      from anon, authenticated;
  revoke select on public.delivery_notes from anon, authenticated;
  ```
- Closes the direct-F12 base-table bypass. The new app is unaffected (the views read the base tables
  via owner rights). No reader is broken because no live client reads the base tables anymore.

### 6. Verify (security check — `spec/10-SECURITY.md` §3.6)
- Minted **employee** JWT → base `invoices`/`suppliers`/`delivery_notes` reads = `42501`; `*_v` rows
  visible but cost columns NULL; writes 403 except `POST /returns`; payments/vendor_statements/alerts
  = 0 rows.
- Minted **manager** JWT → `*_v` return full financials; all writes reach their handlers.

---

## Why this is safe

The only privilege-removing operation (the REVOKE) is deferred until after the new `*_v`-reading
frontend is live, so there is **never a moment where a live client lacks the read privilege it
needs**. Steps 1–4 are all additive; the old app keeps reading base tables the entire time.

## Rollback note (undo the REVOKE)

Keep step 5 as its own final, deferred action. It is **trivially reversible** — if you need to roll
the frontend back to the old base-table-reading build, restore the old app's reads instantly with:

```sql
grant select on public.invoices       to anon, authenticated;
grant select on public.suppliers      to anon, authenticated;
grant select on public.delivery_notes to anon, authenticated;
```

Do **not** run step 5 until you're confident the new frontend is stable in prod.
