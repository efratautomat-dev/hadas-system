# 08 — Bugs

> Bugs found during build. Format: date | file | issue | status.

| Date | File | Issue | Status |
|---|---|---|---|
| 2026-07-01 | DeliveryNotes.tsx | Manual goods-receipt add is local-state only, never persisted to DB | open |
| 2026-07-01 | payments/bizibox export | On rebuild, verify Bizibox export is byte-identical: the two dates, format, and exported stamp — nothing breaks | open |
| 2026-07-01 | hadas-api returns handlers | Dead increment/decrement_supplier_balance RPC calls (6 sites) to be removed | open |
