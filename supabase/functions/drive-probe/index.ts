const TOKEN = "5dd640f9a856a1e681cdc9aad112b6a02f23b3d8d89efbd8";
const ROOT = "1ocbxq5-ReY7WutAm48pKHDiaB8rBe6SM";

async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("no access_token: " + JSON.stringify(data));
  return data.access_token;
}

// The Drive file fields this probe requests and reads.
interface DriveFile {
  id:            string;
  name?:         string;
  mimeType?:     string;
  size?:         string;
  modifiedTime?: string;
}

async function listChildren(token: string, parentId: string) {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", "'" + parentId + "' in parents and trashed = false");
    url.searchParams.set("fields", "nextPageToken, files(id, name, mimeType, size, modifiedTime)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    if (data.files) out.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

const isFolder = (f: DriveFile) => f.mimeType === "application/vnd.google-apps.folder";

async function findChild(token: string, parentId: string, name: string) {
  const kids = await listChildren(token, parentId);
  return kids.find((f) => isFolder(f) && (f.name || "").trim() === name.trim());
}

// resolve a path of folder names starting from ROOT; returns folder id or null
async function resolvePath(token: string, names: string[]) {
  let cur = ROOT;
  for (const n of names) {
    const f = await findChild(token, cur, n);
    if (!f) return null;
    cur = f.id;
  }
  return cur;
}

async function dumpFolder(token: string, id: string) {
  const files = (await listChildren(token, id)).filter((f) => !isFolder(f));
  return { folderId: id, count: files.length,
    files: files.map((f) => ({ name: f.name, size: f.size || "?", modified: f.modifiedTime })) };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const token = await getGoogleAccessToken();
    // paths passed in the URL as ?source=a/b/c&target=x/y/z (slash-separated folder names)
    const sourceParam = url.searchParams.get("source") || "";
    const targetParam = url.searchParams.get("target") || "";
    const idParam = url.searchParams.get("id") || "";
    const out: Record<string, unknown> = {};

    if (idParam) {
      // dump a folder directly by Drive id (sidesteps slash-in-name folders)
      for (const id of idParam.split(",").map((s) => s.trim()).filter(Boolean)) {
        out["ID: " + id] = await dumpFolder(token, id);
      }
    }
    if (sourceParam) {
      const id = await resolvePath(token, sourceParam.split("/"));
      out["SOURCE: " + sourceParam] = id ? await dumpFolder(token, id) : "PATH NOT FOUND";
    }
    if (targetParam) {
      const id = await resolvePath(token, targetParam.split("/"));
      out["TARGET: " + targetParam] = id ? await dumpFolder(token, id) : "PATH NOT FOUND";
    }
    if (!sourceParam && !targetParam && !idParam) {
      // default: list ROOT children so we can see exact folder names
      const kids = await listChildren(token, ROOT);
      out["ROOT_CHILDREN"] = kids.map((f) => ({ name: f.name, isFolder: isFolder(f), id: f.id }));
    }

    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (err) {
    return new Response("ERROR: " + (err as Error).message, { status: 500 });
  }
});
