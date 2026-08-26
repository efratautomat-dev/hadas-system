# 10 — Security Audit Checklist

> **Run this audit (a) early in the v2 build, and (b) as the GATE before pushing hadas-v2 to
> production. Report first, fix only after owner approval. Deploy the fix only — do not bundle
> unfinished work into a security-sensitive deploy.**

This is a **reference document**, not an instruction to audit right now. When an audit is run,
work through the nine points below, **report all findings first**, and change nothing until the
owner approves. Each fix, once approved, ships as an **isolated deploy** — never mixed with
unrelated or unfinished work.

---

## The 9-point audit

### 1. Secrets in client code
- **Check:** no API keys, service-role keys, tokens, refresh tokens, Drive folder IDs, or
  passwords are hard-coded or bundled into the frontend (`src/`, Vite build output, `import.meta.env`
  values that ship to the browser). Only the intentionally-public anon key belongs client-side.
- **Report, don't fix until approved.**

### 2. Secrets in logs
- **Check:** no `console.log` / `console.error` / Edge Function logs print secrets, full tokens,
  JWTs, request auth headers, or PII. Grep for logging around auth and ingest paths.
- **Report, don't fix until approved.**

### 3. Endpoint auth
- **Check:** every Edge Function enforces auth — either a valid Supabase JWT (email in
  `allowed_users`) or the machine `x-hadas-key`. Confirm no route is unintentionally public, and
  that `verify_jwt` flags in `config.toml` match each function's intended auth. Flag any function
  missing from `config.toml`.
- **Report, don't fix until approved.**

### 4. Secrets in git history
- **Check:** scan the full git history (not just the working tree) for committed secrets — `.env`
  files, keys, tokens. A secret that ever landed in history must be treated as **compromised and
  rotated**, not merely deleted from HEAD.
- **Report, don't fix until approved.**

### 5. Client / server secret separation
- **Check:** the service-role key (RLS-bypassing) lives **only** server-side (Edge Functions / env),
  never in the frontend. The frontend uses the anon key + per-user JWT exclusively. Confirm no
  server-only secret leaks through a client-reachable path.
- **Report, don't fix until approved.**

### 6. DB / RLS access control
- **Check:** Row-Level Security is enabled on every table holding business data; policies enforce
  the manager/employee split at the **data layer** (employees blocked from payments, statements,
  alerts — not just hidden in the UI). Verify the documents-bucket read policy is scoped as
  intended. Confirm live `pg_policies` match the migrations.
- **Report, don't fix until approved.**

### 7. Paid-API spend limits
- **Check:** paid APIs (Anthropic/Claude extraction, Google APIs) have spend caps / usage limits /
  billing alerts so a bug or abuse can't run up unbounded cost. Confirm per-request token/size caps
  on the AI extraction path.
- **Report, don't fix until approved.**

### 8. CORS
- **Check:** CORS on the Edge Functions is no broader than needed. `*` is acceptable only because
  every endpoint is independently authenticated (JWT / `x-hadas-key`); confirm that invariant holds
  and that no state-changing route relies on the browser's origin for protection.
- **Report, don't fix until approved.**

### 9. Input validation & rate-limiting
- **Check:** endpoints validate and bound their inputs (payload size limits — e.g. the camera-
  capture max, type checks, required fields) and there is basic abuse protection / rate-limiting on
  public-facing and ingest endpoints. No unbounded loops or unvalidated pass-through to the DB.
- **Report, don't fix until approved.**

---

## Quick checklist

- [ ] 1. No secrets in client code / bundle (only the public anon key)
- [ ] 2. No secrets or PII in logs
- [ ] 3. Every endpoint enforces auth; `config.toml` `verify_jwt` correct for all functions
- [ ] 4. Git history clean of secrets; anything ever committed is rotated
- [ ] 5. Service-role key server-only; frontend uses anon key + JWT only
- [ ] 6. RLS on all business tables; manager/employee split enforced at data layer
- [ ] 7. Paid-API spend caps / billing alerts / per-request size limits in place
- [ ] 8. CORS scoped; `*` safe only because every route is independently authenticated
- [ ] 9. Inputs validated & bounded; rate-limiting / abuse protection on public + ingest routes

---

## Current baseline (from `/docs` review)

Already in place — **verify still true, don't assume**:

- **Per-user JWT + `allowed_users` allow-list** — the frontend authenticates each user with a
  Supabase JWT; the email must exist in `allowed_users` to be authorized.
- **Full RLS present** — Row-Level Security policies exist across the business tables; frontend
  reads go through the anon client governed as `authenticated`, writes go through `hadas-api` with
  the service-role key.
- **The frontend anon key is public BY DESIGN** — it is meant to ship to the browser and is safe on
  its own; it is **not** a finding. RLS + JWT are what protect the data, not anon-key secrecy.

### Open items to verify

- **Stray `.env` file in the working tree** — an untracked file named like
  `how <hash>…​.env` appears in `git status`. Inspect it: if it contains any credential, treat as
  compromised (rotate), remove it from the tree, and ensure it is git-ignored. (Point 1 / Point 4.)
- **Legacy `HADAS_SERVICE_KEY` fallback** — `hadas-api` and `suppliers-list` fall back to
  `HADAS_SERVICE_KEY` if `SUPABASE_SERVICE_ROLE_KEY` is absent. Confirm it is dead/transitional and
  remove the fallback, and confirm the key is not lingering anywhere it shouldn't. (Point 5.)

---

## DECIDED — authentication moves to JWT only (owner, 2026-08-25)

**The decision:** every caller of every edge function authenticates with a **Supabase
JWT**. The shared-secret header `x-hadas-key` is retired.

**Why.** `hadas-api`, `invoices-ingest` and `payments-ingest` all run with
`verify_jwt = false` in `supabase/config.toml` and authenticate themselves, accepting
**either** a Bearer JWT whose email is in `allowed_users` **or** a bare `x-hadas-key`
header. That second path is a single long-lived secret that:

- grants **full** access with no user behind it — nothing to attribute an action to,
  and no role to gate on, so the employee/manager split does not apply to it at all;
- has already leaked once and been rotated (2026-06-18, `docs/07-OPEN-ISSUES.md` #11);
- lives in cron job definitions, in `curl` snippets in READMEs, and in whatever N8N
  still holds — every one of them a place it can leak again;
- cannot be revoked for one caller without breaking every caller.

A JWT expires, carries an identity, and is already the mechanism the frontend uses.

### What has to be answered before implementing

1. **The cron callers.** `invoices-ingest` and `payments-ingest` are triggered by
   `pg_cron` via `net.http_post`, which has no user session. Options: a service
   account in `allowed_users` with a long-lived token, a Supabase service-role JWT
   verified by `aud`/`role` claim, or moving the trigger to a Database Webhook that
   carries one. **This is the decision the rest depends on.**
2. **The one-off tools.** `drive-migrate`, `drive-probe` and `drive-reconcile` use a
   hard-coded `?key=` in source (`docs/07-OPEN-ISSUES.md` #12) — worse than the header
   and on the same path out.
3. **The legacy N8N flow**, while it still runs in parallel on the `חשבונית` label.
4. **Rollout order** — accept both for one deploy, migrate callers, then remove the
   header, so no tick is missed in between.

### Related, and the reason this surfaced

**⚠️ `hadas-api` runs on the SERVICE-ROLE key, so it bypasses RLS *and the masking
views*.** A handler that reads a base table gets the unmasked row: `invoices_v` /
`suppliers_v` / `delivery_notes_v` are not in the path. Any handler an employee is
allowed to call must therefore **re-apply the mask by hand**.

Found the hard way on 2026-08-25: `GET /delivery-notes/:id/candidates` (the goods
pipeline's suggestion list, which employees may call per §6.7) selected
`invoices.total_amount` from the base table and returned it — handing employees, from
one endpoint, the exact figures `invoices_v` withholds everywhere else. Fixed by
masking inside the handler on the caller's role.

**The general rule, which nothing currently enforces:** every entry in
`employeeMayAccess` needs its handler read as if the views did not exist, because for
that handler they do not. A guard in the same spirit as `check-twins` would be better
than remembering.

