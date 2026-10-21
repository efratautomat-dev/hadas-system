// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  drive-filing (shared)                                                    ║
// ║  Single source of truth for WHERE an invoice's file lives in Google Drive ║
// ║  — the year / Hebrew-month / 15th-of-month overflow rules — plus every     ║
// ║  Drive helper the functions share: folder find/create/ensure/link/move,    ║
// ║  and (at the bottom) file upload / trash / list / copy. Imported by        ║
// ║  invoices-ingest (files new uploads), hadas-api (re-files a corrected date, ║
// ║  trashes a deleted invoice) and backup-run (writes the weekly backup), so  ║
// ║  the rules are defined ONCE and cannot drift between them.                 ║
// ║                                                                            ║
// ║  NOTE: the INVOICE filing rules below are about invoices only. The backup   ║
// ║  layout is its own thing and lives in _shared/backup-layout.ts, so this    ║
// ║  file's promise above stays true.                                          ║
// ║                                                                            ║
// ║  Depends only on the Fetch API (a Web/Deno global) — no external imports,  ║
// ║  so it bundles cleanly into either edge function and is unit-testable in   ║
// ║  plain Node by mocking globalThis.fetch.                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── Config (mirrors the live Drive layout) ──────────────────────────────────
export const DRIVE_ROOT_ID = "1ocbxq5-ReY7WutAm48pKHDiaB8rBe6SM";
export const DRIVE_SUBFOLDERS = {
  invoice:      "חשבוניות",
  partialReturn:"החזר חלקי",
  deliveryNote: "תעודות משלוח",
  statement:    "כרטסות",
  returnDoc:    "חזרות",
};

export const HEBREW_MONTHS = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

// Overflow subfolder name, built from char codes because literal Hebrew/RTL
// text scrambles the surrounding source on save. Renders as: עודפים
export const OVERFLOW_SUBFOLDER = String.fromCharCode(0x05E2, 0x05D5, 0x05D3, 0x05E4, 0x05D9, 0x05DD);

export interface FolderTarget { fileFolderId: string; monthFolderId: string }

// ── Pure filing decision (no I/O → unit-testable) ───────────────────────────
// Given an invoice date and "now", decide which year + Hebrew month the file
// belongs under, and whether it overflows. Routing is by UPLOAD date, not just
// the invoice date:
//   • On time → the invoice's own month folder.
//   • Late    → the OVERFLOW_SUBFOLDER of the currently-active month.
// "Active month" = the previous month before the 15th, otherwise this month.
// A one-month-old invoice gets a grace window: before the 15th it still files
// under its own (previous) month rather than overflowing.
export interface FolderPlan { year: string; monthName: string; overflow: boolean; partialReturn: boolean }

export function planInvoiceFolder(invoiceDate: string, now: Date, partialReturn: boolean): FolderPlan {
  const inv = new Date(invoiceDate);

  // Calendar months the invoice trails the current month (UTC):
  // 0 = current, 1 = one month old, >=2 = older, <0 = future-dated.
  const monthsBehind =
    (now.getUTCFullYear() - inv.getUTCFullYear()) * 12 +
    (now.getUTCMonth()    - inv.getUTCMonth());

  const beforeCutoff = now.getUTCDate() < 15;
  const onTime = monthsBehind <= 0 || (monthsBehind === 1 && beforeCutoff);

  // Partial-returns ALWAYS file under their invoice-date month's "החזר חלקי"
  // subfolder — never overflow (a late partial-return must not land in עודפים).
  if (partialReturn || onTime) {
    return {
      year:          String(inv.getUTCFullYear()),
      monthName:     HEBREW_MONTHS[inv.getUTCMonth()],
      overflow:      false,
      partialReturn,
    };
  }

  // Late: the overflow subfolder of the currently-active month.
  // Date.UTC() normalises a -1 month index back into the prior year correctly.
  const active = beforeCutoff
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),     1));
  return {
    year:          String(active.getUTCFullYear()),
    monthName:     HEBREW_MONTHS[active.getUTCMonth()],
    overflow:      true,
    partialReturn,
  };
}

// ── Drive folder helpers (I/O) ──────────────────────────────────────────────
export async function driveFindFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<string | null> {
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) throw new Error(`drive.list folder failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { files?: Array<{ id: string; name: string }> };
  return data.files?.[0]?.id ?? null;
}

export async function driveCreateFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<string> {
  const resp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents:  [parentId],
    }),
  });
  if (!resp.ok) throw new Error(`drive.create folder failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { id: string };
  return data.id;
}

export async function driveEnsureFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<string> {
  const found = await driveFindFolder(token, parentId, name);
  if (found) return found;
  return driveCreateFolder(token, parentId, name);
}

export async function driveGetFolderLink(token: string, folderId: string): Promise<string> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return "";
  const data = await resp.json() as { webViewLink?: string };
  return data.webViewLink ?? "";
}

// Moves an existing Drive file into newParentId, detaching it from its current
// parent(s) (a Drive "move" = add the new parent, remove the old ones). Used
// when an invoice's date is corrected and the file must re-file into the right
// year/month folder. Idempotent-ish: moving into the folder it's already in is
// harmless.
export async function driveMoveFile(token: string, fileId: string, newParentId: string): Promise<void> {
  const metaResp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaResp.ok) throw new Error(`drive.get parents failed: ${metaResp.status} ${await metaResp.text()}`);
  const meta = await metaResp.json() as { parents?: string[] };
  const removeParents = (meta.parents ?? []).join(",");

  const params = new URLSearchParams({ addParents: newParentId, fields: "id,parents" });
  if (removeParents) params.set("removeParents", removeParents);

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) throw new Error(`drive move failed: ${resp.status} ${await resp.text()}`);
}

// ── Resolve (ensure) the actual Drive folders for an invoice ─────────────────
// Ensures root → חשבוניות → <year> → <Hebrew month> (→ overflow / partial-return
// subfolder as applicable) exist and returns their ids. `now` is injectable for
// testing; production callers omit it.
export async function resolveInvoiceFolder(
  token:         string,
  invoiceDate:   string,
  partialReturn: boolean,
  now:           Date = new Date(),
): Promise<FolderTarget> {
  const plan = planInvoiceFolder(invoiceDate, now, partialReturn);

  const invoiceRoot = await driveEnsureFolder(token, DRIVE_ROOT_ID, DRIVE_SUBFOLDERS.invoice);
  const yearFolder  = await driveEnsureFolder(token, invoiceRoot, plan.year);
  const monthFolder = await driveEnsureFolder(token, yearFolder,  plan.monthName);

  if (plan.overflow) {
    // Overflow wins over partial-return: every late doc lands here.
    const overflowFolder = await driveEnsureFolder(token, monthFolder, OVERFLOW_SUBFOLDER);
    return { fileFolderId: overflowFolder, monthFolderId: overflowFolder };
  }

  const fileFolder = plan.partialReturn
    ? await driveEnsureFolder(token, monthFolder, DRIVE_SUBFOLDERS.partialReturn)
    : monthFolder;
  return { fileFolderId: fileFolder, monthFolderId: monthFolder };
}

// ── File-level Drive I/O ────────────────────────────────────────────────────
// Upload / trash / list / copy. These lived unexported inside the functions that
// happened to need them first — upload in invoices-ingest, trash in hadas-api
// (and again in drive-reconcile) — which was fine while there was one caller
// each. The weekly backup needs all four, and a second hand-rolled multipart
// encoder is the kind of duplicate this repo already keeps a guard script for.

export interface UploadedFile { id: string; webViewLink: string }

/**
 * Uploads bytes as a new Drive file under `parentId`.
 *
 * NOT idempotent: Drive allows two files with the same name in one folder, so a
 * caller that may run twice has to reconcile names itself rather than rely on an
 * upsert that does not exist here.
 */
export async function driveUploadFile(
  token:    string,
  parentId: string,
  filename: string,
  mimeType: string,
  bytes:    Uint8Array,
): Promise<UploadedFile> {
  const boundary = "----hadasinvoice" + crypto.randomUUID();
  const metadata = JSON.stringify({ name: filename, parents: [parentId] });

  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    metadata + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!resp.ok) throw new Error(`drive upload failed: ${resp.status} ${await resp.text()}`);
  return resp.json() as Promise<UploadedFile>;
}

/**
 * Moves a Drive file (or folder — a folder is a file) to trash rather than
 * deleting it: recoverable for 30 days. 404 is success — it is already gone.
 *
 * Every destructive path in this system goes to trash, never to delete. A year
 * of backups removed by one wrong click has to be recoverable.
 */
export async function driveTrashFile(token: string, fileId: string): Promise<void> {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method:  "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ trashed: true }),
  });
  if (!resp.ok && resp.status !== 404)
    throw new Error(`drive trash failed: ${resp.status} ${await resp.text()}`);
}

export interface DriveChild { id: string; name: string; mimeType: string }

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** True when a listed child is itself a folder. */
export function isDriveFolder(child: DriveChild): boolean {
  return child.mimeType === FOLDER_MIME;
}

/**
 * Lists the non-trashed children of a folder, following pageToken to the end.
 *
 * The paging loop is not optional: Drive's default page size is 100, and a year
 * folder holding a backup per week plus the quarter folders is already close
 * enough that "it fit last time" is not a guarantee. A caller that silently saw
 * only the first page would prune the wrong set.
 */
export async function driveListChildren(token: string, parentId: string): Promise<DriveChild[]> {
  const out: DriveChild[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q:        `'${parentId}' in parents and trashed = false`,
      fields:   "nextPageToken, files(id,name,mimeType)",
      pageSize: "200",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resp.ok) throw new Error(`drive list children failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json() as {
      nextPageToken?: string;
      files?: DriveChild[];
    };
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return out;
}

/**
 * Server-side copy of a Drive file into `parentId`, optionally renamed. Google
 * does the copying — the bytes never travel through the edge function, which is
 * what makes promoting a whole backup folder to a quarterly anchor cheap.
 */
export async function driveCopyFile(
  token:    string,
  fileId:   string,
  parentId: string,
  name?:    string,
): Promise<UploadedFile> {
  const body: Record<string, unknown> = { parents: [parentId] };
  if (name) body.name = name;

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?fields=id,webViewLink`,
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    },
  );
  if (!resp.ok) throw new Error(`drive copy failed: ${resp.status} ${await resp.text()}`);
  return resp.json() as Promise<UploadedFile>;
}
