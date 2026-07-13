# Hadas — System Documentation (Index)

**Hadas** is a Hebrew / RTL invoice & supplier-management system for a single retail business.
Supplier invoices, payments, delivery notes, returns/credit-notes and vendor statements arrive by
**email**; an `invoices-ingest` Supabase Edge Function pulls them from labeled Gmail, classifies
and extracts them with **Anthropic Claude** (Haiku classifier + Sonnet extractor), files the
source files in **Google Drive** and **Supabase Storage**, and writes structured rows to
**Supabase Postgres**. A **React + Vite** front end (hosted on **Vercel**) lets the owner and her
employees review everything — suppliers, invoices, payments, deliveries, returns, ledgers,
statement reconciliation, alerts and logs — talking to a `hadas-api` CRUD Edge Function. A legacy
**N8N** flow still runs in parallel during cutover. This documentation reverse-engineers the
system **as the repository stands today** (read-only); it is meant to be the single source of
truth for a rebuild.

> **Conventions:** Hebrew strings appear in `backticks` to preserve exact values (they are matched
> literally in code). Secrets are never shown — only variable names, with values as `[REDACTED]`.
> Anything not verifiable from the repo alone is marked **⚠️ NEEDS OWNER CONFIRMATION**.

## Documents
| File | Contents |
|---|---|
| [00-INDEX.md](./00-INDEX.md) | This overview + map of all docs. |
| [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | Stack, hosting, full repo tree, build/deploy flow, env var names, third-party integrations. |
| [02-DATA-MODEL.md](./02-DATA-MODEL.md) | Every table (columns/types/defaults/keys/indexes) from migrations, storage bucket, and all RLS policies. **Schema source: migrations only — live schema not verified.** |
| [03-FEATURES.md](./03-FEATURES.md) | Screen-by-screen: what the user sees and does, and the components / hooks / endpoints behind each. |
| [04-BUSINESS-LOGIC.md](./04-BUSINESS-LOGIC.md) | The non-obvious rules: status derivation, duplicate detection, balances, credit-note matching, Drive overflow routing, AI/JSON repair, retries, Bizibox, magic numbers. |
| [05-API.md](./05-API.md) | Every Edge Function endpoint: method, path, auth (JWT vs `x-hadas-key`), request/response, `verify_jwt`. |
| [06-DESIGN-SYSTEM.md](./06-DESIGN-SYSTEM.md) | Colors, fonts, spacing/radius/shadow tokens, status & alert palettes, RTL conventions, logo. |
| [07-OPEN-ISSUES.md](./07-OPEN-ISSUES.md) | Bugs, dead code, stubs, "temporary" hacks, inconsistencies, and items needing owner confirmation. |

## Reading order for a rebuild
1. **01-ARCHITECTURE** — the lay of the land.
2. **02-DATA-MODEL** — the persistence layer (capture live DDL for the ⚠️ gaps first).
3. **05-API** + **04-BUSINESS-LOGIC** — the server contract and the rules behind it (the "meat").
4. **03-FEATURES** + **06-DESIGN-SYSTEM** — the UI surface.
5. **07-OPEN-ISSUES** — what to fix or decide while rebuilding.
