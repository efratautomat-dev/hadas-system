// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  invoices-ingest                                                         ║
// ║  Pulls unread invoice emails from Gmail, classifies them with Anthropic, ║
// ║  uploads the attachment to Drive, and writes a row into Postgres.        ║
// ║                                                                          ║
// ║  Production: listens on Gmail label "מסמכים מספקים", marks processed     ║
// ║  emails with "טופל_ממתין במערכת". 14-day rolling lookback window.        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ────────────────────────────────────────────────────────────────

const SOURCE_LABEL_NAME         = "מסמכים מספקים";
const PROCESSED_LABEL_NAME      = "טופל_ממתין במערכת";
const NEEDS_REVIEW_LABEL_NAME   = "דורש בדיקה ידנית";
const PARTIAL_REFUND_LABEL_NAME = "החזר חלקי";         // owner applies manually — never created by code

const DRIVE_ROOT_ID = "1ocbxq5-ReY7WutAm48pKHDiaB8rBe6SM";
const DRIVE_SUBFOLDERS = {
  invoice:      "חשבוניות",
  partialReturn:"החזר חלקי",
  deliveryNote: "תעודות משלוח",
  statement:    "כרטסות",
  returnDoc:    "חזרות",
};

const ANTHROPIC_MODEL_CLASSIFIER = "claude-haiku-4-5-20251001";
const ANTHROPIC_MODEL_EXTRACTOR  = "claude-sonnet-4-6";
const ANTHROPIC_API             = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION         = "2023-06-01";

const HEBREW_MONTHS = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

// ── Body-link invoice fetching (mirrors the existing N8N HTTP node) ──────────
const MAX_LINKS_PER_EMAIL   = 5;     // cap so a link-spam email can't DOS the run
const LINK_FETCH_TIMEOUT_MS = 20000; // per-link fetch timeout
const LINK_FETCH_HEADERS = {
  "Accept":     "*/*",
  "User-Agent": "Mozilla/5.0",
};

// ─── CORS / JSON ───────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hadas-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ─── Auth ──────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const key = req.headers.get("x-hadas-key");
  const expected = Deno.env.get("HADAS_API_KEY");
  return !!expected && key === expected;
}

// ─── Logger (writes to system_logs + console) ──────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

function makeLogger(supabase: SupabaseClient) {
  return async function log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    messageId?: string,
  ) {
    const line = `[${level}] ${messageId ? `(${messageId}) ` : ""}${message}`;
    let contextStr = "";
    try { contextStr = context ? JSON.stringify(context) : ""; }
    catch { contextStr = "[unserializable context]"; }
    console.log(line, contextStr);
    try {
      // supabase-js v2 returns { data, error } — a DB error does NOT throw,
      // so the error must be inspected explicitly or the write fails silently.
      const { error } = await supabase.from("system_logs").insert({
        source:     "invoices-ingest",
        level,
        message,
        context:    context ?? null,
        message_id: messageId ?? null,
      });
      if (error) {
        console.error(`[logger] system_logs insert failed: ${error.message}` +
          (error.code ? ` (code ${error.code})` : ""));
      }
    } catch (e) {
      console.error("[logger] system_logs insert threw:", e instanceof Error ? e.message : String(e));
    }
  };
}

type Logger = ReturnType<typeof makeLogger>;

// ─── Gmail OAuth + helpers ─────────────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type:    "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`Google token exchange failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`No access_token: ${data.error ?? "unknown"}`);
  return data.access_token;
}

interface GmailPart {
  mimeType: string;
  filename?: string;
  body: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds?: string[];
  payload: GmailPart & { headers: Array<{ name: string; value: string }> };
}

async function gmailListLabels(
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`labels.list failed: ${resp.status}`);
  const data = await resp.json() as { labels?: Array<{ id: string; name: string }> };
  return data.labels ?? [];
}

async function gmailEnsureLabel(token: string, name: string): Promise<string> {
  const labels = await gmailListLabels(token);
  const found  = labels.find((l) => l.name === name);
  if (found) return found.id;

  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      name,
      labelListVisibility:   "labelShow",
      messageListVisibility: "show",
    }),
  });
  if (!resp.ok) throw new Error(`labels.create(${name}) failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { id: string };
  return data.id;
}

async function gmailListMessages(
  token: string,
  query: string,
  maxResults = 25,
): Promise<string[]> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`messages.list failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { messages?: Array<{ id: string }> };
  return (data.messages ?? []).map((m) => m.id);
}

async function gmailGetMessage(token: string, id: string): Promise<GmailMessage> {
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) throw new Error(`messages.get(${id}) failed: ${resp.status}`);
  return resp.json() as Promise<GmailMessage>;
}

async function gmailGetAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) throw new Error(`attachments.get failed: ${resp.status}`);
  const data = await resp.json() as { data: string };
  return base64UrlToBytes(data.data);
}

async function gmailModifyLabels(
  token: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<void> {
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ addLabelIds, removeLabelIds }),
    },
  );
}

async function gmailSendAlertEmail(
  token: string,
  to: string,
  subject: string,
  bodyText: string,
): Promise<void> {
  const raw =
    `To: ${to}\r\n` +
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n` +
    `\r\n` +
    bodyText;
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ raw: encoded }),
  });
}

// ─── Drive filename helpers ────────────────────────────────────────────────

// Replaces filesystem-unsafe characters and trims; falls back to placeholder if empty.
function sanitizeForFilename(s: string): string {
  return (s ?? "").replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

// Picks an extension from the original filename, then falls back to MIME.
function pickExtension(origFilename: string, mimeType: string): string {
  const m = origFilename.match(/\.([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  const mt = (mimeType ?? "").toLowerCase();
  if (mt === "application/pdf") return "pdf";
  if (mt === "image/png")        return "png";
  return "jpg";
}

function buildInvoiceFilename(
  supplierName:  string,
  invoiceNumber: string,
  invoiceDate:   string,
  origFilename:  string,
  mimeType:      string,
): string {
  const safe = sanitizeForFilename(supplierName) || "ספק לא ידוע";
  const ext  = pickExtension(origFilename, mimeType);
  const num  = (invoiceNumber ?? "").trim();
  const id   = num || (invoiceDate || new Date().toISOString().slice(0, 10));
  return `${safe} - ${id}.${ext}`;
}

function buildDeliveryNoteFilename(
  supplierName: string,
  noteNumber:   string,
  date:         string,
  origFilename: string,
  mimeType:     string,
): string {
  const safe = sanitizeForFilename(supplierName) || "ספק לא ידוע";
  const ext  = pickExtension(origFilename, mimeType);
  const id   = (noteNumber ?? "").trim() || (date || new Date().toISOString().slice(0, 10));
  return `${safe} - תעודת משלוח ${id}.${ext}`;
}

function buildReturnFilename(
  supplierName:     string,
  creditNoteNumber: string,
  date:             string,
  origFilename:     string,
  mimeType:         string,
): string {
  const safe = sanitizeForFilename(supplierName) || "ספק לא ידוע";
  const ext  = pickExtension(origFilename, mimeType);
  const id   = (creditNoteNumber ?? "").trim() || (date || new Date().toISOString().slice(0, 10));
  return `${safe} - זיכוי ${id}.${ext}`;
}

function buildStatementFilename(origFilename: string, mimeType: string): string {
  // Statements have no structured extractor — sanitize the email attachment name.
  const ext  = pickExtension(origFilename, mimeType);
  const base = sanitizeForFilename(origFilename.replace(/\.[a-z0-9]+$/i, "")) || "כרטסת";
  return `${base}.${ext}`;
}

// ASCII-safe key for Supabase Storage. The Storage API rejects keys containing
// non-ASCII characters (Hebrew, spaces, etc.), so display names go to Drive
// (which accepts Hebrew) while Storage keys are built from IDs we control plus
// the Gmail message ID for per-email uniqueness. Any stray non-ASCII chars in
// supplier IDs or document numbers are stripped defensively.
function buildStorageKey(
  prefix:     string,
  supplierId: string | null | undefined,
  docNumber:  string | null | undefined,
  msgId:      string,
  ext:        string,
): string {
  const sup = (supplierId ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  const num = (docNumber  ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  const parts = [prefix];
  if (sup) parts.push(sup);
  if (num) parts.push(num);
  parts.push(msgId);
  return parts.join("-") + "." + ext;
}

// ─── Drive helpers ─────────────────────────────────────────────────────────

async function driveFindFolder(
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

async function driveCreateFolder(
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

async function driveEnsureFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<string> {
  const found = await driveFindFolder(token, parentId, name);
  if (found) return found;
  return driveCreateFolder(token, parentId, name);
}

interface UploadedFile { id: string; webViewLink: string }

async function driveUploadFile(
  token: string,
  parentId: string,
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
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

async function driveGetFolderLink(token: string, folderId: string): Promise<string> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return "";
  const data = await resp.json() as { webViewLink?: string };
  return data.webViewLink ?? "";
}

// ─── Supabase Storage helper ───────────────────────────────────────────────

type StorageDocType = "invoices" | "delivery-notes" | "returns" | "statements";
const STORAGE_BUCKET = "documents";

// Uploads bytes to the (private) "documents" bucket at {type}/{YYYY}/{MM}/{filename}
// and returns the storage PATH — not a URL. The bucket is private, so callers
// generate a short-lived signed URL at view time via:
//   supabase.storage.from("documents").createSignedUrl(path, expiresInSeconds)
// upsert:true so a re-run on the same email overwrites rather than fails —
// dedup is enforced at the DB level upstream.
async function uploadToStorage(
  supabase: SupabaseClient,
  docType:  StorageDocType,
  date:     Date,
  filename: string,
  mimeType: string,
  bytes:    Uint8Array,
): Promise<string> {
  const yyyy = String(date.getUTCFullYear());
  const mm   = String(date.getUTCMonth() + 1).padStart(2, "0");
  const path = `${docType}/${yyyy}/${mm}/${filename}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([bytes], { type: mimeType }), {
      contentType: mimeType,
      upsert:      true,
    });
  if (error) throw new Error(`storage upload failed (${path}): ${error.message}`);
  return path;
}

// ─── Base64 / body helpers ─────────────────────────────────────────────────

function base64UrlToBytes(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - s.length % 4) % 4);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeBase64UrlToText(s: string): string {
  return new TextDecoder("utf-8").decode(base64UrlToBytes(s));
}

function flattenParts(part: GmailPart): GmailPart[] {
  const out: GmailPart[] = [part];
  part.parts?.forEach((p) => out.push(...flattenParts(p)));
  return out;
}

function extractBodyText(message: GmailMessage): string {
  const flat = flattenParts(message.payload as GmailPart);
  const plain = flat.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain?.body.data) return decodeBase64UrlToText(plain.body.data);
  const html = flat.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (html?.body.data) {
    return decodeBase64UrlToText(html.body.data)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ");
  }
  if (message.payload.body?.data) return decodeBase64UrlToText(message.payload.body.data);
  return "";
}

function extractHeader(message: GmailMessage, name: string): string {
  return message.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// Find attachments that are usable as the invoice itself (PDF / image).
interface CandidateAttachment {
  attachmentId: string;
  filename:     string;
  mimeType:     string;
  size:         number;
  isInline:     boolean;
}

function findAttachments(message: GmailMessage): CandidateAttachment[] {
  const flat = flattenParts(message.payload as GmailPart);
  const out: CandidateAttachment[] = [];
  for (const p of flat) {
    if (!p.body?.attachmentId || !p.filename) continue;
    const mt = (p.mimeType || "").toLowerCase();
    const isPdf   = mt === "application/pdf";
    const isImage = mt.startsWith("image/");
    if (isPdf || isImage) {
      const disp     = p.headers?.find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
      const isInline = disp.toLowerCase().startsWith("inline");
      out.push({
        attachmentId: p.body.attachmentId,
        filename:     p.filename,
        mimeType:     p.mimeType || (isPdf ? "application/pdf" : "image/jpeg"),
        size:         p.body.size ?? 0,
        isInline,
      });
    }
  }
  return out;
}

// ─── Attachment filtering — Stage 1 (heuristic) ────────────────────────────

const LOGO_FILENAME_RE    = /logo|signature|image00[1-9]|banner|footer|header/i;
const LOGO_SIZE_THRESHOLD = 30_000; // bytes — typical upper-bound for inline logos

interface RejectedAttachment { filename: string; mimeType: string; size: number; reason: string }

function heuristicFilterAttachments(
  attachments: CandidateAttachment[],
): { kept: CandidateAttachment[]; rejected: RejectedAttachment[] } {
  const kept: CandidateAttachment[] = [];
  const rejected: RejectedAttachment[] = [];
  for (const a of attachments) {
    const mt = a.mimeType.toLowerCase();
    if (LOGO_FILENAME_RE.test(a.filename)) {
      rejected.push({ filename: a.filename, mimeType: a.mimeType, size: a.size,
        reason: "filename matches logo/signature pattern" });
    } else if (a.isInline) {
      rejected.push({ filename: a.filename, mimeType: a.mimeType, size: a.size,
        reason: "Content-Disposition: inline (embedded HTML image)" });
    } else if (mt.startsWith("image/") && a.size < LOGO_SIZE_THRESHOLD) {
      rejected.push({ filename: a.filename, mimeType: a.mimeType, size: a.size,
        reason: `image too small (${a.size} B < ${LOGO_SIZE_THRESHOLD} B threshold)` });
    } else if (/\.gif$/i.test(a.filename) || mt === "image/gif") {
      rejected.push({ filename: a.filename, mimeType: a.mimeType, size: a.size,
        reason: ".gif is not a document format" });
    } else {
      kept.push(a);
    }
  }
  return { kept, rejected };
}

// ─── Body-link invoice fetching ────────────────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi,    "&")
    .replace(/&lt;/gi,     "<")
    .replace(/&gt;/gi,     ">")
    .replace(/&quot;/gi,   '"')
    .replace(/&#0?39;/g,   "'")
    .replace(/&#x2[fF];/g, "/");
}

function extractRawHtml(message: GmailMessage): string {
  const flat = flattenParts(message.payload as GmailPart);
  const html = flat.find((p) => p.mimeType === "text/html" && p.body?.data);
  return html?.body.data ? decodeBase64UrlToText(html.body.data) : "";
}

const FILE_URL_RE    = /\.(pdf|jpe?g|png)(?:[?#]|$)/i;
const DOWNLOAD_WORDS = ["להורדה", "חשבונית", "download", "invoice"];

// True for URLs that look like they point at a downloadable invoice file.
function isFileHostUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    FILE_URL_RE.test(u) ||
    u.includes("drive.google.com/file/d/") ||
    u.includes("drive.google.com/open?id=") ||
    u.includes("drive.google.com/uc?") ||
    u.includes("docs.google.com/") ||
    u.includes("dropbox.com/") ||
    u.includes("dropboxusercontent.com/") ||
    u.includes("wetransfer.com/") ||
    u.includes("we.tl/") ||
    // icount (the supplier invoicing platform) wraps the real document link in a
    // track.icount.co.il click-tracker; invoice-maven is the underlying doc host.
    u.includes("track.icount.co.il/") ||
    u.includes("icount.co.il/") ||
    u.includes("invoice-maven")
  );
}

function extractAnchors(html: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[1].trim());
    const text = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (/^https?:\/\//i.test(href)) out.push({ href, text });
  }
  return out;
}

function rawUrls(text: string): string[] {
  return (text.match(/https?:\/\/[^\s<>"'\)\]]+/gi) ?? []).map((u) => u.replace(/[).,;]+$/, ""));
}

// Collects candidate invoice-file URLs from the body — file-host links first,
// then links explicitly labelled as a download/invoice link.
function extractInvoiceLinks(plainText: string, html: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const url = decodeHtmlEntities(raw.trim());
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    candidates.push(url);
  };

  const anchors = extractAnchors(html);

  // 1. Anchors whose href is a known file host / direct file URL
  for (const a of anchors) if (isFileHostUrl(a.href)) add(a.href);

  // 2. Anchors whose visible text labels them as a download/invoice link
  for (const a of anchors) {
    const label = a.text.toLowerCase();
    if (DOWNLOAD_WORDS.some((w) => label.includes(w.toLowerCase()))) add(a.href);
  }

  // 3. Raw URLs (HTML source + plain text) that point at a file host
  for (const u of [...rawUrls(html), ...rawUrls(plainText)]) {
    if (isFileHostUrl(u)) add(u);
  }

  // 4. Raw URLs in plain text sitting next to a download keyword
  for (const u of rawUrls(plainText)) {
    const idx = plainText.indexOf(u);
    if (idx === -1) continue;
    const around = plainText.slice(Math.max(0, idx - 60), idx + u.length + 60).toLowerCase();
    if (DOWNLOAD_WORDS.some((w) => around.includes(w.toLowerCase()))) add(u);
  }

  return candidates;
}

// icount does NOT send a direct PDF link — the real document URL is wrapped in a
// click-tracking URL of the form track.icount.co.il/CL0/<ENCODED_REAL_URL>/<...>.
// Following the tracker's own redirect lands on a landing/login page, not the PDF,
// so we must lift the encoded segment out and decodeURIComponent it to recover the
// real document URL (mirrors the working N8N flow). Some trackers double-encode,
// so we decode up to twice and keep the first http(s) URL we recover.
function unwrapTrackingUrl(url: string): string {
  const m = url.match(/track\.icount\.co\.il\/CL0\/([^/?#]+)/i);
  if (!m) return url;
  let seg = m[1];
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(seg);
      if (/^https?:\/\//i.test(decoded)) return decoded;
      if (decoded === seg) break; // no further change — stop decoding
      seg = decoded;
    } catch { break; }
  }
  return url;
}

// Rewrites share links into their direct-download form where possible.
function normalizeDownloadUrl(url: string): string {
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]+)/i);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  if (/dropbox\.com\//i.test(url)) {
    if (/[?&]dl=0\b/i.test(url)) return url.replace(/([?&])dl=0\b/i, "$1dl=1");
    if (/[?&]dl=1\b/i.test(url)) return url;
    return url + (url.includes("?") ? "&" : "?") + "dl=1";
  }
  return url;
}

// Identifies a file by its magic bytes — authoritative over Content-Type.
function sniffFileType(bytes: Uint8Array): "pdf" | "image" | "other" {
  if (bytes.length >= 4 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";   // %PDF
  if (bytes.length >= 3 &&
      bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image";                       // JPEG
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
      bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return "image";   // PNG
  return "other";
}

// Returns the specific image MIME type from the bytes' magic numbers, or null if
// the bytes aren't a recognized image. Authoritative over any declared/header MIME
// — servers (icount included) sometimes label PNG bytes as image/jpeg, which makes
// the Anthropic vision call 400. Note: Anthropic vision accepts png/jpeg/gif/webp.
function sniffImageMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";  // PNG
  if (bytes.length >= 3 &&
      bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";                       // JPEG
  if (bytes.length >= 6 &&
      bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";                        // GIF
  if (bytes.length >= 12 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp"; // WEBP
  return null;
}

function filenameFromUrl(url: string, kind: "pdf" | "image"): string {
  try {
    const base = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    if (/\.(pdf|jpe?g|png)$/i.test(base)) return decodeURIComponent(base);
  } catch { /* fall through to default */ }
  return kind === "pdf" ? "invoice.pdf" : "invoice.jpg";
}

async function fetchLinkBinary(url: string): Promise<Response> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LINK_FETCH_TIMEOUT_MS);
  try {
    // Deno's fetch follows redirects automatically (redirect: "follow").
    return await fetch(url, {
      method:   "GET",
      headers:  LINK_FETCH_HEADERS,
      redirect: "follow",
      signal:   ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface ResolvedDoc { mimeType: string; filename: string; bytes: Uint8Array }

// Tries each candidate link in order; returns the first that yields a PDF/image.
// Never throws — every failure is logged and collected for the caller's alert.
async function resolveDocFromLinks(
  candidates: string[],
  log:        Logger,
  msgId:      string,
): Promise<{ doc: ResolvedDoc | null; failures: Array<{ url: string; reason: string }> }> {
  const failures: Array<{ url: string; reason: string }> = [];

  if (candidates.length > MAX_LINKS_PER_EMAIL) {
    await log("warn", `email has ${candidates.length} candidate links — capping at ${MAX_LINKS_PER_EMAIL}`,
      { total: candidates.length }, msgId);
  }

  for (const rawUrl of candidates.slice(0, MAX_LINKS_PER_EMAIL)) {
    // Unwrap icount click-tracker first, then rewrite share links to direct-download form.
    const url = normalizeDownloadUrl(unwrapTrackingUrl(rawUrl));
    try {
      const resp = await fetchLinkBinary(url);
      if (!resp.ok) {
        failures.push({ url, reason: `HTTP ${resp.status}` });
        await log("warn", `link fetch failed — HTTP ${resp.status}`, { url, rawUrl }, msgId);
        continue;
      }
      const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const kind  = sniffFileType(bytes);
      if (kind === "other") {
        const reason = `not a PDF/image (content-type: ${contentType || "unknown"})`;
        failures.push({ url, reason });
        await log("info", `link skipped — ${reason}`, { url, bytes: bytes.length }, msgId);
        continue;
      }
      // Logo/size filter — the attachment path drops tiny images as logos, but the
      // link path had no such gate, so a ~20KB decorative logo could win over the
      // real invoice link. Skip small images and keep trying the next candidate.
      if (kind === "image" && bytes.length < LOGO_SIZE_THRESHOLD) {
        const reason = `image too small (${bytes.length} B < ${LOGO_SIZE_THRESHOLD} B) — likely a logo`;
        failures.push({ url, reason });
        await log("info", `link skipped — ${reason}`, { url }, msgId);
        continue;
      }
      const mimeType =
        kind === "pdf" ? "application/pdf"
        : sniffImageMediaType(bytes)
          ?? (contentType.startsWith("image/") ? contentType : "image/jpeg");
      await log("info", `link yielded a ${kind} (${bytes.length} bytes)`, { url, contentType }, msgId);
      return { doc: { mimeType, filename: filenameFromUrl(url, kind), bytes }, failures };
    } catch (e) {
      const reason = e instanceof Error
        ? (e.name === "AbortError" ? `timeout after ${LINK_FETCH_TIMEOUT_MS}ms` : e.message)
        : String(e);
      failures.push({ url, reason });
      await log("warn", `link fetch error — ${reason}`, { url, rawUrl }, msgId);
    }
  }
  return { doc: null, failures };
}

// ─── Doc-type routing by subject ───────────────────────────────────────────

type DocType = "invoice" | "delivery_note" | "statement" | "return_doc" | "skip" | "unknown";

function classifyBySubject(subject: string): DocType {
  const s = (subject ?? "").trim();
  if (s.includes("משלוח"))               return "delivery_note";
  if (s.includes("כרטסת"))               return "statement";
  if (s.includes("חזרה") || s.includes("זיכוי")) return "return_doc";
  if (s.includes("חשבונית"))             return "invoice";
  return "unknown";
}

// ─── Anthropic helpers ─────────────────────────────────────────────────────

interface AnthropicTextBlock { type: "text"; text: string }
interface AnthropicImageBlock {
  type:   "image";
  source: { type: "base64"; media_type: string; data: string };
}
interface AnthropicDocumentBlock {
  type:   "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicDocumentBlock;

interface AnthropicMessage { role: "user"; content: AnthropicContentBlock[] }

async function anthropicMessage(
  model: string,
  messages: AnthropicMessage[],
  maxTokens = 2048,
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const resp = await fetch(ANTHROPIC_API, {
    method:  "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type":      "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${txt}`);
  }
  const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
  return data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function buildDocumentBlock(mimeType: string, bytes: Uint8Array): AnthropicContentBlock {
  const data = bytesToBase64(bytes);
  if (mimeType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  // Derive the image media_type from the actual bytes — a declared/header MIME of
  // image/jpeg on PNG bytes makes the Anthropic call 400. Fall back to the declared
  // type only when the bytes aren't a recognized image.
  const mt = sniffImageMediaType(bytes) ?? (mimeType.startsWith("image/") ? mimeType : "image/jpeg");
  return { type: "image", source: { type: "base64", media_type: mt, data } };
}

// ─── JSON repair helpers ───────────────────────────────────────────────────

// Tries to parse raw AI output as JSON, applying progressive repairs before giving up.
// Returns null if all attempts fail — never throws.
function parseJsonRobust(raw: string): unknown | null {
  // 1. Try markdown fence extraction (```json ... ```)
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ }
  }
  // 2. Find outermost { }
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  const slice = raw.slice(s, e + 1);
  // 3. As-is
  try { return JSON.parse(slice); } catch { /* continue */ }
  // 4. Repair: smart/curly quotes → straight, trailing commas before } or ]
  const repaired = slice
    .replace(/[“”„‟‘’ʼ]/g, '"')
    .replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(repaired); } catch { return null; }
}

// ─── Subject-classifier (Haiku) ────────────────────────────────────────────

async function classifyWithAI(subject: string, bodyPreview: string): Promise<DocType> {
  const prompt = `סווג את המסמך לאחת מהקטגוריות הבאות: חשבונית, תעודת משלוח, כרטסת, תעודת זיכוי, או "לא רלוונטי".
החזר רק את המילים, ללא הסבר.

נושא המייל: ${subject}
תוכן המייל (תחילה): ${bodyPreview.slice(0, 500)}`;

  const text = (await anthropicMessage(
    ANTHROPIC_MODEL_CLASSIFIER,
    [{ role: "user", content: [{ type: "text", text: prompt }] }],
    64,
  )).trim();

  if (text.includes("לא רלוונטי")) return "skip";
  if (text.includes("חשבונית"))     return "invoice";
  if (text.includes("תעודת משלוח")) return "delivery_note";
  if (text.includes("כרטסת"))        return "statement";
  if (text.includes("זיכוי"))         return "return_doc";
  return "unknown";
}

// ─── Invoice extractor (Sonnet) ────────────────────────────────────────────

interface ExtractedInvoice {
  vendor_name:        string;
  invoice_number:     string;
  invoice_date:       string;   // YYYY-MM-DD
  total_amount:       number;
  amount_before_vat:  number;
  vat_amount:         number;
  currency:           string;
  category:           string;
  line_items:         string[];
  confidence:         "high" | "medium" | "low";
  missing_fields:     string[];
}

async function extractInvoice(
  doc:               { mimeType: string; bytes: Uint8Array },
  categories:        string[],
  supplierHint:      { name: string; category: string } | null,
): Promise<ExtractedInvoice> {
  const hintLine = supplierHint
    ? `רמז: ספק זה (${supplierHint.name}) קוטלג בעבר כ-"${supplierHint.category}" - השתמש בזה אם זה תואם לתוכן.`
    : "";

  const prompt = `אתה מנתח חשבוניות מומחה לחשבוניות ישראליות. חלץ את הפרטים הבאים מהחשבונית וחזור ב-JSON בלבד, ללא הסברים, ללא backticks.

מבנה החזרה:
{"vendor_name":"","invoice_number":"","invoice_date":"","total_amount":0,"amount_before_vat":0,"vat_amount":0,"currency":"ILS","category":"","line_items":[],"confidence":"high","missing_fields":[]}

כללי תאריכים (חשוב מאוד):
- פורמט הפלט הסופי: YYYY-MM-DD.
- תאריכים בחשבוניות ישראליות נכתבים תמיד DD/MM/YY או DD/MM/YYYY (יום, חודש, שנה — לא הפורמט האמריקאי).
  • "03/05/26"   → 2026-05-03 (ולא 2003-05-26)
  • "15.04.2026" → 2026-04-15
  • "18/05/2026" → 2026-05-18
  • "01/05/26"   → 2026-05-01 (ולא 2001-05-26)
- אם הפענוח מוביל לשנה לפני 2023, זה כמעט בוודאות שגיאת קריאה — סמן confidence=low והוסף "invoice_date" ל-missing_fields במקום לקבל תאריך ישן בלתי סביר.
- כאשר התמונה לא ברורה והשנה דו-משמעית בין מאות (למשל 1903 מול 2026), העדף את השנה הנוכחית (2026) על פני שנים ישנות יותר.

כללים נוספים:
- סכומים כמספרים בלבד ללא סימני מטבע
- confidence: high/medium/low לפי רמת הוודאות שלך
- missing_fields: רשימת שדות שלא מצאת
- line_items: רשימת פריטים כטקסט פשוט
- אם שם עסק מכיל גרשיים (כמו בע"מ), השתמש בגרשיים עבריים: בע״מ
- אם המסמך הוא חשבונית זיכוי (Credit Note / זיכוי / סכום שלילי) — החזר את הסכומים כשליליים

זיהוי "לא חשבונית" (קריטי):
- חשבונית אמיתית מכילה את הכותרת "חשבונית מס" או "חשבונית מקור", או מספר חשבונית בתחילית "חשבונית".
- מסמך הזמנה ("הזמנה" / "ההזמנה תקפה עד" / "מסמך מחושב") הוא לא חשבונית, גם אם מופיעים בו מחירים וסכומים.
- אם המסמך לא חשבונית בפועל — החזר confidence=low, הוסף "not_invoice" ל-missing_fields, ואל תמציא נתונים. השאר vendor_name ו-line_items ככל הניתן, אבל אל תפענח invoice_number או invoice_date.

קטגוריות זמינות (חופשי לבחור מתוכן, או להציע חדשה אם אף אחת לא מתאימה):
${categories.join(", ")}

${hintLine}`;

  const raw = await anthropicMessage(
    ANTHROPIC_MODEL_EXTRACTOR,
    [{
      role:    "user",
      content: [
        buildDocumentBlock(doc.mimeType, doc.bytes),
        { type: "text", text: prompt },
      ],
    }],
    2048,
  );

  let parsed = parseJsonRobust(raw);
  if (parsed === null) {
    const retryRaw = await anthropicMessage(
      ANTHROPIC_MODEL_EXTRACTOR,
      [{
        role: "user",
        content: [
          buildDocumentBlock(doc.mimeType, doc.bytes),
          { type: "text", text: "ענה ב-JSON בלבד ללא markdown וללא הסבר:\n" +
            '{"vendor_name":"","invoice_number":"","invoice_date":"","total_amount":0,"amount_before_vat":0,"vat_amount":0,"currency":"ILS","category":"","line_items":[],"confidence":"high","missing_fields":[]}' },
        ],
      }],
      2048,
    );
    parsed = parseJsonRobust(retryRaw);
    if (parsed === null) {
      throw new Error(`extractInvoice failed after retry. Raw: ${raw.slice(0, 500)}`);
    }
  }
  const p = parsed as Record<string, unknown>;
  return {
    vendor_name:       String(p.vendor_name ?? ""),
    invoice_number:    String(p.invoice_number ?? ""),
    invoice_date:      String(p.invoice_date ?? ""),
    total_amount:      Number(p.total_amount ?? 0),
    amount_before_vat: Number(p.amount_before_vat ?? 0),
    vat_amount:        Number(p.vat_amount ?? 0),
    currency:          String(p.currency ?? "ILS"),
    category:          String(p.category ?? ""),
    line_items:        Array.isArray(p.line_items) ? p.line_items.map(String) : [],
    confidence:        (p.confidence === "high" || p.confidence === "medium" || p.confidence === "low")
                         ? p.confidence : "low",
    missing_fields:    Array.isArray(p.missing_fields) ? p.missing_fields.map(String) : [],
  };
}

// ─── Attachment AI classification — Stage 2 (Haiku, cheap) ───────────────

interface AttachmentClassification {
  is_invoice:    boolean;
  document_type: "invoice" | "delivery_note" | "credit_note" | "receipt" | "other";
  confidence:    "high" | "medium" | "low";
}

async function classifyAttachmentDoc(
  doc: { mimeType: string; bytes: Uint8Array },
): Promise<AttachmentClassification> {
  const raw = await anthropicMessage(
    ANTHROPIC_MODEL_CLASSIFIER,
    [{
      role:    "user",
      content: [
        buildDocumentBlock(doc.mimeType, doc.bytes),
        {
          type: "text",
          text:
`Classify this Hebrew business document by its content alone. The email subject is intentionally not provided — never guess based on a subject.

Mapping by document text:
- "חשבונית מס" or "חשבונית מקור" or an invoice number prefixed with "חשבונית" → "invoice"
- "הזמנה" / "ההזמנה תקפה עד" / "מסמך מחושב" (without "חשבונית מס" or "חשבונית מקור") → "delivery_note". Orders are routed as delivery notes in this system; they are NEVER invoices.
- "תעודת משלוח" → "delivery_note"
- "חשבונית זיכוי" or "תעודת זיכוי" → "credit_note"
- A receipt with no invoice header ("קבלה") → "receipt"
- Anything else → "other"

Critical: classify as "invoice" ONLY if the document explicitly contains "חשבונית מס" or "חשבונית מקור", or shows an invoice number prefixed with "חשבונית". A document whose header says "הזמנה" is NOT an invoice even when it lists prices and totals.

Answer JSON only: {"is_invoice": true/false, "document_type": "invoice"|"delivery_note"|"credit_note"|"receipt"|"other", "confidence": "high"|"medium"|"low"}`,
        },
      ],
    }],
    64,
  );
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return { is_invoice: false, document_type: "other", confidence: "low" };
  try {
    const p = JSON.parse(raw.slice(start, end + 1));
    const VALID_TYPES = ["invoice", "delivery_note", "credit_note", "receipt", "other"] as const;
    const VALID_CONF  = ["high", "medium", "low"] as const;
    return {
      is_invoice:    Boolean(p.is_invoice),
      document_type: VALID_TYPES.includes(p.document_type) ? p.document_type : "other",
      confidence:    VALID_CONF.includes(p.confidence)     ? p.confidence    : "low",
    };
  } catch {
    return { is_invoice: false, document_type: "other", confidence: "low" };
  }
}

// Stage 3 — pick best from classified candidates
interface ScoredAttachment { att: CandidateAttachment; bytes: Uint8Array; cls: AttachmentClassification }

function selectBestAttachment(scored: ScoredAttachment[]): ScoredAttachment | null {
  const invoices = scored.filter((s) => s.cls.is_invoice);
  if (invoices.length === 0) return null; // caller falls through to link scan
  const rank = (s: ScoredAttachment) => {
    const conf = s.cls.confidence === "high" ? 2 : s.cls.confidence === "medium" ? 1 : 0;
    const pdf  = s.att.mimeType === "application/pdf" ? 1 : 0;
    return conf * 1000 + pdf * 100 + s.att.size / 1_000_000;
  };
  return invoices.sort((a, b) => rank(b) - rank(a))[0];
}

// Pick the most useful DocType from a set of classified attachments. Returns
// null when the classifier had nothing specific to say (all "receipt"/"other"),
// in which case the caller keeps the subject-derived docType — important for
// statement emails, since the classifier vocabulary doesn't include "statement".
function dominantDocType(scored: ScoredAttachment[]): DocType | null {
  if (scored.length === 0) return null;
  if (scored.some((s) => s.cls.document_type === "invoice"))       return "invoice";
  if (scored.some((s) => s.cls.document_type === "delivery_note")) return "delivery_note";
  if (scored.some((s) => s.cls.document_type === "credit_note"))   return "return_doc";
  return null;
}

// ─── Fuzzy supplier matching (mirrored from payments-ingest) ───────────────

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/['"״׳`‘’“”]/g, "")
    .replace(/[^א-תa-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarityScore(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  const editScore = 1 - levenshtein(na, nb) / maxLen;
  const tokA  = new Set(na.split(" "));
  const tokB  = new Set(nb.split(" "));
  const inter = [...tokA].filter((t) => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const tokenScore = union > 0 ? inter / union : 0;
  const longEnough = na.length >= 3 && nb.length >= 3;
  const containScore = longEnough && (na.includes(nb) || nb.includes(na)) ? 0.9 : 0;
  return Math.max(editScore, tokenScore, containScore);
}

interface SupplierRow { id: string; name: string; category: string | null }

function findBestSupplier(typed: string, suppliers: SupplierRow[], threshold = 0.85): SupplierRow | null {
  let best: { row: SupplierRow; score: number } | null = null;
  for (const s of suppliers) {
    const score = similarityScore(typed, s.name);
    if (!best || score > best.score) best = { row: s, score };
  }
  return best && best.score >= threshold ? best.row : null;
}

// ─── Drive path resolution ─────────────────────────────────────────────────

interface FolderTarget { fileFolderId: string; monthFolderId: string }

async function resolveInvoiceFolder(
  token:         string,
  invoiceDate:   string,
  partialReturn: boolean,
): Promise<FolderTarget> {
  const d = new Date(invoiceDate);
  const year  = String(d.getUTCFullYear());
  const month = HEBREW_MONTHS[d.getUTCMonth()];
  const invoiceRoot = await driveEnsureFolder(token, DRIVE_ROOT_ID,  DRIVE_SUBFOLDERS.invoice);
  const yearFolder  = await driveEnsureFolder(token, invoiceRoot,    year);
  const monthFolder = await driveEnsureFolder(token, yearFolder,     month);
  const fileFolder  = partialReturn
    ? await driveEnsureFolder(token, monthFolder, DRIVE_SUBFOLDERS.partialReturn)
    : monthFolder;
  return { fileFolderId: fileFolder, monthFolderId: monthFolder };
}

// ─── Main ingest ───────────────────────────────────────────────────────────

interface IngestResult {
  processed:  number;
  alerts:     number;
  skipped:    number;
  errors:     string[];
  ts:         string;
}

async function ingestInvoices(supabase: SupabaseClient): Promise<IngestResult> {
  const result: IngestResult = {
    processed: 0,
    alerts:    0,
    skipped:   0,
    errors:    [],
    ts:        new Date().toISOString(),
  };
  const log = makeLogger(supabase);

  const token = await getGoogleAccessToken();
  await log("info", "google token acquired");

  // Resolve labels (creating destinations as needed; source must already exist)
  const labels = await gmailListLabels(token);
  const sourceLabelId = labels.find((l) => l.name === SOURCE_LABEL_NAME)?.id;
  if (!sourceLabelId) {
    await log("error", `source label "${SOURCE_LABEL_NAME}" not found in Gmail — create it manually first`);
    result.errors.push(`source label "${SOURCE_LABEL_NAME}" missing`);
    return result;
  }
  const destProcessed   = await gmailEnsureLabel(token, PROCESSED_LABEL_NAME);
  const destNeedsReview = await gmailEnsureLabel(token, NEEDS_REVIEW_LABEL_NAME);
  // Partial-refund label is applied manually by the business owner — look up only, never created
  const partialRefundLabelId = labels.find((l) => l.name === PARTIAL_REFUND_LABEL_NAME)?.id ?? null;

  // Gmail query: source label, not yet processed, last 14 days only.
  // The 14-day rolling lookback is a safety measure — without it, a freshly
  // deployed instance would chew through every historical email under the
  // source label. Intentionally no is:unread — owner may open emails before
  // the cron runs.
  const query =
    `label:"${SOURCE_LABEL_NAME}" ` +
    `-label:"${PROCESSED_LABEL_NAME}" newer_than:14d`;
  const messageIds = await gmailListMessages(token, query);
  await log("info", `found ${messageIds.length} candidate messages`, { query });

  if (messageIds.length === 0) return result;

  // Load suppliers + categories once
  const { data: supplierRows } = await supabase.from("suppliers").select("id, name, category");
  const suppliers: SupplierRow[] = supplierRows ?? [];
  const { data: catRows } = await supabase.from("categories").select("name");
  const categoryNames: string[] = (catRows ?? []).map((r: { name: string }) => r.name);

  const managerEmail = Deno.env.get("GMAIL_USER_EMAIL") ?? "";

  for (const msgId of messageIds) {
    try {
      // Idempotency: skip if already in invoices by gmail_message_id
      const { data: dup } = await supabase
        .from("invoices")
        .select("id")
        .eq("gmail_message_id", msgId)
        .maybeSingle();
      if (dup) {
        await log("info", "already ingested, applying processed label", { invoiceId: dup.id }, msgId);
        await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
        result.skipped++;
        continue;
      }

      const message    = await gmailGetMessage(token, msgId);
      const subject    = extractHeader(message, "Subject") || "(no subject)";
      const from       = extractHeader(message, "From");
      const bodyText   = extractBodyText(message);
      const rawHtml    = extractRawHtml(message);
      const emailTs    = new Date(parseInt(message.internalDate, 10)).toISOString();
      const messageLink = `https://mail.google.com/mail/u/0/#all/${msgId}`;

      await log("info", "processing", { subject, from, labelIds: message.labelIds ?? [] }, msgId);

      // 1. Determine doc type
      let docType = classifyBySubject(subject);
      if (docType === "unknown") {
        const cls = await classifyWithAI(subject, bodyText);
        await log("info", `classifier → ${cls}`, undefined, msgId);
        docType = cls;
      }

      if (docType === "skip") {
        await log("info", "classifier said 'not relevant' — marking processed and skipping", undefined, msgId);
        await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
        result.skipped++;
        continue;
      }

      if (docType === "unknown") {
        await log("warn", "classifier uncertain — alerting manager and skipping", undefined, msgId);
        if (managerEmail) {
          await gmailSendAlertEmail(token, managerEmail,
            "מייל לא סווג — invoices-ingest",
            `נושא: ${subject}\nשולח: ${from}\nקישור למייל: ${messageLink}\n\nהמסווג לא הצליח לזהות סוג מסמך. נא לבדוק ידנית.`);
        }
        await supabase.from("alerts").insert({
          type: "invoice_unclassified",
          title: "מייל חשבונית לא סווג",
          message: `לא ניתן היה לסווג את המייל "${subject}". יש לבדוק ידנית.`,
          payload: { gmailMessageId: msgId, subject, from, messageLink },
          status: "unread",
        });
        await gmailModifyLabels(token, msgId, [destNeedsReview, destProcessed], [sourceLabelId, "UNREAD"]);
        result.alerts++;
        continue;
      }

      // 2. Find + filter attachments — Stage 1 heuristic, then Stage 2 AI for multiple candidates
      const rawAtt = findAttachments(message);
      const { kept: hKept, rejected: hRejected } = heuristicFilterAttachments(rawAtt);

      // Log every heuristic rejection
      for (const rej of hRejected) {
        await log("info", `attachment rejected: ${rej.reason}`,
          { filename: rej.filename, mimeType: rej.mimeType, size: rej.size }, msgId);
      }

      type UsableDoc = { mimeType: string; filename: string; bytes: Uint8Array };
      let usableDoc:  UsableDoc | null = null;
      let usableDocs: UsableDoc[]      = []; // all docs for multi-doc non-invoice types

      // Classify EVERY surviving attachment — even a sole survivor. The customer
      // often types "חשבונית" in the subject regardless of attachment content,
      // so the subject-derived docType cannot be trusted on its own; only the
      // document content can confirm what was actually attached.
      const scored: ScoredAttachment[] = [];
      for (const a of hKept) {
        const bytes = await gmailGetAttachment(token, msgId, a.attachmentId);
        const cls   = await classifyAttachmentDoc({ mimeType: a.mimeType, bytes });
        await log("info",
          `attachment classified: ${a.filename} → ${cls.document_type} (is_invoice=${cls.is_invoice}, confidence=${cls.confidence})`,
          { filename: a.filename, mimeType: a.mimeType, size: a.size }, msgId);
        scored.push({ att: a, bytes, cls });
      }

      // If the classifier identifies a specific doc type, trust it over the subject.
      // (Skipped for statement emails — classifier vocabulary doesn't include statements
      // so dominantDocType returns null in that case, leaving docType=statement intact.)
      const overrideType = dominantDocType(scored);
      if (overrideType && overrideType !== docType) {
        await log("info",
          `overriding subject-derived docType=${docType} with classifier docType=${overrideType}`,
          undefined, msgId);
        docType = overrideType;
      }

      if (docType === "invoice") {
        // Pick single best candidate by confidence → PDF → size
        const best = selectBestAttachment(scored);
        if (best) {
          usableDoc  = { mimeType: best.att.mimeType, filename: best.att.filename, bytes: best.bytes };
          usableDocs = [usableDoc];
          await log("info", `selected: ${best.att.filename}`,
            { docType: best.cls.document_type, confidence: best.cls.confidence }, msgId);
        } else {
          await log("warn", "no attachment classified as invoice — falling through to link scan", undefined, msgId);
        }
      } else {
        // delivery_note / return_doc / statement: keep ALL non-"other" docs
        const relevant = scored.filter((s) => s.cls.document_type !== "other");
        if (relevant.length > 0) {
          usableDocs = relevant.map((s) => ({ mimeType: s.att.mimeType, filename: s.att.filename, bytes: s.bytes }));
          usableDoc  = usableDocs[0];
          await log("info", `multi-doc: ${usableDocs.length} document(s) for ${docType}`, undefined, msgId);
        } else {
          await log("warn", "no attachment relevant for doc type — falling through to link scan", undefined, msgId);
        }
      }

      // Fallback: try body links when no attachment yielded a usable doc
      let linkFailures: Array<{ url: string; reason: string }> = [];
      let attemptedLinks = false;
      if (!usableDoc) {
        const candidateLinks = extractInvoiceLinks(bodyText, rawHtml);
        if (candidateLinks.length > 0) {
          attemptedLinks = true;
          await log("info", `no usable attachment — scanning ${candidateLinks.length} body link(s)`,
            { candidateLinks }, msgId);
          const linkResult = await resolveDocFromLinks(candidateLinks, log, msgId);
          linkFailures = linkResult.failures;
          if (linkResult.doc) {
            const linked = linkResult.doc;
            if (linked.mimeType.startsWith("image/")) {
              // Classify images from links — reject non-invoice images
              const cls = await classifyAttachmentDoc({ mimeType: linked.mimeType, bytes: linked.bytes });
              await log("info",
                `link image classified: ${linked.filename} → ${cls.document_type} (is_invoice=${cls.is_invoice}, confidence=${cls.confidence})`,
                undefined, msgId);
              if (cls.is_invoice) {
                usableDoc = linked;
              } else {
                linkFailures.push({ url: linked.filename, reason: `classified as ${cls.document_type}, not an invoice` });
                await log("info", `link image rejected by classifier: ${cls.document_type}`,
                  { filename: linked.filename }, msgId);
              }
            } else {
              usableDoc = linked; // PDFs from links accepted without classification
            }
            if (usableDoc) {
              usableDocs = [usableDoc];
              await log("info", "invoice document obtained from a body link", undefined, msgId);
            }
          }
        }
      }

      if (!usableDoc) {
        // Stage 4: choose the most specific alert type
        const hadFiltered    = rawAtt.length > 0 && hKept.length === 0;
        const hadClassedOut  = hKept.length > 0; // survived heuristic but none is_invoice
        const noValidAtt     = hadFiltered || hadClassedOut;
        const alertType      = noValidAtt    ? "invoice_no_valid_attachment"
                             : attemptedLinks ? "invoice_link_failed"
                             :                  "invoice_no_attachment";
        const alertTitle     = noValidAtt    ? "מייל ללא קובץ חשבונית מזוהה"
                             : attemptedLinks ? "הורדת חשבונית מקישור נכשלה"
                             :                  "מייל ללא קובץ מצורף";
        const alertMessage   = hadFiltered
          ? `במייל "${subject}" נמצאו ${rawAtt.length} קבצים אך אף אחד לא זוהה כחשבונית`
          : hadClassedOut
          ? `במייל "${subject}" נמצאו ${hKept.length} קבצים לאחר סינון אך אף אחד לא סווג כחשבונית`
          : attemptedLinks
          ? `לא ניתן היה להוריד חשבונית מהקישורים במייל "${subject}". יש לבדוק ידנית.`
          : `במייל "${subject}" לא נמצא קובץ PDF/תמונה או קישור להורדה. יש לבדוק ידנית.`;

        await log("warn", `no usable document — ${alertType}`,
          { rawAtt: rawAtt.length, hKept: hKept.length, linkFailures }, msgId);
        await supabase.from("alerts").insert({
          type:    alertType,
          title:   alertTitle,
          message: alertMessage,
          payload: {
            gmailMessageId:      msgId,
            subject,
            from,
            messageLink,
            linkFailures,
            rejectedAttachments: hRejected,
          },
          status: "unread",
        });
        await gmailModifyLabels(token, msgId, [destNeedsReview, destProcessed], [sourceLabelId, "UNREAD"]);
        result.alerts++;
        continue;
      }

      // 3. Branch by docType — for non-invoice types process EACH doc as a separate record
      if (docType !== "invoice") {
        for (const doc of usableDocs) {
          await handleNonInvoice(supabase, log, msgId, suppliers, {
            docType,
            subject,
            from,
            emailTs,
            messageLink,
            doc,
          });
        }
        await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
        result.processed++;
        continue;
      }

      // 4. Invoice flow
      // a. Supplier-default category hint (best effort — vendor not known until extraction)
      //    We pass null upfront; after extraction we can refine, but the AI gets categories list.
      const extracted = await extractInvoice(
        usableDoc,
        categoryNames,
        null,
      );
      await log("info", "extracted", { extracted }, msgId);

      // not_invoice escape hatch — the extractor identified the document as an
      // order, receipt or other non-invoice and refused to fabricate fields.
      // Skip the insert entirely so the invoices table stays clean, alert the
      // manager, and mark the email processed so it doesn't get retried.
      if (extracted.missing_fields?.includes("not_invoice")) {
        await log("info", "extractor flagged as not_invoice, skipping ingest",
          { vendor: extracted.vendor_name, missing_fields: extracted.missing_fields }, msgId);
        await supabase.from("alerts").insert({
          type:    "document_misclassified",
          title:   "מסמך לא-חשבונית הגיע לתיבת החשבוניות",
          message: `המסמך מ-${extracted.vendor_name || "ספק לא ידוע"} זוהה כלא-חשבונית (כנראה הזמנה או קבלה). נא לבדוק במייל המקורי.`,
          payload: { gmailMessageId: msgId, subject, from, messageLink, extracted },
          status:  "unread",
        });
        await gmailModifyLabels(token, msgId, [destNeedsReview, destProcessed], [sourceLabelId, "UNREAD"]);
        result.alerts++;
        continue;
      }

      // Low confidence → needs_review path
      if (extracted.confidence === "low") {
        await log("warn", "low confidence extraction — flagging for manual review", { extracted }, msgId);
        if (managerEmail) {
          await gmailSendAlertEmail(token, managerEmail,
            "חשבונית — נדרשת בדיקה ידנית",
            `נושא: ${subject}\nספק (מזוהה): ${extracted.vendor_name}\nשדות חסרים: ${extracted.missing_fields.join(", ")}\nקישור למייל: ${messageLink}`);
        }
        await supabase.from("alerts").insert({
          type: "invoice_low_confidence",
          title: "חשבונית בוודאות נמוכה",
          message: `החשבונית מ-${extracted.vendor_name || "ספק לא ידוע"} נשמרה בסטטוס 'נדרש בירור' — נא לבדוק.`,
          payload: { gmailMessageId: msgId, subject, from, messageLink, extracted },
          status: "unread",
        });
      }

      // e. Find or flag supplier
      const matched = findBestSupplier(extracted.vendor_name, suppliers);

      let supplierId:        string | null = matched?.id ?? null;
      let supplierDefaultCat: string | null = (matched?.category ?? "").trim() || null;
      let isNewSupplier = false;
      if (!supplierId && extracted.vendor_name) {
        // New supplier — seed its category with what the AI just extracted so
        // future invoices from this vendor skip AI category classification.
        const seedCategory = (extracted.category ?? "").trim() || null;
        const { data: created, error: supErr } = await supabase
          .from("suppliers")
          .insert({ name: extracted.vendor_name, category: seedCategory })
          .select("id, category")
          .single();
        if (supErr) {
          await log("error", `supplier insert failed: ${supErr.message}`, undefined, msgId);
        } else {
          supplierId    = created!.id as string;
          isNewSupplier = true;
          suppliers.push({ id: supplierId, name: extracted.vendor_name, category: created!.category ?? null });
          await log("info", `created new supplier ${supplierId} (category: ${seedCategory ?? "(none)"})`,
            { name: extracted.vendor_name }, msgId);
        }
      }

      // Choose the invoice category by precedence: supplier default → AI.
      // New suppliers don't have a "previous" default; we use the AI category
      // (which was also saved as their default above).
      let finalCategory = extracted.category;
      if (supplierDefaultCat) {
        finalCategory = supplierDefaultCat;
        await log("info", `category from supplier default: ${finalCategory}`, undefined, msgId);
      } else if (isNewSupplier) {
        await log("info", `category from AI (new supplier, seeded as default): ${finalCategory}`, undefined, msgId);
      } else {
        await log("info", `category from AI (no supplier default): ${finalCategory}`, undefined, msgId);
      }

      // d. Duplicate check (supplier_id + invoice_number)
      let isDuplicate = false;
      if (supplierId && extracted.invoice_number) {
        const { data: dupInv } = await supabase
          .from("invoices")
          .select("id")
          .eq("supplier_id", supplierId)
          .eq("invoice_number", extracted.invoice_number)
          .maybeSingle();
        if (dupInv) {
          isDuplicate = true;
          await log("warn", "duplicate invoice number for supplier", { existingId: dupInv.id }, msgId);
          await supabase.from("alerts").insert({
            type: "invoice_duplicate",
            title: "חשבונית כפולה",
            message: `קיימת כבר חשבונית עם מספר ${extracted.invoice_number} לספק זה.`,
            payload: { gmailMessageId: msgId, subject, messageLink, supplierId, invoiceNumber: extracted.invoice_number, existingInvoiceId: dupInv.id },
            status: "unread",
          });
        }
      }

      // f. Partial return flag — set by Gmail label, not subject text
      const partialReturn = partialRefundLabelId !== null &&
        (message.labelIds ?? []).includes(partialRefundLabelId);

      // g+h. Upload to Drive (primary backup) AND Supabase Storage (in-app preview).
      const supplierDisplayName = matched?.name ?? extracted.vendor_name;
      const invoiceFilename = buildInvoiceFilename(
        supplierDisplayName,
        extracted.invoice_number,
        extracted.invoice_date,
        usableDoc.filename,
        usableDoc.mimeType,
      );
      const invoiceDateObj = new Date(extracted.invoice_date || new Date().toISOString().slice(0, 10));

      let driveFileLink   = "";
      let monthFolderLink = "";
      try {
        const target = await resolveInvoiceFolder(token, extracted.invoice_date || new Date().toISOString().slice(0, 10), partialReturn);
        const uploaded = await driveUploadFile(
          token,
          target.fileFolderId,
          invoiceFilename,
          usableDoc.mimeType,
          usableDoc.bytes,
        );
        driveFileLink   = uploaded.webViewLink;
        monthFolderLink = await driveGetFolderLink(token, target.monthFolderId);
        await log("info", "uploaded to Drive", { fileId: uploaded.id }, msgId);
      } catch (e) {
        await log("error", `Drive upload failed: ${e instanceof Error ? e.message : e}`, undefined, msgId);
        result.errors.push(`Drive upload failed for ${msgId}`);
      }

      let storagePath = "";
      try {
        // Drive gets the Hebrew display name (invoiceFilename); Storage gets an
        // ASCII key built from IDs so Supabase Storage's ASCII-only key rule is
        // never violated.
        const storageKey = buildStorageKey(
          "invoice",
          supplierId,
          extracted.invoice_number,
          msgId,
          pickExtension(usableDoc.filename, usableDoc.mimeType),
        );
        storagePath = await uploadToStorage(
          supabase, "invoices", invoiceDateObj,
          storageKey, usableDoc.mimeType, usableDoc.bytes,
        );
        await log("info", "uploaded to Storage", { storagePath }, msgId);
      } catch (e) {
        await log("error", `Storage upload failed: ${e instanceof Error ? e.message : e}`, undefined, msgId);
        result.errors.push(`Storage upload failed for ${msgId}`);
      }

      // i. Old-date warning (still save normally)
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      if (extracted.invoice_date && new Date(extracted.invoice_date) < startOfMonth) {
        await log("warn", "invoice older than current month", { invoiceDate: extracted.invoice_date }, msgId);
        await supabase.from("alerts").insert({
          type: "invoice_old_date",
          title: "חשבונית מחודש קודם",
          message: `החשבונית מ-${extracted.vendor_name} מתאריך ${extracted.invoice_date} — בדקי האם להעביר לרו"ח.`,
          payload: { gmailMessageId: msgId, subject, invoiceDate: extracted.invoice_date, vendor: extracted.vendor_name, messageLink },
          status: "unread",
        });
      }

      // j. Dedup guard then insert
      // Primary: gmail_message_id + invoice_number + supplier_id
      // Fallback (no invoice_number): gmail_message_id alone (1 invoice per email)
      let existingInv: { id: string } | null = null;
      if (supplierId && extracted.invoice_number) {
        const { data } = await supabase.from("invoices").select("id")
          .eq("gmail_message_id", msgId)
          .eq("invoice_number", extracted.invoice_number)
          .eq("supplier_id", supplierId)
          .limit(1);
        existingInv = data?.[0] ?? null;
      } else {
        const { data } = await supabase.from("invoices").select("id")
          .eq("gmail_message_id", msgId)
          .limit(1);
        existingInv = data?.[0] ?? null;
      }
      if (existingInv) {
        await log("info",
          `skipped duplicate invoice: ${extracted.invoice_number || "(no number)"} for message ${msgId}`,
          { existingId: existingInv.id }, msgId);
        await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
        result.skipped++;
        continue;
      }

      const insertRow: Record<string, unknown> = {
        supplier_id:        supplierId,
        supplier_name:      extracted.vendor_name,
        invoice_number:     extracted.invoice_number,
        invoice_date:       extracted.invoice_date || null,
        total_amount:       extracted.total_amount,
        amount_before_vat:  extracted.amount_before_vat,
        vat_amount:         extracted.vat_amount,
        category:           finalCategory,
        line_items:         extracted.line_items.join("\n"),
        ai_confidence:      extracted.confidence,
        status:             extracted.confidence === "low" ? "needs_review" : "ממתין",
        is_duplicate:       isDuplicate,
        has_error:          false,
        partial_return:     partialReturn,
        drive_file_link:    driveFileLink,
        storage_url:        storagePath || null,
        month_folder_link:  monthFolderLink,
        drive_folder_link:  monthFolderLink,
        message_link:       messageLink,
        gmail_message_id:   msgId,
        email_subject:      subject,
        gmail_label_source: SOURCE_LABEL_NAME,
        received_at:        emailTs,
        sender_name:        from,
        email_sender:       from,
      };

      const { error: insErr } = await supabase.from("invoices").insert(insertRow);
      if (insErr) {
        if (insErr.code === "23505") {
          await log("info", "concurrent insert race — skipping", { code: insErr.code }, msgId);
          result.skipped++;
        } else {
          await log("error", `invoice insert failed: ${insErr.message}`, { code: insErr.code }, msgId);
          result.errors.push(`Invoice insert failed for ${msgId}: ${insErr.message}`);
        }
        continue;
      }

      // k. Update supplier_categories + categories usage (tracks the FINAL category,
      // whether it came from the supplier default or AI).
      if (supplierId && finalCategory) {
        // Upsert supplier_categories
        const { data: existingSc } = await supabase
          .from("supplier_categories")
          .select("id, usage_count")
          .eq("supplier_id", supplierId)
          .eq("category", finalCategory)
          .maybeSingle();
        if (existingSc) {
          await supabase
            .from("supplier_categories")
            .update({ usage_count: (existingSc.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
            .eq("id", existingSc.id);
        } else {
          await supabase
            .from("supplier_categories")
            .insert({ supplier_id: supplierId, category: finalCategory, usage_count: 1 });
        }

        // Bump category usage_count (creating row if new)
        if (!categoryNames.includes(finalCategory)) {
          await supabase.from("categories").insert({ name: finalCategory, usage_count: 1 });
          categoryNames.push(finalCategory);
        } else {
          const { data: cat } = await supabase
            .from("categories")
            .select("usage_count")
            .eq("name", finalCategory)
            .single();
          if (cat) {
            await supabase
              .from("categories")
              .update({ usage_count: (cat.usage_count ?? 0) + 1 })
              .eq("name", finalCategory);
          }
        }
      }

      // 5. Apply processed label, remove source
      await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);

      await log("info", "invoice ingested", { supplierId, isNewSupplier, isDuplicate, category: finalCategory }, msgId);
      result.processed++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log("error", `unhandled exception: ${msg}`, undefined, msgId);
      result.errors.push(`Error processing ${msgId}: ${msg}`);
    }
  }

  return result;
}

// ─── Non-invoice extractors ────────────────────────────────────────────────

interface ExtractedDeliveryNote {
  vendor_name:       string;
  note_number:       string;
  date:              string; // YYYY-MM-DD
  amount:            number;
  amount_before_vat: number;
  vat_amount:        number;
  line_items:        string[];
}

async function extractDeliveryNote(
  doc: { mimeType: string; bytes: Uint8Array },
): Promise<ExtractedDeliveryNote> {
  const prompt =
    "אתה מנתח תעודות משלוח. חלץ את הפרטים מהמסמך וחזור ב-JSON בלבד, ללא הסברים.\n" +
    '{"vendor_name":"","note_number":"","date":"","amount":0,"amount_before_vat":0,"vat_amount":0,"line_items":[]}\n' +
    "כללים: תאריך YYYY-MM-DD, סכומים ללא סימני מטבע.";
  const raw = await anthropicMessage(
    ANTHROPIC_MODEL_EXTRACTOR,
    [{ role: "user", content: [buildDocumentBlock(doc.mimeType, doc.bytes), { type: "text", text: prompt }] }],
    1024,
  );
  let parsed = parseJsonRobust(raw);
  if (parsed === null) {
    const retryRaw = await anthropicMessage(
      ANTHROPIC_MODEL_EXTRACTOR,
      [{ role: "user", content: [
        buildDocumentBlock(doc.mimeType, doc.bytes),
        { type: "text", text: "ענה ב-JSON בלבד ללא markdown וללא הסבר:\n" +
          '{"vendor_name":"","note_number":"","date":"","amount":0,"amount_before_vat":0,"vat_amount":0,"line_items":[]}' },
      ] }],
      1024,
    );
    parsed = parseJsonRobust(retryRaw);
    if (parsed === null) {
      throw new Error(`extractDeliveryNote failed after retry. Raw: ${raw.slice(0, 500)}`);
    }
  }
  const p = parsed as Record<string, unknown>;
  return {
    vendor_name:       String(p.vendor_name ?? ""),
    note_number:       String(p.note_number ?? ""),
    date:              String(p.date ?? ""),
    amount:            Number(p.amount ?? 0),
    amount_before_vat: Number(p.amount_before_vat ?? 0),
    vat_amount:        Number(p.vat_amount ?? 0),
    line_items:        Array.isArray(p.line_items) ? p.line_items.map(String) : [],
  };
}

interface ExtractedReturn {
  vendor_name:        string;
  credit_note_number: string;
  date:               string; // YYYY-MM-DD
  amount:             number;
  reason:             string;
  detail:             string;
}

async function extractReturn(
  doc: { mimeType: string; bytes: Uint8Array },
): Promise<ExtractedReturn> {
  const prompt =
    "אתה מנתח תעודות זיכוי וחזרות. חלץ את הפרטים מהמסמך וחזור ב-JSON בלבד.\n" +
    '{"vendor_name":"","credit_note_number":"","date":"","amount":0,"reason":"","detail":""}\n' +
    "כללים: תאריך YYYY-MM-DD, amount = סכום מוחזר (מספר חיובי), credit_note_number = מספר תעודת הזיכוי שהונפק על ידי הספק.";
  const raw = await anthropicMessage(
    ANTHROPIC_MODEL_EXTRACTOR,
    [{ role: "user", content: [buildDocumentBlock(doc.mimeType, doc.bytes), { type: "text", text: prompt }] }],
    512,
  );
  let parsed = parseJsonRobust(raw);
  if (parsed === null) {
    const retryRaw = await anthropicMessage(
      ANTHROPIC_MODEL_EXTRACTOR,
      [{ role: "user", content: [
        buildDocumentBlock(doc.mimeType, doc.bytes),
        { type: "text", text: "ענה ב-JSON בלבד ללא markdown וללא הסבר:\n" +
          '{"vendor_name":"","credit_note_number":"","date":"","amount":0,"reason":"","detail":""}' },
      ] }],
      512,
    );
    parsed = parseJsonRobust(retryRaw);
    if (parsed === null) {
      throw new Error(`extractReturn failed after retry. Raw: ${raw.slice(0, 500)}`);
    }
  }
  const p = parsed as Record<string, unknown>;
  return {
    vendor_name:        String(p.vendor_name ?? ""),
    credit_note_number: String(p.credit_note_number ?? ""),
    date:               String(p.date ?? ""),
    amount:             Number(p.amount ?? 0),
    reason:             String(p.reason ?? ""),
    detail:             String(p.detail ?? ""),
  };
}

// ─── Non-invoice doc handlers ──────────────────────────────────────────────

async function handleNonInvoice(
  supabase:  SupabaseClient,
  log:       Logger,
  msgId:     string,
  suppliers: SupplierRow[],
  ctx: {
    docType:     Exclude<DocType, "invoice" | "skip" | "unknown">;
    subject:     string;
    from:        string;
    emailTs:     string;
    messageLink: string;
    doc:         { mimeType: string; filename: string; bytes: Uint8Array };
  },
): Promise<void> {
  // Non-invoice docs are NOT uploaded to Drive — they are viewable via the
  // Gmail message link stored on the row.

  const resolveSupplier = async (vendorName: string): Promise<string | null> => {
    if (!vendorName) return null;
    const matched = findBestSupplier(vendorName, suppliers);
    if (matched) return matched.id;
    const { data: created, error: supErr } = await supabase
      .from("suppliers").insert({ name: vendorName }).select("id").single();
    if (supErr) {
      await log("error", `supplier insert failed: ${supErr.message}`, undefined, msgId);
      return null;
    }
    const id = created!.id as string;
    suppliers.push({ id, name: vendorName, category: null });
    await log("info", `created new supplier ${id}`, { name: vendorName }, msgId);
    return id;
  };

  if (ctx.docType === "delivery_note") {
    let extracted: ExtractedDeliveryNote;
    try {
      extracted = await extractDeliveryNote(ctx.doc);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await log("error", `extractDeliveryNote failed: ${errMsg}`,
        { filename: ctx.doc.filename }, msgId);
      await supabase.from("alerts").insert({
        type:    "extraction_failed",
        title:   "פענוח מסמך נכשל",
        message: `לא ניתן היה לפענח תעודת משלוח "${ctx.doc.filename}" (מייל: ${msgId})`,
        payload: { gmailMessageId: msgId, subject: ctx.subject, filename: ctx.doc.filename, error: errMsg },
        status:  "unread",
      });
      return;
    }
    const supplierId = await resolveSupplier(extracted.vendor_name);

    // Dedup: primary = gmail_message_id + note_number + supplier_id
    //        fallback = gmail_message_id + supplier_id (no note_number)
    let existingDN: { id: string } | null = null;
    if (supplierId && extracted.note_number) {
      const { data } = await supabase.from("delivery_notes").select("id")
        .eq("gmail_message_id", msgId).eq("note_number", extracted.note_number)
        .eq("supplier_id", supplierId).limit(1);
      existingDN = data?.[0] ?? null;
    } else if (supplierId) {
      const { data } = await supabase.from("delivery_notes").select("id")
        .eq("gmail_message_id", msgId).eq("supplier_id", supplierId).limit(1);
      existingDN = data?.[0] ?? null;
    }
    if (existingDN) {
      await log("info",
        `skipped duplicate delivery_note: ${extracted.note_number || "(no number)"} for message ${msgId}`,
        { existingId: existingDN.id, filename: ctx.doc.filename }, msgId);
      return;
    }

    const dateForPath = new Date(extracted.date || ctx.emailTs);

    let storagePath = "";
    try {
      const storageKey = buildStorageKey(
        "delivery-note",
        supplierId,
        extracted.note_number,
        msgId,
        pickExtension(ctx.doc.filename, ctx.doc.mimeType),
      );
      storagePath = await uploadToStorage(
        supabase, "delivery-notes", dateForPath,
        storageKey, ctx.doc.mimeType, ctx.doc.bytes,
      );
      await log("info", "delivery_note uploaded to Storage", { storagePath }, msgId);
    } catch (e) {
      await log("error", `Storage upload failed: ${e instanceof Error ? e.message : e}`,
        { filename: ctx.doc.filename }, msgId);
    }

    const { error } = await supabase.from("delivery_notes").insert({
      supplier_id:       supplierId,
      supplier_name:     extracted.vendor_name,
      note_number:       extracted.note_number,
      date:              extracted.date || null,
      amount:            extracted.amount,
      amount_before_vat: extracted.amount_before_vat,
      vat_amount:        extracted.vat_amount,
      line_items:        extracted.line_items.join("\n"),
      status:            "pending_match",
      invoice_id:        null,
      source_email:      ctx.from,
      received_at:       ctx.emailTs,
      drive_file_link:   null,
      storage_url:       storagePath || null,
      gmail_message_id:  msgId,
      email_subject:     ctx.subject,
      message_link:      ctx.messageLink,
    });
    if (error) {
      await log("error", `delivery_note insert failed: ${error.message}`,
        { code: error.code, filename: ctx.doc.filename }, msgId);
    } else {
      await log("info", "delivery_note ingested",
        { supplierId, noteNumber: extracted.note_number, filename: ctx.doc.filename }, msgId);
    }

  } else if (ctx.docType === "return_doc") {
    // Credit notes from a supplier are a RESPONSE to a return the store already
    // issued — match them against an open return and close it, don't insert new.
    let extracted: ExtractedReturn;
    try {
      extracted = await extractReturn(ctx.doc);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await log("error", `extractReturn failed: ${errMsg}`,
        { filename: ctx.doc.filename }, msgId);
      await supabase.from("alerts").insert({
        type:    "extraction_failed",
        title:   "פענוח מסמך נכשל",
        message: `לא ניתן היה לפענח חזרה/זיכוי "${ctx.doc.filename}" (מייל: ${msgId})`,
        payload: { gmailMessageId: msgId, subject: ctx.subject, filename: ctx.doc.filename, error: errMsg },
        status:  "unread",
      });
      return;
    }
    const supplierId = await resolveSupplier(extracted.vendor_name);

    // Upload the credit-note file to Storage up front so it's available whether
    // we match a return (storage_url goes on the row) or alert (goes in payload).
    const dateForPath = new Date(extracted.date || ctx.emailTs);

    let storagePath = "";
    try {
      const storageKey = buildStorageKey(
        "credit-note",
        supplierId,
        extracted.credit_note_number,
        msgId,
        pickExtension(ctx.doc.filename, ctx.doc.mimeType),
      );
      storagePath = await uploadToStorage(
        supabase, "returns", dateForPath,
        storageKey, ctx.doc.mimeType, ctx.doc.bytes,
      );
      await log("info", "credit_note uploaded to Storage", { storagePath }, msgId);
    } catch (e) {
      await log("error", `Storage upload failed: ${e instanceof Error ? e.message : e}`,
        { filename: ctx.doc.filename }, msgId);
    }

    const createUnmatchedAlert = async (reason: string) => {
      await supabase.from("alerts").insert({
        type:    "unmatched_credit_note",
        title:   "תעודת זיכוי ללא חזרה תואמת",
        message: `תעודת זיכוי מ-${extracted.vendor_name || "ספק לא ידוע"} בסך ${extracted.amount} - אין חזרה תואמת במערכת. יש לבדוק.`,
        payload: {
          gmailMessageId:   msgId,
          supplierName:     extracted.vendor_name,
          amount:           extracted.amount,
          creditNoteNumber: extracted.credit_note_number,
          storagePath:       storagePath || null,
        },
        status: "unread",
      });
      await log("info", `unmatched credit note - alert created (${reason})`,
        { supplierId, vendor: extracted.vendor_name, amount: extracted.amount }, msgId);
    };

    if (!supplierId) {
      await createUnmatchedAlert("supplier not found");
      return;
    }

    const { data: openReturns, error: searchErr } = await supabase
      .from("returns")
      .select("id, amount, date, status")
      .eq("supplier_id", supplierId)
      .neq("status", "הסתיים")
      .order("date", { ascending: false })
      .limit(1);
    if (searchErr) {
      await log("error", `returns search failed: ${searchErr.message}`,
        { code: searchErr.code, supplierId }, msgId);
      return;
    }

    const existing = openReturns?.[0] ?? null;
    if (!existing) {
      // OUTCOME C — no open return for this supplier
      await createUnmatchedAlert("no open return for supplier");
      return;
    }

    const expectedAmount = Number(existing.amount ?? 0);
    const actualAmount   = extracted.amount;
    const diff           = Math.abs(actualAmount - expectedAmount);
    // Treat a missing/zero existing amount as a full mismatch so we still raise
    // the alert rather than silently dividing by zero.
    const pct            = expectedAmount > 0 ? diff / expectedAmount : 1;

    const { error: updErr } = await supabase
      .from("returns")
      .update({
        supplier_credit_note_number: extracted.credit_note_number,
        supplier_credit_note_date:   extracted.date || null,
        supplier_credit_note_amount: actualAmount,
        gmail_message_id:            msgId,
        storage_url:                 storagePath || null,
        status:                      "הסתיים",
      })
      .eq("id", existing.id);
    if (updErr) {
      await log("error", `return update failed: ${updErr.message}`,
        { existingId: existing.id, code: updErr.code }, msgId);
      return;
    }

    if (pct > 0.10) {
      // OUTCOME B — closed, but flag the mismatch for review
      await supabase.from("alerts").insert({
        type:    "return_amount_mismatch",
        title:   "פער בהחזר - יש לבדוק מול הספק",
        message: `תעודת זיכוי מהספק ${extracted.vendor_name} בסך ${actualAmount} לא תואמת לחזרה שהונפקה בסך ${expectedAmount}. פער: ${diff.toFixed(2)}`,
        payload: { returnId: existing.id, expectedAmount, actualAmount, supplierId },
        status:  "unread",
      });
      await log("warn",
        `return closed with mismatch: ${existing.id} (expected ${expectedAmount}, got ${actualAmount}, diff ${diff.toFixed(2)})`,
        { returnId: existing.id }, msgId);
    } else {
      // OUTCOME A — clean match
      await log("info",
        `return matched and closed: ${existing.id} with credit note ${extracted.credit_note_number || "(no number)"}`,
        { returnId: existing.id, amount: actualAmount }, msgId);
    }

  } else {
    // statement — uploaded to Storage only; no Drive upload.
    let storagePath = "";
    try {
      const storageKey = buildStorageKey(
        "statement", null, null, msgId,
        pickExtension(ctx.doc.filename, ctx.doc.mimeType),
      );
      storagePath = await uploadToStorage(
        supabase, "statements", new Date(ctx.emailTs),
        storageKey, ctx.doc.mimeType, ctx.doc.bytes,
      );
      await log("info", "statement uploaded to Storage", { storagePath }, msgId);
    } catch (e) {
      await log("error", `Storage upload failed: ${e instanceof Error ? e.message : e}`,
        { filename: ctx.doc.filename }, msgId);
    }

    const { error } = await supabase.from("vendor_statements").insert({
      drive_file_link:  null,
      storage_url:      storagePath || null,
      message_link:     ctx.messageLink,
      gmail_message_id: msgId,
      email_subject:    ctx.subject,
      received_at:      ctx.emailTs,
      status:           "needs_review",
    });
    if (error) {
      await log("warn", `vendor_statements insert failed: ${error.message}`, undefined, msgId);
    }
    await log("info", "statement recorded", { storagePath }, msgId);
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (!isAuthorized(req)) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HADAS_SERVICE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const result = await ingestInvoices(supabase);
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Record top-level failures in system_logs too — the per-message catch only
    // covers errors inside the loop, not setup failures (Gmail token, etc.).
    try {
      await makeLogger(supabase)("error", `ingest run aborted: ${msg}`);
    } catch { /* logger self-guards; nothing more we can do */ }
    return json({ error: msg }, 500);
  }
});
