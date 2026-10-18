// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  backup-run                                                               ║
// ║  The weekly snapshot of the whole database into Google Drive.              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// The system had no backup at all. Everything the business knows — suppliers,
// invoices, payments, balances, statements, notes — lived in one copy, in one
// Supabase project. This function is the second copy.
//
// WHAT IT WRITES, per run, into <root>/גיבויים/<year>/<Hebrew month>/גיבוי <date>/
//   <table>.json × 18   the restorable artifact: every column, full fidelity
//   גיבוי <date>.xlsx    the readable one: a sheet per table (see _shared/xlsx-write.ts)
//   _manifest.json      row census, exclusions with reasons, restore order, gaps
//
// FIVE RULES THIS FUNCTION IS BUILT AROUND
//
//  1. A SHORT BACKUP IS WORSE THAN NO BACKUP. PostgREST caps a response at 1000
//     rows; a naive read of `invoices` would return a tenth of it and look
//     perfectly successful. Every table is paged, and the pages are proved
//     against an exact count by DISTINCT KEY — not by array length, because a row
//     inserted mid-paging shifts the window and duplicates one row while dropping
//     another, leaving the length right and the data wrong. A mismatch fails the
//     whole run and uploads nothing.
//
//  2. NOTHING REACHES DRIVE UNTIL EVERY TABLE IS READ. A read failure must cost
//     zero Drive writes, so there is no half-folder to mistake for a backup.
//
//  3. `_manifest.json` IS UPLOADED LAST, and is therefore the completeness mark:
//     a folder without one is a run that died mid-upload, visible to the eye
//     without consulting anything.
//
//  4. THE DATABASE ROW IS THE RECORD, NOT THE HTTP REPLY. pg_net reports a
//     timeout long before a full dump finishes and nobody is awake at 04:00 on a
//     Monday. `backup_runs` is what the Settings panel and the next run read.
//
//  5. FAILURE SAYS WHERE IT STOPPED. `error_stage` carries 'read:invoices' or
//     'upload' or 'quarter-copy'. "The backup failed" is not something anyone can
//     act on; "it stopped reading invoices at 4,120 of 4,213" is.
//
// AUTH: `x-hadas-key` ONLY — deliberately no JWT path. Both callers are machines:
// pg_cron, and hadas-api proxying the owner's button after doing its own
// manager-role check. A JWT path here would be a fourth copy of role resolution
// guarding a payload that contains every figure invoices_v exists to hide.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DRIVE_ROOT_ID,
  driveEnsureFolder,
  driveFindFolder,
  driveGetFolderLink,
  driveListChildren,
  driveUploadFile,
  driveCopyFile,
  driveTrashFile,
  isDriveFolder,
} from "../_shared/drive-filing.ts";
import { getGoogleAccessToken } from "../_shared/google-auth.ts";
import {
  readTable,
  IncompleteReadError,
  type TableReader,
  type TableResult,
} from "../_shared/backup-read.ts";
import {
  BACKUP_TABLES,
  BACKUP_EXCLUDED,
  BACKUP_GAPS,
  RESTORE_ORDER,
  validateBackupTables,
  type BackupTableSpec,
} from "../_shared/backup-tables.ts";
import {
  BACKUP_ROOT_FOLDER,
  QUARTERS_FOLDER,
  backupFolderName,
  backupFolderNameWithSuffix,
  backupFolderPlan,
  isBackupFolderName,
  israelDateParts,
  previousQuarter,
  quarterFolderName,
  quarterStartDate,
  type Quarter,
} from "../_shared/backup-layout.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hadas-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function validateKey(key: string | null): boolean {
  const expected = Deno.env.get("HADAS_API_KEY");
  return !!expected && key === expected;
}

/** PostgREST's own ceiling. Overridable per request so the paging loop can be
 *  exercised against a small dev dataset — the only realistic way to test it. */
const DEFAULT_PAGE_SIZE = 1000;
/** A lease older than this belonged to a run that died; it is swept, not honoured. */
const LEASE_STALE_MINUTES = 30;
/** Format version of the manifest. Bump when its shape changes. */
const MANIFEST_VERSION = 1;

// ─── Logging ────────────────────────────────────────────────────────────────
// Same shape as invoices-ingest's logger. system_logs is the screen the owner
// actually reads (לוגי מערכת), not the Deno function log.

type Level = "debug" | "info" | "warn" | "error";
type Logger = (level: Level, message: string, context?: Record<string, unknown>) => Promise<void>;

function makeLogger(supabase: SupabaseClient, runId: () => string | null): Logger {
  return async (level, message, context) => {
    const id = runId();
    console.log(`[${level}] ${message}`, context ? JSON.stringify(context) : "");
    try {
      const { error } = await supabase.from("system_logs").insert({
        source:     "backup-run",
        level,
        message,
        context:    context ?? null,
        // Correlates every line of one run, the way message_id does for an email.
        message_id: id,
      });
      if (error) console.error(`[logger] system_logs insert failed: ${error.message}`);
    } catch (e) {
      console.error("[logger] system_logs insert threw:", e instanceof Error ? e.message : String(e));
    }
  };
}

// ─── Alerts ─────────────────────────────────────────────────────────────────
// Shaped like invoices-ingest's insertAlertOnce but keyed differently: that one
// dedups on payload->>gmailMessageId, which is load-bearing for twenty call
// sites and means nothing here. Generalising it to serve both would put a backup
// feature's diff inside the ingest alert path.

async function raiseAlertOnce(
  supabase: SupabaseClient,
  log:      Logger,
  alert:    { type: string; title: string; message: string; severity: string; payload: Record<string, unknown> },
  dedupKey: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("alerts")
      .select("id")
      .eq("type", alert.type)
      .filter(`payload->>${dedupKey}`, "eq", String(alert.payload[dedupKey] ?? ""))
      .limit(1);
    if (existing && existing.length > 0) {
      await log("info", `alert suppressed (already exists): ${alert.type}`, { existingId: existing[0].id });
      return;
    }
    const { error } = await supabase.from("alerts").insert({ ...alert, status: "unread" });
    if (error) await log("error", `alert insert failed (${alert.type}): ${error.message}`);
  } catch (e) {
    // An alert that cannot be raised must never be the reason a backup is
    // reported as failed — the run row already carries the truth.
    await log("error", `alert raise threw (${alert.type}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── The reader behind the completeness guard ───────────────────────────────
// The guard itself — paging, and proving the pages against an exact count by
// DISTINCT KEY — lives in ../_shared/backup-read.ts, where it can be driven by a
// table that misbehaves on purpose (`npm run check:backup`). This is only the
// Supabase wiring for it.

function supabaseReader(supabase: SupabaseClient): TableReader {
  return {
    async count(table) {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (error) throw new Error(`count failed: ${error.message}`);
      return count ?? 0;
    },
    async page(table, orderBy, from, to) {
      let q = supabase.from(table).select("*");
      // Order by EVERY key column: one column is not a total order on a composite
      // key, and .range() over a partial order is not a snapshot.
      for (const col of orderBy) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(from, to);
      if (error) throw new Error(`read at offset ${from} failed: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    },
  };
}

// ─── Serialising ────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function jsonFile(result: TableResult, generatedAt: string): Uint8Array {
  return enc.encode(JSON.stringify({
    table:       result.spec.table,
    label:       result.spec.label,
    generatedAt,
    rowCount:    result.rows.length,
    expected:    result.expected,
    orderBy:     result.spec.orderBy,
    rows:        result.rows,
  }, null, 2));
}

/**
 * Union of every key present across the rows, in first-seen order.
 *
 * `select('*')` returns the columns as they are, so a column added to the schema
 * later appears here with no change to this function — which is why the column
 * list is derived and never hard-coded.
 */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen: string[] = [];
  const have = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!have.has(key)) { have.add(key); seen.push(key) }
    }
  }
  return seen;
}

/** A cell as the spreadsheet should hold it. Objects and arrays (jsonb columns)
 *  become compact JSON text — readable, and never the string "[object Object]". */
function cellValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  try { return JSON.stringify(v) } catch { return String(v) }
}

// ─── The backup ─────────────────────────────────────────────────────────────

interface RunRow { id: string }

interface BackupBody {
  mode?:          "weekly" | "year-end-cleanup";
  force?:         boolean;
  triggeredBy?:   "cron" | "manual";
  actorEmail?:    string;
  /** Plan + counts only. Writes NO Drive files and NO run row — a dry run that
   *  showed up in the history as a successful backup would be the exact lie this
   *  feature exists to remove. */
  dryRun?:        boolean;
  pageSize?:      number;
  debugMaxPages?: number;
  /** TEST ONLY: pretend the run happens at this instant, to exercise the quarter
   *  and month boundaries without waiting three months for one. */
  now?:           string;
  /** year-end-cleanup only. */
  year?:          number;
  confirm?:       boolean;
}

async function runWeeklyBackup(
  supabase: SupabaseClient,
  body:     BackupBody,
): Promise<Response> {
  let runId: string | null = null;
  const log = makeLogger(supabase, () => runId);

  const now      = body.now ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) return json({ error: `bad \`now\`: ${body.now}` }, 400);
  const plan     = backupFolderPlan(now);
  const pageSize = Math.max(1, Math.min(1000, body.pageSize ?? DEFAULT_PAGE_SIZE));
  const started  = Date.now();

  // A list that contradicts itself (duplicate sheet name, a table missing from
  // the restore order) would produce an unopenable workbook or an unrestorable
  // set. Cheap to check, and it checks the thing a reviewer cannot see.
  const listProblems = validateBackupTables();
  if (listProblems.length) {
    await log("error", "BACKUP_TABLES is inconsistent — refusing to run", { problems: listProblems });
    return json({ ok: false, error: "backup table list is inconsistent", problems: listProblems }, 500);
  }

  // ── 0 · sweep a dead lease ────────────────────────────────────────────────
  const staleBefore = new Date(Date.now() - LEASE_STALE_MINUTES * 60_000).toISOString();
  const { data: swept } = await supabase
    .from("backup_runs")
    .update({
      status:      "failed",
      finished_at: new Date().toISOString(),
      error:       `lease expired — no completion within ${LEASE_STALE_MINUTES} minutes`,
      error_stage: "lease",
    })
    .eq("kind", "backup")
    .eq("status", "running")
    .lt("started_at", staleBefore)
    .select("id");
  if (swept?.length) {
    await log("warn", `swept ${swept.length} dead backup lease(s)`, { ids: (swept as RunRow[]).map(r => r.id) });
  }

  // ── 1 · already done today? ───────────────────────────────────────────────
  if (!body.force) {
    const { data: doneToday } = await supabase
      .from("backup_runs")
      .select("id, drive_folder_link")
      .eq("kind", "backup")
      .eq("status", "ok")
      .eq("run_date", plan.date)
      .limit(1);
    if (doneToday?.length) {
      await log("info", `a successful backup for ${plan.date} already exists — skipping`, {
        runId: doneToday[0].id,
      });
      return json({
        ok: true, skipped: "already-backed-up-today",
        runId: doneToday[0].id, date: plan.date,
        folder: { link: doneToday[0].drive_folder_link },
      });
    }
  }

  // ── 2 · read everything BEFORE touching Drive ─────────────────────────────
  // Deliberately before claiming the lease on a dry run, and before any upload
  // in a real one: a read failure costs nothing and leaves nothing behind.
  const generatedAt = new Date().toISOString();
  const collected: TableResult[] = [];
  const warnings: string[] = [];

  if (!body.dryRun) {
    const { data: claimed, error: claimErr } = await supabase
      .from("backup_runs")
      .insert({
        kind:         "backup",
        status:       "running",
        run_date:     plan.date,
        triggered_by: body.triggeredBy ?? "cron",
        actor_email:  body.actorEmail ?? null,
      })
      .select("id")
      .single();
    // The unique partial index on (kind) WHERE status='running' is the lease:
    // a concurrent run loses here, at the database, not after a check it passed.
    if (claimErr || !claimed) {
      await log("warn", `could not claim the backup lease: ${claimErr?.message ?? "no row"}`);
      return json({ ok: false, error: "a backup is already running", detail: claimErr?.message }, 409);
    }
    runId = (claimed as RunRow).id;
    await log("info", `backup started for ${plan.date}`, {
      triggeredBy: body.triggeredBy ?? "cron", pageSize, tables: BACKUP_TABLES.length,
    });
  }

  const failRun = async (stage: string, err: unknown): Promise<Response> => {
    const message = err instanceof Error ? err.message : String(err);
    // An incomplete read knows the two numbers that make the failure actionable.
    // "The backup failed" sends nobody anywhere; "it collected 4,120 of 4,213
    // rows of invoices" names the table and the size of the hole.
    const counts = err instanceof IncompleteReadError
      ? { table: err.table, expected: err.expected, collected: err.collected }
      : {};
    await log("error", `backup failed at ${stage}: ${message}`, { stage, ...counts });
    if (runId) {
      await supabase.from("backup_runs").update({
        status:      "failed",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        error:       message,
        error_stage: stage,
        summary:     { warnings, ...counts },
      }).eq("id", runId);

      await raiseAlertOnce(supabase, log, {
        type:     "backup_failed",
        title:    "הגיבוי השבועי נכשל",
        message:  `הגיבוי של ${plan.date} נעצר בשלב ${stage}. ${message}`,
        severity: "high",
        payload:  { runId, runDate: plan.date, stage, error: message, ...counts },
      }, "runDate");
    }
    return json({ ok: false, runId, date: plan.date, stage, error: message, ...counts }, 500);
  };

  const reader = supabaseReader(supabase);

  for (const spec of BACKUP_TABLES) {
    try {
      const result = await readTable(
        reader, spec, { pageSize, debugMaxPages: body.debugMaxPages }, log,
      );
      collected.push(result);
      warnings.push(...result.warnings);
      await log("debug", `read ${spec.table}: ${result.rows.length} row(s) in ${result.pages} page(s)`);
    } catch (e) {
      return failRun(`read:${spec.table}`, e);
    }
  }

  const totalRows = collected.reduce((n, r) => n + r.rows.length, 0);

  // ── 3 · the table nobody classified ───────────────────────────────────────
  // A table added later would otherwise be absent from every backup until the
  // day somebody needed it. The run still succeeds — it just says so.
  let unlisted: string[] = [];
  try {
    const { data: inventory, error } = await supabase.rpc("backup_table_inventory");
    if (error) throw new Error(error.message);
    const known = new Set([...BACKUP_TABLES.map(t => t.table), ...BACKUP_EXCLUDED.map(t => t.table)]);
    unlisted = ((inventory ?? []) as string[]).filter(t => !known.has(t));
    for (const table of unlisted) {
      warnings.push(`טבלה ${table} אינה ברשימת הגיבוי ואינה ברשימת ההחרגות`);
      await raiseAlertOnce(supabase, log, {
        type:     "backup_table_unlisted",
        title:    "טבלה חדשה אינה מגובה",
        message:  `הטבלה ${table} קיימת במסד ואינה מופיעה לא ברשימת הגיבוי ולא ברשימת ההחרגות, ולכן אינה נשמרת.`,
        severity: "medium",
        payload:  { table, runId },
      }, "table");
    }
  } catch (e) {
    // Never fatal: not knowing whether a table is missing is a reason to warn,
    // not a reason to throw away a complete backup.
    warnings.push(`לא ניתן לבדוק את רשימת הטבלאות: ${e instanceof Error ? e.message : String(e)}`);
    await log("warn", `table inventory check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 4 · build the files ───────────────────────────────────────────────────
  interface Artifact { name: string; mime: string; bytes: Uint8Array }
  const artifacts: Artifact[] = [];
  let readableFormat: "xlsx" | "csv" | "none" = "none";

  for (const result of collected) {
    artifacts.push({
      name:  `${result.spec.table}.json`,
      mime:  "application/json",
      bytes: jsonFile(result, generatedAt),
    });
  }

  try {
    const { writeXlsx } = await import("../_shared/xlsx-write.ts");
    const workbook = await writeXlsx(collected.map(r => {
      const columns = columnsOf(r.rows);
      return {
        name:   r.spec.sheet,
        // A table with no rows still gets a sheet, and its key columns as the
        // header: "backed up, and empty" is information. A missing sheet looks
        // like a missing table.
        header: columns.length ? columns : r.spec.orderBy,
        rows:   r.rows.map(row => columns.map(c => cellValue(row[c]))),
      };
    }));
    artifacts.push({
      name:  `${backupFolderName(plan.date)}.xlsx`,
      mime:  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: workbook,
    });
    readableFormat = "xlsx";
  } catch (e) {
    // The JSON is what a restore reads; the workbook is what a person opens. A
    // failure here is worth a loud warning and not worth discarding a correct
    // backup, so the CSVs go up instead and the row records which happened.
    const message = e instanceof Error ? e.message : String(e);
    warnings.push(`חוברת ה-Excel נכשלה (${message}) — נשמרו קובצי CSV במקומה`);
    await log("warn", `workbook failed, falling back to CSV: ${message}`);
    for (const result of collected) {
      const columns = columnsOf(result.rows);
      const head = columns.length ? columns : result.spec.orderBy;
      const lines = [head.map(csvCell).join(",")];
      for (const row of result.rows) lines.push(columns.map(c => csvCell(cellValue(row[c]))).join(","));
      artifacts.push({
        name:  `${result.spec.table}.csv`,
        mime:  "text/csv; charset=utf-8",
        // A BOM, or Excel opens Hebrew as mojibake.
        bytes: enc.encode("\uFEFF" + lines.join("\r\n")),
      });
    }
    readableFormat = "csv";
  }

  // ── 5 · Drive ─────────────────────────────────────────────────────────────
  let folderId = "";
  let folderLink = "";
  let token = "";
  try {
    token = await getGoogleAccessToken();

    const backupsRoot = await driveEnsureFolder(token, DRIVE_ROOT_ID, BACKUP_ROOT_FOLDER);
    const yearFolder  = await driveEnsureFolder(token, backupsRoot, plan.year);
    const monthFolder = await driveEnsureFolder(token, yearFolder, plan.monthName);

    // Drive permits two folders with the same name, so a forced second run on one
    // day must take a NEW name rather than add files to a folder that already
    // holds a complete set. Otherwise nobody could tell which set was whole.
    let attempt = 1;
    while (await driveFindFolder(token, monthFolder, backupFolderNameWithSuffix(plan.date, attempt))) {
      attempt++;
      if (attempt > 50) throw new Error(`more than 50 backup folders already exist for ${plan.date}`);
    }
    const folderName = backupFolderNameWithSuffix(plan.date, attempt);
    folderId   = await driveEnsureFolder(token, monthFolder, folderName);
    folderLink = await driveGetFolderLink(token, folderId);
    if (attempt > 1) await log("info", `today already had a backup folder — this run is "${folderName}"`);

    // The manifest goes LAST, on purpose: it is the completeness mark. A folder
    // without one is a run that died mid-upload, and that is visible at a glance.
    for (const artifact of artifacts) {
      await driveUploadFile(token, folderId, artifact.name, artifact.mime, artifact.bytes);
    }

    const manifest = {
      manifestVersion: MANIFEST_VERSION,
      runId,
      runDate:         plan.date,
      generatedAt,
      folder:          folderName,
      readableFormat,
      totalRows,
      tables: collected.map(r => ({
        table:    r.spec.table,
        label:    r.spec.label,
        rows:     r.rows.length,
        expected: r.expected,
        pages:    r.pages,
        orderBy:  r.spec.orderBy,
        columns:  columnsOf(r.rows),
      })),
      excluded:     BACKUP_EXCLUDED,
      restoreOrder: RESTORE_ORDER,
      notBackedUp:  BACKUP_GAPS,
      warnings,
    };
    await driveUploadFile(
      token, folderId, "_manifest.json", "application/json",
      enc.encode(JSON.stringify(manifest, null, 2)),
    );
  } catch (e) {
    return failRun("upload", e);
  }

  const bytes = artifacts.reduce((n, a) => n + a.bytes.length, 0);

  // ── 6 · the quarterly anchor ──────────────────────────────────────────────
  // Never fatal. The backup itself is already up; a failure here leaves the
  // anchor folder absent, which means next week's run tries again. Self-healing
  // beats failing a good backup over a copy.
  let quarterAnchor: string | null = null;
  let quarterLink: string | null = null;
  try {
    const promoted = await promoteQuarterAnchor(supabase, log, token, plan.quarter);
    if (promoted) { quarterAnchor = promoted.name; quarterLink = promoted.link }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    warnings.push(`העוגן הרבעוני לא נוצר (${message}) — ינוסה שוב בשבוע הבא`);
    await log("warn", `quarter anchor failed: ${message}`);
  }

  // ── 7 · close the row ─────────────────────────────────────────────────────
  const summary = {
    tables: collected.map(r => ({
      table: r.spec.table, label: r.spec.label, rows: r.rows.length, expected: r.expected,
    })),
    warnings,
    unlisted,
    excluded:    BACKUP_EXCLUDED.map(e => e.table),
    notBackedUp: BACKUP_GAPS.map(g => g.what),
  };
  await supabase.from("backup_runs").update({
    status:              "ok",
    finished_at:         new Date().toISOString(),
    duration_ms:         Date.now() - started,
    drive_folder_id:     folderId,
    drive_folder_link:   folderLink,
    quarter_anchor:      quarterAnchor,
    quarter_folder_link: quarterLink,
    total_rows:          totalRows,
    file_count:          artifacts.length + 1,   // + _manifest.json
    bytes,
    readable_format:     readableFormat,
    summary,
  }).eq("id", runId!);

  await log("info", `backup ok: ${totalRows} rows, ${artifacts.length + 1} files, ${bytes} bytes`, {
    durationMs: Date.now() - started, readableFormat, quarterAnchor,
  });

  return json({
    ok: true, runId, date: plan.date, status: "ok",
    folder:         { id: folderId, link: folderLink, name: backupFolderName(plan.date) },
    tables:         summary.tables,
    totalRows,
    fileCount:      artifacts.length + 1,
    bytes,
    readableFormat,
    quarterAnchor:  quarterAnchor ? { quarter: quarterAnchor, link: quarterLink } : null,
    warnings,
    durationMs:     Date.now() - started,
  });
}

function csvCell(v: string | number | boolean | null): string {
  if (v === null) return "";
  const s = String(v);
  // A leading = + - @ is a formula to Excel, and a backup is the last place to
  // hand a spreadsheet something executable.
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * On the first run of a new quarter, copy the LAST successful backup of the
 * quarter that just closed into <year of that quarter>/רבעונים/רבעון N YYYY.
 *
 * Answered from Drive plus history rather than from a flag, which makes it
 * idempotent and self-healing: if the folder is already there, nothing happens;
 * if a previous attempt died halfway, the missing files are copied next time.
 *
 * Returns null when there is nothing to do.
 */
async function promoteQuarterAnchor(
  supabase: SupabaseClient,
  log:      Logger,
  token:    string,
  current:  Quarter,
): Promise<{ name: string; link: string } | null> {
  const closed = previousQuarter(current);
  const name   = quarterFolderName(closed);

  const backupsRoot = await driveEnsureFolder(token, DRIVE_ROOT_ID, BACKUP_ROOT_FOLDER);
  // The year of the CLOSED quarter, not of the run: the January run anchors Q4 of
  // the previous year, and the anchor belongs under that year so a year can be
  // pruned as one unit.
  const yearFolder  = await driveEnsureFolder(token, backupsRoot, String(closed.year));
  const quartersDir = await driveEnsureFolder(token, yearFolder, QUARTERS_FOLDER);

  const existing = await driveFindFolder(token, quartersDir, name);

  const { data: source } = await supabase
    .from("backup_runs")
    .select("id, run_date, drive_folder_id")
    .eq("kind", "backup")
    .eq("status", "ok")
    .gte("run_date", quarterStartDate(closed))
    .lt("run_date", quarterStartDate(current))
    .not("drive_folder_id", "is", null)
    .order("run_date", { ascending: false })
    .limit(1);

  if (!source?.length) {
    if (!existing) await log("info", `no successful backup inside ${name} — no anchor to make`);
    return null;
  }

  const anchorDir = existing ?? await driveEnsureFolder(token, quartersDir, name);
  const link      = await driveGetFolderLink(token, anchorDir);

  const [want, have] = await Promise.all([
    driveListChildren(token, String(source[0].drive_folder_id)),
    driveListChildren(token, anchorDir),
  ]);
  const haveNames = new Set(have.map(f => f.name));
  const missing   = want.filter(f => !isDriveFolder(f) && !haveNames.has(f.name));

  if (!missing.length) {
    // Already complete. Only report an anchor on the run that actually made one,
    // so the panel's quarter line means "this run did that" and not "that exists".
    return existing ? null : { name, link };
  }

  for (const file of missing) {
    await driveCopyFile(token, file.id, anchorDir, file.name);
  }
  await log("info", `quarter anchor ${name}: copied ${missing.length} file(s) from ${source[0].run_date}`, {
    sourceRunId: source[0].id, quarter: name,
  });
  return { name, link };
}

// ─── Year-end cleanup ───────────────────────────────────────────────────────

async function runYearEndCleanup(
  supabase: SupabaseClient,
  body:     BackupBody,
): Promise<Response> {
  let runId: string | null = null;
  const log = makeLogger(supabase, () => runId);

  const now     = body.now ? new Date(body.now) : new Date();
  const today   = israelDateParts(now);
  const year    = Number(body.year);
  const started = Date.now();

  if (!Number.isInteger(year)) return json({ error: "`year` must be an integer" }, 400);
  // Refused on both sides of the wire — hadas-api checks it too. A destructive
  // route gets its guard twice, because one of the two might be the one bypassed.
  if (year >= today.year) {
    return json({ error: `refusing to prune ${year}: only a year that has ended can be pruned` }, 400);
  }
  if (body.confirm !== true) {
    return json({ error: "`confirm: true` is required — this moves folders to the Drive bin" }, 400);
  }

  const { data: claimed, error: claimErr } = await supabase
    .from("backup_runs")
    .insert({
      kind: "cleanup", status: "running", run_date: today.date,
      triggered_by: body.triggeredBy ?? "manual", actor_email: body.actorEmail ?? null,
    })
    .select("id")
    .single();
  if (claimErr || !claimed) {
    return json({ ok: false, error: "a cleanup is already running", detail: claimErr?.message }, 409);
  }
  runId = (claimed as RunRow).id;

  try {
    const token       = await getGoogleAccessToken();
    const backupsRoot = await driveEnsureFolder(token, DRIVE_ROOT_ID, BACKUP_ROOT_FOLDER);
    const yearFolder  = await driveFindFolder(token, backupsRoot, String(year));
    if (!yearFolder) throw new Error(`there is no backup folder for ${year}`);

    const children = await driveListChildren(token, yearFolder);
    // Month folders only. רבעונים is kept — that is the whole point of the prune —
    // and anything that is not a folder, or not one of ours, is left untouched:
    // this function deletes what it put there and nothing else.
    const doomed = children.filter(c =>
      isDriveFolder(c) && c.name !== QUARTERS_FOLDER && !isBackupFolderName(c.name));
    const skipped = children.filter(c => !doomed.includes(c)).map(c => c.name);

    for (const folder of doomed) await driveTrashFile(token, folder.id);

    const summary = { year, trashed: doomed.map(d => d.name), kept: skipped };
    await supabase.from("backup_runs").update({
      status: "ok", finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started, summary,
    }).eq("id", runId);

    await log("info", `year-end cleanup of ${year}: ${doomed.length} month folder(s) to the bin`, summary);
    return json({ ok: true, runId, year, trashed: doomed.map(d => d.name), kept: skipped });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("backup_runs").update({
      status: "failed", finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started, error: message, error_stage: "cleanup",
    }).eq("id", runId);
    await log("error", `year-end cleanup of ${year} failed: ${message}`);
    return json({ ok: false, runId, year, error: message }, 500);
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS, status: 204 });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  if (!validateKey(req.headers.get("x-hadas-key"))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HADAS_SERVICE_KEY") ?? "",
  );

  let body: BackupBody = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text) as BackupBody;
  } catch (e) {
    return json({ error: `bad JSON body: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  try {
    // The cron tick sends `{}`, so the destructive mode is structurally
    // unreachable from it: cleanup has to be asked for by name.
    return body.mode === "year-end-cleanup"
      ? await runYearEndCleanup(supabase, body)
      : await runWeeklyBackup(supabase, body);
  } catch (e) {
    // Last resort. A throw that escaped the per-stage handling must still answer
    // in the shape every caller parses.
    console.error("[backup-run] unhandled:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e), stage: "unhandled" }, 500);
  }
});
