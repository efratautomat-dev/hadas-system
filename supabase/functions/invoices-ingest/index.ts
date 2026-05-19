// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  invoices-ingest                                                         ║
// ║  Pulls unread invoice emails from Gmail, classifies them with Anthropic, ║
// ║  uploads the attachment to Drive, and writes a row into Postgres.        ║
// ║                                                                          ║
// ║  TEST MODE: listens on Gmail label "ספקים" (manually populated by user). ║
// ║  To switch to production, change SOURCE_LABEL_NAME to "חשבונית".         ║
// ╚══════════════════════════════════════════════════════════════════════════╝
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ────────────────────────────────────────────────────────────────

const SOURCE_LABEL_NAME = "ספקים"; // TEST: swap to "חשבונית" for production

const DEST_LABEL_NAMES = {
  processed:      "טופל",                  // generic "handled"
  invoice:        "הועבר לרוח",            // matches existing N8N convention
  deliveryNote:   "תעודות משלוח",
  statement:      "כרטסות",
  returnDoc:      "חזרות",
  needsReview:    "דורש בדיקה ידנית",
};

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
    console.log(line, context ? JSON.stringify(context) : "");
    try {
      await supabase.from("system_logs").insert({
        source:     "invoices-ingest",
        level,
        message,
        context:    context ?? null,
        message_id: messageId ?? null,
      });
    } catch (e) {
      console.error("[logger] DB insert failed:", e);
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
  partId?:      string;
  attachmentId: string;
  filename:     string;
  mimeType:     string;
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
      out.push({
        attachmentId: p.body.attachmentId,
        filename:     p.filename,
        mimeType:     p.mimeType || (isPdf ? "application/pdf" : "image/jpeg"),
      });
    }
  }
  return out;
}

// Pull every URL out of the body — we'll try to fetch each in turn.
function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'\)]+/g) ?? [];
  return [...new Set(matches)];
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
  // Force common image MIMEs into supported set
  const mt = mimeType.startsWith("image/") ? mimeType : "image/jpeg";
  return { type: "image", source: { type: "base64", media_type: mt, data } };
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

  const prompt = `אתה מנתח חשבוניות מומחה. חלץ את הפרטים הבאים מהחשבונית וחזור ב-JSON בלבד, ללא הסברים, ללא backticks.

מבנה החזרה:
{"vendor_name":"","invoice_number":"","invoice_date":"","total_amount":0,"amount_before_vat":0,"vat_amount":0,"currency":"ILS","category":"","line_items":[],"confidence":"high","missing_fields":[]}

כללים:
- תאריך בפורמט YYYY-MM-DD
- סכומים כמספרים בלבד ללא סימני מטבע
- confidence: high/medium/low לפי רמת הוודאות שלך
- missing_fields: רשימת שדות שלא מצאת
- line_items: רשימת פריטים כטקסט פשוט
- אם שם עסק מכיל גרשיים (כמו בע"מ), השתמש בגרשיים עבריים: בע״מ
- אם המסמך הוא חשבונית זיכוי (Credit Note / זיכוי / סכום שלילי) — החזר את הסכומים כשליליים

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

  const jsonStart = raw.indexOf("{");
  const jsonEnd   = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`Extractor returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  return {
    vendor_name:       String(parsed.vendor_name ?? ""),
    invoice_number:    String(parsed.invoice_number ?? ""),
    invoice_date:      String(parsed.invoice_date ?? ""),
    total_amount:      Number(parsed.total_amount ?? 0),
    amount_before_vat: Number(parsed.amount_before_vat ?? 0),
    vat_amount:        Number(parsed.vat_amount ?? 0),
    currency:          String(parsed.currency ?? "ILS"),
    category:          String(parsed.category ?? ""),
    line_items:        Array.isArray(parsed.line_items) ? parsed.line_items.map(String) : [],
    confidence:        (parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low")
                         ? parsed.confidence : "low",
    missing_fields:    Array.isArray(parsed.missing_fields) ? parsed.missing_fields.map(String) : [],
  };
}

// ─── "Is this a real invoice?" filter for multi-attachment cases ───────────

async function isAccountingAttachment(doc: { mimeType: string; bytes: Uint8Array }): Promise<boolean> {
  const text = await anthropicMessage(
    ANTHROPIC_MODEL_CLASSIFIER,
    [{
      role:    "user",
      content: [
        buildDocumentBlock(doc.mimeType, doc.bytes),
        { type: "text", text: "האם זה חשבונית/קבלה/מסמך חשבונאי? ענה רק כן או לא." },
      ],
    }],
    16,
  );
  return text.trim().startsWith("כן");
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

interface SupplierRow { id: string; name: string }

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

async function resolveAuxFolder(
  token: string,
  rootSubfolder: string,
  date: Date,
): Promise<string> {
  const root = await driveEnsureFolder(token, DRIVE_ROOT_ID, rootSubfolder);
  const year = await driveEnsureFolder(token, root, String(date.getUTCFullYear()));
  return year;
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
  const destProcessed   = await gmailEnsureLabel(token, DEST_LABEL_NAMES.processed);
  const destInvoice     = await gmailEnsureLabel(token, DEST_LABEL_NAMES.invoice);
  const destDelivery    = await gmailEnsureLabel(token, DEST_LABEL_NAMES.deliveryNote);
  const destStatement   = await gmailEnsureLabel(token, DEST_LABEL_NAMES.statement);
  const destReturn      = await gmailEnsureLabel(token, DEST_LABEL_NAMES.returnDoc);
  const destNeedsReview = await gmailEnsureLabel(token, DEST_LABEL_NAMES.needsReview);

  const destLabelByDocType: Record<Exclude<DocType, "skip" | "unknown">, string> = {
    invoice:        destInvoice,
    delivery_note:  destDelivery,
    statement:      destStatement,
    return_doc:     destReturn,
  };

  // Gmail query: source label, unread, not yet processed by N8N or by us, recent.
  const query =
    `label:"${SOURCE_LABEL_NAME}" is:unread ` +
    `-label:"הועבר לרוח" -label:"${DEST_LABEL_NAMES.processed}" newer_than:1M`;
  const messageIds = await gmailListMessages(token, query);
  await log("info", `found ${messageIds.length} candidate messages`, { query });

  if (messageIds.length === 0) return result;

  // Load suppliers + categories once
  const { data: supplierRows } = await supabase.from("suppliers").select("id, name");
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

      // 2. Find a usable attachment (PDF/image) — direct, or via inline URL
      const directAtt = findAttachments(message);
      let usableDoc: { mimeType: string; filename: string; bytes: Uint8Array } | null = null;

      if (directAtt.length === 1) {
        const a = directAtt[0];
        usableDoc = {
          mimeType: a.mimeType,
          filename: a.filename,
          bytes:    await gmailGetAttachment(token, msgId, a.attachmentId),
        };
      } else if (directAtt.length > 1) {
        // Multiple attachments — ask Haiku per attachment, keep "כן" ones
        const keep: typeof usableDoc[] = [];
        for (const a of directAtt) {
          const bytes = await gmailGetAttachment(token, msgId, a.attachmentId);
          if (await isAccountingAttachment({ mimeType: a.mimeType, bytes })) {
            keep.push({ mimeType: a.mimeType, filename: a.filename, bytes });
          }
        }
        if (keep.length === 0) {
          await log("warn", "multiple attachments but none looked accounting-relevant", undefined, msgId);
        } else {
          usableDoc = keep[0]!; // first matching — others would be repeated invoices in practice
          if (keep.length > 1) await log("info", `multi-attachment: kept ${keep.length}, using the first`, undefined, msgId);
        }
      }

      if (!usableDoc) {
        // Try inline URLs
        const urls = extractUrls(bodyText);
        for (const url of urls) {
          try {
            const fetched = await fetch(url, { redirect: "follow" });
            const mt = (fetched.headers.get("content-type") ?? "").toLowerCase();
            if (mt.includes("text/html")) {
              // Login wall
              await log("warn", "inline link returned HTML — likely password-protected", { url }, msgId);
              await supabase.from("alerts").insert({
                type: "invoice_locked_link",
                title: "חשבונית דורשת סיסמה",
                message: `המייל "${subject}" מכיל קישור שמחייב התחברות. נא להוריד ידנית.`,
                payload: { gmailMessageId: msgId, subject, from, messageLink, lockedUrl: url },
                status: "unread",
              });
              if (managerEmail) {
                await gmailSendAlertEmail(token, managerEmail,
                  "חשבונית דורשת סיסמה",
                  `קישור: ${url}\nמייל: ${messageLink}\nנושא: ${subject}`);
              }
              usableDoc = null;
              break;
            }
            if (mt.includes("pdf") || mt.startsWith("image/")) {
              const buf = new Uint8Array(await fetched.arrayBuffer());
              usableDoc = {
                mimeType: mt.includes("pdf") ? "application/pdf" : mt,
                filename: url.split("/").pop()?.split("?")[0] || (mt.includes("pdf") ? "invoice.pdf" : "invoice.jpg"),
                bytes:    buf,
              };
              break;
            }
          } catch (e) {
            await log("debug", `inline URL fetch failed: ${e instanceof Error ? e.message : e}`, { url }, msgId);
          }
        }
      }

      if (!usableDoc) {
        await log("warn", "no usable attachment", undefined, msgId);
        await supabase.from("alerts").insert({
          type: "invoice_no_attachment",
          title: "מייל ללא קובץ מצורף",
          message: `במייל "${subject}" לא נמצא קובץ PDF/תמונה. יש לבדוק ידנית.`,
          payload: { gmailMessageId: msgId, subject, from, messageLink },
          status: "unread",
        });
        await gmailModifyLabels(token, msgId, [destNeedsReview, destProcessed], [sourceLabelId, "UNREAD"]);
        result.alerts++;
        continue;
      }

      // 3. Branch by docType
      if (docType !== "invoice") {
        // Other doc types — save to dedicated folder + matching table (stubbed)
        await handleNonInvoice(supabase, token, log, msgId, {
          docType,
          subject,
          from,
          emailTs,
          messageLink,
          doc:           usableDoc,
        });

        await gmailModifyLabels(token, msgId, [destLabelByDocType[docType], destProcessed], [sourceLabelId, "UNREAD"]);
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

      let supplierId: string | null = matched?.id ?? null;
      let isNewSupplier = false;
      if (!supplierId && extracted.vendor_name) {
        // create a placeholder supplier — mark is_new for downstream review
        const { data: created, error: supErr } = await supabase
          .from("suppliers")
          .insert({ name: extracted.vendor_name })
          .select("id")
          .single();
        if (supErr) {
          await log("error", `supplier insert failed: ${supErr.message}`, undefined, msgId);
        } else {
          supplierId    = created!.id as string;
          isNewSupplier = true;
          suppliers.push({ id: supplierId, name: extracted.vendor_name });
          await log("info", `created new supplier ${supplierId}`, { name: extracted.vendor_name }, msgId);
        }
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

      // f. Partial return flag
      const partialReturn = subject.includes("החזר חלקי") || subject.includes("partial return");

      // g+h. Resolve Drive folder and upload
      let driveFileLink   = "";
      let monthFolderLink = "";
      try {
        const target = await resolveInvoiceFolder(token, extracted.invoice_date || new Date().toISOString().slice(0, 10), partialReturn);
        const uploaded = await driveUploadFile(
          token,
          target.fileFolderId,
          usableDoc.filename,
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

      // j. Insert invoice row
      const insertRow: Record<string, unknown> = {
        supplier_id:        supplierId,
        supplier_name:      extracted.vendor_name,
        invoice_number:     extracted.invoice_number,
        invoice_date:       extracted.invoice_date || null,
        total_amount:       extracted.total_amount,
        amount_before_vat:  extracted.amount_before_vat,
        vat_amount:         extracted.vat_amount,
        category:           extracted.category,
        line_items:         extracted.line_items.join("\n"),
        ai_confidence:      extracted.confidence,
        status:             extracted.confidence === "low" ? "needs_review" : "ממתין",
        is_duplicate:       isDuplicate,
        has_error:          false,
        partial_return:     partialReturn,
        drive_file_link:    driveFileLink,
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

      // k. Update supplier_categories + categories usage
      if (supplierId && extracted.category) {
        await supabase.rpc("noop").catch(() => {});
        // Upsert supplier_categories
        const { data: existingSc } = await supabase
          .from("supplier_categories")
          .select("id, usage_count")
          .eq("supplier_id", supplierId)
          .eq("category", extracted.category)
          .maybeSingle();
        if (existingSc) {
          await supabase
            .from("supplier_categories")
            .update({ usage_count: (existingSc.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
            .eq("id", existingSc.id);
        } else {
          await supabase
            .from("supplier_categories")
            .insert({ supplier_id: supplierId, category: extracted.category, usage_count: 1 });
        }

        // Bump category usage_count (creating row if new)
        if (!categoryNames.includes(extracted.category)) {
          await supabase.from("categories").insert({ name: extracted.category, usage_count: 1 });
          categoryNames.push(extracted.category);
        } else {
          const { data: cat } = await supabase
            .from("categories")
            .select("usage_count")
            .eq("name", extracted.category)
            .single();
          if (cat) {
            await supabase
              .from("categories")
              .update({ usage_count: (cat.usage_count ?? 0) + 1 })
              .eq("name", extracted.category);
          }
        }
      }

      // 5. Apply Gmail labels — destination + processed, remove source
      await gmailModifyLabels(token, msgId, [destInvoice, destProcessed], [sourceLabelId, "UNREAD"]);

      await log("info", "invoice ingested", { supplierId, isNewSupplier, isDuplicate, category: extracted.category }, msgId);
      result.processed++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log("error", `unhandled exception: ${msg}`, undefined, msgId);
      result.errors.push(`Error processing ${msgId}: ${msg}`);
    }
  }

  return result;
}

// ─── Non-invoice doc handlers ──────────────────────────────────────────────

async function handleNonInvoice(
  supabase: SupabaseClient,
  token:    string,
  log:      Logger,
  msgId:    string,
  ctx: {
    docType:     Exclude<DocType, "invoice" | "skip" | "unknown">;
    subject:     string;
    from:        string;
    emailTs:     string;
    messageLink: string;
    doc:         { mimeType: string; filename: string; bytes: Uint8Array };
  },
): Promise<void> {
  const date = new Date(ctx.emailTs);
  const subRoot =
    ctx.docType === "delivery_note" ? DRIVE_SUBFOLDERS.deliveryNote :
    ctx.docType === "statement"     ? DRIVE_SUBFOLDERS.statement    :
                                       DRIVE_SUBFOLDERS.returnDoc;

  const yearFolderId = await resolveAuxFolder(token, subRoot, date);
  const uploaded     = await driveUploadFile(token, yearFolderId, ctx.doc.filename, ctx.doc.mimeType, ctx.doc.bytes);
  const folderLink   = await driveGetFolderLink(token, yearFolderId);

  // TODO: Match the document to an existing supplier / linked invoice and write
  //       a proper row into delivery_notes / vendor_statements / returns.
  //       For now we just stash metadata so manual review can pick it up.
  const tableByType: Record<typeof ctx.docType, string> = {
    delivery_note: "delivery_notes",
    statement:     "vendor_statements",
    return_doc:    "returns",
  };
  const table = tableByType[ctx.docType];

  try {
    await supabase.from(table).insert({
      // Common fields likely present in those tables; if a column doesn't exist
      // the insert will fail with 42703 and we'll see it in logs.
      drive_file_link:  uploaded.webViewLink,
      folder_link:      folderLink,
      message_link:     ctx.messageLink,
      gmail_message_id: msgId,
      email_subject:    ctx.subject,
      received_at:      ctx.emailTs,
      status:           "needs_review",
    });
  } catch (e) {
    await log("warn", `${table} insert failed (likely schema mismatch — TODO matcher): ${e instanceof Error ? e.message : e}`, undefined, msgId);
  }

  await log("info", `${ctx.docType} stored in Drive (matcher pending)`, { fileId: uploaded.id }, msgId);
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
    return json({ error: msg }, 500);
  }
});
