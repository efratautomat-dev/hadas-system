# 03 — Stack & Build Approach

> Technology stack and the rebuild strategy. No secrets, tokens, or Drive folder IDs appear in
> this document — those live only in environment variables.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | **React + TypeScript + Vite** |
| UI | RTL throughout, Heebo font (see `04-DESIGN.md`) |
| Backend | **Supabase** — Auth, Postgres DB, Edge Functions (Deno) |
| Hosting | **Vercel** (frontend, auto-deploy on push to `main`) |
| Database | **Same Supabase DB as production** (see `02-ERD.md`) |
| AI | Claude models via Edge Functions (extraction / classification) |

---

## Build approach

1. **Fresh build in an isolated repo** — `hadas-v2`. The rebuild does not edit the current repo
   in place; it is a clean implementation.
2. **Dev Supabase project** for development — separate from production so schema/data experiments
   are safe.
3. **Cut env over to production only when ready** — when the rebuild is verified against the dev
   Supabase, switch the env vars (Supabase URL/keys, Drive folders) to production and deploy.
   The production DB schema is the one in `02-ERD.md`.

---

## Drive filing

The system files each document type to a Google Drive folder. **Folder targets are resolved from
environment variables — their IDs are NOT stored in this document or any spec file.**

| Env var | Used for |
|---|---|
| `DRIVE_FOLDER_INVOICES` | invoice documents |
| `DRIVE_FOLDER_DELIVERY` | delivery notes |
| `DRIVE_FOLDER_RETURNS` | returns / credit notes |
| `DRIVE_FOLDER_STATEMENTS` | supplier statements |

Documents are also copied to the private Supabase Storage `documents` bucket
(`{docType}/{YYYY}/{MM}/{filename}`); viewers mint short-lived signed URLs. Drive folder IDs and
all API keys/tokens stay in env / secret storage only.
