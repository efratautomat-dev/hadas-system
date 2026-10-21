// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  backup-tables (shared)                                                   ║
// ║  WHAT the weekly backup saves, what it deliberately does not, and in what  ║
// ║  order a restore would have to put it back.                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ⚠️ `supabase/dev-schema.sql` is the authoritative schema, NOT the migrations
// folder — the core tables predate it. This list is derived from there.
//
// Two lists, not one. A table that is absent from BOTH is a table nobody has
// classified, and the run says so out loud (alert `backup_table_unlisted`)
// rather than quietly leaving it out of every backup until someone needs it.
// `BACKUP_EXCLUDED` is therefore part of the contract, with its reason attached,
// and it is written into the manifest so the exclusion is auditable from the
// backup itself and not only from this file.
//
// Hebrew labels sit in one contiguous block at the TOP of each entry's line, the
// same shape DRIVE_SUBFOLDERS / HEBREW_MONTHS already take in drive-filing.ts.
// (String.fromCharCode is reserved for a Hebrew word embedded mid-logic — the
// one case that needed it. Twenty labels written that way would be unreviewable.)

export interface BackupTableSpec {
  /** Table name in the `public` schema. */
  table: string;
  /**
   * The column(s) that UNIQUELY identify a row, in order. Not cosmetic, and not
   * optional: `.range()` paging over a non-unique or unstable order is not a
   * snapshot — rows get skipped and duplicated between pages. readTable() orders
   * by all of these and counts DISTINCT composites to prove nothing was lost.
   *
   * An array because two tables have a COMPOSITE primary key and one of them has
   * no `id` column at all. A single-column assumption here reads a column that
   * does not exist.
   */
  orderBy: string[];
  /** Hebrew name, carried into the run summary so the UI needs no label map. */
  label: string;
  /** Excel sheet name: ≤31 chars, unique, none of [ ] : * ? / \ */
  sheet: string;
}

export const BACKUP_TABLES: BackupTableSpec[] = [
  { table: "suppliers",              orderBy: ["id"],    label: "ספקים",              sheet: "ספקים" },
  { table: "employees",              orderBy: ["id"],    label: "עובדים",             sheet: "עובדים" },
  { table: "allowed_users",          orderBy: ["email"], label: "משתמשים מורשים",      sheet: "משתמשים" },
  { table: "categories",             orderBy: ["id"],    label: "קטגוריות",           sheet: "קטגוריות" },
  { table: "supplier_categories",    orderBy: ["id"],    label: "קטגוריות לפי ספק",    sheet: "קטגוריות ספק" },
  { table: "invoices",               orderBy: ["id"],    label: "חשבוניות",           sheet: "חשבוניות" },
  { table: "payments",               orderBy: ["id"],    label: "תשלומים",            sheet: "תשלומים" },
  { table: "returns",                orderBy: ["id"],    label: "חזרות",              sheet: "חזרות" },
  { table: "delivery_notes",         orderBy: ["id"],    label: "תעודות משלוח",        sheet: "תעודות משלוח" },
  { table: "orders",                 orderBy: ["id"],    label: "הזמנות",             sheet: "הזמנות" },
  { table: "vendor_statements",      orderBy: ["id"],    label: "כרטסות",             sheet: "כרטסות" },
  { table: "supplier_notes",         orderBy: ["id"],    label: "הערות ספק",           sheet: "הערות ספק" },
  { table: "ledger_resets",          orderBy: ["id"],    label: "איפוסי כרטסת",        sheet: "איפוסי כרטסת" },
  { table: "ledger_marks",           orderBy: ["supplier_id", "row_id"], label: "סימוני ✓ בכרטסת", sheet: "סימוני כרטסת" },
  { table: "alerts",                 orderBy: ["id"],    label: "התראות",             sheet: "התראות" },
  { table: "app_settings",           orderBy: ["key"],   label: "הגדרות",             sheet: "הגדרות" },
  { table: "ingest_failures",        orderBy: ["gmail_message_id"], label: "כשלי קליטה", sheet: "כשלי קליטה" },

  // ── The two composite keys. delivery_note_invoices has NO `id` column; both
  // would have been read with a non-existent single key had the shape above not
  // been an array.
  { table: "delivery_note_invoices", orderBy: ["delivery_note_id", "invoice_id"],
    label: "קישור תעודה-חשבונית", sheet: "קישורי תעודות" },
  // "This note has been dealt with" — a human judgement about one note, not
  // derivable from any other row, and therefore business data. Added after the
  // inventory diff caught it missing: it arrived with the notes work and would
  // otherwise have been absent from every backup.
  { table: "note_handled",           orderBy: ["source_key", "record_id"],
    label: "הערות שטופלו",        sheet: "הערות שטופלו" },
];

export const BACKUP_EXCLUDED: { table: string; why: string }[] = [
  {
    table: "system_logs",
    why: "Diagnostics, not a business fact — every row it describes exists in " +
         "another table. It is also the only UNBOUNDED table in the schema (a " +
         "five-minute ingest cron writes to it forever), so including it would " +
         "make the weekly run's size and memory grow without limit and would " +
         "dominate both artifacts. If it is ever wanted, the right shape is a " +
         "separate retention-limited export, not a line in BACKUP_TABLES.",
  },
  {
    table: "ingest_lock",
    why: "A single-row mutex. Restoring a held lease would leave ingest " +
         "permanently convinced another run is in flight. State that only means " +
         "something to a process which is not running is worse than no state.",
  },
  {
    table: "backup_runs",
    why: "The backup's own log. A backup of the record of backups adds nothing " +
         "to a restore and grows a self-reference nobody reads.",
  },
];

/**
 * FK-safe order for putting the data back, written into the manifest.
 *
 * Restore is deliberately out of scope for this feature — but a set of files
 * nobody can establish an insert order for is not a backup, it is an archive.
 * Making a restore POSSIBLE costs one array; it is not the same as building one.
 */
export const RESTORE_ORDER: string[] = [
  "allowed_users",
  "employees",
  "categories",
  "app_settings",
  "suppliers",            // ← everything below references suppliers
  "supplier_categories",
  "supplier_notes",
  "note_handled",         // references suppliers; record_id is deliberately not an FK
  "ledger_resets",
  "ledger_marks",         // supplier_id deliberately not an FK (merge_suppliers)
  "invoices",
  "payments",
  "returns",
  "delivery_notes",
  "delivery_note_invoices", // ← references delivery_notes AND invoices
  "orders",
  "vendor_statements",
  "alerts",
  "ingest_failures",
];

/**
 * What this backup CANNOT reach, named so that "full snapshot" is never read as
 * "everything". Written into the manifest and shown in the Settings panel: the
 * difference between an assumption and a known limit.
 */
export const BACKUP_GAPS: { what: string; why: string }[] = [
  {
    what: "auth.users",
    why: "A different schema, not exposed through PostgREST. A restore recreates " +
         "logins; allowed_users carries the email → role map that decides who is " +
         "a manager.",
  },
  {
    what: "Supabase Storage objects",
    why: "The document files themselves (documents + branding buckets). Not row " +
         "data, and the invoice originals are already in Drive from ingest.",
  },
  {
    what: "The Drive source documents",
    why: "Deliberate: they are already in Drive. Backing them up into Drive would " +
         "duplicate what is being protected, in the same place.",
  },
];

/** Sanity: no duplicate table, no duplicate sheet name, every sheet ≤31 chars. */
export function validateBackupTables(): string[] {
  const problems: string[] = [];
  const seenTable = new Set<string>();
  const seenSheet = new Set<string>();

  for (const t of BACKUP_TABLES) {
    if (seenTable.has(t.table)) problems.push(`duplicate table in BACKUP_TABLES: ${t.table}`);
    seenTable.add(t.table);
    if (seenSheet.has(t.sheet)) problems.push(`duplicate sheet name: ${t.sheet}`);
    seenSheet.add(t.sheet);
    // Excel's own limits, asserted here rather than discovered in a corrupt file.
    if ([...t.sheet].length > 31) problems.push(`sheet name over 31 chars: ${t.sheet}`);
    if (/[[\]:*?/\\]/.test(t.sheet)) problems.push(`sheet name has a forbidden char: ${t.sheet}`);
  }

  for (const t of BACKUP_TABLES) {
    if (!t.orderBy.length) problems.push(`no orderBy columns: ${t.table}`);
  }

  const inRestore = new Set(RESTORE_ORDER);
  for (const t of BACKUP_TABLES) {
    if (!inRestore.has(t.table)) problems.push(`missing from RESTORE_ORDER: ${t.table}`);
  }
  for (const name of RESTORE_ORDER) {
    if (!seenTable.has(name)) problems.push(`in RESTORE_ORDER but not backed up: ${name}`);
  }
  return problems;
}
