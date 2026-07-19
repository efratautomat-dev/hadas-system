// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  drive-filing (shared)                                                    ║
// ║  Single source of truth for WHERE an invoice's file lives in Google Drive ║
// ║  — the year / Hebrew-month / 15th-of-month overflow rules — plus the Drive ║
// ║  folder helpers. Imported by BOTH invoices-ingest (files new uploads) and  ║
// ║  hadas-api (re-files the copy when an invoice's date is corrected), so the ║
// ║  rules are defined ONCE and can never drift between the two functions.     ║
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
