// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  backup-layout (shared)                                                   ║
// ║  WHERE a weekly backup lands in Drive, and which quarter it belongs to.    ║
// ║  Pure — no I/O, no Drive, no database. Every date decision in the feature  ║
// ║  comes from here, so a month or quarter boundary is reasoned about once.   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// The layout, decided with the owner:
//
//   <DRIVE_ROOT_ID>/גיבויים/
//   └── 2026/
//       ├── רבעונים/
//       │   └── רבעון 3 2026/        ← a copy of the last backup of that quarter
//       ├── ספטמבר/
//       │   ├── גיבוי 2026-09-05/
//       │   └── גיבוי 2026-09-12/
//       └── אוקטובר/
//           └── גיבוי 2026-10-03/
//
// The year → Hebrew-month shape is the same one invoices are already filed in
// (drive-filing.ts), and it is what lets a finished year be pruned in one pass
// while the four quarter folders survive.
//
// ⚠️ EVERY DATE HERE IS ISRAEL-LOCAL, NEVER UTC. The job runs at 04:00 Israel
// time, which is 01:00 or 02:00 UTC the SAME day — but a run that drifts earlier,
// or a schedule someone moves, would file a Saturday backup in Friday's folder
// and break the "one backup per run_date" idempotency key. Asking for the local
// date explicitly costs one Intl call and removes the whole class of bug.

import { HEBREW_MONTHS } from "./drive-filing.ts";

// ── Hebrew folder names, in one block above all logic ───────────────────────
export const BACKUP_ROOT_FOLDER = "גיבויים";
export const QUARTERS_FOLDER    = "רבעונים";
const QUARTER_PREFIX            = "רבעון";
const BACKUP_PREFIX             = "גיבוי";

export const ISRAEL_TZ = "Asia/Jerusalem";

export interface DateParts {
  /** 2026 */
  year: number;
  /** 1-12 (NOT a 0-based month index — those only exist inside Date) */
  month: number;
  /** 1-31 */
  day: number;
  /** "2026-10-07" — Israel-local, the value stored in backup_runs.run_date */
  date: string;
}

/**
 * The Israel-local calendar date of `now`.
 *
 * en-CA because it formats as YYYY-MM-DD; the parts are read individually
 * anyway, so the locale only has to be one that Intl will not reorder.
 */
export function israelDateParts(now: Date = new Date()): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year:  "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).formatToParts(now);

  const get = (type: string) => {
    const found = parts.find(p => p.type === type)?.value;
    if (!found) throw new Error(`israelDateParts: Intl returned no ${type}`);
    return Number(found);
  };

  const year  = get("year");
  const month = get("month");
  const day   = get("day");
  return {
    year,
    month,
    day,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export interface Quarter { quarter: 1 | 2 | 3 | 4; year: number }

/** Which quarter a 1-12 month sits in. */
export function quarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** Which quarter an Israel-local "YYYY-MM-DD" sits in. */
export function quarterOfDate(date: string): Quarter {
  const [y, m] = date.split("-").map(Number);
  if (!y || !m) throw new Error(`quarterOfDate: not a YYYY-MM-DD date: ${date}`);
  return { quarter: quarterOfMonth(m), year: y };
}

/**
 * The quarter before this one. Rolls the YEAR back at Q1, which is the case the
 * January run depends on: it anchors Q4 of the PREVIOUS year, and the anchor
 * folder therefore belongs under that year, not under the running one.
 */
export function previousQuarter(q: Quarter): Quarter {
  return q.quarter === 1
    ? { quarter: 4, year: q.year - 1 }
    : { quarter: (q.quarter - 1) as 1 | 2 | 3, year: q.year };
}

/** First Israel-local date of a quarter, as "YYYY-MM-DD". Inclusive bound. */
export function quarterStartDate(q: Quarter): string {
  const month = (q.quarter - 1) * 3 + 1;
  return `${q.year}-${String(month).padStart(2, "0")}-01`;
}

/** "רבעון 3 2026" — the quarter folder's name, and the value stored in quarter_anchor. */
export function quarterFolderName(q: Quarter): string {
  return `${QUARTER_PREFIX} ${q.quarter} ${q.year}`;
}

/** "גיבוי 2026-10-07" — one run's folder. */
export function backupFolderName(date: string): string {
  return `${BACKUP_PREFIX} ${date}`;
}

/**
 * A re-run on a day that already has a folder gets " (2)", " (3)", … rather than
 * a second folder of the same name. Drive permits duplicate names, so without
 * this a forced manual run would leave two folders called the same thing and no
 * way to tell which holds the complete set.
 */
export function backupFolderNameWithSuffix(date: string, attempt: number): string {
  const base = backupFolderName(date);
  return attempt <= 1 ? base : `${base} (${attempt})`;
}

/** Is a folder name one of ours — i.e. may the year-end prune consider it? */
export function isBackupFolderName(name: string): boolean {
  return /^גיבוי \d{4}-\d{2}-\d{2}( \(\d+\))?$/.test(name);
}

export interface BackupFolderPlan {
  /** "2026" — the year folder under גיבויים */
  year: string;
  /** "אוקטובר" — reused from the invoice filing rules, never re-listed */
  monthName: string;
  /** "גיבוי 2026-10-07" */
  dayFolder: string;
  /** Israel-local YYYY-MM-DD */
  date: string;
  /** Which quarter this run falls in */
  quarter: Quarter;
}

/**
 * Everything the run needs to know about where it is filing, from one `now`.
 * Injectable for testing; production callers pass nothing.
 */
export function backupFolderPlan(now: Date = new Date()): BackupFolderPlan {
  const { year, month, date } = israelDateParts(now);
  return {
    year:      String(year),
    monthName: HEBREW_MONTHS[month - 1],
    dayFolder: backupFolderName(date),
    date,
    quarter:   { quarter: quarterOfMonth(month), year },
  };
}

/** Whole days between two Israel-local YYYY-MM-DD dates. Used for "stale backup". */
export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`daysBetween: bad dates ${fromDate} / ${toDate}`);
  return Math.round((b - a) / 86_400_000);
}
