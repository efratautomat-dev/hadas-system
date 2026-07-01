const TOKEN = "5dd640f9a856a1e681cdc9aad112b6a02f23b3d8d89efbd8";

const TARGET: Record<string, string> = {
  "2026-01": "1vajvESdZZORgYkthjiatOcyTSPrE8CPe",
  "2026-02": "1ZuG_Sy1a-gmOr_0_8X5W7SeRJv0RzJe-",
  "2026-03": "1qXn5tJzwiQjIwSleGmV5ysCzgUSXcuhx",
  "2026-04": "1JihTUGLEzOnd5c2diWG8c1MPwTYOUzR1",
  "2026-05": "1TqPRtrcQ4p-rs9guykai6JH2xkV_n_iZ",
  "2026-06": "1ZhiCus0v8Bk7R1eCiQ2a2CzRJlYaWN2C",
};
const PARTIAL_MAY = "17I0VmOdbQBVca6rIrwCDh_wG_uc13EHb";
const OVERFLOW = "1JRg9yrzdxhFgC-6p2uA7znH2oFbgR-hU";
const OVERFLOW_FILES = ["1d1jPnVY76C4nqwLsF1CqXtd7WFE8Bq-a","1y-s37D3Lpi-AQykcBdq0SO5Kon7iT9uy","1LHfeBJocbAfV9Na3i2AzKtRvO2HNQGa6","1WN3Y5G5UlsDyRwHzqbPDPicZlVQzMn64","11ztotlZgb-2zyUrcPxY_pETEf9DBvMrj","1JFGuORmUWkQnNsmPKOJW9Yxc51vFcDMg","1bwUdlUjEnGnar20vybMgQUmyq4psf56M","1dlAso8ldpvC0Mw6SLPnlqzNguXbMB8op","1W7mMSZrYV7OWy_ZueXGfSWpmKdy3do4W","1kZItoBhiDOtZi1Z9CSSYOMch1Y2H0bcS","1f4TjsDvj_wjevaUMURb9H6TMVjBYgxhj","1RH1Oh4p-tNJryR_3c37SvtAQyLRyI6rG","1jKRznbg7VBKllINiU2Jk6n9df5ylpJpF","1P5h1PZezpYpYCuZzBwLuIOTGLil9dqur","1wMt9bWX3IugOB1UqfQSW4XXx18UtXBDB"];
const SOURCE_MAY = "1a-JYXOCvwNtzWzwpP3IbN-y1jwrnCJww";
const norm = (s) => (s || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
const CAR_IDS = ["INV-2026-130","INV-2026-131","INV-2026-132","INV-2026-145","INV-2026-152","INV-2026-178","INV-2026-184","INV-2026-199","INV-2026-204","INV-2026-210","INV-2026-222","INV-2026-226","INV-2026-230"];

async function getToken(): Promise<string> {
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
  const d = await res.json();
  if (!d.access_token) throw new Error("no access_token");
  return d.access_token;
}

async function dbInvoices(month: string) {
  const url = Deno.env.get("SUPABASE_URL")! +
    "/rest/v1/invoices?select=id,invoice_date,supplier_name,invoice_number,total_amount,partial_return,drive_file_link&invoice_date=gte." +
    month + "-01&invoice_date=lte." + month + "-31";
  const res = await fetch(url, {
    headers: {
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    },
  });
  return await res.json();
}

function classifyLink(link: string): { kind: string; id: string } {
  if (!link) return { kind: "MISSING", id: "" };
  let m = link.match(/\/file\/d\/([^/]+)/);
  if (m) return { kind: "FILE", id: m[1] };
  m = link.match(/\/drive\/folders\/([^/?]+)/);
  if (m) return { kind: "FOLDER", id: m[1] };
  return { kind: "UNKNOWN", id: "" };
}

async function getParents(token: string, fileId: string): Promise<string[]> {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files/" + fileId + "?fields=parents&supportsAllDrives=true",
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!res.ok) return [];
  const d = await res.json();
  return d.parents || [];
}

async function listFiles(token: string, folderId: string) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", "'" + folderId + "' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const res = await fetch(url.toString(), { headers: { Authorization: "Bearer " + token } });
  const d = await res.json();
  return d.files || [];
}

async function copyFile(token: string, fileId: string, targetParent: string) {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files/" + fileId + "/copy?supportsAllDrives=true&fields=id,name",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ parents: [targetParent] }),
    },
  );
  return res.ok ? await res.json() : { error: await res.text() };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== TOKEN) return new Response("unauthorized", { status: 401 });
  const month = url.searchParams.get("month") || "2026-05";
  const dryRun = url.searchParams.get("dryRun") !== "false";
  try {
    const token = await getToken();
    if (url.searchParams.get("phase") === "overflow") {
      const rep: any[] = [];
      for (const fid of OVERFLOW_FILES) {
        if (dryRun) { rep.push({ file: fid, action: "WILL COPY to overflow" }); continue; }
        const r = await copyFile(token, fid, OVERFLOW);
        rep.push({ file: fid, action: r.error ? "FAILED" : "COPIED", note: r.error ? r.error.slice(0,80) : (r.name||"") });
      }
      return new Response(JSON.stringify({ phase: "overflow", dryRun, count: OVERFLOW_FILES.length, report: rep }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    if (url.searchParams.get("phase") === "may-fix") {
      const mainMay = TARGET["2026-05"];
      const sourceFiles = await listFiles(token, SOURCE_MAY);
      const invoices = await dbInvoices("2026-05");
      const rep: any[] = [];
      let copied = 0, already = 0, notfound = 0, toCar = 0;
      for (const inv of invoices) {
        const car = CAR_IDS.includes(inv.id);
        const dest = car ? PARTIAL_MAY : mainMay;
        const cls = classifyLink(inv.drive_file_link || "");
        if (cls.kind === "FILE") { continue; }
        let fileId = "", how = "";
        if (cls.kind === "FILE") { fileId = cls.id; how = "db-link"; }
        else {
          const num = norm(inv.invoice_number || "");
          const match = num.length >= 4 ? sourceFiles.find((f) => norm(f.name).includes(num)) : null;
          if (match) { fileId = match.id; how = "matched"; }
        }
        if (!fileId) { rep.push({ id: inv.id, num: inv.invoice_number, dest: car ? "CAR" : "MAIN", action: "NOT FOUND" }); notfound++; continue; }
        const parents = await getParents(token, fileId);
        if (parents.includes(dest)) { rep.push({ id: inv.id, num: inv.invoice_number, dest: car ? "CAR" : "MAIN", action: "SKIP", how }); already++; continue; }
        if (car) toCar++;
        if (dryRun) { rep.push({ id: inv.id, num: inv.invoice_number, dest: car ? "CAR" : "MAIN", action: "WILL COPY", how }); copied++; continue; }
        const r = await copyFile(token, fileId, dest);
        rep.push({ id: inv.id, num: inv.invoice_number, dest: car ? "CAR" : "MAIN", action: r.error ? "FAILED" : "COPIED", how, newId: r.id || "" });
        if (!r.error) copied++;
      }
      return new Response(JSON.stringify({ phase: "may-fix", dryRun, total: invoices.length, summary: { copied, already, notfound, toCar }, report: rep }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    const target = TARGET[month];
    const invoices = await dbInvoices(month);
    const report: any[] = [];
    let willCopy = 0, already = 0, broken = 0, viaFolder = 0;

    for (const inv of invoices) {
      const partial = inv.partial_return === true;
      const dest = (month === "2026-05" && partial) ? PARTIAL_MAY : target;
      const cls = classifyLink(inv.drive_file_link || "");
      let action = "", note = "", fileId = cls.id;

      if (cls.kind === "FILE") {
        const parents = await getParents(token, cls.id);
        if (parents.includes(dest)) { action = "SKIP (already in target)"; already++; }
        else { action = dryRun ? "WILL COPY" : "COPIED"; willCopy++; }
      } else if (cls.kind === "FOLDER") {
        const files = await listFiles(token, cls.id);
        if (files.length === 0) { action = "BROKEN (empty folder)"; broken++; }
        else { action = dryRun ? "WILL COPY (from folder)" : "COPIED (from folder)"; fileId = files[0].id; viaFolder++; note = files.length + " files in folder"; }
      } else { action = "BROKEN (" + cls.kind + ")"; broken++; }

      if (!dryRun && action.startsWith("COPIED") && fileId) {
        const r = await copyFile(token, fileId, dest);
        if (r.error) { action = "COPY FAILED"; note = r.error.slice(0, 80); }
      }

      report.push({ id: inv.id, supplier: inv.supplier_name, num: inv.invoice_number,
        partial, dest: (dest === PARTIAL_MAY ? "PARTIAL" : month), link: cls.kind, action, note });
    }

    return new Response(JSON.stringify({
      month, dryRun, total: invoices.length,
      summary: { willCopy, already, broken, viaFolder }, report,
    }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    return new Response("ERROR: " + (e as Error).message, { status: 500 });
  }
});
