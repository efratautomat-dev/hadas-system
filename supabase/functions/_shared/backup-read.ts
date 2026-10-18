// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  backup-read (shared)                                                     ║
// ║  Reads one table completely — and PROVES it read all of it.               ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// This is the load-bearing part of the whole backup, so it lives on its own,
// behind an injected reader, and is exercised directly by
// `scripts/backup-guard-check.mjs` against a fake table that misbehaves on
// purpose. A guard nobody has watched fail is a guard nobody has tested.
//
// THE PROBLEM. PostgREST answers at most 1000 rows. A plain `select('*')` on
// `invoices` returns a tenth of the table and reports complete success — the
// resulting file is a backup that is quietly short, which is worse than having no
// backup at all, because it is trusted.
//
// Paging fixes that, and introduces a subtler failure of its own. `.range()` is
// OFFSET/LIMIT against a live table, not a snapshot: insert a row that sorts
// early while page 3 of 9 is being fetched and every later window shifts by one,
// so one row comes back twice and another is never seen. `rows.length` still
// equals the count. The data is wrong and every obvious check says it is right.
//
// Hence: count DISTINCT KEYS, not array length.
//   · duplicates present      → the window moved. THROW; upload nothing.
//   · fewer than the count    → re-count. Equal? rows were deleted mid-read, which
//                               is not a broken backup: warn and accept.
//                               Still short? THROW.
//   · more than the count     → rows were inserted mid-read. A snapshot slightly
//                               newer than its own count is fine: note it.

import type { BackupTableSpec } from "./backup-tables.ts";

/**
 * The two database operations a complete read needs. Injected rather than taking
 * a Supabase client, so the guard above can be driven by a table that lies.
 */
export interface TableReader {
  /** Exact row count, as of now. Called again when a read comes up short. */
  count(table: string): Promise<number>;
  /** Rows [from..to] inclusive, ordered by every column of `orderBy` ascending. */
  page(table: string, orderBy: string[], from: number, to: number): Promise<Record<string, unknown>[]>;
}

export type ReadLog = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
) => Promise<void> | void;

export interface TableResult {
  spec:     BackupTableSpec;
  rows:     Record<string, unknown>[];
  /** The count the table reported BEFORE the read. */
  expected: number;
  pages:    number;
  warnings: string[];
}

/**
 * Joins a row's key columns into one comparable string.
 *
 * NUL is the separator because it cannot occur inside a Postgres text value.
 * Any printable separator lets two different composites collide into one key —
 * ("a b", "c") and ("a", "b c") would both become "a b c" — and a collision makes
 * the distinct count too low, which reports a complete read as short.
 */
export function compositeKey(row: Record<string, unknown>, columns: string[]): string {
  return columns.map(c => String(row[c] ?? "")).join("\u0000");
}

export class IncompleteReadError extends Error {
  // Declared as plain fields rather than constructor parameter properties: the
  // latter are TypeScript-only sugar that a type-STRIPPING runtime cannot
  // compile away, and scripts/backup-guard-check.mjs loads this module that way.
  readonly table: string;
  readonly expected: number;
  readonly collected: number;

  constructor(table: string, expected: number, collected: number, message: string) {
    super(message);
    this.name      = "IncompleteReadError";
    this.table     = table;
    this.expected  = expected;
    this.collected = collected;
  }
}

export interface ReadOptions {
  pageSize: number;
  /** TEST ONLY: stop after this many pages, to prove the guard fires. */
  debugMaxPages?: number;
}

export async function readTable(
  reader: TableReader,
  spec:   BackupTableSpec,
  opts:   ReadOptions,
  log:    ReadLog,
): Promise<TableResult> {
  if (!spec.orderBy.length) {
    throw new Error(`${spec.table}: no orderBy columns — a read with no total order cannot be verified`);
  }
  const pageSize = Math.max(1, Math.min(1000, opts.pageSize));
  const warnings: string[] = [];

  const expected = await reader.count(spec.table);

  const rows: Record<string, unknown>[] = [];
  let from  = 0;
  let pages = 0;

  for (;;) {
    const page = await reader.page(spec.table, spec.orderBy, from, from + pageSize - 1);
    for (const row of page) rows.push(row);
    pages++;

    if (opts.debugMaxPages && pages >= opts.debugMaxPages) break;
    // A short page is the end of the table. Equal to pageSize means there may be
    // more, so ask again — a table whose size is an exact multiple of the page
    // size ends on an empty page, which costs one request and removes a guess.
    if (page.length < pageSize) break;
    from += pageSize;
  }

  const distinct = new Set(rows.map(r => compositeKey(r, spec.orderBy))).size;

  // (a) The window moved under us.
  if (distinct !== rows.length) {
    throw new IncompleteReadError(
      spec.table, expected, distinct,
      `${spec.table}: paging returned ${rows.length - distinct} duplicate row(s) out of ${rows.length} ` +
      `(ordered by ${spec.orderBy.join(", ")}) — the table changed while it was being read, ` +
      `so some rows were fetched twice and others not at all`,
    );
  }

  // (b) Short. Deleted rows are legitimate; a lost page is not.
  if (distinct < expected) {
    const recount = await reader.count(spec.table);
    if (recount === distinct) {
      warnings.push(`${spec.table}: ${expected - distinct} שורות נמחקו בזמן הקריאה`);
      await log("warn", `${spec.table}: shrank during the read (${expected} → ${recount}) — accepted`, {
        table: spec.table, expected, collected: distinct,
      });
    } else {
      throw new IncompleteReadError(
        spec.table, expected, distinct,
        `${spec.table}: INCOMPLETE — collected ${distinct} of ${expected} rows ` +
        `(re-count says ${recount}) across ${pages} page(s) of ${pageSize}`,
      );
    }
  }

  // (c) Longer than the count: inserts during the read.
  if (distinct > expected) {
    warnings.push(`${spec.table}: ${distinct - expected} שורות נוספו בזמן הקריאה`);
    await log("info", `${spec.table}: grew during the read (${expected} → ${distinct})`, {
      table: spec.table, expected, collected: distinct,
    });
  }

  return { spec, rows, expected, pages, warnings };
}
