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
const CAPTURE_LABEL_SOURCE      = "צילום ידני";       // stamped on rows captured via the in-app camera (not Gmail)
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
const MAX_REDIRECTS         = 5;     // match N8N's maxRedirects:5 — fail fast on tracker loops
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

const EXT_PDF_RE   = /\.pdf$/i;
const EXT_IMAGE_RE = /\.(jpe?g|png)$/i;

function findAttachments(message: GmailMessage): CandidateAttachment[] {
  const flat = flattenParts(message.payload as GmailPart);
  const out: CandidateAttachment[] = [];
  for (const p of flat) {
    if (!p.body?.attachmentId || !p.filename) continue;
    const mt   = (p.mimeType || "").toLowerCase();
    const name = p.filename;
    // Detect type by MIME first, then fall back to the filename EXTENSION (N8N's
    // approach). Many senders attach PDFs as application/octet-stream,
    // application/x-pdf or binary/octet-stream — the old MIME-only check dropped
    // those silently (the "אס ג'י ברטים" credit note hit this). PDF takes
    // precedence; we normalize mimeType so Stage 1 routes it correctly.
    const isPdf   = mt === "application/pdf" || EXT_PDF_RE.test(name);
    const isImage = mt.startsWith("image/")  || EXT_IMAGE_RE.test(name);
    if (isPdf || isImage) {
      const disp     = p.headers?.find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
      const isInline = disp.toLowerCase().startsWith("inline");
      let mimeType: string;
      if (isPdf) {
        mimeType = "application/pdf";
      } else if (mt.startsWith("image/")) {
        mimeType = p.mimeType;                                  // already a real image/* MIME
      } else {
        const ext = name.match(EXT_IMAGE_RE)?.[1].toLowerCase(); // image by extension on a generic MIME
        mimeType  = ext === "png" ? "image/png" : "image/jpeg";
      }
      out.push({
        attachmentId: p.body.attachmentId,
        filename:     name,
        mimeType,
        size:         p.body.size ?? 0,
        isInline,
      });
    }
  }
  return out;
}

// ─── Stage 1 — sort by FILE FORMAT (ports the N8N file-sort node) ───────────

const LOGO_FILENAME_RE    = /logo|signature|image00[1-9]|banner|footer|header/i;
const LOGO_SIZE_THRESHOLD = 50_000; // bytes — logo gate (matches the N8N flow); also the link-path image floor

// A document the pipeline will actually process. `attachmentId` is the stable
// Gmail id (null for link-derived docs) — used as the per-file dedup discriminator
// so multiple numberless invoices in one email never collide.
interface UsableFile {
  attachmentId: string | null;
  filename:     string;
  mimeType:     string;
  bytes:        Uint8Array;
  format:       "pdf" | "image";
  size:         number;
}
interface DroppedFile { filename: string; mimeType: string; size: number; reason: string }

// Stage 1: PDFs pass unconditionally (a PDF ad is filtered later by the
// invoice-path quickInvoiceCheck). Images pass only when they're NOT a
// logo/signature by FILENAME and are larger than the 50KB size floor — this is
// the logo gate, by name+size, replacing the old AI content classifier. Bytes
// are downloaded only for files that survive the gate. Runs per-file, so the
// multi-file rule (drop logos/ads, keep real docs) falls out naturally.
async function sortAttachmentsByFormat(
  token:       string,
  msgId:       string,
  attachments: CandidateAttachment[],
): Promise<{ files: UsableFile[]; dropped: DroppedFile[] }> {
  const files:   UsableFile[]  = [];
  const dropped: DroppedFile[] = [];
  for (const a of attachments) {
    const mt = a.mimeType.toLowerCase();
    if (mt === "application/pdf") {
      const bytes = await gmailGetAttachment(token, msgId, a.attachmentId);
      files.push({ attachmentId: a.attachmentId, filename: a.filename, mimeType: a.mimeType, bytes, format: "pdf", size: a.size });
      continue;
    }
    // image/*
    if (LOGO_FILENAME_RE.test(a.filename)) {
      dropped.push({ filename: a.filename, mimeType: a.mimeType, size: a.size, reason: "filename matches logo/signature pattern" });
    } else if (mt === "image/gif" || /\.gif$/i.test(a.filename)) {
      dropped.push({ filename: a.filename, mimeType: a.mimeType, size: a.size, reason: ".gif is not a document format" });
    } else if (a.size < LOGO_SIZE_THRESHOLD) {
      dropped.push({ filename: a.filename, mimeType: a.mimeType, size: a.size, reason: `image too small (${a.size} B < ${LOGO_SIZE_THRESHOLD} B) — likely a logo` });
    } else {
      const bytes = await gmailGetAttachment(token, msgId, a.attachmentId);
      files.push({ attachmentId: a.attachmentId, filename: a.filename, mimeType: a.mimeType, bytes, format: "image", size: a.size });
    }
  }
  return { files, dropped };
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

// Full N8N keyword set (superset of N8N's list) so portal-style "view/download"
// links are caught — e.g. כובעי זיוה's "להורדת המסמך" ("הורד" already matches it).
const DOWNLOAD_WORDS = [
  "לצפייה", "צפייה", "לחץ כאן", "הורד", "להורדה", "להורדת",
  "view", "download", "invoice", "חשבונית", "מסמך",
];

// True for URLs that point directly at a PDF file.
const isPdfUrl = (url: string): boolean => /\.pdf(?:[?#]|$)/i.test(url);

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

// Collects candidate invoice-file URLs from the body, mirroring the N8N
// "Extract – Link from HTML" node EXACTLY:
//   1. decode tracking URLs on every anchor href FIRST (icount wraps the real
//      link in track.icount.co.il/CL0/<encoded>);
//   2. keep a link ONLY if its anchor text OR decoded URL contains a keyword;
//   3. prefer .pdf links (pdfLinks[0]), then the remaining keyword links;
//   4. if no keyword link at all, fall back to scanning the body for any .pdf.
// This is the fix for icount emails: the old approach enqueued EVERY tracking
// link (logo/header/social) in document order and the real download link got
// evicted past the candidate cap. Keyword-filtering the set first makes the real
// link win regardless of how many decorative tracking links precede it.
function extractInvoiceLinks(plainText: string, html: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (raw: string) => {
    if (!/^https?:\/\//i.test(raw) || seen.has(raw)) return;
    seen.add(raw);
    ordered.push(raw);
  };
  const hasKeyword = (s: string) => {
    const low = s.toLowerCase();
    return DOWNLOAD_WORDS.some((w) => low.includes(w.toLowerCase()));
  };

  // 1. Decode tracking on every anchor href up front.
  const links = extractAnchors(html).map((a) => ({
    url:  decodeHtmlEntities(unwrapTrackingUrl(a.href)),
    text: a.text,
  }));

  // 2. Keep only links whose anchor text OR decoded URL contains a keyword.
  const keywordLinks = links.filter((l) => hasKeyword(l.text) || hasKeyword(l.url));

  // 3. Prefer .pdf among the keyword links, then the remaining keyword links.
  for (const l of keywordLinks) if (isPdfUrl(l.url)) push(l.url);
  for (const l of keywordLinks) push(l.url);

  // 4. No keyword link → scan the whole body (anchors + raw URLs) for any .pdf.
  if (ordered.length === 0) {
    const all = [
      ...links.map((l) => l.url),
      ...rawUrls(html).map((u) => unwrapTrackingUrl(u)),
      ...rawUrls(plainText).map((u) => unwrapTrackingUrl(u)),
    ];
    for (const u of all) if (isPdfUrl(u)) push(u);
  }

  return ordered;
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
    // Follow redirects manually with a hard cap of MAX_REDIRECTS (mirrors N8N's
    // maxRedirects:5). Deno's default "follow" allows ~20, so a tracker redirect
    // loop wastes the whole per-link timeout before failing; capping at 5 fails
    // fast so the next candidate is tried promptly.
    let current = url;
    for (let hop = 0; ; hop++) {
      const resp = await fetch(current, {
        method:   "GET",
        headers:  LINK_FETCH_HEADERS,
        redirect: "manual",
        signal:   ctrl.signal,
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        await resp.body?.cancel();           // release the connection
        if (!loc) return resp;               // 3xx without Location — let caller treat as non-OK
        if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
        current = new URL(loc, current).toString(); // resolve relative redirects
        continue;
      }
      return resp;
    }
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

// "skip" was retired with the old subject+text classifier (classifyWithAI). Stage 2
// always resolves to a concrete type (subject → classifyDocTypeByContent, which
// defaults to "invoice"), so "unknown" is only ever transient before that step.
type DocType = "invoice" | "delivery_note" | "statement" | "return_doc" | "unknown";

function classifyBySubject(subject: string): DocType {
  const s = (subject ?? "").trim();
  if (s.includes("כרטסת"))                                         return "statement";
  // זיכוי/חזרה/החזר checked before invoice so "חשבונית זיכוי" routes to return.
  if (s.includes("זיכוי") || s.includes("חזרה") || s.includes("החזר")) return "return_doc";
  // הזמנה (order) is routed as a delivery note in this system, per N8N convention.
  if (s.includes("משלוח") || s.includes("הזמנה"))                   return "delivery_note";
  if (s.includes("חשבונית"))                                       return "invoice";
  // The customer self-sends hand-received documents titled generically "מסמך"
  // (and can't reliably label them). With no specific keyword above, force
  // content-based detection rather than guessing. Specific keywords win first,
  // so "מסמך חשבונית" still routes by "חשבונית".
  if (s.includes("מסמך"))                                          return "unknown";
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

// ─── Stage 2 — document-type routing (subject first, AI content as fallback) ─

// Stage-2 fallback router — used ONLY when classifyBySubject is inconclusive.
// Looks at the document content and returns a TYPE for routing. It NEVER drops a
// document: an unrecognized/empty answer (or an API error) defaults to "invoice",
// the fully-handled path whose extractor has its own not_invoice safety net.
async function classifyDocTypeByContent(
  doc: { mimeType: string; bytes: Uint8Array },
): Promise<Exclude<DocType, "unknown">> {
  let raw = "";
  try {
    raw = (await anthropicMessage(
      ANTHROPIC_MODEL_CLASSIFIER,
      [{
        role: "user",
        content: [
          buildDocumentBlock(doc.mimeType, doc.bytes),
          { type: "text", text:
`סווג את סוג המסמך לפי תוכנו בלבד. ענה במילה אחת בלבד מתוך: חשבונית / כרטסת / משלוח / זיכוי

- כרטסת: דוח מצטבר עם ריבוי תנועות/שורות (תאריך, חובה, זכות), יתרת פתיחה ויתרת סגירה, או הכותרות "כרטסת", "ריכוז תנועות", "דוח יתרות", "הנהלת חשבונות". זהו ריכוז של כמה עסקאות לאורך תקופה — לא חשבונית בודדת, גם אם מופיעים בו סכומים רבים. אם יש יותר מעסקה אחת ויתרה מצטברת → כרטסת (ולא חשבונית).
- חשבונית: מסמך של עסקה בודדת עם "חשבונית מס" / "חשבונית מקור" / קבלה ומספר חשבונית יחיד.
- משלוח: תעודת משלוח / הזמנה.
- זיכוי: תעודת זיכוי / חשבונית זיכוי / החזר.` },
        ],
      }],
      16,
    )).trim();
  } catch {
    return "invoice";
  }
  if (raw.includes("כרטסת"))                       return "statement";
  if (raw.includes("זיכוי") || raw.includes("החזר")) return "return_doc";
  if (raw.includes("משלוח") || raw.includes("הזמנה")) return "delivery_note";
  return "invoice"; // default safe path
}

// Invoice-path ONLY: separates a real invoice/receipt from an ad/flyer/newsletter/
// catalog (N8N's "Analyze document2" yes/no). Lenient by construction — only an
// explicit "לא" (ad/marketing) drops the file; empty/ambiguous/error → keep, so a
// legitimate invoice is never discarded here (the extractor's not_invoice hatch is
// the final net). NEVER applied to statements/delivery-notes/returns.
async function quickInvoiceCheck(doc: { mimeType: string; bytes: Uint8Array }): Promise<boolean> {
  let raw = "";
  try {
    raw = (await anthropicMessage(
      ANTHROPIC_MODEL_CLASSIFIER,
      [{
        role: "user",
        content: [
          buildDocumentBlock(doc.mimeType, doc.bytes),
          { type: "text", text:
`האם זהו מסמך עסקי (חשבונית / קבלה / תעודה), או חומר פרסומי (פרסומת / דף שיווקי / ניוזלטר / קטלוג)?
ענה במילה אחת בלבד: "כן" אם מסמך עסקי, "לא" אם חומר פרסומי. אם אינך בטוח — ענה "כן".` },
        ],
      }],
      16,
    )).trim();
  } catch {
    return true; // never drop on error
  }
  // Only an explicit negative drops the file.
  if (raw.startsWith("לא") || raw.toLowerCase().startsWith("no")) return false;
  return true;
}

// ─── Invoice extractor (Sonnet) ────────────────────────────────────────────

interface ExtractedInvoice {
  vendor_name:        string;
  hp:                 string;   // supplier tax id (ח.פ / ע.מ), digits only, "" if absent
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
{"vendor_name":"","hp":"","invoice_number":"","invoice_date":"","total_amount":0,"amount_before_vat":0,"vat_amount":0,"currency":"ILS","category":"","line_items":[],"confidence":"high","missing_fields":[]}

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
- hp: מספר העוסק המנפיק את החשבונית — ח.פ / ע.מ / עוסק מורשה (בדרך כלל 9 ספרות). החזר ספרות בלבד, ללא מקפים או רווחים. אם אינו מופיע במסמך — השאר "".
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
            '{"vendor_name":"","hp":"","invoice_number":"","invoice_date":"","total_amount":0,"amount_before_vat":0,"vat_amount":0,"currency":"ILS","category":"","line_items":[],"confidence":"high","missing_fields":[]}' },
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
    hp:                String(p.hp ?? ""),
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

// NOTE: the old AI content classifier (classifyAttachmentDoc / selectBestAttachment /
// dominantDocType) was removed. It gated documents by is_invoice and dropped
// anything it didn't recognize — which discarded statements ("other") and link
// images. Routing now uses Stage 1 (format/logo gate) + Stage 2 (subject →
// classifyDocTypeByContent), and the invoice path filters ads per-file via
// quickInvoiceCheck. See sortAttachmentsByFormat and the main ingest loop.

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

interface SupplierRow { id: string; name: string; category: string | null; hp: string | null }

function findBestSupplier(typed: string, suppliers: SupplierRow[], threshold = 0.85): SupplierRow | null {
  let best: { row: SupplierRow; score: number } | null = null;
  for (const s of suppliers) {
    const score = similarityScore(typed, s.name);
    if (!best || score > best.score) best = { row: s, score };
  }
  return best && best.score >= threshold ? best.row : null;
}

// Tax-id normalizer — digits only, so "51-423-789 / 0" and "514237890" compare equal.
function normalizeHp(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

// Best-effort: append a newly-seen vendor spelling to a supplier's alt_names so
// future invoices match by name too. NEVER throws — a missing column or any DB
// error is logged and swallowed so invoice ingest is never interrupted.
async function appendAltName(
  supabase: SupabaseClient, supplierId: string, newName: string, log: Logger, msgId: string,
): Promise<void> {
  const name = (newName ?? "").trim();
  if (!name) return;
  try {
    const { data, error } = await supabase
      .from("suppliers").select("alt_names").eq("id", supplierId).maybeSingle();
    if (error) {
      await log("warn", `alt_names read skipped: ${error.message}`, { supplierId }, msgId);
      return;
    }
    const existing: string[] = Array.isArray(data?.alt_names) ? data!.alt_names : [];
    if (existing.includes(name)) return;
    const { error: upErr } = await supabase
      .from("suppliers").update({ alt_names: [...existing, name] }).eq("id", supplierId);
    if (upErr) {
      await log("warn", `alt_names update skipped: ${upErr.message}`, { supplierId }, msgId);
    } else {
      await log("info", `alt_names: recorded "${name}" on supplier ${supplierId}`, undefined, msgId);
    }
  } catch (e) {
    await log("warn", `alt_names append threw: ${e instanceof Error ? e.message : e}`, { supplierId }, msgId);
  }
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

// ─── Alert idempotency (A4) ──────────────────────────────────────────────────

// A concurrent manual run + cron tick both reach an alert insert before either
// applies the processed label, producing two alerts for one email. Insert only
// when no same-type alert already exists for this Gmail message. Returns true if
// a NEW alert row was written (callers gate counters / manager emails on that).
// `status:"unread"` is always set here so call sites don't repeat it.
async function insertAlertOnce(
  supabase: SupabaseClient,
  log:      Logger,
  msgId:    string,
  alert:    { type: string; title: string; message: string; payload: Record<string, unknown> },
  // Extra payload keys that further narrow the "already exists" check. Default
  // dedup is (type, gmailMessageId) = one alert of a type per email; pass e.g.
  // ["supplierId"] so multiple invoices in ONE email each get their own alert.
  dedupKeys: string[] = [],
): Promise<boolean> {
  let query = supabase
    .from("alerts")
    .select("id")
    .eq("type", alert.type)
    .filter("payload->>gmailMessageId", "eq", msgId);
  for (const key of dedupKeys) {
    query = query.filter(`payload->>${key}`, "eq", String(alert.payload[key] ?? ""));
  }
  const { data: existing } = await query.limit(1);
  if (existing && existing.length > 0) {
    await log("info", `alert suppressed (already exists): ${alert.type}`, { existingId: existing[0].id }, msgId);
    return false;
  }
  const { error } = await supabase.from("alerts").insert({ ...alert, status: "unread" });
  if (error) {
    await log("error", `alert insert failed (${alert.type}): ${error.message}`, { code: error.code }, msgId);
    return false;
  }
  return true;
}

// ─── Main ingest ───────────────────────────────────────────────────────────

interface IngestResult {
  processed:  number;
  alerts:     number;
  skipped:    number;
  errors:     string[];
  ts:         string;
}

// Context shared by every invoice file in one email (the email-level facts plus
// the loaded suppliers/categories the helper mutates in place).
interface InvoiceFileCtx {
  token:                string;
  msgId:                string;
  subject:              string;
  from:                 string;
  emailTs:              string;
  messageLink:          string;
  labelIds:             string[];
  partialRefundLabelId: string | null;
  managerEmail:         string;
  suppliers:            SupplierRow[];
  categoryNames:        string[];
  // Stamped into invoices.gmail_label_source so a row's origin is visible in the
  // DB/UI. Defaults to the Gmail source label; the camera-capture path overrides
  // it with CAPTURE_LABEL_SOURCE. Optional so the email call site stays unchanged.
  labelSource?:         string;
}

type InvoiceFileOutcome = "created" | "skipped" | "alerted" | "error";

// Runs the full invoice pipeline for ONE file: extract → supplier → category →
// Drive + Storage upload → dedup → insert → category usage. Returns the outcome;
// the caller owns the Gmail label transition (applied once per email) and tallies.
// Multiple files from one email each call this independently, producing one
// invoice record per real invoice.
async function handleInvoiceFile(
  supabase: SupabaseClient,
  log:      Logger,
  file:     UsableFile,
  ctx:      InvoiceFileCtx,
  result:   IngestResult,
): Promise<InvoiceFileOutcome> {
  const { token, msgId, subject, from, emailTs, messageLink, managerEmail, suppliers, categoryNames } = ctx;

  const extracted = await extractInvoice(file, categoryNames, null);
  await log("info", "extracted", { extracted, filename: file.filename }, msgId);

  // not_invoice escape hatch — the extractor refused to fabricate fields for a
  // non-invoice (order/receipt). Alert, skip the insert. (Belt-and-suspenders
  // alongside quickInvoiceCheck, which already drops obvious ads upstream.)
  if (extracted.missing_fields?.includes("not_invoice")) {
    await log("info", "extractor flagged as not_invoice, skipping ingest",
      { vendor: extracted.vendor_name, filename: file.filename }, msgId);
    await insertAlertOnce(supabase, log, msgId, {
      type:    "document_misclassified",
      title:   "מסמך לא-חשבונית הגיע לתיבת החשבוניות",
      message: `המסמך מ-${extracted.vendor_name || "ספק לא ידוע"} זוהה כלא-חשבונית (כנראה הזמנה או קבלה). נא לבדוק במייל המקורי.`,
      payload: { gmailMessageId: msgId, subject, from, messageLink, extracted },
    });
    return "alerted";
  }

  if (extracted.confidence === "low") {
    await log("warn", "low confidence extraction — flagging for manual review", { extracted }, msgId);
    if (managerEmail) {
      await gmailSendAlertEmail(token, managerEmail,
        "חשבונית — נדרשת בדיקה ידנית",
        `נושא: ${subject}\nספק (מזוהה): ${extracted.vendor_name}\nשדות חסרים: ${extracted.missing_fields.join(", ")}\nקישור למייל: ${messageLink}`);
    }
    await insertAlertOnce(supabase, log, msgId, {
      type:    "invoice_low_confidence",
      title:   "חשבונית בוודאות נמוכה",
      message: `החשבונית מ-${extracted.vendor_name || "ספק לא ידוע"} נשמרה בסטטוס 'נדרש בירור' — נא לבדוק.`,
      payload: { gmailMessageId: msgId, subject, from, messageLink, extracted },
    });
  }

  // Find or create supplier — precedence: ח.פ (hp) exact match → name fuzzy → create new.
  const extractedHp = normalizeHp(extracted.hp);

  // 1. hp dedupe — a tax-id match is authoritative; never create a second supplier
  //    for a vendor we already know by ח.פ, even when the name is spelled differently
  //    (Hebrew vs English, punctuation). Name-only path can't catch those.
  let matched: SupplierRow | null = extractedHp
    ? (suppliers.find(s => normalizeHp(s.hp) === extractedHp) ?? null)
    : null;

  if (matched) {
    const nameAgrees = similarityScore(extracted.vendor_name, matched.name) >= 0.85;
    if (extracted.vendor_name && !nameAgrees) {
      // Same ח.פ, different name → record the new spelling (best-effort) and raise
      // a "check supplier data" alert. dedupKeys=["supplierId"] so two hp-mismatched
      // invoices in ONE email each get their own alert (not suppressed).
      await log("info", `hp dedupe: matched supplier ${matched.id} by ח.פ, name differs`,
        { extractedName: extracted.vendor_name, existingName: matched.name, hp: extractedHp }, msgId);
      await appendAltName(supabase, matched.id, extracted.vendor_name, log, msgId);
      await insertAlertOnce(supabase, log, msgId, {
        type:    "supplier_details_review",
        title:   "בדוק האם נתוני הספק תואמים",
        message: `חשבונית עם ח.פ ${extractedHp} שויכה לספק "${matched.name}", אך השם בחשבונית הוא "${extracted.vendor_name}". יש לוודא שמדובר באותו ספק.`,
        payload: { gmailMessageId: msgId, subject, messageLink, supplierId: matched.id, hp: extractedHp, existingName: matched.name, extractedName: extracted.vendor_name },
      }, ["supplierId"]);
    } else {
      await log("info", `hp dedupe: matched supplier ${matched.id} by ח.פ (name agrees)`, { hp: extractedHp }, msgId);
    }
  } else {
    // 2. Fall back to name-fuzzy match (unchanged behavior).
    matched = findBestSupplier(extracted.vendor_name, suppliers);
  }

  let supplierId: string | null = matched?.id ?? null;
  const supplierDefaultCat: string | null = (matched?.category ?? "").trim() || null;
  let isNewSupplier = false;
  if (!supplierId && extracted.vendor_name) {
    // 3. New supplier — store the extracted ח.פ (if any) so the NEXT invoice from
    //    this vendor dedupes by hp. Contact/phone still unknown → supplier_incomplete.
    const seedCategory = (extracted.category ?? "").trim() || null;
    const { data: created, error: supErr } = await supabase
      .from("suppliers")
      .insert({ name: extracted.vendor_name, category: seedCategory, hp: extractedHp || null })
      .select("id, category")
      .single();
    if (supErr) {
      await log("error", `supplier insert failed: ${supErr.message}`, undefined, msgId);
    } else {
      supplierId    = created!.id as string;
      isNewSupplier = true;
      suppliers.push({ id: supplierId, name: extracted.vendor_name, category: created!.category ?? null, hp: extractedHp || null });
      await log("info", `created new supplier ${supplierId} (category: ${seedCategory ?? "(none)"})`,
        { name: extracted.vendor_name, hp: extractedHp || null }, msgId);
      // New supplier created silently from the invoice — prompt the owner to fill
      // in ח.פ / contact details. Same type + payload shape as payments-ingest so
      // the frontend handles both identically.
      await insertAlertOnce(supabase, log, msgId, {
        type:    "supplier_incomplete",
        title:   "ספק חדש - השלימי פרטים",
        message: `נוצר ספק חדש '${extracted.vendor_name}' מתוך חשבונית. השלימי ח.פ ופרטי קשר.`,
        payload: { supplierId, typedSupplierName: extracted.vendor_name, gmailMessageId: msgId },
      });
    }
  }

  // Category precedence: supplier default → AI.
  let finalCategory = extracted.category;
  if (supplierDefaultCat) {
    finalCategory = supplierDefaultCat;
    await log("info", `category from supplier default: ${finalCategory}`, undefined, msgId);
  } else if (isNewSupplier) {
    await log("info", `category from AI (new supplier, seeded as default): ${finalCategory}`, undefined, msgId);
  } else {
    await log("info", `category from AI (no supplier default): ${finalCategory}`, undefined, msgId);
  }

  // Duplicate invoice-number alert (non-terminal — still insert with is_duplicate)
  let isDuplicate = false;
  if (supplierId && extracted.invoice_number) {
    const { data: dupInv } = await supabase
      .from("invoices").select("id")
      .eq("supplier_id", supplierId)
      .eq("invoice_number", extracted.invoice_number)
      .limit(1);
    if (dupInv && dupInv.length > 0) {
      isDuplicate = true;
      await log("warn", "duplicate invoice number for supplier", { existingId: dupInv[0].id }, msgId);
      await insertAlertOnce(supabase, log, msgId, {
        type:    "invoice_duplicate",
        title:   "חשבונית כפולה",
        message: `קיימת כבר חשבונית עם מספר ${extracted.invoice_number} לספק זה.`,
        payload: { gmailMessageId: msgId, subject, messageLink, supplierId, invoiceNumber: extracted.invoice_number, existingInvoiceId: dupInv[0].id },
      });
    }
  }

  const partialReturn = ctx.partialRefundLabelId !== null && ctx.labelIds.includes(ctx.partialRefundLabelId);

  // Per-file dedup discriminator: invoice_number when present, else the stable
  // Gmail attachmentId ("link" for link docs). Goes into the Storage key so two
  // numberless invoices in the same email produce two distinct storage paths.
  const fileTag = extracted.invoice_number || (file.attachmentId ?? "link");

  // Drive (primary backup) + Supabase Storage (in-app preview)
  const supplierDisplayName = matched?.name ?? extracted.vendor_name;
  const invoiceFilename = buildInvoiceFilename(
    supplierDisplayName, extracted.invoice_number, extracted.invoice_date, file.filename, file.mimeType,
  );
  const invoiceDateObj = new Date(extracted.invoice_date || new Date().toISOString().slice(0, 10));

  let driveFileLink = "", monthFolderLink = "";
  try {
    const target = await resolveInvoiceFolder(token, extracted.invoice_date || new Date().toISOString().slice(0, 10), partialReturn);
    const uploaded = await driveUploadFile(token, target.fileFolderId, invoiceFilename, file.mimeType, file.bytes);
    driveFileLink   = uploaded.webViewLink;
    monthFolderLink = await driveGetFolderLink(token, target.monthFolderId);
    await log("info", "uploaded to Drive", { fileId: uploaded.id }, msgId);
  } catch (e) {
    await log("error", `Drive upload failed: ${e instanceof Error ? e.message : e}`, undefined, msgId);
    result.errors.push(`Drive upload failed for ${msgId}`);
  }

  let storagePath = "";
  try {
    const storageKey = buildStorageKey(
      "invoice", supplierId, fileTag, msgId, pickExtension(file.filename, file.mimeType),
    );
    storagePath = await uploadToStorage(supabase, "invoices", invoiceDateObj, storageKey, file.mimeType, file.bytes);
    await log("info", "uploaded to Storage", { storagePath }, msgId);
  } catch (e) {
    await log("error", `Storage upload failed: ${e instanceof Error ? e.message : e}`, undefined, msgId);
    result.errors.push(`Storage upload failed for ${msgId}`);
  }

  // Old-date warning (non-terminal)
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (extracted.invoice_date && new Date(extracted.invoice_date) < startOfMonth) {
    await log("warn", "invoice older than current month", { invoiceDate: extracted.invoice_date }, msgId);
    await insertAlertOnce(supabase, log, msgId, {
      type:    "invoice_old_date",
      title:   "חשבונית מחודש קודם",
      message: `החשבונית מ-${extracted.vendor_name} מתאריך ${extracted.invoice_date} — בדקי האם להעביר לרו"ח.`,
      payload: { gmailMessageId: msgId, subject, invoiceDate: extracted.invoice_date, vendor: extracted.vendor_name, messageLink },
    });
  }

  // Dedup guard then insert.
  // Numbered:    gmail_message_id + invoice_number + supplier_id.
  // Numberless:  gmail_message_id + storage_url (unique per file via fileTag) —
  //              supports multiple numberless invoices from one email.
  let existingInv: { id: string } | null = null;
  if (supplierId && extracted.invoice_number) {
    const { data } = await supabase.from("invoices").select("id")
      .eq("gmail_message_id", msgId)
      .eq("invoice_number", extracted.invoice_number)
      .eq("supplier_id", supplierId)
      .limit(1);
    existingInv = data?.[0] ?? null;
  } else if (storagePath) {
    const { data } = await supabase.from("invoices").select("id")
      .eq("gmail_message_id", msgId)
      .eq("storage_url", storagePath)
      .limit(1);
    existingInv = data?.[0] ?? null;
  }
  if (existingInv) {
    await log("info",
      `skipped duplicate invoice: ${extracted.invoice_number || "(no number)"} for message ${msgId}`,
      { existingId: existingInv.id }, msgId);
    return "skipped";
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
    gmail_label_source: ctx.labelSource ?? SOURCE_LABEL_NAME,
    received_at:        emailTs,
    sender_name:        from,
    email_sender:       from,
  };

  const { error: insErr } = await supabase.from("invoices").insert(insertRow);
  if (insErr) {
    if (insErr.code === "23505") {
      await log("info", "concurrent insert race — skipping", { code: insErr.code }, msgId);
      return "skipped";
    }
    await log("error", `invoice insert failed: ${insErr.message}`, { code: insErr.code }, msgId);
    result.errors.push(`Invoice insert failed for ${msgId}: ${insErr.message}`);
    return "error";
  }

  // Update supplier_categories + categories usage (tracks the FINAL category)
  if (supplierId && finalCategory) {
    const { data: existingSc } = await supabase
      .from("supplier_categories")
      .select("id, usage_count")
      .eq("supplier_id", supplierId)
      .eq("category", finalCategory)
      .maybeSingle();
    if (existingSc) {
      await supabase.from("supplier_categories")
        .update({ usage_count: (existingSc.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("id", existingSc.id);
    } else {
      await supabase.from("supplier_categories")
        .insert({ supplier_id: supplierId, category: finalCategory, usage_count: 1 });
    }

    if (!categoryNames.includes(finalCategory)) {
      await supabase.from("categories").insert({ name: finalCategory, usage_count: 1 });
      categoryNames.push(finalCategory);
    } else {
      const { data: cat } = await supabase.from("categories").select("usage_count").eq("name", finalCategory).single();
      if (cat) {
        await supabase.from("categories").update({ usage_count: (cat.usage_count ?? 0) + 1 }).eq("name", finalCategory);
      }
    }
  }

  await log("info", "invoice ingested",
    { supplierId, isNewSupplier, isDuplicate, category: finalCategory, filename: file.filename }, msgId);
  return "created";
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
  const { data: supplierRows } = await supabase.from("suppliers").select("id, name, category, hp");
  const suppliers: SupplierRow[] = supplierRows ?? [];
  const { data: catRows } = await supabase.from("categories").select("name");
  const categoryNames: string[] = (catRows ?? []).map((r: { name: string }) => r.name);

  const managerEmail = Deno.env.get("GMAIL_USER_EMAIL") ?? "";

  for (const msgId of messageIds) {
    try {
      // Idempotency fast-path: if this email already produced any invoice row,
      // skip it. limit(1) (not maybeSingle) because one email can now legitimately
      // hold multiple invoice rows; the processed-label Gmail filter is the real
      // idempotency guard, this is just a cheap re-run short-circuit.
      const { data: dupRows } = await supabase
        .from("invoices")
        .select("id")
        .eq("gmail_message_id", msgId)
        .limit(1);
      const dup = dupRows?.[0] ?? null;
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

      // ── Stage 1: sort by FILE FORMAT (logo/size gate; PDFs unconditional) ──
      const rawAtt = findAttachments(message);
      const { files: attFiles, dropped } = await sortAttachmentsByFormat(token, msgId, rawAtt);
      for (const d of dropped) {
        await log("info", `attachment dropped (Stage 1): ${d.reason}`,
          { filename: d.filename, mimeType: d.mimeType, size: d.size }, msgId);
      }

      let usableFiles: UsableFile[] = attFiles;

      // Link path — only when no usable attachment survived Stage 1.
      let attemptedLinks = false;
      let linkFailures: Array<{ url: string; reason: string }> = [];
      if (usableFiles.length === 0) {
        const candidateLinks = extractInvoiceLinks(bodyText, rawHtml);
        if (candidateLinks.length > 0) {
          attemptedLinks = true;
          await log("info", `no usable attachment — scanning ${candidateLinks.length} body link(s)`,
            { candidateLinks }, msgId);
          const linkResult = await resolveDocFromLinks(candidateLinks, log, msgId);
          linkFailures = linkResult.failures;
          if (linkResult.doc) {
            const linked = linkResult.doc;
            usableFiles = [{
              attachmentId: null,
              filename:     linked.filename,
              mimeType:     linked.mimeType,
              bytes:        linked.bytes,
              format:       linked.mimeType === "application/pdf" ? "pdf" : "image",
              size:         linked.bytes.length,
            }];
            await log("info", "document obtained from a body link", { filename: linked.filename }, msgId);
          }
        }
      }

      // No document at all → alert + mark processed.
      if (usableFiles.length === 0) {
        const hadFiltered = rawAtt.length > 0; // had attachments, all dropped by Stage 1
        const alertType   = hadFiltered    ? "invoice_no_valid_attachment"
                          : attemptedLinks ? "invoice_link_failed"
                          :                  "invoice_no_attachment";
        const alertTitle  = hadFiltered    ? "מייל ללא קובץ חשבונית מזוהה"
                          : attemptedLinks ? "הורדת חשבונית מקישור נכשלה"
                          :                  "מייל ללא קובץ מצורף";
        const alertMessage = hadFiltered
          ? `במייל "${subject}" נמצאו ${rawAtt.length} קבצים אך כולם סוננו (לוגו/קובץ קטן מ-50KB)`
          : attemptedLinks
          ? `לא ניתן היה להוריד מסמך מהקישורים במייל "${subject}". יש לבדוק ידנית.`
          : `במייל "${subject}" לא נמצא קובץ PDF/תמונה או קישור להורדה. יש לבדוק ידנית.`;

        await log("warn", `no usable document — ${alertType}`,
          { rawAtt: rawAtt.length, dropped, linkFailures }, msgId);
        await insertAlertOnce(supabase, log, msgId, {
          type:    alertType,
          title:   alertTitle,
          message: alertMessage,
          payload: { gmailMessageId: msgId, subject, from, messageLink, linkFailures, droppedFiles: dropped },
        });
        await gmailModifyLabels(token, msgId, [destNeedsReview, destProcessed], [sourceLabelId, "UNREAD"]);
        result.alerts++;
        continue;
      }

      // ── Stage 2: document TYPE — subject first, AI content only if inconclusive ──
      let docType = classifyBySubject(subject);
      if (docType === "unknown") {
        docType = await classifyDocTypeByContent(usableFiles[0]);
        await log("info", `subject inconclusive — content router → ${docType}`, undefined, msgId);
      } else {
        await log("info", `docType from subject → ${docType}`, undefined, msgId);
      }

      // ── Routing by type ──
      // statement / delivery_note / return_doc: route by subject, each file its
      // own record. These are NEVER subjected to quickInvoiceCheck (that ad-gate
      // is invoice-only — it's what previously discarded statements).
      if (docType !== "invoice") {
        let allSaved = true;
        for (const f of usableFiles) {
          const ok = await handleNonInvoice(supabase, log, msgId, suppliers, {
            docType,
            subject,
            from,
            emailTs,
            messageLink,
            doc: { mimeType: f.mimeType, filename: f.filename, bytes: f.bytes },
          });
          if (!ok) allSaved = false;
        }
        // Only label after the DB write(s) succeeded. A failed write leaves the
        // email unlabeled so the next run retries (already-saved siblings are
        // dedup-guarded). Without this, a failed insert was silently lost.
        if (!allSaved) {
          await log("warn", "a document write failed — leaving email unlabeled for retry", { docType }, msgId);
          continue;
        }
        await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
        result.processed++;
        continue;
      }

      // Invoice path — per-file ad check; each YES becomes a SEPARATE invoice
      // record. Multi-invoice emails are fully supported; ads/flyers are dropped.
      const invoiceCtx: InvoiceFileCtx = {
        token, msgId, subject, from, emailTs, messageLink,
        labelIds: message.labelIds ?? [],
        partialRefundLabelId,
        managerEmail,
        suppliers,
        categoryNames,
      };
      let created = 0, alerted = 0, skipped = 0, ads = 0, errored = 0;
      for (const f of usableFiles) {
        if (!(await quickInvoiceCheck(f))) {
          ads++;
          await log("info", "file dropped — quickInvoiceCheck says ad/marketing", { filename: f.filename }, msgId);
          continue;
        }
        const outcome = await handleInvoiceFile(supabase, log, f, invoiceCtx, result);
        if      (outcome === "created") created++;
        else if (outcome === "alerted") alerted++;
        else if (outcome === "skipped") skipped++;
        else                            errored++;
      }

      // Every file was an ad → surface it so the email isn't lost silently.
      if (created === 0 && alerted === 0 && skipped === 0 && errored === 0 && ads > 0) {
        await insertAlertOnce(supabase, log, msgId, {
          type:    "invoice_no_valid_attachment",
          title:   "מייל ללא קובץ חשבונית מזוהה",
          message: `כל ${ads} הקבצים במייל "${subject}" זוהו כפרסומת/חומר שיווקי ולא כחשבונית.`,
          payload: { gmailMessageId: msgId, subject, from, messageLink, ads },
        });
        alerted++;
      }

      result.processed += created;
      result.alerts    += alerted;
      if (created === 0 && alerted === 0 && skipped > 0) result.skipped++;

      // ANY failed DB write → do NOT label; leave the email for the next run to
      // retry. Already-created invoices are dedup-guarded (gmail_message_id +
      // invoice_number/storage_url), so the retry only re-attempts the failed
      // file(s). Without this, a partial failure silently lost the failed invoice.
      if (errored > 0) {
        await log("warn", `${errored} invoice file(s) errored — leaving email unlabeled for retry`,
          { created, alerted, skipped, ads, errored }, msgId);
        continue;
      }

      // Apply the email's label once: needs-review if anything was flagged.
      const addLabels = alerted > 0 ? [destNeedsReview, destProcessed] : [destProcessed];
      await gmailModifyLabels(token, msgId, addLabels, [sourceLabelId, "UNREAD"]);
      await log("info", "email invoice processing complete",
        { created, alerted, skipped, ads, errored }, msgId);

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
    docType:     Exclude<DocType, "invoice" | "unknown">;
    subject:     string;
    from:        string;
    emailTs:     string;
    messageLink: string;
    doc:         { mimeType: string; filename: string; bytes: Uint8Array };
  },
): Promise<boolean> {
  // Returns true when the document was fully handled (DB row written, or
  // deliberately escalated to the user via an alert) — the caller may then label
  // the email processed. Returns false ONLY when a DB write (insert/update/read)
  // errored, so the caller leaves the email unlabeled for the next run to retry.
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
    suppliers.push({ id, name: vendorName, category: null, hp: null });
    await log("info", `created new supplier ${id}`, { name: vendorName }, msgId);
    // New supplier created silently from the document — prompt the owner to fill
    // in ח.פ / contact details. Same type + payload shape as payments-ingest.
    await insertAlertOnce(supabase, log, msgId, {
      type:    "supplier_incomplete",
      title:   "ספק חדש - השלימי פרטים",
      message: `נוצר ספק חדש '${vendorName}' מתוך מסמך. השלימי ח.פ ופרטי קשר.`,
      payload: { supplierId: id, typedSupplierName: vendorName, gmailMessageId: msgId },
    });
    return id;
  };

  if (ctx.docType === "delivery_note") {
    // A thrown extraction error (transient API 429/500/timeout, or a parse
    // failure after retry) propagates to the caller's per-message handler, which
    // leaves the email UNLABELED so the next cron run retries — instead of
    // alerting + labeling and losing the document. (No clean "not a delivery
    // note" verdict exists here; the doc was already routed by subject/content.)
    const extracted = await extractDeliveryNote(ctx.doc);
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
      return true; // already saved
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
      return false; // DB write failed — leave email for retry
    }
    await log("info", "delivery_note ingested",
      { supplierId, noteNumber: extracted.note_number, filename: ctx.doc.filename }, msgId);
    return true;

  } else if (ctx.docType === "return_doc") {
    // Credit notes from a supplier are a RESPONSE to a return the store already
    // issued — match them against an open return and close it, don't insert new.
    // As with delivery notes — a thrown extraction error propagates so the email
    // stays unlabeled and the next run retries, rather than escalating + labeling.
    const extracted = await extractReturn(ctx.doc);
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
      await insertAlertOnce(supabase, log, msgId, {
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
      });
      await log("info", `unmatched credit note - alert created (${reason})`,
        { supplierId, vendor: extracted.vendor_name, amount: extracted.amount }, msgId);
    };

    if (!supplierId) {
      await createUnmatchedAlert("supplier not found");
      return true; // escalated to the user — handled
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
      return false; // DB read failed — leave email for retry
    }

    const existing = openReturns?.[0] ?? null;
    if (!existing) {
      // OUTCOME C — no open return for this supplier
      await createUnmatchedAlert("no open return for supplier");
      return true; // escalated to the user — handled
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
      return false; // DB write failed — leave email for retry
    }

    if (pct > 0.10) {
      // OUTCOME B — closed, but flag the mismatch for review
      await insertAlertOnce(supabase, log, msgId, {
        type:    "return_amount_mismatch",
        title:   "פער בהחזר - יש לבדוק מול הספק",
        message: `תעודת זיכוי מהספק ${extracted.vendor_name} בסך ${actualAmount} לא תואמת לחזרה שהונפקה בסך ${expectedAmount}. פער: ${diff.toFixed(2)}`,
        payload: { gmailMessageId: msgId, returnId: existing.id, expectedAmount, actualAmount, supplierId },
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
    return true; // return row updated successfully

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

    // vendor_statements schema has no email_subject / message_link /
    // gmail_message_id / received_at columns — only status, storage_url,
    // drive_file_link, and a NOT-NULL `month` (+ supplier_id/balances filled in
    // later by the user). `month` is a text column rendered as-is in the UI; we
    // default it to the email-received month (YYYY-MM), which the user can correct.
    const statementMonth = ctx.emailTs.slice(0, 7); // "YYYY-MM" from the ISO emailTs
    const { error } = await supabase.from("vendor_statements").insert({
      status:          "needs_review",
      storage_url:     storagePath || null,
      drive_file_link: null,
      month:           statementMonth,
    });
    if (error) {
      // Only log/alert FAILURE on a real error — never log "recorded" for a row
      // that didn't persist.
      await log("error", `vendor_statements insert failed: ${error.message}`, { code: error.code }, msgId);
      await insertAlertOnce(supabase, log, msgId, {
        type:    "statement_save_failed",
        title:   "שמירת כרטסת נכשלה",
        message: `לא ניתן היה לשמור כרטסת מהמייל "${ctx.subject}". יש לבדוק ידנית.`,
        payload: { gmailMessageId: msgId, subject: ctx.subject, filename: ctx.doc.filename, error: error.message, storagePath: storagePath || null },
      });
      return false; // DB write failed — leave email for retry
    }
    await log("info", "statement recorded", { storagePath, month: statementMonth }, msgId);
    return true;
  }
}

// ─── Camera capture (shares the email IMAGE pipeline) ───────────────────────
//
// A document photographed in the app reaches the SAME per-document logic as an
// email image: handleInvoiceFile / handleNonInvoice. The only difference is the
// image arrives as base64 over HTTP instead of from Gmail, and the user picks the
// doc type explicitly — so we skip Gmail fetch, the Stage-1 logo/size gate, the
// Stage-2 type classifier, and the invoice-only ad gate (quickInvoiceCheck). The
// AI extraction, Drive upload, Storage upload, dedup, DB insert and alerts all run
// unchanged because they ARE the same functions.

type CaptureDocType = "invoice" | "delivery_note" | "return_doc";

interface CaptureRequest {
  source:      "camera";
  docType:     CaptureDocType;
  filename?:   string;
  mimeType?:   string;
  imageBase64: string;     // raw base64 or a full data: URL
  capturedBy?: string;     // employee/manager email, for audit + the `from` field
}

const MAX_CAPTURE_BYTES = 15 * 1024 * 1024; // 15MB guard — phone photos are ~1-5MB

// Standard (non-url-safe) base64 → bytes; tolerates a leading data: URL prefix.
function captureBase64ToBytes(b64: string): Uint8Array {
  const comma = b64.indexOf(",");
  const raw   = b64.startsWith("data:") && comma !== -1 ? b64.slice(comma + 1) : b64;
  const bin   = atob(raw.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const CAPTURE_TYPE_LABEL: Record<CaptureDocType, string> = {
  invoice:       "חשבונית",
  delivery_note: "תעודת משלוח",
  return_doc:    "חזרה/זיכוי",
};

async function handleCapture(supabase: SupabaseClient, body: CaptureRequest): Promise<Response> {
  const log = makeLogger(supabase);

  // ── Validate ──
  const docType = body.docType;
  if (docType !== "invoice" && docType !== "delivery_note" && docType !== "return_doc") {
    return json({ error: `invalid docType: ${String(docType)}` }, 400);
  }
  if (!body.imageBase64 || typeof body.imageBase64 !== "string") {
    return json({ error: "imageBase64 is required" }, 400);
  }
  let bytes: Uint8Array;
  try {
    bytes = captureBase64ToBytes(body.imageBase64);
  } catch {
    return json({ error: "imageBase64 is not valid base64" }, 400);
  }
  if (bytes.length === 0)               return json({ error: "image is empty" }, 400);
  if (bytes.length > MAX_CAPTURE_BYTES) return json({ error: "image too large (max 15MB)" }, 400);

  // Authoritative MIME from the bytes' magic numbers (same rule the email path
  // uses) — a wrong declared type would 400 the Anthropic vision call.
  const mimeType = sniffImageMediaType(bytes)
    ?? (body.mimeType?.startsWith("image/") ? body.mimeType : "image/jpeg");
  if (!mimeType.startsWith("image/")) {
    return json({ error: "capture must be an image (jpeg/png)" }, 400);
  }
  const filename = body.filename || `capture.${mimeType === "image/png" ? "png" : "jpg"}`;

  // ── Synthesize the Gmail-shaped context the shared functions expect ──
  const captureId   = "capture-" + crypto.randomUUID(); // plays the role of msgId
  const nowIso      = new Date().toISOString();
  const from        = body.capturedBy || "צילום מהאפליקציה";
  const subject     = `צילום ידני — ${CAPTURE_TYPE_LABEL[docType]}`;
  const managerEmail = Deno.env.get("GMAIL_USER_EMAIL") ?? "";

  await log("info", "capture received", { docType, filename, bytes: bytes.length, from }, captureId);

  // Google token (for Drive — generic OAuth, not Gmail-specific) + reference data.
  const token = await getGoogleAccessToken();
  const { data: supplierRows } = await supabase.from("suppliers").select("id, name, category, hp");
  const suppliers: SupplierRow[] = supplierRows ?? [];
  const { data: catRows } = await supabase.from("categories").select("name");
  const categoryNames: string[] = (catRows ?? []).map((r: { name: string }) => r.name);

  const result: IngestResult = { processed: 0, alerts: 0, skipped: 0, errors: [], ts: nowIso };
  const doc = { mimeType, filename, bytes };

  try {
    if (docType === "invoice") {
      const file: UsableFile = {
        attachmentId: captureId, filename, mimeType, bytes, format: "image", size: bytes.length,
      };
      const ctx: InvoiceFileCtx = {
        token, msgId: captureId, subject, from, emailTs: nowIso,
        messageLink: "", labelIds: [], partialRefundLabelId: null,
        managerEmail, suppliers, categoryNames, labelSource: CAPTURE_LABEL_SOURCE,
      };
      const outcome = await handleInvoiceFile(supabase, log, file, ctx, result);
      await log("info", "capture invoice complete", { outcome }, captureId);
      return json({
        ok:       outcome !== "error",
        outcome,                       // created | alerted | skipped | error
        docType,
        captureId,
        errors:   result.errors,
      });
    }

    // delivery_note / return_doc — same handler the email path uses.
    const ok = await handleNonInvoice(supabase, log, captureId, suppliers, {
      docType, subject, from, emailTs: nowIso, messageLink: "", doc,
    });
    await log("info", "capture non-invoice complete", { docType, ok }, captureId);
    return json({ ok, outcome: ok ? "created" : "error", docType, captureId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("error", `capture failed: ${msg}`, { docType }, captureId);
    return json({ ok: false, outcome: "error", docType, captureId, error: msg }, 500);
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

  // Camera-capture path: a POST with { source: "camera", ... }. Anything else
  // (the cron tick / manual trigger) falls through to the Gmail pull below.
  if (req.method === "POST") {
    let body: unknown = null;
    try { body = await req.json(); } catch { body = null; }
    if (body && typeof body === "object" && (body as { source?: string }).source === "camera") {
      try {
        return await handleCapture(supabase, body as CaptureRequest);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try { await makeLogger(supabase)("error", `capture handler aborted: ${msg}`); } catch { /* self-guards */ }
        return json({ ok: false, error: msg }, 500);
      }
    }
  }

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
