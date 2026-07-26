// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  drive-reconcile (one-off utility)                                         ║
// ║  Finds ORPHANED Drive invoice files — files sitting in the חשבוניות tree   ║
// ║  whose Drive id is not referenced by any invoices.drive_file_link. These   ║
// ║  are the duplicate copies left behind by the pre-fix ingest bug (Drive     ║
// ║  upload ran before the dedup guard, so a reprocessed email uploaded a      ║
// ║  second file while the DB stayed correctly deduped).                        ║
// ║                                                                            ║
// ║  DEFAULT = DRY RUN: lists orphans (count + names), trashes NOTHING.         ║
// ║  Pass ?apply=1 to actually trash them (recoverable for 30 days) — only      ║
// ║  after reviewing the dry-run output.                                        ║
// ║                                                                            ║
// ║  Auth: ?key=<AUTH_KEY>. Reuses the shared Drive layout config so no Hebrew  ║
// ║  folder-name literal lives in this file (RTL-source hazard — see CLAUDE.md).║
// ╚══════════════════════════════════════════════════════════════════════════╝
import { DRIVE_ROOT_ID, DRIVE_SUBFOLDERS } from "../_shared/drive-filing.ts";

// Static shared secret for invoking this ad-hoc utility (same pattern as drive-probe).
const AUTH_KEY = "rc_4f9a2c7e1b8d40a6b3e5c9f27a1d6e0b";

// Safety backstop: never walk more than this many Drive folders (guards against
// an unexpected cycle / runaway; the invoice tree is year/month/subfolder, tiny).
const MAX_FOLDERS = 5000;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("no access_token: " + JSON.stringify(data));
  return data.access_token as string;
}

const isFolder = (f: DriveFile) => f.mimeType === "application/vnd.google-apps.folder";

// Same id-extraction regex hadas-api uses on the stored webViewLink, so the
// orphan set is computed with the exact matching rule the DB was written with.
function driveFileIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const m = link.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]+)/i);
  return m ? m[1] : null;
}

async function listChildren(token: string, parentId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${parentId}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken, files(id, name, mimeType, size, modifiedTime)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`drive.list failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { files?: DriveFile[]; nextPageToken?: string };
    if (data.files) out.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function findChild(token: string, parentId: string, name: string): Promise<DriveFile | undefined> {
  const kids = await listChildren(token, parentId);
  return kids.find((f) => isFolder(f) && (f.name || "").trim() === name.trim());
}

// Depth-first walk of the invoice subtree. Collects every non-folder file with
// the folder path it was found under (for a human-readable review list).
async function collectFiles(
  token: string,
  folderId: string,
  path: string,
  acc: Array<DriveFile & { path: string }>,
  budget: { folders: number },
): Promise<void> {
  if (++budget.folders > MAX_FOLDERS) throw new Error(`folder budget exceeded (${MAX_FOLDERS}) — aborting walk`);
  const kids = await listChildren(token, folderId);
  for (const f of kids) {
    if (isFolder(f)) {
      await collectFiles(token, f.id, `${path}/${f.name}`, acc, budget);
    } else {
      acc.push({ ...f, path });
    }
  }
}

// Pull every drive_file_link from the invoices table via PostgREST, paginating
// so a large table is fully covered (advance by the page size actually returned).
async function fetchDbLinkIds(): Promise<Set<string>> {
  const base = Deno.env.get("SUPABASE_URL")!;
  const key  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ids = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const url = `${base}/rest/v1/invoices?select=drive_file_link&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`invoices fetch failed: ${res.status} ${await res.text()}`);
    const rows = await res.json() as Array<{ drive_file_link: string | null }>;
    for (const r of rows) {
      const id = driveFileIdFromLink(r.drive_file_link);
      if (id) ids.add(id);
    }
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return ids;
}

async function driveTrashFile(token: string, fileId: string): Promise<void> {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method:  "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ trashed: true }),
  });
  if (!resp.ok && resp.status !== 404)
    throw new Error(`drive trash failed: ${resp.status} ${await resp.text()}`);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== AUTH_KEY) return new Response("unauthorized", { status: 401 });
  const apply = url.searchParams.get("apply") === "1";

  try {
    const token = await getGoogleAccessToken();

    // Scope strictly to the invoice subtree (root → חשבוניות). Delivery notes,
    // statements and returns live under other subfolders and other tables, so
    // walking only חשבוניות keeps this from false-flagging non-invoice files.
    const invoiceRoot = await findChild(token, DRIVE_ROOT_ID, DRIVE_SUBFOLDERS.invoice);
    if (!invoiceRoot) {
      return new Response(JSON.stringify({ error: `invoice subfolder not found under root` }, null, 2),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    const files: Array<DriveFile & { path: string }> = [];
    await collectFiles(token, invoiceRoot.id, DRIVE_SUBFOLDERS.invoice, files, { folders: 0 });

    const dbIds = await fetchDbLinkIds();
    const orphans = files.filter((f) => !dbIds.has(f.id));

    const orphanList = orphans.map((f) => ({
      name:         f.name,
      id:           f.id,
      path:         f.path,
      size:         f.size ?? "?",
      modifiedTime: f.modifiedTime ?? "?",
    }));

    const summary = {
      mode:              apply ? "APPLY (trashing)" : "DRY_RUN (nothing trashed)",
      driveFilesScanned: files.length,
      dbLinkedIds:       dbIds.size,
      orphanCount:       orphans.length,
    };

    if (!apply) {
      return new Response(JSON.stringify({ ...summary, orphans: orphanList }, null, 2),
        { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    // APPLY: trash each orphan (recoverable in Drive trash for 30 days).
    const trashed: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const f of orphans) {
      try { await driveTrashFile(token, f.id); trashed.push(f.id); }
      catch (e) { failed.push({ id: f.id, error: e instanceof Error ? e.message : String(e) }); }
    }
    return new Response(JSON.stringify({ ...summary, trashedCount: trashed.length, failed, orphans: orphanList }, null, 2),
      { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (err) {
    return new Response("ERROR: " + (err instanceof Error ? err.message : String(err)), { status: 500 });
  }
});
