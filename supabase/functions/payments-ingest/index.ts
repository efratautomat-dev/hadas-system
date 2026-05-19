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

function isAuthorized(req: Request): boolean {
  const key = req.headers.get("x-hadas-key");
  const expected = Deno.env.get("HADAS_API_KEY");
  console.log("expected:", JSON.stringify(expected));
  console.log("got:", JSON.stringify(key));
  console.log("match:", key === expected);
  return !!expected && key === expected;
}

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

function normalizeBizboxType(raw: string): string {
  const t = raw.trim();
  if ((BIZBOX_TYPES as readonly string[]).includes(t)) return t;
  return LEGACY_TYPE_MAP[t] ?? "אחר";
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

// Returns the value after the first matching keyword on any line.
// Strips leading separators (colon, dash, en-dash, whitespace).
function extractField(lines: string[], ...keywords: string[]): string | null {
  for (const line of lines) {
    for (const kw of keywords) {
      const idx = line.indexOf(kw);
      if (idx === -1) continue;
      const after = line.slice(idx + kw.length).replace(/^[\s:–\-]+/, "").replace(/\*+$/, "").replace(/^\*+/, "").trim();
      if (after) return after;
    }
  }
  return null;
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
  // Normalise HTML to plain text
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const supplier   = extractField(lines, "ספק");
  const amountRaw  = extractField(lines, "סכום");
  const typeRaw    = extractField(lines, "סוג תשלום");
  const payDateRaw = extractField(lines, "תאריך תשלום");
  const valDateRaw = extractField(lines, "תאריך ערך");
  const refRaw     = extractField(lines, "אסמכתא");
  const notesRaw   = extractField(lines, "הערות");

  if (!supplier || !amountRaw || !typeRaw || !payDateRaw) return null;

  const amount = parseFloat(amountRaw.replace(/[,\s₪]/g, ""));
  if (isNaN(amount)) return null;

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
): Promise<IngestResult> {
  const result: IngestResult = {
    processed: 0,
    alerts:    0,
    skipped:   0,
    errors:    [],
    ts:        new Date().toISOString(),
  };

  const token = await getGmailAccessToken();
  console.log("[ingest] gmail token OK");

  const processedLabelId = await getLabelId(token, "תשלומים שנקלטו");
  console.log("[ingest] processedLabelId:", processedLabelId);

  // Fetch unread payment emails not yet tagged as processed
  const query =
    'to:h8420785+payments@gmail.com label:unread -label:"תשלומים שנקלטו"';
  const messageIds = await listMessageIds(token, query);

  console.log("[ingest] messageIds found:", messageIds.length, messageIds);

  if (messageIds.length === 0) {
    console.log("[ingest] no unread messages — done");
    return result;
  }

  const { data: supplierRows } = await supabase
    .from("suppliers")
    .select("id, name");
  const suppliers: SupplierRow[] = supplierRows ?? [];

  for (const msgId of messageIds) {
    try {
      console.log(`[msg ${msgId}] processing`);

      // Idempotency: skip if already ingested
      const { data: dup } = await supabase
        .from("payments")
        .select("id")
        .eq("source_message_id", msgId)
        .maybeSingle();

      if (dup) {
        console.log(`[msg ${msgId}] SKIP — already in payments table (id=${dup.id})`);
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
      console.log(`[msg ${msgId}] subject: "${subject}" | labels: ${JSON.stringify(labelIds)}`);

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
        console.log(`[msg ${msgId}] SKIP — parse failed. body (first 500 chars):`, body.slice(0, 500));
        result.errors.push(`Parse failed for message ${msgId}`);
        continue;
      }
      console.log(`[msg ${msgId}] parsed:`, JSON.stringify(parsed));

      const matched = findBestSupplier(parsed.supplier, suppliers);
      // Log top scores for every supplier to see why matching fails
      const scores = suppliers.map(s => ({ name: s.name, score: similarityScore(parsed.supplier, s.name) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      console.log(`[msg ${msgId}] supplier "${parsed.supplier}" — top matches:`, JSON.stringify(scores));
      console.log(`[msg ${msgId}] matched supplier:`, matched ? matched.name : "NONE");

      if (matched) {
        const { error: insErr } = await supabase.from("payments").insert({
          supplier_id:       matched.id,
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
            console.log(`[msg ${msgId}] SKIP — unique constraint (already inserted by concurrent run)`);
            result.skipped++;
          } else {
            console.log(`[msg ${msgId}] ERROR — DB insert failed:`, insErr.message);
            result.errors.push(
              `DB insert failed for ${msgId}: ${insErr.message}`,
            );
          }
          continue;
        }

        console.log(`[msg ${msgId}] DONE — payment created, applying label`);
        if (processedLabelId) {
          await modifyLabels(token, msgId, [processedLabelId], ["UNREAD"]);
        }
        result.processed++;
      } else {
        // Supplier not found — create alert and leave email unread
        const { error: alertErr } = await supabase.from("alerts").insert({
          type:    "supplier_not_found",
          title:   "ספק לא זוהה במייל תשלום",
          message: `המייל מתאריך ${emailFmt} מכיל תשלום עבור ספק '${parsed.supplier}' שלא נמצא במערכת. צור ספק חדש כדי לשייך את התשלום.`,
          payload: {
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
          console.log(`[msg ${msgId}] ERROR — alert insert failed: code=${alertErr.code} msg=${alertErr.message} details=${alertErr.details}`);
          result.errors.push(
            `Alert insert failed for ${msgId}: ${alertErr.message}`,
          );
        } else {
          console.log(`[msg ${msgId}] DONE — supplier_not_found alert created, applying label`);
          if (processedLabelId) {
            await modifyLabels(token, msgId, [processedLabelId], ["UNREAD"]);
          }
          result.alerts++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Error processing ${msgId}: ${msg}`);
    }
  }

  return result;
}

// ─── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("HADAS_SERVICE_KEY") ??
    "";
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const result = await ingestPayments(supabase);
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
