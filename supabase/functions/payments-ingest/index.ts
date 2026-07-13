import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ──────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
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

// ─── Auth ──────────────────────────────────────────────────────────────────────

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
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return false;
    const { data } = await supabase
      .from("allowed_users")
      .select("email")
      .eq("email", user.email)
      .maybeSingle();
    return !!data;
  }

  return false;
}

// ─── Logger (writes to system_logs + console) ──────────────────────────────────

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
        source:     "payments-ingest",
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

// ─── Gmail OAuth ───────────────────────────────────────────────────────────────

async function getGmailAccessToken(): Promise<string> {
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
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gmail token exchange failed: ${resp.status} ${text}`);
  }
  const data = await resp.json() as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`No access_token in response: ${data.error ?? "unknown"}`);
  }
  return data.access_token;
}

// ─── Gmail API helpers ─────────────────────────────────────────────────────────

interface GmailPart {
  mimeType: string;
  body: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  internalDate: string; // ms-since-epoch as string
  payload: GmailPart & {
    headers: Array<{ name: string; value: string }>;
  };
}

async function listMessageIds(token: string, query: string): Promise<string[]> {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
    `?q=${encodeURIComponent(query)}&maxResults=25`;
  console.log("[listMessages] query:", query);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`listMessages failed: ${resp.status} ${txt}`);
  }
  const data = await resp.json() as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };
  console.log("[listMessages] resultSizeEstimate:", data.resultSizeEstimate, "count:", (data.messages ?? []).length);
  return (data.messages ?? []).map((m) => m.id);
}

async function getMessage(token: string, id: string): Promise<GmailMessage> {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`getMessage ${id} failed: ${resp.status}`);
  return resp.json() as Promise<GmailMessage>;
}

async function getLabelId(
  token: string,
  labelName: string,
): Promise<string | null> {
  const resp = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/labels",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return null;
  const data = await resp.json() as {
    labels?: Array<{ id: string; name: string }>;
  };
  return data.labels?.find((l) => l.name === labelName)?.id ?? null;
}

async function modifyLabels(
  token: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<void> {
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    },
  );
}

// ─── Email body extraction ──────────────────────────────────────────────────────

function decodeBase64Url(s: string): string {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function extractBody(message: GmailMessage): string {
  const flat: GmailPart[] = [];
  function walk(p: GmailPart) {
    flat.push(p);
    p.parts?.forEach(walk);
  }
  walk(message.payload as GmailPart);

  const plain = flat.find(
    (p) => p.mimeType === "text/plain" && p.body?.data,
  );
  if (plain?.body.data) return decodeBase64Url(plain.body.data);

  const html = flat.find(
    (p) => p.mimeType === "text/html" && p.body?.data,
  );
  if (html?.body.data) return decodeBase64Url(html.body.data);

  if (message.payload.body?.data) {
    return decodeBase64Url(message.payload.body.data);
  }
  return "";
}

// ─── Email parser ──────────────────────────────────────────────────────────────

const BIZBOX_TYPES = [
  "צ'ק",
  "עמלה",
  "סליקה",
  "מזומן",
  "כרטיס אשראי",
  "הרשאה לחיוב חשבון",
  "העברה בנקאית",
  "הלוואה",
  "אחר",
] as const;

const LEGACY_TYPE_MAP: Record<string, string> = {
  transfer: "העברה בנקאית",
  check:    "צ'ק",
  cash:     "מזומן",
  credit:   "כרטיס אשראי",
  שיק:      "צ'ק",
  העברה:    "העברה בנקאית",
  אשראי:    "כרטיס אשראי",
};

// Collapse apostrophe variants (' ’ ‘ ʼ ׳ ` ´) to a single form so "צ'ק" matches
// regardless of which apostrophe the customer's keyboard/template produced.
function normalizeApostrophes(s: string): string {
  return s.replace(/['’‘ʼ׳`´]/g, "'");
}

function normalizeBizboxType(raw: string): string {
  const t  = raw.trim();
  const tn = normalizeApostrophes(t);
  // Match against the canonical list, comparing apostrophe-insensitively, and
  // return the canonical BIZBOX spelling (so the stored value is consistent).
  const canonical = BIZBOX_TYPES.find((b) => normalizeApostrophes(b) === tn);
  if (canonical) return canonical;
  return LEGACY_TYPE_MAP[t] ?? LEGACY_TYPE_MAP[tn] ?? "אחר";
}

function parseIsoDate(raw: string): string {
  const d = raw.trim();
  // DD/MM/YYYY or D/M/YYYY
  const dm = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dm) {
    return `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  }
  // YYYY-MM-DD passthrough
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return d;
}

// All field labels the template uses (incl. tolerated variants). Used both as
// search keywords and — critically — as boundaries: when a value spills onto the
// following line(s), collection stops at the next label so one field never
// swallows the next.
const ALL_LABELS = [
  "ספק",
  "סכום", "סך",
  "סוג תשלום", "סוג",
  "תאריך תשלום", "תאריך ערך",
  "אסמכתא",
  "הערות", "הערה",
];

// Strip emoji/pictographs (📌💰💳📅📆🔖📝🪷 …), markdown asterisks, and nbsp BEFORE
// matching, so labels/values glued to decorations are still found.
function stripDecorations(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/\*/g, "")
    .replace(/ /g, " ");
}

function startsWithKnownLabel(line: string): boolean {
  return ALL_LABELS.some((lbl) => line.startsWith(lbl));
}

// A line where a spilled value must STOP: another field label, a quote marker,
// a separator rule, or a forward/reply header (so forwarded headers and the
// quoted empty template below never leak into a value).
function isStopLine(line: string): boolean {
  if (!line) return true;
  if (startsWithKnownLabel(line)) return true;
  if (/^>/.test(line)) return true;
  if (/^-{3,}\s*$/.test(line)) return true;
  if (/forwarded message|הודעה שהועברה/i.test(line)) return true;
  if (/^(from|sent|to|subject|cc|bcc|date|מאת|נשלח|אל|נושא|תאריך|בתאריך)\s*:/i.test(line)) return true;
  return false;
}

// Find a field value, tolerating: value after a colon, value stuck directly to
// the label with no separator ("סכום5675"), or the label alone with the value on
// the following line(s). Returns the first NON-EMPTY value — so on a forwarded
// email the filled top template wins over a duplicated empty one below. Empty
// labels are skipped (not returned), so an all-blank template yields null.
function extractField(lines: string[], keywords: string[]): string | null {
  // Keyword priority dominates line order: a more-specific keyword (e.g. "סכום")
  // is searched across ALL lines before falling back to a variant (e.g. "סך").
  for (const kw of keywords) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const idx = line.indexOf(kw);
      if (idx === -1) continue;

      // a. value glued / colon-separated on the same line
      const after = line
        .slice(idx + kw.length)
        .replace(/^[\s:：=\-–—]+/, "")
        .trim();
      if (after) return after;

      // b. label alone → collect following line(s) up to the next boundary
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (isStopLine(lines[j])) break;
        collected.push(lines[j]);
      }
      const joined = collected.join(" ").trim();
      if (joined) return joined;
      // label present but empty here — keep scanning further occurrences
    }
  }
  return null;
}

// Extract the first number after a label, ignoring ₪ and thousands separators.
function parseAmount(raw: string): number | null {
  const m = raw.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

interface ParsedPayment {
  supplier:    string;
  amount:      number;
  paymentType: string;
  paymentDate: string;
  valueDate:   string | null;
  reference:   string;
  notes:       string;
}

function parseEmailBody(raw: string): ParsedPayment | null {
  // 1. Normalise HTML → plain text (block tags become line breaks so label/value
  //    pairs split across <p>/<div>/table cells don't get glued together).
  let text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // 2. Strip emoji + markdown decorations BEFORE matching.
  text = stripDecorations(text);

  // 3. Trim to non-empty lines.
  let lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // 4. Forwarded emails: the customer fills a fresh template at the TOP and the
  //    original (usually empty) template is quoted below a forward separator.
  //    Keep only the topmost template so the empty copy can't shadow it.
  const cutIdx = lines.findIndex((l) =>
    /forwarded message|הודעה שהועברה/i.test(l) || /^-{5,}\s*$/.test(l)
  );
  if (cutIdx > 0) lines = lines.slice(0, cutIdx);

  const supplier   = extractField(lines, ["ספק"]);
  const amountRaw  = extractField(lines, ["סכום", "סך"]);
  const typeRaw    = extractField(lines, ["סוג תשלום", "סוג"]);
  const payDateRaw = extractField(lines, ["תאריך תשלום"]);
  const valDateRaw = extractField(lines, ["תאריך ערך"]);
  const refRaw     = extractField(lines, ["אסמכתא"]);
  const notesRaw   = extractField(lines, ["הערות", "הערה"]);

  // Required fields — an empty template (e.g. an unfilled draft) fails here.
  if (!supplier || !amountRaw || !typeRaw || !payDateRaw) return null;

  const amount = parseAmount(amountRaw);
  if (amount === null) return null;

  return {
    supplier:    supplier.trim(),
    amount,
    paymentType: normalizeBizboxType(typeRaw),
    paymentDate: parseIsoDate(payDateRaw),
    valueDate:   valDateRaw ? parseIsoDate(valDateRaw) : null,
    reference:   refRaw?.trim() ?? "",
    notes:       notesRaw?.trim() ?? "",
  };
}

// ─── Fuzzy supplier matching ───────────────────────────────────────────────────

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "")              // Hebrew vowel diacritics
    .replace(/['"״׳`‘’“”]/g, "") // quote variants
    .replace(/[^א-תa-z0-9\s]/g, "")    // keep Hebrew, Latin alpha, digits, space
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarityScore(typed: string, stored: string): number {
  const na = normalizeForMatch(typed);
  const nb = normalizeForMatch(stored);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;

  const maxLen = Math.max(na.length, nb.length);
  const editScore = 1 - levenshtein(na, nb) / maxLen;

  const tokA  = new Set(na.split(" "));
  const tokB  = new Set(nb.split(" "));
  const inter = [...tokA].filter((t) => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const tokenScore = union > 0 ? inter / union : 0;

  // Containment bonus: typed name is a prefix/suffix of stored name
  const longEnough    = na.length >= 3 && nb.length >= 3;
  const containScore  = longEnough && (na.includes(nb) || nb.includes(na)) ? 0.9 : 0;

  return Math.max(editScore, tokenScore, containScore);
}

interface SupplierRow { id: string; name: string }

function findBestSupplier(
  typed: string,
  suppliers: SupplierRow[],
  threshold = 0.8,
): SupplierRow | null {
  let best: { row: SupplierRow; score: number } | null = null;
  for (const s of suppliers) {
    const score = similarityScore(typed, s.name);
    if (!best || score > best.score) best = { row: s, score };
  }
  return best && best.score >= threshold ? best.row : null;
}

// ─── Main ingest ───────────────────────────────────────────────────────────────

interface IngestResult {
  processed: number;
  alerts:    number;
  skipped:   number;
  errors:    string[];
  ts:        string;
}

async function ingestPayments(
  supabase: SupabaseClient,
  log: Logger,
): Promise<IngestResult> {
  const result: IngestResult = {
    processed: 0,
    alerts:    0,
    skipped:   0,
    errors:    [],
    ts:        new Date().toISOString(),
  };

  const token = await getGmailAccessToken();
  await log("debug", "gmail token OK");

  const processedLabelId = await getLabelId(token, "תשלומים שנקלטו");
  await log("debug", "resolved processed label", { processedLabelId });

  // Fetch payment emails not yet tagged as processed.
  // NOTE: `label:unread` was removed deliberately — a self-sent email is marked
  // read immediately (and filed under Sent), so requiring unread silently
  // excluded the very payment emails we need. Idempotency is enforced via the
  // `-label:"תשלומים שנקלטו"` filter plus the `source_message_id` dedupe below.
  const query =
    'to:h8420785+payments@gmail.com -label:"תשלומים שנקלטו"';
  const messageIds = await listMessageIds(token, query);

  await log("info", `found ${messageIds.length} messages`, { query, messageIds });

  if (messageIds.length === 0) {
    await log("info", "no messages to process — done");
    return result;
  }

  const { data: supplierRows } = await supabase
    .from("suppliers")
    .select("id, name");
  const suppliers: SupplierRow[] = supplierRows ?? [];
  await log("debug", `loaded ${suppliers.length} suppliers for matching`);

  for (const msgId of messageIds) {
    try {
      await log("debug", "processing message", undefined, msgId);

      // Idempotency: skip if already ingested. Use limit(1) + length, NOT
      // maybeSingle() — maybeSingle returns an ERROR (not data) when >1 row
      // matches, which, if its error is ignored, makes the check think the
      // message is new and re-insert forever once any duplicate exists.
      const { data: dupRows, error: dupErr } = await supabase
        .from("payments")
        .select("id")
        .eq("source_message_id", msgId)
        .limit(1);

      if (dupErr) {
        // Can't confirm the message isn't already in — skip rather than risk a
        // duplicate; the next run retries once the DB is reachable.
        await log("error", "dedup check failed — skipping to avoid duplicate",
          { code: dupErr.code, message: dupErr.message }, msgId);
        result.errors.push(`Dedup check failed for ${msgId}: ${dupErr.message}`);
        continue;
      }

      if (dupRows && dupRows.length > 0) {
        await log("info", `skip — already in payments table (id=${dupRows[0].id})`, undefined, msgId);
        if (processedLabelId) {
          await modifyLabels(token, msgId, [processedLabelId], ["UNREAD"]);
        }
        result.skipped++;
        continue;
      }

      const message  = await getMessage(token, msgId);

      // Log subject and labels for this message
      const subject = message.payload.headers.find(h => h.name.toLowerCase() === "subject")?.value ?? "(no subject)";
      const labelIds = (message as unknown as { labelIds?: string[] }).labelIds ?? [];
      await log("debug", "fetched message", { subject, labelIds }, msgId);

      const body     = extractBody(message);
      const emailTs  = new Date(parseInt(message.internalDate, 10)).toISOString();
      const emailFmt = new Date(parseInt(message.internalDate, 10))
        .toLocaleDateString("he-IL", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

      const parsed = parseEmailBody(body);
      if (!parsed) {
        await log("warn", "parse failed — not labeled, will retry next run",
          { bodyPreview: body.slice(0, 500) }, msgId);
        result.errors.push(`Parse failed for message ${msgId}`);
        continue;
      }
      await log("info", "parsed fields", { parsed }, msgId);

      const matched = findBestSupplier(parsed.supplier, suppliers);
      // Log top scores for every supplier to see why matching fails
      const scores = suppliers.map(s => ({ name: s.name, score: similarityScore(parsed.supplier, s.name) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      await log(
        matched ? "info" : "warn",
        matched ? `supplier matched: ${matched.name}` : `supplier NOT found for "${parsed.supplier}"`,
        { typed: parsed.supplier, matched: matched?.name ?? null, topScores: scores },
        msgId,
      );

      // Resolve the supplier: fuzzy match → exact-name dedupe → auto-create.
      // Mirrors invoices-ingest, which auto-creates a supplier rather than
      // blocking. Payment emails carry no ח.פ, so we create with NAME ONLY
      // (same as invoices' non-invoice path); the ח.פ / contact details are
      // filled in later via the "ספק חדש" alert raised below.
      let supplierId = matched?.id ?? null;
      let createdNewSupplier = false;

      if (!supplierId) {
        const typedName = parsed.supplier.trim();

        // Exact-name pre-check (case-insensitive) so we link to an existing
        // supplier the fuzzy matcher just missed instead of creating a
        // duplicate. ilike with the wildcards escaped == case-insensitive equals.
        const escaped = typedName.replace(/([\\%_])/g, "\\$1");
        const { data: exactRows } = await supabase
          .from("suppliers")
          .select("id, name")
          .ilike("name", escaped)
          .limit(1);
        const exact = exactRows?.[0] ?? null;

        if (exact) {
          supplierId = exact.id;
          suppliers.push({ id: exact.id, name: exact.name });
          await log("info", `supplier found by exact name (fuzzy missed): ${exact.name}`, undefined, msgId);
        } else {
          const { data: created, error: supErr } = await supabase
            .from("suppliers")
            .insert({ name: typedName })
            .select("id, name")
            .single();

          if (supErr) {
            // Unique-name race: another run created it first — read it back.
            if (supErr.code === "23505") {
              const { data: raceRows } = await supabase
                .from("suppliers")
                .select("id, name")
                .ilike("name", escaped)
                .limit(1);
              const raced = raceRows?.[0] ?? null;
              if (raced) {
                supplierId = raced.id;
                suppliers.push({ id: raced.id, name: raced.name });
                await log("info", `supplier created by concurrent run — linking to ${raced.id}`, undefined, msgId);
              }
            }
            if (!supplierId) {
              await log("error", "supplier auto-create failed — not labeled, will retry next run",
                { code: supErr.code, message: supErr.message, details: supErr.details, typedName }, msgId);
              result.errors.push(`Supplier create failed for ${msgId}: ${supErr.message}`);
              continue;
            }
          } else {
            supplierId         = created!.id as string;
            createdNewSupplier = true;
            suppliers.push({ id: supplierId, name: created!.name as string });
            await log("info", `created new supplier ${supplierId} (name only)`, { name: typedName }, msgId);
          }
        }
      }

      // Insert the payment linked to the matched / found / newly-created supplier.
      const { error: insErr } = await supabase.from("payments").insert({
        supplier_id:       supplierId,
        amount:            parsed.amount,
        payment_type:      parsed.paymentType,
        payment_date:      parsed.paymentDate,
        value_date:        parsed.valueDate,
        reference:         parsed.reference,
        notes:             parsed.notes,
        status:            "pending",
        source:            "email",
        email_received_at: emailTs,
        source_message_id: msgId,
      });

      if (insErr) {
        if (insErr.code === "23505") {
          await log("info", "skip — unique constraint (already inserted by concurrent run)", undefined, msgId);
          result.skipped++;
        } else {
          await log("error", "payment insert failed — not labeled, will retry next run",
            { code: insErr.code, message: insErr.message, details: insErr.details }, msgId);
          result.errors.push(
            `DB insert failed for ${msgId}: ${insErr.message}`,
          );
        }
        continue;
      }

      // For a brand-new supplier, raise a "complete details" alert so the missing
      // ח.פ / contact info can be filled in later. Non-fatal: the payment is
      // already inserted, so a failed alert must NOT block labeling or retry the
      // whole message (which the source_message_id unique index would skip anyway).
      if (createdNewSupplier) {
        const { error: alertErr } = await supabase.from("alerts").insert({
          type:    "supplier_incomplete",
          title:   "ספק חדש - השלימי פרטים",
          message: `המייל מתאריך ${emailFmt} יצר ספק חדש '${parsed.supplier}' מתוך תשלום. השלימי ח.פ ופרטי קשר.`,
          payload: {
            supplierId,
            typedSupplierName: parsed.supplier,
            gmailMessageId:    msgId,
            emailDate:         emailFmt,
            amount:            parsed.amount,
            paymentType:       parsed.paymentType,
            paymentDate:       parsed.paymentDate,
            valueDate:         parsed.valueDate,
            reference:         parsed.reference,
            notes:             parsed.notes,
            emailReceivedAt:   emailTs,
          },
          status: "unread",
        });
        if (alertErr) {
          await log("error", "supplier_incomplete alert insert failed (payment already inserted)",
            { code: alertErr.code, message: alertErr.message, details: alertErr.details }, msgId);
        } else {
          await log("info", "raised supplier_incomplete alert for new supplier", { supplierId }, msgId);
          result.alerts++;
        }
      }

      await log("info", "inserted payment — applying label",
        { supplierId, amount: parsed.amount, createdNewSupplier }, msgId);
      if (processedLabelId) {
        await modifyLabels(token, msgId, [processedLabelId], ["UNREAD"]);
      }
      result.processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log("error", `unhandled error processing message: ${msg}`, undefined, msgId);
      result.errors.push(`Error processing ${msgId}: ${msg}`);
    }
  }

  await log("info", "ingest run complete",
    { processed: result.processed, alerts: result.alerts, skipped: result.skipped, errors: result.errors.length });
  return result;
}

// ─── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("HADAS_SERVICE_KEY") ??
    "";
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const log = makeLogger(supabase);

  if (!(await isAuthorized(req, supabase))) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const result = await ingestPayments(supabase, log);
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Record top-level failures in system_logs too — the per-message catch only
    // covers individual messages, not setup (token, label, supplier load).
    await log("error", `ingest run aborted: ${msg}`);
    return json({ error: msg }, 500);
  }
});
