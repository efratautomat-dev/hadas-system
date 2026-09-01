// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  invoices-ingest                                                         ║
// ║  Pulls unread invoice emails from Gmail, classifies them with Anthropic, ║
// ║  uploads the attachment to Drive, and writes a row into Postgres.        ║
// ║                                                                          ║
// ║  Production: listens on Gmail label "מסמכים מספקים", marks processed     ║
// ║  emails with "טופל_ממתין במערכת". 14-day rolling lookback window.        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveInvoiceFolder, driveGetFolderLink } from "../_shared/drive-filing.ts";
import { vatRateFor, completeAmounts, round2 } from "../_shared/vat.ts";
// The supplier ledger engine — byte-locked twin of src/lib/ledgerEngine.ts (see
// scripts/check-twins.mjs). Reconciling a statement on arrival MUST use the same
// engine the screen uses, or the server and the screen disagree — which is the
// exact failure spec/06-RULES.md §9 exists to prevent.
import { buildLedger, statementDiff, statementVerdict } from "../_shared/ledgerEngine.ts";

// ─── Config ────────────────────────────────────────────────────────────────

const SOURCE_LABEL_NAME         = "מסמכים מספקים";
const CAPTURE_LABEL_SOURCE      = "צילום ידני";       // stamped on rows captured via the in-app camera (not Gmail)
const PROCESSED_LABEL_NAME      = "טופל_ממתין במערכת";
const FAILED_LABEL_NAME         = "פענוח נכשל";        // parks emails that keep failing extraction
const MAX_INGEST_ATTEMPTS       = 2;                   // cap before we stop retrying & alert
// Recovery mode (POST {source:"requeue"}). The normal tick deliberately looks back
// only 14 days, so an email parked behind the FAILED label is unreachable forever
// once it ages out — removing the label by hand does nothing. These bound the
// deliberate catch-up sweep instead of widening the routine query.
const REQUEUE_LOOKBACK_DAYS     = 120;                 // owner's figure, not 365
const REQUEUE_MAX_MESSAGES      = 50;                  // one batch; call again for the next
// "דורש בדיקה ידנית" was removed 2026-08-19: ingest no longer labels the mailbox
// for review. An alert already carries the item, and a second queue in Gmail
// that nothing clears is worse than none. Existing labels stay in the mailbox
// and can be deleted by hand — nothing reads them.
const PARTIAL_REFUND_LABEL_NAME = "החזר חלקי";         // owner applies manually — never created by code

// Log category for the statement path. Tags every line the כרטסת flow writes —
// both as a `[…]` prefix on the message and as context.docType — so the owner can
// tell which ingest run a line belongs to on the לוגי מערכת screen.
const STATEMENT_LOG_TAG         = "כרטסת";

// Drive filing config (root id, subfolder names) + the folder-resolution rules
// now live in ../_shared/drive-filing.ts — the single source shared with hadas-api.

const ANTHROPIC_MODEL_CLASSIFIER = "claude-haiku-4-5-20251001";
const ANTHROPIC_MODEL_EXTRACTOR  = "claude-sonnet-4-6";
// Document extraction with many line_items (esp. Hebrew, which tokenizes
// heavily) can exceed a small cap and truncate mid-string → unparseable JSON.
// 8192 is well within claude-sonnet-4-6's 64K output ceiling and stays under the
// ~16K non-streaming limit (this fn uses plain fetch, not streaming). It's a
// ceiling, not a cost floor — normal docs stop far earlier, so typical spend is
// unchanged.
const EXTRACTION_MAX_TOKENS     = 8192;
const ANTHROPIC_API             = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION         = "2023-06-01";

// HEBREW_MONTHS moved to ../_shared/drive-filing.ts (used only by folder resolution).

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

function validateKey(key: string | null): boolean {
  const expected = Deno.env.get("HADAS_API_KEY");
  return !!expected && key === expected;
}

// Two valid auth paths (mirrors hadas-api):
//   1. x-hadas-key header           — cron / machine-to-machine calls
//   2. Authorization: Bearer <jwt>  — logged-in browser users in allowed_users
async function isAuthorized(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const hadasKey = req.headers.get("x-hadas-key");
  if (hadasKey) return validateKey(hadasKey);

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // Hard 5s cap on the auth round-trip so a stalled getUser can never hang the
    // request indefinitely — on timeout/error we fail closed (unauthorized).
    let timer: number | undefined;
    try {
      const { data: { user }, error } = await Promise.race([
        supabase.auth.getUser(token),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("getUser timeout")), 5000);
        }),
      ]);
      if (error || !user) return false;
      const { data } = await supabase
        .from("allowed_users")
        .select("email")
        .eq("email", user.email)
        .maybeSingle();
      return !!data;
    } catch {
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return false;
}

// ─── Logger (writes to system_logs + console) ──────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

// `docType` is an OPTIONAL category tag (e.g. STATEMENT_LOG_TAG). When present it
// lands in BOTH places the owner looks: prefixed onto the message (`[כרטסת] …`)
// and as `context.docType` in the jsonb column, which is filterable. Omitting it
// leaves every existing call site byte-for-byte unchanged.
function makeLogger(supabase: SupabaseClient, docType?: string) {
  return async function log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    messageId?: string,
  ) {
    const tagged  = docType ? `[${docType}] ${message}` : message;
    const ctx     = docType ? { ...(context ?? {}), docType } : context;
    const line = `[${level}] ${messageId ? `(${messageId}) ` : ""}${tagged}`;
    let contextStr: string;
    try { contextStr = ctx ? JSON.stringify(ctx) : ""; }
    catch { contextStr = "[unserializable context]"; }
    console.log(line, contextStr);
    try {
      // supabase-js v2 returns { data, error } — a DB error does NOT throw,
      // so the error must be inspected explicitly or the write fails silently.
      const { error } = await supabase.from("system_logs").insert({
        source:     "invoices-ingest",
        level,
        message:    tagged,
        context:    ctx ?? null,
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

/**
 * Which mailbox are we actually reading? Asked of Gmail with the same credentials
 * the ingest already authenticates with, so it cannot be wrong or forgotten.
 *
 * This used to come from GMAIL_USER_EMAIL alone. That is config someone has to set
 * correctly on every environment, and when it is unset the guard below silently
 * does nothing — which is precisely what happened in production: a statement the
 * owner scanned and mailed to herself matched HER OWN supplier card by sender
 * address, moving a balance that belongs to nobody. The account we are logged into
 * is a fact the API already knows; asking it removes the failure mode instead of
 * documenting it. GMAIL_USER_EMAIL stays as the fallback for a failed lookup.
 *
 * Cached per invocation — one call per ingest run, not per document.
 */
let cachedIngestMailbox: string | null | undefined;
async function getIngestMailbox(token: string, log: Logger, msgId: string): Promise<string | null> {
  if (cachedIngestMailbox !== undefined) return cachedIngestMailbox;
  try {
    const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      const data = await resp.json() as { emailAddress?: string };
      const addr = extractEmailAddress(data.emailAddress ?? "");
      if (addr) {
        cachedIngestMailbox = addr;
        return addr;
      }
    }
    await log("warn", `Gmail profile lookup did not return an address (${resp.status}) — falling back to GMAIL_USER_EMAIL`, undefined, msgId);
  } catch (e) {
    await log("warn", `Gmail profile lookup failed (${e instanceof Error ? e.message : e}) — falling back to GMAIL_USER_EMAIL`, undefined, msgId);
  }
  cachedIngestMailbox = extractEmailAddress(Deno.env.get("GMAIL_USER_EMAIL") ?? "") || null;
  return cachedIngestMailbox;
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
  labelIds: string[] = [],
  maxResults = 25,
): Promise<string[]> {
  // labelIds matches by ID (immune to label nesting / spaces / rename); q carries
  // only the exclusions + date window. Name-based `label:"…"` in q is unreliable
  // for nested labels — that's what made label:"החזר חלקי" return 0.
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  for (const id of labelIds) params.append("labelIds", id);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`;
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
  return (s ?? "").replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
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

// ── Drive filenames for the pipelines that do NOT file to Drive yet ─────────
// `driveUploadFile` has exactly ONE call site today — the invoice path. Delivery
// notes, returns and statements are stored and inserted, but never uploaded to
// Drive, so these three builders are staged and unreachable. They are kept
// deliberately: they encode the agreed naming ("<ספק> - תעודת משלוח <מס'>"), and
// deleting them would throw that away. Wire them up when those pipelines gain
// their Drive upload — until then the linter is told they are unused on purpose.
/* eslint-disable @typescript-eslint/no-unused-vars */
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
/* eslint-enable @typescript-eslint/no-unused-vars */

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
// driveFindFolder / driveCreateFolder / driveEnsureFolder moved to
// ../_shared/drive-filing.ts (used only by folder resolution, now shared).

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

// driveGetFolderLink moved to ../_shared/drive-filing.ts (imported at top).

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
  return (text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map((u) => u.replace(/[).,;]+$/, ""));
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
type DocType = "invoice" | "delivery_note" | "statement" | "return_doc" | "receipt" | "unknown";

function classifyBySubject(subject: string): DocType {
  const s = (subject ?? "").trim();
  if (s.includes("כרטסת"))                                         return "statement";
  // זיכוי/חזרה/החזר checked before invoice so "חשבונית זיכוי" routes to return.
  if (s.includes("זיכוי") || s.includes("חזרה") || s.includes("החזר")) return "return_doc";
  // הזמנה (order) is routed as a delivery note in this system, per N8N convention.
  if (s.includes("משלוח") || s.includes("הזמנה"))                   return "delivery_note";
  if (s.includes("חשבונית"))                                       return "invoice";
  // A RECEIPT is proof of payment, not a tax document — it must never become an
  // invoice row (owner's rule, 2026-08-05). Checked AFTER "חשבונית" on purpose:
  // "חשבונית מס קבלה" is a combined document and IS a valid tax invoice, so the
  // "חשבונית" branch above must claim it first. Only a bare קבלה lands here.
  if (s.includes("קבלה"))                                          return "receipt";
  // The customer self-sends hand-received documents titled generically "מסמך"
  // (and can't reliably label them). With no specific keyword above, force
  // content-based detection rather than guessing. Specific keywords win first,
  // so "מסמך חשבונית" still routes by "חשבונית".
  if (s.includes("מסמך"))                                          return "unknown";
  return "unknown";
}

// ── "the document type is known but the FILE isn't there" alerts ────────────
// ONE type per non-invoice document type — not one per (type × reason). The
// reason (filtered attachment / link failed / nothing attached) rides in the
// Hebrew message and in the payload's `reason` key, so the owner still sees WHY
// without the alert taxonomy exploding into nine near-identical entries.
//
// invoice / unknown are absent on purpose: they keep the three long-standing
// invoice_* types, which the frontend and existing rows already know.
const NO_FILE_ALERT: Partial<Record<DocType, { type: string; title: string; docLabel: string }>> = {
  statement:     { type: "statement_no_file",     title: "כרטסת ללא קובץ",         docLabel: "כרטסת" },
  delivery_note: { type: "delivery_note_no_file", title: "תעודת משלוח ללא קובץ",   docLabel: "תעודת משלוח" },
  return_doc:    { type: "return_no_file",        title: "זיכוי/חזרה ללא קובץ",     docLabel: "תעודת זיכוי/חזרה" },
};

// ── "we know what the document is, but extraction kept failing" ──────────────
// Same shape and the same reasoning as NO_FILE_ALERT above: one type per document
// type, the reason rides in the payload. This exists because the parked-failure
// alert used to be hard-coded to the INVOICE wording, so a תעודת משלוח that failed
// extraction was reported to the owner as a failed invoice — the same defect
// spec/09-IDEAS.md §10 records for כרטסת, where a statement whose file could not be
// fetched surfaced as a failed invoice and never reached vendor_statements.
//
// invoice / unknown are deliberately absent: they keep `invoice_ingest_failed`,
// which existing alert rows and the frontend already know.
const FAILED_ALERT: Partial<Record<DocType, { type: string; title: string }>> = {
  statement:     { type: "statement_ingest_failed",     title: "פענוח כרטסת נכשל — דורש טיפול ידני" },
  delivery_note: { type: "delivery_note_ingest_failed", title: "פענוח תעודת משלוח נכשל — דורש טיפול ידני" },
  return_doc:    { type: "return_ingest_failed",        title: "פענוח תעודת זיכוי/חזרה נכשל — דורש טיפול ידני" },
};

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

// Optional observability hook. `console.warn` alone is invisible to the owner —
// she reads `system_logs` (the לוגי מערכת screen), not the Deno function logs — so
// a caller that has a logger passes it here and a truncated response becomes a
// `warn` row she can actually see. Callers with no logger in scope omit it and
// keep today's console-only behaviour.
interface AnthropicCallOptions {
  log?:      Logger;
  msgId?:    string;
  /** Extra context merged into the truncation log row (e.g. { stage: "retry" }). */
  logContext?: Record<string, unknown>;
}

async function anthropicMessage(
  model: string,
  messages: AnthropicMessage[],
  maxTokens = EXTRACTION_MAX_TOKENS,
  opts: AnthropicCallOptions = {},
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
  const data = await resp.json() as {
    content?:     Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?:       { output_tokens?: number };
  };
  // Truncation guard: stop_reason "max_tokens" means the JSON was cut off
  // mid-string and every downstream JSON.parse fails. Surface it in the function
  // logs so it reads as truncation, not a generic parse error.
  if (data.stop_reason === "max_tokens") {
    const detail = `(model=${model}, output_tokens=${data.usage?.output_tokens ?? "?"})`;
    console.warn(`[anthropicMessage] response TRUNCATED at max_tokens=${maxTokens} ${detail}`);
    // Never let an observability write break an extraction that might still parse.
    if (opts.log) {
      try {
        await opts.log("warn",
          `תשובת ה-AI נקטעה — הגיעה לתקרת max_tokens=${maxTokens} ${detail}`,
          {
            ...(opts.logContext ?? {}),
            stopReason:   "max_tokens",
            maxTokens,
            model,
            outputTokens: data.usage?.output_tokens ?? null,
          },
          opts.msgId,
        );
      } catch { /* logging must never mask the API result */ }
    }
  }
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
  // 4. Repair: smart/curly quotes → straight, gershayim inside Hebrew runs,
  //    trailing commas before } or ]
  const repaired = slice
    .replace(/[“”„‟‘’ʼ]/g, '"')
    // A stray ASCII " flanked by Hebrew letters is a gershayim *inside a word*
    // (בס״ד, בע״מ, ש״ח) the model emitted as a plain quote — not a JSON string
    // delimiter. Convert to U+05F4 (״) so it stops terminating the string early.
    // A structural quote is never Hebrew-on-both-sides (always borders : , { } [ ]
    // or whitespace), so this can't corrupt valid JSON. The lookahead leaves the
    // right-hand letter free so runs of consecutive gershayim are all fixed.
    .replace(/([א-ת])"(?=[א-ת])/g, "$1״")
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
  let raw: string;
  try {
    raw = (await anthropicMessage(
      ANTHROPIC_MODEL_CLASSIFIER,
      [{
        role: "user",
        content: [
          buildDocumentBlock(doc.mimeType, doc.bytes),
          { type: "text", text:
`סווג את סוג המסמך לפי תוכנו בלבד. ענה במילה אחת בלבד מתוך: חשבונית / כרטסת / משלוח / זיכוי / קבלה

- כרטסת: דוח מצטבר עם ריבוי תנועות/שורות (תאריך, חובה, זכות), יתרת פתיחה ויתרת סגירה, או הכותרות "כרטסת", "ריכוז תנועות", "דוח יתרות", "הנהלת חשבונות". זהו ריכוז של כמה עסקאות לאורך תקופה — לא חשבונית בודדת, גם אם מופיעים בו סכומים רבים. אם יש יותר מעסקה אחת ויתרה מצטברת → כרטסת (ולא חשבונית).
- חשבונית: מסמך של עסקה בודדת עם הכותרת "חשבונית מס" או "חשבונית מקור" ומספר חשבונית יחיד.
- קבלה: אישור על תשלום שהתקבל בלבד — הכותרת "קבלה" ללא המילה "חשבונית", לרוב עם אסמכתא/מספר שיק/פרטי אמצעי תשלום ובלי פירוט פריטים שנמכרו. שים לב: מסמך שכותרתו "חשבונית מס קבלה" (או "חשבונית מס / קבלה") הוא חשבונית לכל דבר — ענה "חשבונית". רק מסמך שהוא קבלה בלבד → "קבלה".
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
  // Bare קבלה only — "חשבונית מס קבלה" contains "חשבונית" and was already caught
  // by the invoice default below via the model answering "חשבונית".
  if (raw.includes("קבלה") && !raw.includes("חשבונית")) return "receipt";
  return "invoice"; // default safe path
}

// Invoice-path ONLY: separates a real invoice/receipt from an ad/flyer/newsletter/
// catalog (N8N's "Analyze document2" yes/no). Lenient by construction — only an
// explicit "לא" (ad/marketing) drops the file; empty/ambiguous/error → keep, so a
// legitimate invoice is never discarded here (the extractor's not_invoice hatch is
// the final net). NEVER applied to statements/delivery-notes/returns.
async function quickInvoiceCheck(doc: { mimeType: string; bytes: Uint8Array }): Promise<boolean> {
  let raw: string;
  try {
    raw = (await anthropicMessage(
      ANTHROPIC_MODEL_CLASSIFIER,
      [{
        role: "user",
        content: [
          buildDocumentBlock(doc.mimeType, doc.bytes),
          { type: "text", text:
`האם זהו מסמך עסקי (חשבונית / תעודה), או חומר פרסומי (פרסומת / דף שיווקי / ניוזלטר / קטלוג)?
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
    EXTRACTION_MAX_TOKENS,
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
      EXTRACTION_MAX_TOKENS,
    );
    parsed = parseJsonRobust(retryRaw);
    if (parsed === null) {
      const looksTruncated = !retryRaw.trimEnd().endsWith("}");
      throw new Error(
        `extractInvoice failed after retry${looksTruncated ? " — response appears TRUNCATED (raise max_tokens)" : ""}. ` +
        `Raw: ${raw.slice(0, 500)}`);
    }
  }
  const p = parsed as Record<string, unknown>;
  const invoice_date = String(p.invoice_date ?? "");

  // The extractor returns 0 for any amount it could not read, and plenty of
  // supplier documents print only a total. Complete the three here so the row
  // reaches the database whole — holes only, never overwriting a figure that WAS
  // read off the document. The rate comes from the invoice's own date.
  // The sign is re-applied below: completion works on magnitudes, and a credit
  // note keeps its minus (the extractor is told to return negatives, and
  // handleInvoiceFile force-negates a known credit note anyway).
  const negative = Number(p.total_amount ?? 0) < 0
                || Number(p.amount_before_vat ?? 0) < 0
                || Number(p.vat_amount ?? 0) < 0;
  const s = negative ? -1 : 1;
  const filled = completeAmounts(
    { net: p.amount_before_vat, vat: p.vat_amount, gross: p.total_amount },
    vatRateFor(invoice_date),
  );

  return {
    vendor_name:       String(p.vendor_name ?? ""),
    hp:                String(p.hp ?? ""),
    invoice_number:    String(p.invoice_number ?? ""),
    invoice_date,
    total_amount:      s * filled.gross,
    amount_before_vat: s * filled.net,
    vat_amount:        s * filled.vat,
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

interface SupplierRow {
  id: string; name: string; category: string | null; hp: string | null;
  alt_names?: string[] | null;
  // Contact address on the supplier card. Statements frequently carry neither ח.פ
  // nor a usable company name, and then the SENDING address is the only signal we
  // have — see resolveStatementSupplier.
  email?: string | null;
}

// A `From` header is usually `Display Name <addr@host>`, sometimes a bare address.
// Returns the lower-cased address only, or "" when there isn't one.
function extractEmailAddress(from: string | null | undefined): string {
  const s = (from ?? "").trim();
  if (!s) return "";
  const angled = s.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : s).trim().replace(/^["']|["']$/g, "");
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : "";
}

// Escape the LIKE metacharacters so an address containing `_` (very common:
// `first_last@host`) is matched literally instead of as a single-char wildcard.
function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

function findBestSupplier(typed: string, suppliers: SupplierRow[], threshold = 0.85): SupplierRow | null {
  let best: { row: SupplierRow; score: number } | null = null;
  for (const s of suppliers) {
    // Score against the canonical name AND every recorded alt_names spelling — the
    // best of them wins. This is what lets a known variant (e.g. a car-rental vendor
    // with no ח.פ to anchor on) match an existing card instead of forking a new one;
    // without it alt_names is write-only dead data.
    const names = [s.name, ...(Array.isArray(s.alt_names) ? s.alt_names : [])];
    let score = 0;
    for (const n of names) {
      const sc = similarityScore(typed, n);
      if (sc > score) score = sc;
    }
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
// FolderTarget / OVERFLOW_SUBFOLDER / resolveInvoiceFolder (year / Hebrew month /
// 15th-of-month overflow rules) now live in ../_shared/drive-filing.ts — the
// single source of truth, shared with hadas-api's date-correction re-filing.
// resolveInvoiceFolder is imported at the top of this file.

// ─── Alert idempotency (A4) ──────────────────────────────────────────────────

// A concurrent manual run + cron tick both reach an alert insert before either
// applies the processed label, producing two alerts for one email. Insert only
// when no same-type alert already exists for this Gmail message. Returns true if
// a NEW alert row was written (callers gate counters / manager emails on that).
// `status:"unread"` is always set here so call sites don't repeat it.
// ─── A number that cannot be stored is not a price ──────────────────────────
//
// The amount columns are numeric(10,2) on production — up to 99,999,999.99. The
// largest delivery note this business has ever filed is ₪34,354, so a figure that
// does not fit was never a price: it is a barcode, an item code, an hp or a phone
// number the extractor picked off a table. Report-style PDFs are full of them.
//
// Postgres answers such an insert with 22003 and rejects the WHOLE row, and the
// caller then leaves the email unlabeled — so ONE bad cell kept an entire document
// out of the system. That is the wrong trade, and it is the same trade the ₪20K
// gate already refuses to make: file the document, mark what is wrong, never hide
// it (docs/04-BUSINESS-LOGIC.md, spec/06-RULES.md).
//
// The bound is the column's own limit, on purpose. No business threshold is
// invented here that nobody chose — cf. the approval gate, where an empty setting
// means OFF rather than a default figure.
const NUMERIC_10_2_MAX = 99_999_999.99;

function storableAmount(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.abs(v) > NUMERIC_10_2_MAX ? null : v;
}

/**
 * Replaces every unstorable figure with null and names the fields it dropped.
 * An empty `dropped` means the row is unchanged and nothing needs saying.
 */
function storableAmounts<K extends string>(
  fields: Record<K, unknown>,
): { values: Record<K, number | null>; dropped: K[] } {
  const values = {} as Record<K, number | null>;
  const dropped: K[] = [];
  for (const key of Object.keys(fields) as K[]) {
    const raw = fields[key];
    const safe = storableAmount(raw);
    values[key] = safe;
    if (safe === null && raw !== null && raw !== undefined) dropped.push(key);
  }
  return { values, dropped };
}

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

// Cost guard. Increments this email's failure counter. Below the cap it returns
// false → caller leaves the email unlabeled so the next tick retries (transient
// API/network errors recover on their own). At the cap it PARKS the email — adds
// the FAILED label (which the cron query excludes) + raises a visible alert — and
// returns true.
//
// Nothing is silently dropped, but removing the FAILED label by hand is NOT a full
// re-queue: this counter is never reset, so the email comes back at attempts=MAX and
// the next failure parks it again on the FIRST try. It also only works inside the
// routine 14-day window. The supported recovery is POST {source:"requeue"}, which
// clears the counter and sweeps REQUEUE_LOOKBACK_DAYS back.
async function recordFailureAndMaybePark(
  supabase: SupabaseClient,
  log:      Logger,
  token:    string,
  msgId:    string,
  failedLabelId: string,
  meta:     { subject: string; from: string; messageLink: string },
  errorMsg: string,
  // What the classifier decided this email was. It selects the alert the owner
  // sees: a delivery note that failed extraction must not be reported as a failed
  // invoice (see FAILED_ALERT). `unknown` keeps the invoice wording, which is the
  // honest default when nothing identified the document.
  docType:  DocType = "unknown",
): Promise<boolean> {
  const { data: row } = await supabase
    .from("ingest_failures")
    .select("attempts")
    .eq("gmail_message_id", msgId)
    .maybeSingle();
  const attempts = (row?.attempts ?? 0) + 1;
  await supabase.from("ingest_failures").upsert(
    {
      gmail_message_id: msgId,
      attempts,
      last_error:       errorMsg.slice(0, 500),
      last_attempt_at:  new Date().toISOString(),
    },
    { onConflict: "gmail_message_id" },
  );

  if (attempts < MAX_INGEST_ATTEMPTS) {
    await log("warn",
      `ingest failed (attempt ${attempts}/${MAX_INGEST_ATTEMPTS}) — leaving unlabeled for retry`,
      { error: errorMsg }, msgId);
    return false;
  }

  // Cap reached → park out of the query and surface it.
  await gmailModifyLabels(token, msgId, [failedLabelId], ["UNREAD"]);
  const failedAlert = FAILED_ALERT[docType] ??
    { type: "invoice_ingest_failed", title: "פענוח חשבונית נכשל — דורש טיפול ידני" };
  await insertAlertOnce(supabase, log, msgId, {
    type:    failedAlert.type,
    title:   failedAlert.title,
    message: `המייל "${meta.subject}" נכשל בפענוח ${attempts} פעמים ולא יעובד שוב אוטומטית. ` +
             `להסרת החסימה ולניסיון חוזר — הסר/י את התווית "${FAILED_LABEL_NAME}" מהמייל.`,
    payload: {
      gmailMessageId: msgId, subject: meta.subject, from: meta.from,
      messageLink: meta.messageLink, attempts, lastError: errorMsg.slice(0, 300),
      docType,
    },
  });
  await log("error",
    `ingest failed ${attempts}× — parked behind "${FAILED_LABEL_NAME}", will not retry`,
    { error: errorMsg }, msgId);
  return true;
}

// ─── Main ingest ───────────────────────────────────────────────────────────

interface IngestResult {
  processed:  number;
  alerts:     number;
  skipped:    number;
  errors:     string[];
  ts:         string;
  /** Recovery mode only: how many parked emails this run put back in the queue. */
  requeued?:  number;
}

interface IngestOptions {
  /**
   * Recovery run: process the emails PARKED behind the failed label instead of the
   * normal queue, ignoring the 14-day window. Their `ingest_failures` counters are
   * cleared and the label removed first, so each one gets a full retry budget again
   * rather than the single attempt a leftover counter would allow.
   */
  requeueFailed?:       boolean;
  /** How far back the recovery sweep looks. Defaults to REQUEUE_LOOKBACK_DAYS. */
  requeueLookbackDays?: number;
}

// Context shared by every invoice file in one email (the email-level facts plus
// the loaded suppliers/categories the helper mutates in place).
/** `20000` → `₪20,000`. Alert text only — every stored figure stays numeric. */
function fmtIls(n: number): string {
  return "\u20AA" + Math.round(Math.abs(n)).toLocaleString("he-IL") + (n < 0 ? "-" : "");
}

/**
 * The pre-VAT amount above which an invoice waits for the owner's decision.
 *
 * Read from app_settings so the owner can move it in Settings without a deploy.
 * `null` = NO GATE. An unset, blank or unparseable value must never fall back to
 * a number nobody chose: guessing a threshold would silently hold up invoices
 * the owner never asked to stop, and a gate that appears on its own is worse
 * than no gate.
 *
 * Loaded ONCE per run and carried on the ctx — a per-invoice read would hit the
 * DB once per file for a value that cannot change mid-run.
 */
async function loadApprovalThreshold(supabase: SupabaseClient, log: Logger): Promise<number | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "invoice_approval_threshold")
    .maybeSingle();
  if (error) {
    await log("warn", `approval threshold unreadable — gate OFF: ${error.message}`, {});
    return null;
  }
  const raw = (data?.value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    await log("warn", "approval threshold is not a positive number — gate OFF", { raw });
    return null;
  }
  return n;
}

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
  /** Pre-VAT approval threshold, or null when the gate is off. See loadApprovalThreshold. */
  approvalThreshold:    number | null;
  suppliers:            SupplierRow[];
  categoryNames:        string[];
  // True when this file is a credit note (חשבונית מס זיכוי) routed through the
  // invoice pipeline as a negative invoice rather than via the returns flow.
  isCreditNote:         boolean;
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

  // Credit note: same pipeline, but the amounts are negative so the row nets
  // against the supplier balance and shows as a minus line in the invoice list.
  // Force the sign deterministically rather than trusting the extractor.
  if (ctx.isCreditNote) {
    extracted.total_amount      = -Math.abs(extracted.total_amount);
    extracted.amount_before_vat = -Math.abs(extracted.amount_before_vat);
    extracted.vat_amount        = -Math.abs(extracted.vat_amount);
    await log("info", "credit note — amounts negated", {
      total: extracted.total_amount, vendor: extracted.vendor_name,
    }, msgId);
  }

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
    // 2. NAME-FALLBACK (secondary) — used ONLY when hp is absent/unmatched. ח.פ (step 1
    //    above) is the primary key; name-fuzzy stays as the documented secondary fallback.
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

  // Supabase Storage (in-app preview). NB: the Drive upload is deferred until
  // AFTER the dedup guard below. Storage is upsert-idempotent (deterministic key)
  // so it's safe to run here; Drive create is NOT idempotent, so uploading it
  // before the guard was what let a reprocessed/retried email leave a second
  // (orphan) Drive file while the DB stayed correctly deduped.
  const supplierDisplayName = matched?.name ?? extracted.vendor_name;
  const invoiceDateObj = new Date(extracted.invoice_date || new Date().toISOString().slice(0, 10));

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

  // Suspicious-date check (non-terminal). The filing rule already routes normal
  // prior-month invoices automatically (own month / grace / עודפים overflow), so a
  // plain "previous month" alert was redundant noise. Only flag dates that are
  // implausibly old — a likely AI date-parse error (e.g. wrong year 2024/2025).
  const now = new Date();
  const SUSPICIOUS_MONTHS_BACK = 3;
  const suspiciousBefore = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth() - SUSPICIOUS_MONTHS_BACK, 1));
  if (extracted.invoice_date && new Date(extracted.invoice_date) < suspiciousBefore) {
    await log("warn", "invoice date implausibly old — possible parse error",
      { invoiceDate: extracted.invoice_date }, msgId);
    await insertAlertOnce(supabase, log, msgId, {
      type:    "invoice_old_date",                      // keep id → no frontend change
      title:   "חשבונית בתאריך חשוד",
      message: `תאריך החשבונית מ-${extracted.vendor_name} הוא ${extracted.invoice_date} — מעל 3 חודשים אחורה, ייתכן שגיאת קריאה בתאריך. נא לוודא.`,
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

  // Not a duplicate → NOW upload to Drive. Deferring the upload past the dedup
  // guard means a reprocessed/retried email (which returns "skipped" above) never
  // creates a second Drive file. driveUploadFile is NOT idempotent — Drive permits
  // duplicate filenames and mints a fresh id every call — so this MUST stay below
  // the guard. A Drive failure here is non-fatal (empty link, still inserts) — the
  // same behaviour as before.
  let driveFileLink = "", monthFolderLink = "";
  const invoiceFilename = buildInvoiceFilename(
    supplierDisplayName, extracted.invoice_number, extracted.invoice_date, file.filename, file.mimeType,
  );
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


  // ── approval gate ───────────────────────────────────────────────────────────
  // Math.abs is deliberate. completeAmounts works on MAGNITUDES and credit notes
  // are negated afterwards (see the isCreditNote block above), so without abs a
  // −₪30,000 credit note slips under a ₪20,000 threshold and never stops.
  //
  // PRE-VAT, the owner's rule: the threshold is about the size of the purchase,
  // not about what the tax adds on top of it.
  //
  // The invoice is still inserted normally. The gate marks it and asks; it does
  // not hold the document hostage — a filed invoice that the owner cannot see is
  // worse than one she has yet to rule on.
  // Same 22003 guard as the delivery-note path, and it matters more here: losing
  // an invoice loses money owed. A figure that cannot be stored is dropped, the
  // invoice is filed as needs_review with the reason on the row, and an alert
  // carries it to the owner. The gate below then measures the SANITISED figure —
  // reading a threshold off a number Postgres refused would be meaningless.
  const money = storableAmounts({
    total_amount:      extracted.total_amount,
    amount_before_vat: extracted.amount_before_vat,
    vat_amount:        extracted.vat_amount,
  });
  const amountUnreadable = money.dropped.length > 0;

  const preVat = Math.abs(Number(money.values.amount_before_vat ?? 0)) || 0;
  const overThreshold = ctx.approvalThreshold !== null && preVat > ctx.approvalThreshold;
  const insertRow: Record<string, unknown> = {
    supplier_id:        supplierId,
    // Use the matched supplier's official name (from supplier details), not the
    // AI-read vendor text / logo, so balance nets correctly (it's keyed by
    // supplier_name). Falls back to extracted.vendor_name for brand-new suppliers.
    supplier_name:      supplierDisplayName,
    invoice_number:     extracted.invoice_number,
    invoice_date:       extracted.invoice_date || null,
    ...money.values,
    category:           finalCategory,
    line_items:         extracted.line_items.join("\n"),
    ai_confidence:      extracted.confidence,
    status:             (extracted.confidence === "low" || amountUnreadable)
                          ? "needs_review" : "ממתין",
    is_duplicate:       isDuplicate,
    has_error:          amountUnreadable,
    error_reason:       amountUnreadable
                          ? `סכום לא קריא: ${money.dropped.join(", ")}` : null,
    awaiting_approval:  overThreshold,
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

  // `.select("id")` so the approval alert can name the row it is about. The
  // alert is useless without it: approving or rejecting means acting on THIS
  // invoice, and every other alert that resolves to an invoice has to go looking
  // for it by gmail_message_id afterwards.
  const { data: insertedRows, error: insErr } = await supabase
    .from("invoices").insert(insertRow).select("id");
  if (insErr) {
    if (insErr.code === "23505") {
      await log("info", "concurrent insert race — skipping", { code: insErr.code }, msgId);
      return "skipped";
    }
    await log("error", `invoice insert failed: ${insErr.message}`, { code: insErr.code }, msgId);
    result.errors.push(`Invoice insert failed for ${msgId}: ${insErr.message}`);
    return "error";
  }
  const insertedId: string | null = insertedRows?.[0]?.id ?? null;

  // ── the approval alert ──────────────────────────────────────────────────────
  // Everything needed to decide travels IN THE PAYLOAD — supplier, number, date,
  // both amounts, the threshold that stopped it, and the links to the document
  // and the source email. Same shape as invoice_low_confidence, and for the same
  // reason: an alert that forces the owner to go and look things up before she
  // can answer it is an alert she will leave sitting.
  //
  // dedupKeys ["invoiceId"] — one email can carry several invoices, and each big
  // one deserves its own decision. Without it the second invoice in an email
  // would be silently suppressed as "an alert of this type already exists".
  // An invoice filed without its figure moves no balance, so it cannot be left to
  // be noticed on a list. dedupKeys ["invoiceId"] for the same reason as below:
  // one email can carry several invoices.
  if (amountUnreadable) {
    await log("warn", "invoice amount was not storable — filed for review without it",
      { invoiceId: insertedId, dropped: money.dropped }, msgId);
    await insertAlertOnce(supabase, log, msgId, {
      type:    "invoice_amount_unreadable",
      title:   "סכום לא נקרא בחשבונית — דורש השלמה",
      message: `חשבונית ${extracted.invoice_number || ""} מ-${supplierDisplayName || extracted.vendor_name || "ספק לא ידוע"} נקלטה, אך הסכום שנקרא ממנה אינו סכום אפשרי והושאר ריק. עד להשלמה היא אינה משפיעה על יתרת הספק.`,
      payload: {
        gmailMessageId: msgId,
        invoiceId:      insertedId,
        supplierId,
        supplierName:   supplierDisplayName || extracted.vendor_name || "",
        invoiceNumber:  extracted.invoice_number ?? "",
        fields:         money.dropped,
        driveFileLink,
        storageUrl:     storagePath || null,
        subject,
        from,
        messageLink,
      },
    }, ["invoiceId"]);
    result.alerts++;
  }

  if (overThreshold) {
    await log("warn", "invoice over approval threshold — awaiting owner decision", {
      invoiceId: insertedId, preVat, threshold: ctx.approvalThreshold,
    }, msgId);
    await insertAlertOnce(supabase, log, msgId, {
      type:    "invoice_approval_required",
      title:   "חשבונית גדולה — נדרש אישור",
      message: `חשבונית ${extracted.invoice_number || ""} מ-${supplierDisplayName || extracted.vendor_name || "ספק לא ידוע"} על ${fmtIls(preVat)} לפני מע"מ עברה את סף האישור (${fmtIls(ctx.approvalThreshold ?? 0)}). נא לאשר או לדחות.`,
      payload: {
        gmailMessageId:  msgId,
        invoiceId:       insertedId,
        supplierId,
        supplierName:    supplierDisplayName || extracted.vendor_name || "",
        invoiceNumber:   extracted.invoice_number ?? "",
        invoiceDate:     extracted.invoice_date ?? "",
        amountBeforeVat: extracted.amount_before_vat,
        vatAmount:       extracted.vat_amount,
        totalAmount:     extracted.total_amount,
        threshold:       ctx.approvalThreshold,
        isCreditNote:    ctx.isCreditNote,
        category:        finalCategory,
        lineItems:       extracted.line_items.join("\n"),
        driveFileLink,
        storageUrl:      storagePath || null,
        subject,
        from,
        messageLink,
      },
    }, ["invoiceId"]);
    result.alerts++;
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

async function ingestInvoices(
  supabase: SupabaseClient,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const result: IngestResult = {
    processed: 0,
    alerts:    0,
    skipped:   0,
    errors:    [],
    ts:        new Date().toISOString(),
  };
  const log = makeLogger(supabase);

  // ── Single-flight lease ──────────────────────────────────────────────────
  // Claim the ingest_lock row atomically; a second concurrent run finds a fresh
  // lease (locked_at within the TTL) and exits, closing the race where two runs
  // both process an email before either marks it processed. The 10-minute TTL
  // lets a crashed run self-heal. Released in the finally below.
  const runId = crypto.randomUUID();
  const LEASE_TTL_MS = 10 * 60 * 1000;
  const { data: leased, error: leaseErr } = await supabase
    .from("ingest_lock")
    .update({ holder: runId, locked_at: new Date().toISOString() })
    .eq("id", 1)
    .lt("locked_at", new Date(Date.now() - LEASE_TTL_MS).toISOString())
    .select("id");
  if (leaseErr) {
    // Fail OPEN: if the lock row/table is unreachable (e.g. migration not yet
    // applied) proceed without single-flight rather than halt ingestion entirely.
    await log("warn", `ingest_lock unavailable — proceeding without single-flight`, { error: leaseErr.message });
  } else if (!leased || leased.length === 0) {
    await log("info", "another ingest run holds the lease — exiting");
    return result;
  }

  try {
  const token = await getGoogleAccessToken();
  await log("info", "google token acquired");

  // Resolve labels (creating destinations as needed; source must already exist)
  const labels = await gmailListLabels(token);
  // Gmail returns nested labels as full paths ("Parent/Child"); resolve by the
  // exact name OR any nested leaf, trimmed — so a manually-nested label (the
  // reason label:"החזר חלקי" matched 0) still resolves to its ID.
  const findLabelId = (name: string): string | null =>
    labels.find((l) => l.name.trim() === name || l.name.trim().endsWith("/" + name))?.id ?? null;

  const sourceLabelId = findLabelId(SOURCE_LABEL_NAME);
  if (!sourceLabelId) {
    await log("error", `source label "${SOURCE_LABEL_NAME}" not found in Gmail — create it manually first`);
    result.errors.push(`source label "${SOURCE_LABEL_NAME}" missing`);
    return result;
  }
  const destProcessed   = await gmailEnsureLabel(token, PROCESSED_LABEL_NAME);
  const destFailed      = await gmailEnsureLabel(token, FAILED_LABEL_NAME);
  // Partial-refund label is applied manually by the business owner — look up only, never created.
  const partialRefundLabelId = findLabelId(PARTIAL_REFUND_LABEL_NAME);
  if (!partialRefundLabelId) {
    // Not fatal, but surface the ACTUAL Gmail label names so a nesting/typo/niqqud
    // mismatch is visible in the logs instead of silently fetching nothing.
    await log("warn", `partial-refund label "${PARTIAL_REFUND_LABEL_NAME}" did not resolve to an id`,
      { candidates: labels.map((l) => l.name).filter((n) => n.includes("חלקי") || n.includes("החזר")) });
  }

  // Gmail query: source label, not yet processed, last 14 days only.
  // The 14-day rolling lookback is a safety measure — without it, a freshly
  // deployed instance would chew through every historical email under the
  // source label. Intentionally no is:unread — owner may open emails before
  // the cron runs.
  // Two independent sources, each matched by label ID (not by name in q, which is
  // fragile for nested/spaced labels). OR-ed via union:
  //   • supplier-docs label — 14-day window, skip already-failed
  //   • manually-applied partial-return label — wider 90-day window, never
  //     failed-skipped, so it no longer depends on the supplier label being
  //     co-applied. Exclusions stay name-based (those labels are code-created,
  //     always top-level, so name search is reliable for them).
  let messageIds: string[];

  if (opts.requeueFailed) {
    // ── Recovery sweep ──────────────────────────────────────────────────────
    // Emails carrying BOTH the source label and the FAILED label (Gmail ANDs the
    // labelIds), over a deliberately wider window. This exists because the routine
    // 14-day lookback makes a parked email permanently unreachable once it ages
    // out — the code used to tell the owner that removing the label re-queues it,
    // which is only true inside those 14 days.
    const days = opts.requeueLookbackDays ?? REQUEUE_LOOKBACK_DAYS;
    messageIds = await gmailListMessages(
      token,
      `-label:"${PROCESSED_LABEL_NAME}" newer_than:${days}d`,
      [sourceLabelId, destFailed],
      REQUEUE_MAX_MESSAGES,
    );
    await log("info", `requeue: found ${messageIds.length} parked message(s)`,
      { lookbackDays: days, cap: REQUEUE_MAX_MESSAGES });

    if (messageIds.length > 0) {
      // Clear the counters BEFORE processing. `ingest_failures` is never reset
      // anywhere else, so a parked email sits at attempts=MAX and the very next
      // failure parks it again immediately — one attempt, not a retry budget.
      const { error: clearErr } = await supabase
        .from("ingest_failures").delete().in("gmail_message_id", messageIds);
      if (clearErr) {
        await log("warn", `requeue: could not clear failure counters — retries will be limited`,
          { error: clearErr.message });
      }
      // Drop the FAILED label so a run that succeeds ends with ONE label (טופל),
      // and so the routine tick can see the email again if this run is interrupted.
      for (const id of messageIds) {
        await gmailModifyLabels(token, id, [], [destFailed]);
      }
    }
    result.requeued = messageIds.length;
  } else {
    const srcIds  = await gmailListMessages(
      token,
      `-label:"${PROCESSED_LABEL_NAME}" -label:"${FAILED_LABEL_NAME}" newer_than:14d`,
      [sourceLabelId],
    );
    const partIds = partialRefundLabelId
      ? await gmailListMessages(token, `-label:"${PROCESSED_LABEL_NAME}" newer_than:90d`, [partialRefundLabelId])
      : [];
    messageIds = [...new Set([...srcIds, ...partIds])];
    await log("info", `found ${messageIds.length} candidate messages`,
      { source: srcIds.length, partialReturn: partIds.length });
  }

  if (messageIds.length === 0) return result;

  // Load suppliers + categories once
  const { data: supplierRows } = await supabase.from("suppliers").select("id, name, category, hp, alt_names, email");
  const suppliers: SupplierRow[] = supplierRows ?? [];
  const { data: catRows } = await supabase.from("categories").select("name");
  const categoryNames: string[] = (catRows ?? []).map((r: { name: string }) => r.name);

  const managerEmail = Deno.env.get("GMAIL_USER_EMAIL") ?? "";
  const approvalThreshold = await loadApprovalThreshold(supabase, log);
  await log("info", "invoice approval gate", {
    threshold: approvalThreshold, active: approvalThreshold !== null,
  });

  for (const msgId of messageIds) {
    // Hoisted so the per-message catch below can reference them when a failure
    // (e.g. extractInvoice throwing) unwinds out of the try. `docType` is hoisted
    // for the same reason and one more: the parked-failure alert is chosen by it,
    // and an extraction that throws unwinds past the point where it was decided.
    let subject     = "(no subject)";
    let from        = "";
    let messageLink = `https://mail.google.com/mail/u/0/#all/${msgId}`;
    let docType: DocType = "unknown";
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
      subject     = extractHeader(message, "Subject") || "(no subject)";
      from        = extractHeader(message, "From");
      const bodyText   = extractBodyText(message);
      const rawHtml    = extractRawHtml(message);
      const emailTs    = new Date(parseInt(message.internalDate, 10)).toISOString();
      messageLink = `https://mail.google.com/mail/u/0/#all/${msgId}`;

      await log("info", "processing", { subject, from, labelIds: message.labelIds ?? [] }, msgId);

      // ── Stage 2a: document TYPE from the SUBJECT — computed HERE, before the
      // "no usable document" guard below (spec/09-IDEAS.md §10).
      //
      // It used to run after that guard, and the guard's alert types/messages are
      // hard-coded to invoice_*. So a כרטסת email whose file could not be fetched
      // was reported as a failed INVOICE and never reached vendor_statements at
      // all. classifyBySubject depends on nothing but the subject string, so it
      // belongs up here; the AI CONTENT fallback stays below, where a file exists.
      docType = classifyBySubject(subject);

      // ── RECEIPTS DO NOT ENTER THE SYSTEM (owner's rule, 2026-08-05) ──
      // A קבלה is proof that a payment was made; it carries no tax obligation and
      // duplicates an invoice that already exists (or will). Letting one in creates
      // a phantom invoice row and inflates what a supplier is owed.
      //
      // NOTE the asymmetry with every other rejection in this loop: a receipt is NOT
      // an anomaly and raises NO alert. Suppliers send receipts routinely, so
      // alerting would manufacture a queue out of ordinary correspondence. It is
      // logged instead — visible in לוגי מערכת, countable, and silent.
      //
      // A "חשבונית מס קבלה" is a COMBINED document and a valid tax invoice; both
      // classifiers claim it for "חשבונית" first, so it never reaches here.
      //
      // Checked TWICE — once on the subject (below, before any attachment is even
      // downloaded) and once after the content router — because a receipt with a
      // generic subject is only recognised from the file itself. Without the early
      // check, a receipt with no fetchable file would trip the no-file guard and
      // raise an invoice_no_attachment alert: exactly the noise this avoids.
      const skipIfReceipt = async (): Promise<boolean> => {
        if (docType !== "receipt") return false;
        await log("info", "receipt — deliberately NOT ingested (receipts are not invoices)",
          { subject, from }, msgId);
        await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
        result.skipped++;
        return true;
      };
      if (await skipIfReceipt()) continue;

      // A manually-applied "החזר חלקי" label means: this is an ordinary invoice
      // for special (partial-return subfolder) filing — never let a "החזר"/"זיכוי"
      // keyword in the subject/content reroute it off the invoice path. Applied
      // here (rather than after Stage 2b) so the guard below also sees the invoice
      // verdict this label forces; a labelled email with an inconclusive subject
      // now skips the content router entirely, which the override would have
      // overruled anyway.
      const isPartialReturn =
        partialRefundLabelId !== null && (message.labelIds ?? []).includes(partialRefundLabelId);
      if (isPartialReturn) docType = "invoice";

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

      // No document at all → alert + mark processed. The alert is now chosen by the
      // SUBJECT-classified docType, so a כרטסת/תעודת משלוח/זיכוי that lost its file
      // is reported as such instead of as a failed invoice. `unknown` (no keyword in
      // the subject) keeps the invoice wording — with no file there is nothing left
      // to classify by, and invoices are the overwhelming majority.
      if (usableFiles.length === 0) {
        const hadFiltered = rawAtt.length > 0; // had attachments, all dropped by Stage 1
        // WHY there is no file — the one thing the owner needs in order to act.
        const reason = hadFiltered ? "filtered" : attemptedLinks ? "link_failed" : "no_attachment";
        const reasonText = hadFiltered
          ? `נמצאו ${rawAtt.length} קבצים אך כולם סוננו (לוגו/קובץ קטן מ-50KB)`
          : attemptedLinks
          ? "הורדת הקובץ מהקישורים במייל נכשלה"
          : "לא נמצא קובץ PDF/תמונה ולא קישור להורדה";

        const noFile = NO_FILE_ALERT[docType];   // null for invoice/unknown
        const alertType  = noFile ? noFile.type : hadFiltered ? "invoice_no_valid_attachment"
                                                : attemptedLinks ? "invoice_link_failed"
                                                : "invoice_no_attachment";
        const alertTitle = noFile ? noFile.title : hadFiltered ? "מייל ללא קובץ חשבונית מזוהה"
                                                : attemptedLinks ? "הורדת חשבונית מקישור נכשלה"
                                                : "מייל ללא קובץ מצורף";
        const alertMessage = noFile
          ? `המייל "${subject}" זוהה לפי הנושא כ${noFile.docLabel}, אך ${reasonText}. יש לבדוק ידנית.`
          : hadFiltered
          ? `במייל "${subject}" נמצאו ${rawAtt.length} קבצים אך כולם סוננו (לוגו/קובץ קטן מ-50KB)`
          : attemptedLinks
          ? `לא ניתן היה להוריד מסמך מהקישורים במייל "${subject}". יש לבדוק ידנית.`
          : `במייל "${subject}" לא נמצא קובץ PDF/תמונה או קישור להורדה. יש לבדוק ידנית.`;

        await log("warn", `no usable document — ${alertType} (docType: ${docType}, reason: ${reason})`,
          { rawAtt: rawAtt.length, dropped, linkFailures }, msgId);
        await insertAlertOnce(supabase, log, msgId, {
          type:    alertType,
          title:   alertTitle,
          message: alertMessage,
          payload: {
            gmailMessageId: msgId, subject, from, messageLink,
            docType, reason, linkFailures, droppedFiles: dropped,
          },
        });
        await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
        result.alerts++;
        continue;
      }

      // ── Stage 2b: document TYPE, AI content router — ONLY when the subject was
      // inconclusive. This one needs the file, so it stays here, below the guard.
      if (docType === "unknown") {
        docType = await classifyDocTypeByContent(usableFiles[0]);
        await log("info", `subject inconclusive — content router → ${docType}`, undefined, msgId);
        if (await skipIfReceipt()) continue;
      } else {
        await log("info", `docType from subject → ${docType}`, undefined, msgId);
      }

      // Credit notes (זיכוי) are ingested as NEGATIVE invoices via the invoice
      // pipeline — NOT as returns rows — so the balance moves exactly once.
      const isCreditNote = docType === "return_doc";

      // ── Routing by type ──
      // statement / delivery_note: route by subject, each file its own record.
      // These are NEVER subjected to quickInvoiceCheck (that ad-gate is
      // invoice-only — it's what previously discarded statements). Credit notes
      // fall through to the invoice path below.
      if (docType !== "invoice" && !isCreditNote) {
        let allSaved = true;
        for (const f of usableFiles) {
          const ok = await handleNonInvoice(supabase, log, msgId, suppliers, {
            docType,
            subject,
            from,
            token,
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
          await recordFailureAndMaybePark(
            supabase, log, token, msgId, destFailed,
            { subject, from, messageLink }, "a document write failed", docType);
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
        approvalThreshold,
        suppliers,
        categoryNames,
        isCreditNote,
      };
      let created = 0, alerted = 0, skipped = 0, ads = 0, errored = 0;
      for (const f of usableFiles) {
        if (!isCreditNote && !(await quickInvoiceCheck(f))) {
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
        await recordFailureAndMaybePark(
          supabase, log, token, msgId, destFailed,
          { subject, from, messageLink }, `${errored} invoice file(s) errored`, docType);
        continue;
      }

      // Every processed email gets exactly ONE label: טופל. A flagged document used
      // to ALSO get "דורש בדיקה ידנית", which made the mailbox a second, partial
      // queue competing with the alerts screen — the same item in two places, one
      // of which nothing ever cleared. The SYSTEM is where review happens; the
      // mailbox only records that ingest ran.
      await gmailModifyLabels(token, msgId, [destProcessed], [sourceLabelId, "UNREAD"]);
      await log("info", "email invoice processing complete",
        { created, alerted, skipped, ads, errored }, msgId);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log("error", `unhandled exception: ${msg}`, undefined, msgId);
      result.errors.push(`Error processing ${msgId}: ${msg}`);
      await recordFailureAndMaybePark(
        supabase, log, token, msgId, destFailed,
        { subject, from, messageLink }, msg, docType);
    }
  }

  return result;
  } finally {
    // Release only our own lease (reset to epoch) so the next run starts at once.
    await supabase.from("ingest_lock")
      .update({ locked_at: new Date(0).toISOString() })
      .eq("id", 1).eq("holder", runId);
  }
}

// ─── Non-invoice extractors ────────────────────────────────────────────────

interface ExtractedDeliveryNote {
  vendor_name:       string;
  /** Supplier's business number (ח.פ) — the PRIMARY supplier join key (§2b). */
  hp:                string;
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
    '{"vendor_name":"","hp":"","note_number":"","date":"","amount":0,"amount_before_vat":0,"vat_amount":0,"line_items":[]}\n' +
    "כללים: תאריך YYYY-MM-DD, סכומים ללא סימני מטבע, hp = מספר ח.פ/עוסק של הספק (ספרות בלבד, ריק אם אינו מופיע).";
  // EXTRACTION_MAX_TOKENS, not a tight cap: `line_items` is an UNBOUNDED array and a
  // delivery note is precisely the document that lists every item. At 1024 the reply
  // was cut mid-array, the JSON never closed, parseJsonRobust returned null, the retry
  // ran under the SAME cap and was cut at the same place, and the note was parked as a
  // failed *invoice* after MAX_INGEST_ATTEMPTS. extractInvoice has always used the full
  // budget for the same reason; extractReturn/extractStatement stay small because their
  // schemas are fixed-size.
  const raw = await anthropicMessage(
    ANTHROPIC_MODEL_EXTRACTOR,
    [{ role: "user", content: [buildDocumentBlock(doc.mimeType, doc.bytes), { type: "text", text: prompt }] }],
    EXTRACTION_MAX_TOKENS,
  );
  let parsed = parseJsonRobust(raw);
  if (parsed === null) {
    const retryRaw = await anthropicMessage(
      ANTHROPIC_MODEL_EXTRACTOR,
      [{ role: "user", content: [
        buildDocumentBlock(doc.mimeType, doc.bytes),
        { type: "text", text: "ענה ב-JSON בלבד ללא markdown וללא הסבר:\n" +
          '{"vendor_name":"","hp":"","note_number":"","date":"","amount":0,"amount_before_vat":0,"vat_amount":0,"line_items":[]}' },
      ] }],
      EXTRACTION_MAX_TOKENS,
    );
    parsed = parseJsonRobust(retryRaw);
    if (parsed === null) {
      // Same truncation hint extractInvoice carries — an unclosed reply is the one
      // failure whose cause is legible from the raw text.
      const looksTruncated = !retryRaw.trimEnd().endsWith("}");
      throw new Error(
        `extractDeliveryNote failed after retry${looksTruncated ? " — response appears TRUNCATED (raise max_tokens)" : ""}. ` +
        `Raw: ${raw.slice(0, 500)}`);
    }
  }
  const p = parsed as Record<string, unknown>;
  const date = String(p.date ?? "");

  // Same three-amount completion as extractInvoice — a delivery note that prints
  // only a total still lands with net and VAT filled. Holes only.
  const filled = completeAmounts(
    { net: p.amount_before_vat, vat: p.vat_amount, gross: p.amount },
    vatRateFor(date),
  );

  return {
    vendor_name:       String(p.vendor_name ?? ""),
    hp:                String(p.hp ?? ""),
    note_number:       String(p.note_number ?? ""),
    date,
    amount:            filled.gross,
    amount_before_vat: filled.net,
    vat_amount:        filled.vat,
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

interface ExtractedStatement {
  vendor_name:     string;
  /** The RECIPIENT named on the statement — always us. Extracted purely so the
   *  matcher can refuse a vendor_name that is really the recipient; never stored. */
  customer_name:   string;
  hp:              string;
  /** The supplier's FINAL balance due at the foot of the statement, or null when
   *  the document has no unambiguous closing figure. NEVER a guess. */
  closing_balance: number | null;
  /** The statement's OWN period as `YYYY-MM`, or "" when it isn't stated. */
  period:          string;
}

const STATEMENT_JSON_SHAPE = '{"vendor_name":"","customer_name":"","hp":"","closing_balance":null,"period":""}';
// 512 was not enough and made this feature fail 100% of the time: the statement
// prompt is the only all-Hebrew, rule-heavy prompt in the file, and Hebrew runs
// roughly one token per 1–2 characters, so the answer was cut off mid-JSON,
// parseJsonRobust found no closing `}` and extractStatement threw on EVERY run.
// max_tokens is a CEILING, not a reservation — billing is on tokens actually
// produced, and this reply is a handful of fields — so raising it costs nothing.
const STATEMENT_MAX_TOKENS       = 2048;
// The retry gets a BIGGER budget than the first attempt. Re-asking an identical
// question of an identical document under an identical ceiling is not a retry —
// it fails the same way, which is exactly what used to happen here.
const STATEMENT_RETRY_MAX_TOKENS = 3072;
// Sonnet 4.6 REJECTS an assistant prefill (HTTP 400), so the "prefill a `{`"
// trick is unavailable on this model — see the note above extractStatement.
// The supported substitute is an explicit no-preamble instruction, which is what
// STATEMENT_JSON_ONLY carries.
const STATEMENT_JSON_ONLY =
  "החזר JSON תקין בלבד. אל תוסיף טקסט, הסבר, כותרת או סימוני markdown לפני ה-JSON או אחריו. " +
  "התו הראשון בתשובה חייב להיות { והתו האחרון }.";

// Statements (כרטסת / supplier ledgers) are deliberately extracted NARROW: the
// vendor identity (name + ח.פ), the statement's own period, and ONE amount — the
// closing balance. That single number is what the whole reconciliation compares
// against; the line detail is reviewed by eye against the attached document, so
// there is nothing to gain (and accuracy to lose) from extracting it.
//
// `closing_balance` is null-or-nothing on purpose: a guessed balance would produce
// a confident, wrong verdict, which is worse than no verdict at all.
//
// ⚠️ EXACTLY ONE ATTEMPT PLUS ONE RETRY, then throw. No loop, no third call. The
// caller swallows the throw and still saves the row (see handleNonInvoice), so an
// extra attempt here would only multiply cost on documents that are unreadable
// anyway. Raising the token budgets did NOT add an attempt.
//
// ⚠️ No assistant prefill. Forcing JSON by prefilling an assistant turn with `{`
// is the classic trick, but ANTHROPIC_MODEL_EXTRACTOR is claude-sonnet-4-6, and a
// last-assistant-turn prefill is rejected with HTTP 400 on that model family —
// adding one would turn "fails sometimes" into "400s every time". The supported
// replacement is a no-preamble instruction (STATEMENT_JSON_ONLY).
async function extractStatement(
  doc: { mimeType: string; bytes: Uint8Array },
  log?: Logger,
  msgId?: string,
): Promise<ExtractedStatement> {
  const prompt =
    "אתה מנתח כרטסות ספק (דפי חשבון / כרטסת הנהלת חשבונות). חלץ את הפרטים וחזור ב-JSON בלבד, ללא הסברים.\n" +
    STATEMENT_JSON_SHAPE + "\n" +
    STATEMENT_JSON_ONLY + "\n" +
    "כללים:\n" +
    // A כרטסת carries TWO company names: the supplier who ISSUED it and the
    // customer it is ADDRESSED TO — which is always us. "שייכת" was ambiguous
    // enough that the extractor returned the recipient, and the statement then
    // matched our own supplier card and moved a balance belonging to nobody.
    "vendor_name = שם החברה שהנפיקה את הכרטסת — הספק, כלומר הצד שאנחנו חייבים לו כסף.\n" +
    "  שים לב: בכרטסת מופיעים תמיד שני שמות — המנפיק (הספק) והנמען (הלקוח, כלומר אנחנו).\n" +
    "  vendor_name הוא תמיד המנפיק, לעולם לא הנמען. הנמען מופיע בדרך כלל אחרי \"לכבוד\" / \"עבור\" /\n" +
    "  \"כרטסת לקוח\" — אותו יש להתעלם ממנו לחלוטין.\n" +
    "  אם אינך מצליח להבחין בוודאות מי המנפיק ומי הנמען — החזר מחרוזת ריקה. אל תנחש.\n" +
    "customer_name = שם הנמען (הלקוח) כפי שמופיע במסמך, או מחרוזת ריקה. שדה זה נועד\n" +
    "  לאימות בלבד — הוא מאפשר לוודא ש-vendor_name אינו הנמען.\n" +
    "hp = מספר ח.פ / ע.מ של הספק, ספרות בלבד. אם אינו מופיע במסמך — מחרוזת ריקה.\n" +
    "closing_balance = יתרת הסגירה של הספק בתחתית הכרטסת (היתרה לתשלום / יתרה סופית), " +
    "מספר בלבד ללא סימני מטבע ובלי מפרידי אלפים. יתרת זכות = מספר שלילי. " +
    "אם אין במסמך יתרת סגירה חד-משמעית — החזר null. אין לנחש, אין לסכם ואין לחשב יתרה בעצמך.\n" +
    "period = החודש/התקופה של הכרטסת עצמה בפורמט YYYY-MM. אם התקופה אינה מצוינת — מחרוזת ריקה.";
  // ATTEMPT 1 of 2.
  const raw = await anthropicMessage(
    ANTHROPIC_MODEL_EXTRACTOR,
    [{ role: "user", content: [buildDocumentBlock(doc.mimeType, doc.bytes), { type: "text", text: prompt }] }],
    STATEMENT_MAX_TOKENS,
    { log, msgId, logContext: { stage: "statement-extract" } },
  );
  let parsed = parseJsonRobust(raw);
  if (parsed === null) {
    // ATTEMPT 2 of 2 — a leaner prompt AND a larger ceiling, so the second call
    // differs from the first in the two ways that can actually change the outcome.
    const retryRaw = await anthropicMessage(
      ANTHROPIC_MODEL_EXTRACTOR,
      [{ role: "user", content: [
        buildDocumentBlock(doc.mimeType, doc.bytes),
        { type: "text", text: STATEMENT_JSON_ONLY + "\n" + STATEMENT_JSON_SHAPE },
      ] }],
      STATEMENT_RETRY_MAX_TOKENS,
      { log, msgId, logContext: { stage: "statement-extract-retry" } },
    );
    parsed = parseJsonRobust(retryRaw);
    if (parsed === null) {
      // No third attempt — by design. The caller records the failure loudly.
      const looksTruncated = !retryRaw.trimEnd().endsWith("}");
      throw new Error(
        `extractStatement failed after retry${looksTruncated ? " — response appears TRUNCATED" : ""}. ` +
        `Raw: ${raw.slice(0, 500)}`);
    }
  }
  const p = parsed as Record<string, unknown>;
  return {
    vendor_name:     String(p.vendor_name ?? ""),
    customer_name:   String(p.customer_name ?? ""),
    hp:              normalizeHp(p.hp == null ? "" : String(p.hp)),
    // Rounded to the agora like every other amount here (round₂). NOT run through
    // completeAmounts(): a statement is not an invoice and carries no VAT split.
    closing_balance: parseClosingBalance(p.closing_balance),
    period:          normalizeStatementPeriod(p.period),
  };
}

// null unless the model returned a real, finite number. A string is tolerated
// (models quote amounts) but only after stripping currency/thousands noise; an
// empty/unparsable value stays null so the caller can tell "no balance" from 0.
function parseClosingBalance(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : null;
  if (typeof v !== "string") return null;
  // Accounting notations that carry the SIGN, handled before the sign character is
  // stripped: "(1,234.50)" and a trailing "1234.50-" are both NEGATIVE. Losing
  // either would flip a credit balance into a debit — a silent, confident error.
  const parenNegative = /^\s*\(.*\)\s*$/.test(v);
  const trailingMinus = /-\s*$/.test(v);
  let cleaned = v.replace(/[₪,\s]/g, "").replace(/[^\d.\-+]/g, "").replace(/[-+]/g, "");
  if (!/\d/.test(cleaned)) return null;
  if (parenNegative || trailingMinus || /^\s*-/.test(v)) cleaned = "-" + cleaned;
  const n = Number(cleaned);
  return Number.isFinite(n) ? round2(n) : null;
}

// The statement's own period → "YYYY-MM". Israeli dates are DAY-first, so a
// three-part D/M/YYYY is read day-first (never US month-first); a two-part
// M/YYYY is month + year. Anything else → "" and the caller falls back.
function normalizeStatementPeriod(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const pad = (x: string) => x.padStart(2, "0");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);      // YYYY-MM[-DD]
  if (m) return `${m[1]}-${pad(m[2])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);             // DD/MM/YYYY (day-first)
  if (m) return `${m[3]}-${pad(m[2])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);                           // MM/YYYY
  if (m) return `${m[2]}-${pad(m[1])}`;
  return "";
}

// ─── Statement supplier identification ─────────────────────────────────────
//
// Mirrors the `match_method` vocabulary pinned by migration 20260802000000 and
// widened by 20260818000000 to add `subject`
// (`hp | name | subject | email | invoice_email | manual | none`). `manual` is the
// UI's value only — ingest never writes it.
type StatementMatchMethod = "hp" | "name" | "subject" | "email" | "invoice_email" | "none";

// One-shot guard so a missing GMAIL_USER_EMAIL is reported once per function
// instance instead of once per statement.
let ingestMailboxWarned = false;

/**
 * Ordered identification chain for an incoming כרטסת, recording WHICH rule fired.
 *
 *   1. ח.פ off the document       → suppliers.hp exact            → "hp"
 *   2. vendor name off the document → findBestSupplier (0.85 fuzzy) → "name"
 *   3. the EMAIL SUBJECT          → findBestSupplier (0.85 fuzzy) → "subject"
 *   4. sending address            → suppliers.email exact         → "email"
 *   5. sending address            → the most recent invoice that arrived from the
 *                                   SAME address → that invoice's supplier_id → "invoice_email"
 *   6. nothing                    → null + "none" (an orphan the manager assigns)
 *
 * ⚠️ The DOCUMENT outranks the SENDER, and that ordering is load-bearing. The two
 * address steps were briefly promoted above the name on the reasoning that "exact
 * evidence beats a guess" — but an exact match on the sender proves who SENT the
 * file, not whose statement it is. The owner routinely scans כרטסות herself and
 * mails them to her own address, so the sender is systematically wrong.
 *
 * Steps 4–5 still matter as a fallback: a statement is a printout of the
 * supplier's OWN bookkeeping and often carries neither ח.פ nor a company name we
 * can match (the heading is frequently OUR card in THEIR books).
 *
 * ⚠️ Both address steps are SKIPPED ENTIRELY when the sender is the ingest mailbox
 * itself (`GMAIL_USER_EMAIL`). Mail the owner sends to herself carries no evidence
 * about the supplier, and `invoices.email_sender` additionally holds her address on
 * every camera-captured invoice (the capture path stores `capturedBy` there) — so
 * without the skip, a self-mailed statement matches whichever supplier she
 * photographed most recently.
 *
 * ⚠️ This function NEVER creates a supplier — unlike `resolveSupplier` (invoices /
 * delivery notes / credit notes), which auto-creates + raises `supplier_incomplete`.
 * On a statement that rule inverts: the extracted name is unreliable in exactly the
 * cases where matching fails, so auto-creating would mint an empty card named after
 * a mis-read heading — and worse, that junk card then becomes a fuzzy-match target
 * for real INVOICES, silently splitting a live supplier's balance in two. An orphan
 * statement is visible, one dropdown from being fixed, and moves nothing. A junk
 * supplier is invisible and moves the ledger. So: orphan.
 */
async function resolveStatementSupplier(
  supabase:  SupabaseClient,
  log:       Logger,
  msgId:     string,
  suppliers: SupplierRow[],
  args: {
    hp: string; vendorName: string; subject: string; senderAddress: string
    /** The RECIPIENT named on the document — us. Never a valid supplier answer. */
    customerName?: string
    /** The mailbox we are reading, resolved from Gmail itself. See getIngestMailbox. */
    ingestMailbox: string | null
  },
): Promise<{ supplierId: string | null; method: StatementMatchMethod }> {
  // 1. ח.פ — authoritative across every name-spelling difference.
  const normHp = normalizeHp(args.hp);
  if (normHp) {
    const byHp = suppliers.find((s) => normalizeHp(s.hp) === normHp) ?? null;
    if (byHp) {
      await log("info", `statement supplier matched by ח.פ → ${byHp.id}`, { hp: normHp }, msgId);
      return { supplierId: byHp.id, method: "hp" };
    }
  }

  // 2. Vendor name off the DOCUMENT — the existing 0.85 fuzzy path (also scores
  //    alt_names). The document is about the supplier; the envelope is not.
  // A כרטסת names BOTH parties. If the extractor handed back the recipient (us)
  // as the vendor, matching it would land the statement on our own supplier card
  // and move a balance that belongs to nobody — which is exactly what happened in
  // production. The prompt now distinguishes the two; this refuses the answer even
  // when it does not. Same 0.85 matcher, so "הדס" and "חנות הדס" both fail here.
  const vendorIsActuallyTheCustomer =
    !!args.customerName && !!args.vendorName &&
    !!findBestSupplier(args.vendorName, [{ id: "__customer__", name: args.customerName } as SupplierRow]);
  if (vendorIsActuallyTheCustomer) {
    await log("warn",
      "the extracted vendor_name is the statement's RECIPIENT, not its issuer — ignoring it",
      { vendorName: args.vendorName, customerName: args.customerName }, msgId);
  }

  if (args.vendorName && !vendorIsActuallyTheCustomer) {
    const byName = findBestSupplier(args.vendorName, suppliers);
    if (byName) {
      await log("info", `statement supplier matched by name → ${byName.id}`,
        { vendorName: args.vendorName, matchedName: byName.name }, msgId);
      return { supplierId: byName.id, method: "name" };
    }
  }

  // 3. The EMAIL SUBJECT, through the SAME 0.85 fuzzy matcher (never a second
  //    implementation of matching). No format is imposed: it is enough that the
  //    supplier's name appears somewhere in the subject — "כרטסת יוני - שטראוס",
  //    "שטראוס כרטסת", "FW: כרטסת שטראוס" all match. This is the step that saves
  //    the statements the owner scans and mails to herself, where the document
  //    heading is unreadable and the sender is her own address.
  if (args.subject) {
    const bySubject = findBestSupplier(args.subject, suppliers);
    if (bySubject) {
      await log("info", `statement supplier matched by the email subject → ${bySubject.id}`,
        { subject: args.subject, matchedName: bySubject.name }, msgId);
      return { supplierId: bySubject.id, method: "subject" };
    }
  }

  // ── Address-based steps (4–5) ───────────────────────────────────────────────
  // Config-driven, never a hardcoded address: this codebase is being prepared for
  // other clients, each with their own ingest mailbox.
  const ingestMailbox = args.ingestMailbox;
  if (!ingestMailbox && !ingestMailboxWarned) {
    ingestMailboxWarned = true;
    await log("warn",
      "the ingest mailbox could not be determined (Gmail profile lookup failed AND " +
      "GMAIL_USER_EMAIL is unset) — self-mailed statements may match the wrong supplier",
      undefined, msgId);
  }
  const addr           = args.senderAddress;
  const senderIsUs     = !!ingestMailbox && addr === ingestMailbox;
  const addrIsEvidence = !!addr && !senderIsUs;
  if (senderIsUs) {
    await log("info",
      "statement arrived from the ingest mailbox itself — skipping both sender-address steps",
      { addr }, msgId);
  }

  if (addrIsEvidence) {
    // 4. The address on the supplier card — an EXACT match, compared
    //    case-insensitively and tolerating a `Display Name <addr>` value on either
    //    side.
    const byEmail = suppliers.find((s) => {
      const raw = (s.email ?? "").trim().toLowerCase();
      return !!raw && (raw === addr || extractEmailAddress(s.email) === addr);
    }) ?? null;
    if (byEmail) {
      await log("info", `statement supplier matched by supplier email → ${byEmail.id}`, { addr }, msgId);
      return { supplierId: byEmail.id, method: "email" };
    }

    // 5. The address we have already seen send INVOICES. `invoices.email_sender`
    //    stores the whole `From` header, which is either the bare address or
    //    `Display Name <addr@host>` — so match those two shapes and nothing else.
    //    A bare `%addr%` would also hit `xa@b.com`, and because `.limit()` applies
    //    BEFORE the exact re-check below, 25 such near-misses would have hidden a
    //    real match entirely. Anchoring on the angle bracket makes that impossible.
    //
    //    ⚠️ The corpus is POISONED and must be filtered: the camera-capture path
    //    writes `from = body.capturedBy`, so every photographed invoice carries an
    //    EMPLOYEE's or the OWNER's address in `email_sender` rather than a
    //    supplier's. Those rows are excluded by `gmail_label_source`
    //    (CAPTURE_LABEL_SOURCE), NULL-safely — older/imported rows have no label
    //    source and must survive the filter — and the ingest mailbox is excluded
    //    again in JS as a belt-and-braces re-check.
    const esc     = escapeLike(addr);
    const escCap  = escapeLike(CAPTURE_LABEL_SOURCE);
    const { data: rows, error } = await supabase
      .from("invoices")
      .select("supplier_id, email_sender, received_at, gmail_label_source")
      .not("supplier_id", "is", null)
      .or(`email_sender.ilike.%<${esc}>%,email_sender.ilike.${esc}`)
      .or(`gmail_label_source.is.null,gmail_label_source.neq.${escCap}`)
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(25);
    if (error) {
      await log("warn", `statement sender→invoice lookup failed: ${error.message}`, { addr }, msgId);
    } else {
      const hit = (rows ?? []).find((r: { email_sender: string | null; gmail_label_source: string | null }) => {
        if (r.gmail_label_source === CAPTURE_LABEL_SOURCE) return false;   // camera capture — not a supplier's address
        const from = extractEmailAddress(r.email_sender);
        if (ingestMailbox && from === ingestMailbox) return false;         // our own mailbox — proves nothing
        return from === addr;
      });
      if (hit?.supplier_id) {
        await log("info", `statement supplier matched by a previous invoice from ${addr} → ${hit.supplier_id}`,
          { addr }, msgId);
        return { supplierId: hit.supplier_id as string, method: "invoice_email" };
      }
    }
  }

  await log("info", "statement supplier NOT identified — filing as an orphan",
    {
      hp: normHp || null, vendorName: args.vendorName || null,
      subject: args.subject || null, senderAddress: addr || null,
      senderIsIngestMailbox: senderIsUs,
    }, msgId);
  return { supplierId: null, method: "none" };
}

// ─── Statement reconciliation on arrival ───────────────────────────────────

interface StatementLedgerResult {
  ourBalance:         number;
  paymentArrangement: boolean;
}

/**
 * OUR balance for a supplier, computed by the SHARED ledger engine — the identical
 * `buildLedger` the statements screen, the supplier page and the supplier list all
 * call (spec/06-RULES.md §9). The DB rows are re-shaped here into exactly the field
 * names `useInvoices` / `usePayments` hand it; feeding it anything else would make
 * the twin worthless and put the server back in disagreement with the screen.
 *
 * Returns null when a read failed — the caller then leaves the statement at
 * `needs_review` rather than filing a verdict it could not compute.
 */
async function computeStatementLedger(
  supabase:   SupabaseClient,
  log:        Logger,
  msgId:      string,
  supplierId: string,
): Promise<StatementLedgerResult | null> {
  // All three reads are independent — the supplier row is only consumed once the
  // ledger is built, so awaiting it on its own just serialised a round-trip inside
  // the per-email loop.
  const [
    { data: sup, error: supErr },
    { data: invRows, error: invErr },
    { data: payRows, error: payErr },
  ] = await Promise.all([
    supabase.from("suppliers")
      .select("opening_balance, payment_arrangement")
      .eq("id", supplierId)
      .maybeSingle(),
    supabase.from("invoices")
      .select("id, supplier_id, total_amount, invoice_date, invoice_number, is_duplicate, has_error")
      .eq("supplier_id", supplierId),
    supabase.from("payments")
      .select("id, supplier_id, amount, payment_date, payment_type, status")
      .eq("supplier_id", supplierId),
  ]);
  if (supErr) {
    await log("warn", `statement reconcile: supplier read failed: ${supErr.message}`, { supplierId }, msgId);
    return null;
  }
  if (invErr || payErr) {
    await log("warn",
      `statement reconcile: ledger read failed: ${invErr?.message ?? payErr?.message}`, { supplierId }, msgId);
    return null;
  }

  // ── The mapping, field for field, as the frontend hooks do it ──
  // useInvoices:  supplier_id→supplierId, invoice_date→invoiceDate (ISO, sliced to
  //               10), invoice_number→invoiceNumber, is_duplicate→isDuplicate,
  //               has_error→hasError; total_amount rides along under its own name.
  // usePayments:  supplier_id, amount, payment_date→date, payment_type→type, status
  //               (null → "pending", as the hook's `?? 'pending'` does).
  const invoices = (invRows ?? []).map((r: Record<string, unknown>) => ({
    id:            String(r.id),
    supplierId:    (r.supplier_id as string | null) ?? "",
    total_amount:  Number(r.total_amount ?? 0),
    invoiceDate:   String(r.invoice_date ?? "").slice(0, 10),
    invoiceNumber: (r.invoice_number as string | null) ?? "",
    isDuplicate:   (r.is_duplicate as boolean | null) ?? false,
    hasError:      (r.has_error as boolean | null) ?? false,
  }));
  const payments = (payRows ?? []).map((r: Record<string, unknown>) => ({
    id:          String(r.id),
    supplier_id: (r.supplier_id as string | null) ?? "",
    amount:      Number(r.amount ?? 0),
    date:        (r.payment_date as string | null) ?? "",
    type:        (r.payment_type as string | null) ?? "",
    status:      String(r.status ?? "pending"),
  }));

  // NOTE: `paymentArrangement` is deliberately NOT passed to buildLedger here — see
  // the caller. What is stored is the TRUE ledger figure; the flag decides whether a
  // VERDICT may be drawn from it.
  const ledger = buildLedger(supplierId, invoices, payments, sup?.opening_balance ?? 0);
  return {
    ourBalance:         round2(ledger.closingBalance),
    paymentArrangement: !!sup?.payment_arrangement,
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
    /** Gmail access token — absent on the camera-capture path, which has no
     *  mailbox to ask about (the sender there is the person holding the phone). */
    token?:      string;
  },
): Promise<boolean> {
  // Returns true when the document was fully handled (DB row written, or
  // deliberately escalated to the user via an alert) — the caller may then label
  // the email processed. Returns false ONLY when a DB write (insert/update/read)
  // errored, so the caller leaves the email unlabeled for the next run to retry.
  // Non-invoice docs are NOT uploaded to Drive — they are viewable via the
  // Gmail message link stored on the row.

  // Supplier link key (spec/06-RULES.md §2b): business number (ח.פ) is the PRIMARY
  // join key; fuzzy NAME is only a secondary fallback when hp is missing/unmatched.
  //
  // Used by the delivery-note and credit-note paths ONLY. Statements deliberately do
  // NOT come here — they use resolveStatementSupplier, which widens the chain to the
  // sending address and, critically, never CREATES a supplier. See that function for
  // why auto-creation is right for a delivery note and wrong for a כרטסת.
  const resolveSupplier = async (vendorName: string, hp = ""): Promise<string | null> => {
    const normHp = normalizeHp(hp);
    // 1. PRIMARY — ח.פ exact match (authoritative across name-spelling differences).
    let matched: SupplierRow | null = normHp
      ? (suppliers.find(s => normalizeHp(s.hp) === normHp) ?? null)
      : null;
    // 2. NAME-FALLBACK (secondary) — used ONLY when hp gave no match.
    if (!matched && vendorName) matched = findBestSupplier(vendorName, suppliers);
    if (matched) return matched.id;
    if (!vendorName) return null;
    const { data: created, error: supErr } = await supabase
      .from("suppliers").insert({ name: vendorName, hp: normHp || null }).select("id").single();
    if (supErr) {
      await log("error", `supplier insert failed: ${supErr.message}`, undefined, msgId);
      return null;
    }
    const id = created!.id as string;
    suppliers.push({ id, name: vendorName, category: null, hp: normHp || null });
    await log("info", `created new supplier ${id}`, { name: vendorName, hp: normHp || null }, msgId);
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
    // ח.פ FIRST, name as the fallback — `resolveSupplier` has always supported that
    // order (spec/06-RULES.md §2b); what was missing was the number itself, because
    // the delivery-note prompt never asked for it, so every note linked by NAME alone.
    // Name matching is fragile across spelling and whitespace, and a wrong link here
    // attaches goods to the wrong supplier's balance.
    const supplierId = await resolveSupplier(extracted.vendor_name, extracted.hp);

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

    // A report-style delivery note put a barcode where the total belongs and
    // Postgres rejected the row (22003), which kept the whole email out. The
    // figure is dropped, the note is filed, and the alert below says which.
    const money = storableAmounts({
      amount:            extracted.amount,
      amount_before_vat: extracted.amount_before_vat,
      vat_amount:        extracted.vat_amount,
    });

    const { error } = await supabase.from("delivery_notes").insert({
      supplier_id:       supplierId,
      supplier_name:     extracted.vendor_name,
      note_number:       extracted.note_number,
      date:              extracted.date || null,
      ...money.values,
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
    if (money.dropped.length > 0) {
      await log("warn", "delivery_note amount was not storable — filed without it",
        { dropped: money.dropped, filename: ctx.doc.filename }, msgId);
      await insertAlertOnce(supabase, log, msgId, {
        type:    "delivery_note_amount_unreadable",
        title:   "סכום לא נקרא בתעודת משלוח — דורש בדיקה",
        message: `התעודה נקלטה, אך הסכום שנקרא ממנה אינו סכום אפשרי והושאר ריק. ` +
                 `ספק: ${extracted.vendor_name || "—"}. קובץ: ${ctx.doc.filename}.`,
        payload: {
          gmailMessageId: msgId,
          supplierId,
          noteNumber: extracted.note_number,
          fields:     money.dropped,
          filename:   ctx.doc.filename,
        },
      }, ["noteNumber"]);
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
    // NAME-FALLBACK: extractReturn (credit note) does not capture ח.פ yet, so this
    // links by name only. Add `hp` to the credit-note prompt + pass it here for hp-primary.
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
          // An UNMATCHED credit note never reaches a `returns` row, so the alert
          // payload is the only place its sending address can live. (A MATCHED one
          // now persists it on the row itself — `returns.email_sender`,
          // migration 20260802010000.)
          senderEmail:      ctx.from || null,
          subject:          ctx.subject,
          messageLink:      ctx.messageLink,
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
        email_sender:                ctx.from || null,
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
    // statement — uploaded to Storage only; no Drive upload (Storage-only is by
    // design for non-invoice docs; the file is viewable via a signed URL in the UI).
    //
    // Every line this branch writes is tagged `[כרטסת]` + context.docType, so the
    // owner can tell on the לוגי מערכת screen which run a line belongs to.
    const slog = makeLogger(supabase, STATEMENT_LOG_TAG);

    // Extraction failure must NEVER block the save — the statement file is valuable
    // on its own and the user can set the supplier during review — so the error is
    // swallowed and identification carries on WITHOUT the document's own fields
    // (the subject and the sender may still identify the supplier).
    //
    // It must, however, be LOUD: a failure here means `vendor_balance` is unknown,
    // and an unknown balance that is silently filed as 0 shows the owner a fake gap
    // the size of the whole ledger. So the row is saved with vendor_balance = NULL,
    // status `needs_review`, and a `statement_extract_failed` alert.
    const senderAddress = extractEmailAddress(ctx.from);
    let extracted: ExtractedStatement | null = null;
    let extractError: string | null = null;
    try {
      extracted = await extractStatement(ctx.doc, slog, msgId);
      await slog("info", "statement extracted", {
        vendor: extracted.vendor_name, hp: extracted.hp || null,
        closingBalance: extracted.closing_balance, period: extracted.period || null,
      }, msgId);
    } catch (e) {
      extractError = e instanceof Error ? e.message : String(e);
      await slog("error",
        `פענוח הכרטסת נכשל — היתרה לפי הספק אינה ידועה: ${extractError}`,
        { filename: ctx.doc.filename, subject: ctx.subject }, msgId);
    }

    const { supplierId, method: matchMethod } = await resolveStatementSupplier(
      supabase, slog, msgId, suppliers, {
        hp:            extracted?.hp ?? "",
        vendorName:    extracted?.vendor_name ?? "",
        customerName:  extracted?.customer_name ?? "",
          subject:       ctx.subject ?? "",
        senderAddress,
        ingestMailbox: ctx.token ? await getIngestMailbox(ctx.token, slog, msgId) : null,
      },
    );

    let storagePath = "";
    try {
      const storageKey = buildStorageKey(
        "statement", supplierId, null, msgId,
        pickExtension(ctx.doc.filename, ctx.doc.mimeType),
      );
      storagePath = await uploadToStorage(
        supabase, "statements", new Date(ctx.emailTs),
        storageKey, ctx.doc.mimeType, ctx.doc.bytes,
      );
      await slog("info", "statement uploaded to Storage", { storagePath }, msgId);
    } catch (e) {
      await slog("error", `Storage upload failed: ${e instanceof Error ? e.message : e}`,
        { filename: ctx.doc.filename }, msgId);
    }

    // vendor_statements schema has no email_subject / message_link /
    // gmail_message_id / received_at columns — only supplier_id, status,
    // storage_url, drive_file_link, email_sender, match_method, and `month`
    // (NOT NULL, no default).
    //
    // `month` is a text column rendered as-is in the UI. It now takes the
    // statement's OWN period when the document states one, and only falls back to
    // the email-received month when it doesn't — a כרטסת for June routinely arrives
    // in July, and the old fallback filed every one of them under the wrong month.
    const statementMonth = extracted?.period || ctx.emailTs.slice(0, 7);
    // `vendor_balance` is NULLABLE as of migration 20260818000000, and an unknown
    // closing balance is written as NULL — never coerced to 0. The screen renders
    // `—` for null (comparableRow in StatementReconciliation.tsx) instead of
    // inventing a ₪0 vendor balance and a gap the size of the whole ledger.
    const vendorBalance = extracted?.closing_balance ?? null;

    // ── Reconcile on arrival (01-PRD §7) ──────────────────────────────────────
    // Only possible when we know BOTH sides: which supplier, and what they say the
    // balance is. Missing either → today's behaviour, `needs_review` and NO gap
    // alert (there is nothing to compare, and an alert would be a false positive).
    let ourBalance: number | null = null;
    let diff:       number | null = null;
    let status = "needs_review";
    let paymentArrangement = false;
    if (supplierId && vendorBalance !== null) {
      const ledger = await computeStatementLedger(supabase, slog, msgId, supplierId);
      if (ledger) {
        ourBalance         = ledger.ourBalance;
        diff               = statementDiff(ourBalance, vendorBalance);
        paymentArrangement = ledger.paymentArrangement;
        // A supplier marked בהסדר תשלום is the ONE case with no honest verdict.
        // The flag means "מוחרג ממעקב יתרה" — the owner has deliberately stopped
        // tracking what this supplier is owed — so we file the TRUE ledger figure
        // as the arrival record and draw no verdict and no alert. Settled, not
        // pending: spec/01-PRD.md §7. The reconciliation screen does the same.
        if (paymentArrangement) {
          await slog("info",
            "statement supplier is on a payment arrangement — recording balances, no automatic verdict",
            { supplierId, ourBalance, vendorBalance, diff }, msgId);
        } else {
          // One rule for the whole system — see `statementVerdict` in the engine.
          status = statementVerdict(ourBalance, vendorBalance) ?? status;
        }
      }
    }

    const { data: inserted, error } = await supabase.from("vendor_statements").insert({
      supplier_id:     supplierId,
      status,
      storage_url:     storagePath || null,
      drive_file_link: null,
      month:           statementMonth,
      // NULL, never 0, when the balance is unknown — see the comment on vendorBalance.
      vendor_balance:  vendorBalance,
      // A RECORD OF THE FILING DATE ONLY. spec/06-RULES.md §9: this column is never
      // read back for display — every screen recomputes the balance live from the
      // same engine — so writing it here can never put a stale figure on screen.
      our_balance:     ourBalance ?? 0,
      diff:            diff ?? 0,
      email_sender:    ctx.from || null,
      match_method:    matchMethod,
    }).select("id").single();
    if (error || !inserted) {
      // Only log/alert FAILURE on a real error — never log "recorded" for a row
      // that didn't persist.
      await slog("error", `vendor_statements insert failed: ${error?.message}`, { code: error?.code }, msgId);
      await insertAlertOnce(supabase, slog, msgId, {
        type:    "statement_save_failed",
        title:   "שמירת כרטסת נכשלה",
        message: `לא ניתן היה לשמור כרטסת מהמייל "${ctx.subject}". יש לבדוק ידנית.`,
        payload: { gmailMessageId: msgId, subject: ctx.subject, filename: ctx.doc.filename, error: error?.message, storagePath: storagePath || null },
      });
      return false; // DB write failed — leave email for retry
    }

    const statementId = String(inserted.id);

    // The row saved, but WITHOUT the one number the whole reconciliation turns on.
    // Raised only after a successful insert (a failed insert has its own alert and
    // requeues the email). The payload points at the SOURCE EMAIL, not at a row:
    // opening a statement whose fields are all empty tells the owner nothing — the
    // document itself is what has to be looked at. Mutually exclusive with
    // `statement_mismatch` below, which requires a known vendorBalance.
    if (extractError) {
      await insertAlertOnce(supabase, slog, msgId, {
        type:    "statement_extract_failed",
        title:   "פענוח כרטסת נכשל — היתרה לא נקראה",
        message: `לא הצלחנו לקרוא את יתרת הסגירה מהכרטסת שהגיעה במייל "${ctx.subject}". ` +
                 `הכרטסת נשמרה ללא יתרה לפי הספק ואינה מושווית — יש לפתוח את המסמך ולהזין את היתרה ידנית.`,
        payload: {
          gmailMessageId: msgId,
          subject:        ctx.subject,
          senderEmail:    ctx.from || null,
          messageLink:    ctx.messageLink,      // routing key — opens the source email
          filename:       ctx.doc.filename,
          storagePath:    storagePath || null,
          month:          statementMonth,
          matchMethod,
          error:          extractError.slice(0, 300),
        },
      });
    }

    if (status === "mismatch") {
      const supplierName =
        suppliers.find((s) => s.id === supplierId)?.name || extracted?.vendor_name || "ספק לא מזוהה";
      // dedupKeys=["statementId"] so two statements riding ONE email each raise
      // their own alert instead of the second being suppressed.
      await insertAlertOnce(supabase, slog, msgId, {
        type:    "statement_mismatch",
        title:   "אי-התאמה בכרטסת",
        message: `אי-התאמה בכרטסת ${statementMonth} מול ${supplierName}: ` +
                 `יתרה לפי הספק ${vendorBalance}, היתרה לפי הספרים שלנו ${ourBalance}, הפרש ${diff}.`,
        payload: {
          gmailMessageId: msgId,
          statementId,                       // routing key — opens the statement (Alerts.tsx)
          supplierId,
          typedSupplierName: supplierName,
          vendorBalance, ourBalance, diff,
          month:          statementMonth,
          matchMethod,
          senderEmail:    ctx.from || null,
          subject:        ctx.subject,
          messageLink:    ctx.messageLink,
          storagePath:    storagePath || null,
        },
      }, ["statementId"]);
    }

    await slog("info", "statement recorded", {
      statementId, storagePath, month: statementMonth, supplierId, matchMethod,
      vendorBalance, ourBalance, diff, status, paymentArrangement,
      extractFailed: !!extractError,
    }, msgId);
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

  // Authoritative type from the bytes' magic numbers (same rule the email path
  // uses) — a wrong declared type would 400 the Anthropic call. PDFs must be sent
  // as a document block, not an image block: resolve them to application/pdf here
  // so buildDocumentBlock takes the document branch.
  const isPdf = sniffFileType(bytes) === "pdf";
  const mimeType = isPdf
    ? "application/pdf"
    : (sniffImageMediaType(bytes) ?? (body.mimeType?.startsWith("image/") ? body.mimeType : "image/jpeg"));
  if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
    return json({ error: "capture must be an image (jpeg/png) or a PDF" }, 400);
  }
  const filename = body.filename
    || `capture.${isPdf ? "pdf" : mimeType === "image/png" ? "png" : "jpg"}`;

  // ── Synthesize the Gmail-shaped context the shared functions expect ──
  const captureId   = "capture-" + crypto.randomUUID(); // plays the role of msgId
  const nowIso      = new Date().toISOString();
  const from        = body.capturedBy || "צילום מהאפליקציה";
  const subject     = `צילום ידני — ${CAPTURE_TYPE_LABEL[docType]}`;
  const managerEmail = Deno.env.get("GMAIL_USER_EMAIL") ?? "";
  const approvalThreshold = await loadApprovalThreshold(supabase, log);

  await log("info", "capture received", { docType, filename, bytes: bytes.length, from }, captureId);

  // Google token (for Drive — generic OAuth, not Gmail-specific) + reference data.
  const token = await getGoogleAccessToken();
  const { data: supplierRows } = await supabase.from("suppliers").select("id, name, category, hp, alt_names, email");
  const suppliers: SupplierRow[] = supplierRows ?? [];
  const { data: catRows } = await supabase.from("categories").select("name");
  const categoryNames: string[] = (catRows ?? []).map((r: { name: string }) => r.name);

  const result: IngestResult = { processed: 0, alerts: 0, skipped: 0, errors: [], ts: nowIso };
  const doc = { mimeType, filename, bytes };

  try {
    if (docType === "invoice") {
      const file: UsableFile = {
        attachmentId: captureId, filename, mimeType, bytes, format: isPdf ? "pdf" : "image", size: bytes.length,
      };
      const ctx: InvoiceFileCtx = {
        token, msgId: captureId, subject, from, emailTs: nowIso,
        messageLink: "", labelIds: [], partialRefundLabelId: null,
        managerEmail, approvalThreshold, suppliers, categoryNames, isCreditNote: false,
        labelSource: CAPTURE_LABEL_SOURCE,
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HADAS_SERVICE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Drain the request body BEFORE auth. The camera path uploads a multi-MB
  // base64 image; running the JWT auth round-trips (getUser/allowed_users)
  // before the body is read stalls the upload and hangs the request. Read
  // first, THEN authorize — auth still runs and still rejects before any
  // document is processed or written (handleCapture is downstream of the check).
  let body: unknown = null;
  if (req.method === "POST") {
    try { body = await req.json(); } catch { body = null; }
  }

  if (!(await isAuthorized(req, supabase))) return json({ error: "Unauthorized" }, 401);

  // Camera-capture path: a POST with { source: "camera", ... }. Anything else
  // (the cron tick / manual trigger) falls through to the Gmail pull below.
  if (body && typeof body === "object" && (body as { source?: string }).source === "camera") {
    try {
      return await handleCapture(supabase, body as CaptureRequest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try { await makeLogger(supabase)("error", `capture handler aborted: ${msg}`); } catch { /* self-guards */ }
      return json({ ok: false, error: msg }, 500);
    }
  }

  // Recovery path: a POST with { source: "requeue" }. Re-runs the emails parked
  // behind the "פענוח נכשל" label over a wider window than the routine tick uses.
  // Bounded to REQUEUE_MAX_MESSAGES per call and idempotent — anything that
  // succeeds gets the processed label and drops out, so calling again continues
  // with the next batch.
  const requeue = body && typeof body === "object" &&
    (body as { source?: string }).source === "requeue";

  try {
    const result = requeue
      ? await ingestInvoices(supabase, {
          requeueFailed:       true,
          requeueLookbackDays: Number((body as { days?: number }).days) || undefined,
        })
      : await ingestInvoices(supabase);
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
