import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { resolveInvoiceFolder, driveMoveFile, driveGetFolderLink } from "../_shared/drive-filing.ts";
import { round2 } from "../_shared/vat.ts";
// The supplier ledger engine — byte-locked twin of src/lib/ledgerEngine.ts (see
// scripts/check-twins.mjs). Reconciling a statement here MUST use the same engine
// the screen and invoices-ingest use, or this function becomes a FOURTH copy of the
// balance rule — the exact failure spec/06-RULES.md §9 exists to prevent.
import { buildLedger, statementDiff, statementVerdict } from "../_shared/ledgerEngine.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hadas-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function validateKey(key: string | null): boolean {
  const expectedKey = Deno.env.get("HADAS_API_KEY");
  return !!expectedKey && key === expectedKey;
}

// ─── Google Drive ─────────────────────────────────────────────────────────────
// Same OAuth identity as invoices-ingest (project-wide secrets). That identity
// uploaded the invoice files to Drive, so it is authorized to trash them.

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

// Extracts the Drive file id from a stored webViewLink / open?id= / uc?id= URL.
function driveFileIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const m = link.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]+)/i);
  return m ? m[1] : null;
}

// Moves a Drive file to trash (recoverable for 30 days) rather than deleting
// permanently. 404 is treated as success — the file is already gone.
async function driveTrashFile(token: string, fileId: string): Promise<void> {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!resp.ok && resp.status !== 404)
    throw new Error(`drive trash failed: ${resp.status} ${await resp.text()}`);
}

// ─── Suppliers ────────────────────────────────────────────────────────────────
// Whitelist: id, name, hp, category, contact, email, phone, opening_balance, payment_arrangement, notes, alt_names, linked_invoices
// Excluded (no DB column): opening_balance_date, status, paymentTerms, lastOrderDate, balance

async function createSupplier(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const { name, hp, category, contact, email, phone, openingBalance, paymentArrangement, notes, force } = body;
  if (!name) return json({ error: "name is required" }, 400);

  // Gap #4 — dedup, surfaced to the UI (never silent). Unless `force` ("create anyway"),
  // check for an existing supplier by ח.פ then by fuzzy name. On a match, return it
  // (with name + hp) as { duplicate:true } WITHOUT creating or mutating — the UI asks the
  // user to "use existing" or "create anyway". (hp back-fill on confirm is the UI's job.)
  if (!force) {
    const normHp = normalizeHp(hp);
    const { data: existingRows } = await supabase.from("suppliers").select("id, name, hp");
    const suppliers = (existingRows ?? []) as SupplierMatchRow[];
    let dup: SupplierMatchRow | null =
      normHp ? (suppliers.find(s => normalizeHp(s.hp) === normHp) ?? null) : null;
    if (!dup) dup = findBestSupplierRow(name as string, suppliers);
    if (dup) {
      return json({ duplicate: true, existing: { id: dup.id, name: dup.name, hp: dup.hp } }, 200);
    }
  }

  const { data, error } = await supabase.from("suppliers")
    .insert({
      name,
      hp:              hp       ?? null,
      category:        category ?? null,
      contact:         contact  ?? null,
      email:           email    ?? null,
      phone:           phone    ?? null,
      opening_balance: openingBalance ?? 0,
      payment_arrangement: paymentArrangement ?? false,
      notes:           notes    ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return json({ error: error?.message }, 500);
  return json({ id: data.id }, 201);
}

async function updateSupplier(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const ALLOWED: Record<string, string> = {
    name:           "name",
    hp:             "hp",
    category:       "category",
    contact:        "contact",
    email:          "email",
    phone:          "phone",
    openingBalance: "opening_balance",
    paymentArrangement: "payment_arrangement",   // "בהסדר תשלום" flag — display-only balance exclusion (never mutates invoices/payments)
    notes:          "notes",
    active:         "active",   // active/inactive toggle (deactivation replaces hard delete)
    needsDetails:   "needs_details",   // PART 3C: completing details clears the flag
    needs_details:  "needs_details",
  };
  const updates: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(ALLOWED)) {
    if (body[key] !== undefined) updates[col] = body[key];
  }
  if (Object.keys(updates).length === 0) return json({ error: "No fields to update" }, 400);

  const { error } = await supabase.from("suppliers").update(updates).eq("id", id);
  if (error) return json({ error: error.message }, 500);

  // PART 3C: completing details (needs_details=false) resolves the supplier_incomplete
  // alert(s) for this supplier — same "resolved → hidden" super-rule as other alerts.
  if (body.needs_details === false || body.needsDetails === false) {
    await supabase.from("alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("type", "supplier_incomplete")
      .eq("payload->>supplierId", id)
      .neq("status", "resolved");
  }
  return json({ success: true });
}

async function deleteSupplier(supabase: SupabaseClient, id: string): Promise<Response> {
  // A supplier is FK-referenced (RESTRICT) by five tables. Deleting one that still
  // has ANY dependent row throws a raw Postgres FK error that the UI surfaces as a
  // generic "can't load data" — so check them ALL up front and name what blocks it.
  const DEPENDENTS: { table: string; label: string }[] = [
    { table: "invoices",          label: "חשבוניות" },
    { table: "payments",          label: "תשלומים" },
    { table: "returns",           label: "החזרות" },
    { table: "delivery_notes",    label: "תעודות משלוח" },
    { table: "vendor_statements", label: "דפי ספק" },
  ];
  const blocking: string[] = [];
  for (const dep of DEPENDENTS) {
    const { count } = await supabase.from(dep.table)
      .select("*", { count: "exact", head: true })
      .eq("supplier_id", id);
    if (count && count > 0) blocking.push(dep.label);
  }
  if (blocking.length > 0) {
    return json({
      error: `לספק יש ${blocking.join(", ")} - יש להעביר או למחוק אותם קודם`,
      code:  "HAS_DEPENDENTS",
      blocking,
    }, 409);
  }

  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// Merge two suppliers into one. `fromId` is REMOVED (deleted), `intoId` is KEPT.
// The actual mutation is the atomic merge_suppliers() Postgres function (one
// transaction, all-or-nothing) — this handler only validates, computes the preview
// counts, and (unless dryRun) invokes the RPC. Manager-only via the global role gate
// (POST /suppliers/merge is not in employeeMayAccess). See migration
// 20260720000000_merge_suppliers_rpc.sql.
async function mergeSuppliers(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const fromId = body.fromId as string;
  const intoId = body.intoId as string;
  const dryRun = body.dryRun === true;
  if (!fromId || !intoId || fromId === intoId)
    return json({ error: "fromId and intoId (distinct) are required" }, 400);

  const { data: from } = await supabase.from("suppliers").select("id, name, hp").eq("id", fromId).maybeSingle();
  const { data: into } = await supabase.from("suppliers").select("id, name, hp").eq("id", intoId).maybeSingle();
  if (!from || !into) return json({ error: "Supplier not found", code: "NOT_FOUND" }, 404);

  // Preview: how many rows would move (same head-count pattern as deleteSupplier).
  const TABLES = ["invoices", "payments", "returns", "delivery_notes", "vendor_statements", "supplier_categories"] as const;
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const { count } = await supabase.from(t).select("*", { count: "exact", head: true }).eq("supplier_id", fromId);
    counts[t] = count ?? 0;
  }
  const normHp = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const fromHp = normHp(from.hp), intoHp = normHp(into.hp);
  const hpCarryOver = !intoHp && !!fromHp;                          // kept card inherits removed card's ח.פ
  const hpConflict  = !!fromHp && !!intoHp && fromHp !== intoHp;    // different ח.פ → likely NOT the same vendor

  if (dryRun) {
    return json({
      preview: true,
      from: { id: from.id, name: from.name, hp: from.hp },
      into: { id: into.id, name: into.name, hp: into.hp },
      counts, hpCarryOver, hpConflict,
    });
  }

  const { data, error } = await supabase.rpc("merge_suppliers", { p_from: fromId, p_into: intoId });
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, into: { id: into.id, name: into.name }, moved: data });
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
// Accepts camelCase from the frontend AND snake_case from N8N/direct calls.
// Fields removed: date (display string), isPartialReturn, emailId, uploadDate,
//                 duplicateFlag, duplicateNote (no DB columns for these).

function invoiceToRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  // snake_case passthrough (N8N / direct API). Runs FIRST so the camelCase
  // mapping below can override it: a frontend edit ships BOTH representations —
  // the camelCase field the form mutates, plus the original snake_case key that
  // rides along from the row's ...r spread (see useInvoices load). The edited
  // frontend value must win, otherwise the update reverts to the stale value.
  const SNAKE = [
    "supplier_id", "supplier_name", "invoice_date", "invoice_number",
    "amount_before_vat", "vat_amount", "total_amount", "line_items",
    "sender_name", "email_sender", "drive_file_link", "drive_folder_link",
    "message_link", "received_at", "execution_log_url", "ai_confidence",
    "is_duplicate", "has_error", "status", "category",
    "invoice_type", "external_link", "error_reason", "html_content",
    "ai_missing_fields", "transferred_at", "notes",
  ];
  for (const col of SNAKE) {
    if (body[col] !== undefined) row[col] = body[col];
  }

  // camelCase → DB snake_case (frontend). Runs SECOND and wins over SNAKE.
  const CAMEL: Record<string, string> = {
    supplierId:        "supplier_id",
    supplier:          "supplier_name",
    invoiceDate:       "invoice_date",
    invoiceNumber:     "invoice_number",
    category:          "category",
    amountBeforeVat:   "amount_before_vat",
    vat:               "vat_amount",
    amount:            "total_amount",
    lineDetails:       "line_items",
    notes:             "notes",
    senderName:        "sender_name",
    senderEmail:       "email_sender",
    driveFileLink:     "drive_file_link",
    monthFolderLink:   "drive_folder_link",
    originalEmailLink: "message_link",
    emailReceivedAt:   "received_at",
    n8nErrorLink:      "execution_log_url",
    decodeQuality:     "ai_confidence",
    status:            "status",
    isDuplicate:       "is_duplicate",
    hasError:          "has_error",
  };
  for (const [fe, db] of Object.entries(CAMEL)) {
    if (body[fe] !== undefined) row[db] = body[fe];
  }

  // sentToAccountant boolean → transferred_at timestamp
  if (body.sentToAccountant !== undefined) {
    row.transferred_at = body.sentToAccountant ? new Date().toISOString() : null;
  }

  return row;
}

async function createInvoice(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  if (!body.supplier && !body.supplierId && !body.supplier_name && !body.supplier_id)
    return json({ error: "supplier is required" }, 400);

  const row = invoiceToRow(body);
  const { data, error } = await supabase.from("invoices").insert(row).select("id").single();
  if (error || !data) return json({ error: error?.message }, 500);
  return json({ id: data.id }, 201);
}

async function updateInvoice(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const row = invoiceToRow(body);
  if (Object.keys(row).length === 0) return json({ error: "No fields to update" }, 400);

  // When the invoice DATE changes, re-file the Drive copy into the correct
  // year/month folder using the SAME rules as ingest (../_shared/drive-filing),
  // and refresh the stored folder links. Best-effort: a Drive hiccup or missing
  // credentials must NEVER block the DB update (dev leaves GMAIL_* unset, so this
  // path is skipped there and verified in prod — see driveConfigured guard).
  let drive = "unchanged";
  if (row.invoice_date !== undefined) {
    const { data: cur } = await supabase
      .from("invoices")
      .select("invoice_date, drive_file_link, partial_return")
      .eq("id", id)
      .maybeSingle();

    const oldDate = String(cur?.invoice_date ?? "").slice(0, 10);
    const newDate = String(row.invoice_date ?? "").slice(0, 10);
    const fileId  = driveFileIdFromLink(cur?.drive_file_link ?? null);
    const driveConfigured = !!(
      Deno.env.get("GMAIL_CLIENT_ID") &&
      Deno.env.get("GMAIL_CLIENT_SECRET") &&
      Deno.env.get("GMAIL_REFRESH_TOKEN")
    );

    if (!newDate || newDate === oldDate) {
      drive = "unchanged";                 // date not actually changing → nothing to move
    } else if (!fileId) {
      drive = "skipped_no_file";           // manual invoice / no Drive copy to move
    } else if (!driveConfigured) {
      drive = "skipped_no_creds";          // dev: Drive unset → skip gracefully
    } else {
      try {
        const token   = await getGoogleAccessToken();
        const target  = await resolveInvoiceFolder(token, newDate, !!cur?.partial_return);
        await driveMoveFile(token, fileId, target.fileFolderId);
        const newLink = await driveGetFolderLink(token, target.monthFolderId);
        if (newLink) {
          // Mirror ingest: month_folder_link and drive_folder_link both point at
          // the (new) month folder.
          row.month_folder_link = newLink;
          row.drive_folder_link = newLink;
        } else {
          // The move succeeded but the folder-link lookup hiccupped (returned "").
          // Do NOT blank the columns — leave them at their prior value so the
          // invoice keeps showing a working link. (row.drive_folder_link keeps the
          // value the client round-tripped; month_folder_link is left untouched in
          // the DB by not adding it to `row`.)
          delete row.month_folder_link;
          delete row.drive_folder_link;
          console.warn("[updateInvoice] folder-link lookup empty after move — keeping prior link");
        }
        drive = "moved";
      } catch (e) {
        // Do NOT abort — a Drive failure must not strand the date edit.
        console.error("[updateInvoice] Drive re-file failed — skipping:", e instanceof Error ? e.message : e);
        drive = "move_failed";
      }
    }
  }

  const { error } = await supabase.from("invoices").update(row).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, drive });
}

/**
 * Clear the approval gate on one invoice.
 *
 * APPROVAL ONLY. Rejection is a DELETE — it removes the row, the Drive copy and
 * the alerts — and that already exists as deleteInvoice below. There is
 * deliberately no way to re-raise the flag from here: the gate is set by ingest
 * from the threshold in force at the time, and letting the UI put an invoice
 * back into "waiting" would invent a state nothing measured.
 */
async function approveInvoice(supabase: SupabaseClient, id: string): Promise<Response> {
  const { data, error } = await supabase
    .from("invoices")
    .update({ awaiting_approval: false })
    .eq("id", id)
    .select("id");
  if (error) return json({ error: error.message }, 500);
  // An id that matched nothing is a 404, not a success: the caller is about to
  // mark an alert resolved on the strength of this answer.
  if (!data || data.length === 0) return json({ error: "Invoice not found" }, 404);
  return json({ success: true });
}

async function updateInvoiceStatus(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const { status } = await req.json();
  if (!status) return json({ error: "status is required" }, 400);
  const { error } = await supabase.from("invoices").update({ status }).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// Full invoice deletion: Drive file → related alerts → Storage copy → DB row.
// Drive trashing is BEST-EFFORT: when Drive isn't configured (no GMAIL_* secrets,
// e.g. dev) or the trash call fails, we log and skip rather than abort — the
// invoice row and its alerts must still be removed. Alerts/Storage are best-effort too.
async function deleteInvoice(supabase: SupabaseClient, id: string): Promise<Response> {
  const { data: inv, error: fetchErr } = await supabase.from("invoices")
    .select("id, drive_file_link, gmail_message_id, storage_url, invoice_number, supplier_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!inv)     return json({ error: "Invoice not found" }, 404);

  // 1. Drive — trash the file. Skipped when there is no Drive copy (manual invoices)
  //    OR when Drive credentials aren't configured / the call fails (graceful skip).
  let drive = "skipped";
  const fileId = driveFileIdFromLink(inv.drive_file_link);
  const driveConfigured = !!(Deno.env.get("GMAIL_CLIENT_ID") && Deno.env.get("GMAIL_CLIENT_SECRET") && Deno.env.get("GMAIL_REFRESH_TOKEN"));
  if (fileId && driveConfigured) {
    try {
      const token = await getGoogleAccessToken();
      await driveTrashFile(token, fileId);
      drive = "deleted";
    } catch (e) {
      // Do NOT abort — a Drive hiccup must not strand the invoice/alerts.
      console.error("[deleteInvoice] Drive trash failed — skipping:", e instanceof Error ? e.message : e);
      drive = "skip_failed";
    }
  } else if (fileId && !driveConfigured) {
    drive = "skipped_no_creds";
  }

  // 2. Alerts referencing this invoice (payload JSON keys; best-effort)
  let alerts = 0;
  try {
    const ors = [
      `payload->>invoiceId.eq.${id}`,
      `payload->>existingInvoiceId.eq.${id}`,
      `payload->>duplicateInvoiceId.eq.${id}`,
    ];
    if (inv.gmail_message_id) ors.push(`payload->>gmailMessageId.eq.${inv.gmail_message_id}`);
    const { data: deleted } = await supabase.from("alerts")
      .delete()
      .or(ors.join(","))
      .select("id");
    alerts = deleted?.length ?? 0;
  } catch (e) {
    console.error("[deleteInvoice] alerts cleanup failed:", e instanceof Error ? e.message : e);
  }

  // 3. Storage preview copy (best-effort)
  if (inv.storage_url) {
    const { error: stErr } = await supabase.storage.from("documents").remove([inv.storage_url]);
    if (stErr) console.error("[deleteInvoice] storage cleanup failed:", stErr.message);
  }

  // 3b. Delivery notes attached to this invoice. `delivery_note_invoices` cascades on
  //     the delete below, but a cascade only removes the LINK — it cannot know what
  //     state the note should land in, and a note left at `awaiting_approval` pointing
  //     at an invoice that no longer exists is a pair nobody can ever resolve.
  //     Rejecting a ₪20K invoice is exactly this path, so it is not a rare case.
  //     Captured BEFORE the delete, because afterwards the link rows are gone.
  const { data: linkedNotes } = await supabase.from("delivery_note_invoices")
    .select("delivery_note_id").eq("invoice_id", id);
  const orphanedNoteIds = ((linkedNotes ?? []) as Array<{ delivery_note_id: string }>)
    .map(r => String(r.delivery_note_id));

  // 4. The invoice row itself
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);

  // 4b. Send those notes back to waiting for an invoice. The goods did arrive — only
  //     the bill was withdrawn — so they return to the pipeline rather than vanishing.
  let notesReleased = 0;
  if (orphanedNoteIds.length > 0) {
    const { data: released } = await supabase.from("delivery_notes")
      .update({ stage: "awaiting_invoice", status: "unlinked", invoice_id: null })
      .in("id", orphanedNoteIds)
      .select("id");
    notesReleased = released?.length ?? 0;
  }

  // 5. Duplicate cleanup: after deleting one of a duplicate pair, if exactly ONE
  //    invoice now remains sharing this invoice number, it is no longer a duplicate —
  //    clear its is_duplicate flag so the "כפילות" tag disappears. Prefer the
  //    (invoice_number, supplier_id) key; when supplier_id is NULL/empty (supplier not
  //    resolved), fall back to matching by invoice_number ALONE. Numberless invoices
  //    are skipped (they dedupe by storage_url, not number).
  let unflagged = 0;
  if (inv.invoice_number) {
    let q = supabase.from("invoices").select("id").eq("invoice_number", inv.invoice_number);
    if (inv.supplier_id) q = q.eq("supplier_id", inv.supplier_id);
    const { data: siblings } = await q;
    if (siblings && siblings.length === 1) {
      await supabase.from("invoices").update({ is_duplicate: false }).eq("id", siblings[0].id);
      unflagged = 1;
    }
  }

  return json({ success: true, drive, alerts, unflagged, notesReleased });
}

// ─── Payments ─────────────────────────────────────────────────────────────────
// Whitelist: supplier_id (resolved from name if needed), amount, payment_type,
//            payment_date, reference, value_date, notes, status
// Excluded (no DB column): supplier (name stored in suppliers table, not here)

// (Exact-name lookup removed — supplier resolution now uses the SAME fuzzy name
//  matcher as the invoice ingest pipeline. See findBestSupplierRow below.)

function paymentToRow(body: Record<string, unknown>, supplierId: string | null): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (supplierId !== null)        row.supplier_id   = supplierId;
  if (body.amount     !== undefined) row.amount       = body.amount;
  if (body.type       !== undefined) row.payment_type = body.type;
  if (body.date       !== undefined) row.payment_date = body.date;
  if (body.ref        !== undefined) row.reference    = body.ref;
  if (body.valueDate  !== undefined) row.value_date   = body.valueDate || null;
  if (body.notes      !== undefined) row.notes        = body.notes;
  if (body.status     !== undefined) row.status       = body.status;
  return row;
}

async function createPayment(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  if (!body.amount || !body.date) return json({ error: "amount and date are required" }, 400);

  let supplierId: string | null = null;
  if (body.supplier_id) {
    supplierId = body.supplier_id as string;
  } else if (body.supplier || body.hp) {
    // Auto-create (PART 3B): a payment for a supplier that does not exist yet
    // creates one from whatever is available (name and/or ח.פ), flagged incomplete.
    supplierId = await resolveOrCreateSupplier(supabase, body.supplier as string | undefined, body.hp as string | undefined);
  }

  const row = paymentToRow(body, supplierId);
  const { data, error } = await supabase.from("payments").insert(row).select("id").single();
  if (error || !data) return json({ error: error?.message }, 500);
  return json({ id: data.id }, 201);
}

async function updatePayment(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();

  let supplierId: string | null = null;
  if (body.supplier_id) {
    supplierId = body.supplier_id as string;
  } else if (body.supplier || body.hp) {
    // Auto-create (PART 3B): same as createPayment — resolve by ח.פ/name or create.
    supplierId = await resolveOrCreateSupplier(supabase, body.supplier as string | undefined, body.hp as string | undefined);
  }

  const row = paymentToRow(body, supplierId);
  if (Object.keys(row).length === 0) return json({ error: "No fields to update" }, 400);

  const { error } = await supabase.from("payments").update(row).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function cancelPayment(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("payments").update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// Stamps bizbox_exported_at on the given payments so they are never exported
// to BizBox again. Touches ONLY the stamp — status is deliberately unchanged
// (pending payments must keep appearing in upcoming payments until paid).
// The .is() guard preserves the original stamp if an id is sent twice.
async function markBizboxExported(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string"))
    return json({ error: "ids must be a non-empty array of payment ids" }, 400);

  const { data, error } = await supabase.from("payments")
    .update({ bizbox_exported_at: new Date().toISOString() })
    .in("id", ids)
    .is("bizbox_exported_at", null)
    .select("id");
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, count: data?.length ?? 0 });
}

// Hard delete — distinct from the cancel flow (status='cancelled'), which is
// reversible. Removes the row entirely.
async function deletePayment(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Delivery Notes ───────────────────────────────────────────────────────────
// updateDeliveryNote whitelist: status, invoice_id, amount, date, supplier_name
// Excluded (no DB column): notes, isoDate

async function createDeliveryNote(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const { supplier_name, note_number, date, amount, amount_before_vat, vat_amount, line_items, source_email, received_at } = body;
  // A MANUAL goods receipt has only a supplier + item list — no delivery-note number
  // and often no amount. Email-ingested notes pass the full set. Require only the
  // supplier; default the rest. No gmail_message_id → the row reads as source='manual'.
  if (!supplier_name && !body.supplier_id)
    return json({ error: "supplier is required" }, 400);

  // Auto-create (PART 3B): resolve by ח.פ / name, else create a supplier flagged incomplete.
  const supplierId = body.supplier_id
    ? String(body.supplier_id)
    : await resolveOrCreateSupplier(supabase, supplier_name, body.hp as string | undefined);
  if (!supplierId) return json({ error: "Failed to resolve/create supplier" }, 500);

  const { data: note, error: noteErr } = await supabase.from("delivery_notes")
    .insert({
      supplier_id: supplierId,
      supplier_name:     supplier_name     ?? null,
      note_number:       note_number       ?? "",   // NOT NULL; manual receipts have no number
      date:              date              ?? new Date().toISOString().slice(0, 10),
      amount:            amount            ?? 0,
      amount_before_vat: amount_before_vat ?? null,
      vat_amount:        vat_amount        ?? null,
      line_items:        line_items        ?? null,
      source_email:      source_email      ?? null,
      received_at:       received_at       ?? null,
      status: "pending",
      // Goods are in hand and no invoice is attached — the pipeline's starting state.
      stage: "awaiting_invoice" satisfies PipelineStage,
      // Who physically took the delivery. The UI has always sent this; it used to be
      // dropped here because the column did not exist (added 20260823000000).
      employee_id:   body.employee_id ?? body.employeeId ?? null,
      // How the row was made. 'manual' is the honest default for this endpoint —
      // the camera path passes 'photo' explicitly; email ingest inserts directly.
      intake_source: body.intake_source ?? body.intakeSource ?? "manual",
    })
    .select("id").single();

  if (noteErr || !note) return json({ error: "Failed to create delivery note", details: noteErr?.message }, 500);
  return json({ id: note.id }, 201);
}

async function getDeliveryNotes(req: Request, supabase: SupabaseClient, url: URL): Promise<Response> {
  const supplierId = url.searchParams.get("supplier_id");
  const status = url.searchParams.get("status");

  let query = supabase.from("delivery_notes").select("*").order("date", { ascending: false });
  if (supplierId) query = query.eq("supplier_id", supplierId);
  if (status)     query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);
  return json(data);
}

async function updateDeliveryNote(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.status          !== undefined) updates.status        = body.status;
  if (body.invoiceId       !== undefined) updates.invoice_id    = body.invoiceId;
  if (body.linkedInvoiceId !== undefined) updates.invoice_id    = body.linkedInvoiceId;
  if (body.amount          !== undefined) updates.amount        = body.amount;
  if (body.date            !== undefined) updates.date          = body.date;
  if (body.supplierName    !== undefined) updates.supplier_name = body.supplierName;
  // "שינוי ספק" — reassigning a delivery whose supplier was read wrong. The id and
  // the NAME move together, resolved server-side from the id, exactly as the
  // invoice screen does: a row showing one supplier and belonging to another is
  // the specific defect that free-text supplier fields kept producing. Sending a
  // name alongside is therefore ignored; the id decides.
  if (body.supplierId      !== undefined) {
    updates.supplier_id = body.supplierId || null;
    const { data: sup } = await supabase
      .from("suppliers").select("name").eq("id", body.supplierId).maybeSingle();
    if (sup?.name) updates.supplier_name = sup.name;
  }
  // PIECE 2 — manual↔arrived match correction: the matched arrived note's document +
  // number are copied onto the manual row (mirrors Returns storing the credit-note doc
  // in drive_file_link). Setting them = confirm/override; clearing = unmatch.
  if (body.driveFileLink   !== undefined) updates.drive_file_link = body.driveFileLink;
  if (body.noteNumber      !== undefined) updates.note_number     = body.noteNumber;
  // Pipeline columns. `stage` is normally moved by link/unlink/approve rather than
  // written directly, but the screen must be able to correct a state by hand — §6.f
  // is explicit that a suggested match is always overridable from the page.
  if (body.stage           !== undefined) updates.stage         = body.stage;
  if (body.employeeId      !== undefined) updates.employee_id   = body.employeeId || null;
  if (body.intakeSource    !== undefined) updates.intake_source = body.intakeSource;
  // body.notes intentionally excluded — no notes column in delivery_notes

  if (Object.keys(updates).length === 0) return json({ error: "No fields to update" }, 400);
  const { error } = await supabase.from("delivery_notes").update(updates).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function deleteDeliveryNote(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("delivery_notes").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// PIECE 2 — auto-match an ARRIVED (email) delivery note to a manual goods receipt.
// Rule (mirrors §2a matching): same supplier; pick the most recent UNMATCHED manual
// receipt (source='manual' → no gmail_message_id; not yet linked → no drive_file_link).
// On match, copy the arrived note's document link + number onto the manual row — the
// same soft-link Returns uses (matched row stores the counterpart's drive_file_link),
// so the manual row's "הצג מסמך מספק" button opens the supplier's document. AI-suggested;
// the user can confirm/override/unmatch via updateDeliveryNote (drive_file_link/note_number).
async function matchDeliveryNote(supabase: SupabaseClient, arrivedId: string): Promise<Response> {
  const { data: arrived } = await supabase.from("delivery_notes")
    .select("id, supplier_id, note_number, drive_file_link, gmail_message_id")
    .eq("id", arrivedId).maybeSingle();
  if (!arrived) return json({ error: "Arrived note not found" }, 404);
  if (!arrived.gmail_message_id) return json({ error: "Not an arrived (email) note" }, 400);

  const { data: candidates } = await supabase.from("delivery_notes")
    .select("id, drive_file_link")
    .eq("supplier_id", arrived.supplier_id)
    .is("gmail_message_id", null)                 // manual receipts only
    .order("date", { ascending: false });
  const manual = (candidates ?? []).find(c => !c.drive_file_link);   // not already linked
  if (!manual) return json({ success: true, matched: null });

  const { error } = await supabase.from("delivery_notes")
    .update({ drive_file_link: arrived.drive_file_link, note_number: arrived.note_number })
    .eq("id", manual.id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, matched: manual.id });
}

// ─── The goods pipeline state machine (spec ch. 6) ────────────────────────────
//
//   סחורה → חשבונית → אישור → בכרטסת
//
// `delivery_notes.stage` is the state; `delivery_note_invoices` is the link, and it
// is many-to-many because ONE invoice routinely covers several deliveries (a
// consolidated supplier) and, rarely, one delivery is split across invoices.
//
// The legacy `status` column and the single `invoice_id` are still WRITTEN here, as
// a mirror, because screens and scripts still read them. They are no longer the
// truth: stage and the link table are. Dropping the mirror is a later, separate step.
type PipelineStage = "awaiting_goods" | "awaiting_invoice" | "awaiting_approval" | "in_ledger";

/** Which invoices is this delivery note attached to? */
async function linkedInvoiceIds(supabase: SupabaseClient, noteId: string): Promise<string[]> {
  const { data } = await supabase.from("delivery_note_invoices")
    .select("invoice_id").eq("delivery_note_id", noteId);
  return ((data ?? []) as Array<{ invoice_id: string }>).map(r => String(r.invoice_id));
}

async function linkDeliveryNote(
  req: Request, supabase: SupabaseClient, id: string, actor?: string,
): Promise<Response> {
  const { invoice_id } = await req.json();
  if (!invoice_id) return json({ error: "invoice_id is required" }, 400);

  // The invoice decides the resulting stage. Attaching a note to an invoice that is
  // ALREADY in the ledger (the consolidated case, where a late note joins an invoice
  // the owner approved last week) must not reopen an approval nobody is waiting on.
  const { data: inv } = await supabase.from("invoices")
    .select("id, ledger_approved_at").eq("id", invoice_id).maybeSingle();
  if (!inv) return json({ error: "Invoice not found" }, 404);

  const { error: linkErr } = await supabase.from("delivery_note_invoices")
    .upsert(
      { delivery_note_id: id, invoice_id, created_by: actor ?? null },
      { onConflict: "delivery_note_id,invoice_id" },
    );
  if (linkErr) return json({ error: linkErr.message }, 500);

  const stage: PipelineStage = inv.ledger_approved_at ? "in_ledger" : "awaiting_approval";
  const { error } = await supabase.from("delivery_notes")
    .update({ invoice_id, status: "linked", stage })
    .eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, stage });
}

// Unlink one invoice, or all of them. With many-to-many, "unlink" is ambiguous:
// pass `invoice_id` to detach a single one, omit it to detach every invoice from the
// note. The stage is then DERIVED from what is left — a note that still holds another
// invoice has not gone back to waiting for one.
async function unlinkDeliveryNote(
  req: Request, supabase: SupabaseClient, id: string,
): Promise<Response> {
  let invoiceId: string | undefined;
  try {
    const body = await req.json();
    invoiceId = body?.invoice_id ? String(body.invoice_id) : undefined;
  } catch { /* no body = detach everything, the pre-many-to-many behaviour */ }

  let del = supabase.from("delivery_note_invoices").delete().eq("delivery_note_id", id);
  if (invoiceId) del = del.eq("invoice_id", invoiceId);
  const { error: delErr } = await del;
  if (delErr) return json({ error: delErr.message }, 500);

  const remaining = await linkedInvoiceIds(supabase, id);
  const stage: PipelineStage = remaining.length > 0 ? "awaiting_approval" : "awaiting_invoice";
  const { error } = await supabase.from("delivery_notes")
    .update({
      invoice_id: remaining[0] ?? null,          // mirror follows the surviving link
      status: remaining.length > 0 ? "linked" : "unlinked",
      stage,
    })
    .eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, stage, remaining: remaining.length });
}

// ─── The gate into the ledger (§6.e, §6.7) ────────────────────────────────────
//
// Approval is stamped on the INVOICE, not on the note, because the money is the
// invoice's and it must enter the balance exactly ONCE however many deliveries it
// covers (§6.c). Approving therefore moves every note attached to it in one go —
// which is precisely what makes a consolidated invoice one decision instead of five.
//
// NOTE this is not `invoices.awaiting_approval`. That is the ₪20K threshold gate and
// it is a different question, decided on a different screen. They coexist.
async function ledgerApproveInvoice(
  supabase: SupabaseClient, id: string, actor?: string,
): Promise<Response> {
  const { data: inv, error: fetchErr } = await supabase.from("invoices")
    .select("id, ledger_approved_at").eq("id", id).maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!inv)     return json({ error: "Invoice not found" }, 404);

  // Idempotent: approving twice must not re-stamp the date or re-report the move.
  if (inv.ledger_approved_at) return json({ success: true, alreadyApproved: true, notesMoved: 0 });

  const { error } = await supabase.from("invoices")
    .update({ ledger_approved_at: new Date().toISOString(), ledger_approved_by: actor ?? null })
    .eq("id", id);
  if (error) return json({ error: error.message }, 500);

  const { data: links } = await supabase.from("delivery_note_invoices")
    .select("delivery_note_id").eq("invoice_id", id);
  const noteIds = ((links ?? []) as Array<{ delivery_note_id: string }>)
    .map(r => String(r.delivery_note_id));
  if (noteIds.length > 0) {
    await supabase.from("delivery_notes")
      .update({ stage: "in_ledger", status: "archived" })
      .in("id", noteIds);
  }
  return json({ success: true, notesMoved: noteIds.length });
}

// The reverse (§6.14: "ביטול הצמדה אחרי אישור"). Reversible on purpose — an approval
// given by mistake is a mistake about a pair, not about a document, and nothing is
// destroyed by taking it back.
async function ledgerUnapproveInvoice(supabase: SupabaseClient, id: string): Promise<Response> {
  const { data: inv, error: fetchErr } = await supabase.from("invoices")
    .select("id, ledger_approved_at").eq("id", id).maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!inv)     return json({ error: "Invoice not found" }, 404);
  if (!inv.ledger_approved_at) return json({ success: true, alreadyPending: true, notesMoved: 0 });

  const { error } = await supabase.from("invoices")
    .update({ ledger_approved_at: null, ledger_approved_by: null })
    .eq("id", id);
  if (error) return json({ error: error.message }, 500);

  const { data: links } = await supabase.from("delivery_note_invoices")
    .select("delivery_note_id").eq("invoice_id", id);
  const noteIds = ((links ?? []) as Array<{ delivery_note_id: string }>)
    .map(r => String(r.delivery_note_id));
  if (noteIds.length > 0) {
    await supabase.from("delivery_notes")
      .update({ stage: "awaiting_approval", status: "linked" })
      .in("id", noteIds);
  }
  return json({ success: true, notesMoved: noteIds.length });
}

// ─── Suggested matches (§6.f) ─────────────────────────────────────────────────
//
// The system SUGGESTS; a human confirms. It never attaches on its own — a wrong
// automatic link is worse than no link, because nobody goes looking for it.
//
// Ranked on supplier + date proximity + amount, in that order of trust. Amount is the
// strongest single signal when it matches, so an exact amount outranks a closer date.
// Line items are deliberately NOT used: `delivery_notes.line_items` is free-form and
// its shape varies per supplier (spec/12 §constraints), so matching on it would look
// precise while being arbitrary.
const MATCH_WINDOW_DAYS = 45;

interface ScoredCandidate {
  invoice: { id: string; invoice_number: string | null; invoice_date: string | null;
             total_amount: number | null; ledger_approved_at: string | null };
  dayGap: number | null;
  amountGap: number | null;
  amountMatch: boolean;
}

// ⚠️ `role` is NOT optional decoration. This function runs on the SERVICE-ROLE key, so
// it reads the BASE `invoices` table and bypasses `invoices_v` — the very view whose
// job is to NULL the amount columns for anyone who is not a manager. Employees are
// allowed to call this (§6.7 lets them confirm a match), so returning `total_amount`
// raw would hand them, through this endpoint, the exact figures the view withholds
// everywhere else. The mask below reproduces `invoices_v` by hand because there is no
// view to lean on down here.
async function deliveryNoteCandidates(
  supabase: SupabaseClient, id: string, role?: string,
): Promise<Response> {
  const isManager = role === "manager";
  const { data: note, error: noteErr } = await supabase.from("delivery_notes")
    .select("id, supplier_id, date, amount").eq("id", id).maybeSingle();
  if (noteErr) return json({ error: noteErr.message }, 500);
  if (!note)   return json({ error: "Delivery note not found" }, 404);
  if (!note.supplier_id) return json({ candidates: [], reason: "note has no supplier" });

  const noteDate = note.date ? new Date(note.date) : null;

  interface CandidateInvoice {
    id: string;
    invoice_number: string | null;
    invoice_date: string | null;
    total_amount: number | null;
    ledger_approved_at: string | null;
  }
  const { data: invoices } = await supabase.from("invoices")
    .select("id, invoice_number, invoice_date, total_amount, ledger_approved_at")
    .eq("supplier_id", note.supplier_id)
    .or("is_duplicate.is.false,is_duplicate.is.null")
    .or("has_error.is.false,has_error.is.null");

  const already = new Set(await linkedInvoiceIds(supabase, id));
  const noteAmount = Math.abs(Number(note.amount ?? 0));

  const scored = ((invoices ?? []) as CandidateInvoice[])
    .filter((i: CandidateInvoice) => !already.has(String(i.id)))
    .map((i: CandidateInvoice) => {
      const invDate = i.invoice_date ? new Date(i.invoice_date) : null;
      const dayGap = noteDate && invDate
        ? Math.round(Math.abs(invDate.getTime() - noteDate.getTime()) / 86_400_000)
        : null;
      const invAmount = Math.abs(Number(i.total_amount ?? 0));
      // "Same amount" to the agora, with a 1% tolerance for a delivery note that
      // rounds or omits a line the invoice carries.
      const amountGap = noteAmount > 0 && invAmount > 0 ? Math.abs(invAmount - noteAmount) : null;
      const amountMatch = amountGap !== null && amountGap <= Math.max(1, noteAmount * 0.01);
      return { invoice: i, dayGap, amountGap, amountMatch };
    })
    .filter((c: ScoredCandidate) => c.dayGap === null || c.dayGap <= MATCH_WINDOW_DAYS)
    .sort((a: ScoredCandidate, b: ScoredCandidate) => {
      if (a.amountMatch !== b.amountMatch) return a.amountMatch ? -1 : 1;
      return (a.dayGap ?? 9999) - (b.dayGap ?? 9999);
    })
    .slice(0, 10);

  return json({
    candidates: scored.map((c: ScoredCandidate) => ({
      invoice_id:     c.invoice.id,
      invoice_number: c.invoice.invoice_number,
      invoice_date:   c.invoice.invoice_date,
      // Masked exactly as invoices_v masks it. `amount_match` survives either way —
      // it is a yes/no about two numbers the caller never sees, which is all an
      // employee needs to judge a suggestion.
      total_amount:   isManager ? c.invoice.total_amount : null,
      already_in_ledger: !!c.invoice.ledger_approved_at,
      day_gap:        c.dayGap,
      amount_match:   c.amountMatch,
    })),
    windowDays: MATCH_WINDOW_DAYS,
  });
}

// ─── Orders (spec ch. 7) ──────────────────────────────────────────────────────
//
// The board that replaces the WhatsApp group. A supplier, free text, a date.
//
// 🔑 D22 — AN ORDER IS NOT A SOURCE OF TRUTH. Nothing here computes a quantity or
// an amount, and nothing here reaches the ledger. The order catches goods early
// and answers a waiting customer; the money is settled by the delivery note
// against the invoice.

async function createOrder(req: Request, supabase: SupabaseClient, actor?: string): Promise<Response> {
  const body = await req.json();
  const supplierName = body.supplier_name ?? body.supplierName ?? null;
  if (!body.supplier_id && !supplierName) return json({ error: "supplier is required" }, 400);

  const supplierId = body.supplier_id
    ? String(body.supplier_id)
    : await resolveOrCreateSupplier(supabase, supplierName, body.hp as string | undefined);
  if (!supplierId) return json({ error: "Failed to resolve/create supplier" }, 500);

  const { data, error } = await supabase.from("orders").insert({
    supplier_id:    supplierId,
    supplier_name:  supplierName,
    description:    body.description ?? "",
    // §7.b — the date is automatic. Accepted from the body only so a back-dated
    // entry is possible; the UI never sends one.
    date:           body.date ?? new Date().toISOString().slice(0, 10),
    // §7.7 — when the supplier said it would arrive. Nullable and never required:
    // the owner usually does not know, and a required field she cannot fill gets
    // an invented answer.
    expected_date:  body.expected_date ?? body.expectedDate ?? null,
    status:         "order_waiting",
    customer_name:  body.customer_name  ?? body.customerName  ?? null,
    customer_phone: body.customer_phone ?? body.customerPhone ?? null,
    created_by:     actor ?? null,
  }).select("id").single();

  if (error || !data) return json({ error: "Failed to create order", details: error?.message }, 500);

  // ── The order opens its pipeline immediately ──────────────────────────────
  //
  // Each of the three parts starts a chain — that is the model, and an order was
  // the one still waiting for a second event before it counted. So an order lived
  // only on its own board, and the goods list, which is where the owner actually
  // looks, did not know it existed. Nothing showed a purchase between "asked for"
  // and "arrived".
  //
  // `awaiting_goods` is the right stage and not a new one: it says the goods are
  // what is missing, which is equally true of an invoice that came first and of an
  // order not yet delivered. The strip tells them apart from the order step, which
  // is why that step exists.
  const { data: pipe } = await supabase.from("delivery_notes").insert({
    supplier_id:   supplierId,
    supplier_name: supplierName,
    note_number:   "",
    date:          body.date ?? new Date().toISOString().slice(0, 10),
    amount:        0,
    status:        "pending",
    stage:         "awaiting_goods" satisfies PipelineStage,
    // Names the door it came through, so a row that never carried goods is never
    // read as a delivery that happened.
    intake_source: "order",
    line_items:    body.description ?? null,
  }).select("id").single();
  if (pipe) {
    await supabase.from("orders").update({ delivery_note_id: pipe.id }).eq("id", data.id);
  }

  // ── A customer order landing on a supplier that already has one open ──────
  //
  // The owner's rule, and the reason it exists: the shipment is already on its
  // way, so the customer's item can ride along instead of triggering a second
  // delivery — but only if somebody notices in time. An employee taking the order
  // over the phone has no way to know, so the system tells the manager.
  //
  // Only for CUSTOMER orders. A restock order joining another restock order is
  // ordinary and needs no interruption; the alert exists because a customer is
  // waiting and a missed window costs her the wait, not the store a delivery fee.
  const customerName = body.customer_name ?? body.customerName ?? null;
  if (customerName) {
    const { data: openSiblings } = await supabase.from("orders")
      .select("id, description, expected_date, date")
      .eq("supplier_id", supplierId)
      .eq("status", "order_waiting")
      .neq("id", data.id)
      .order("expected_date", { ascending: true, nullsFirst: false })
      .limit(1);
    const sibling = openSiblings?.[0];
    if (sibling) {
      const when = sibling.expected_date
        ? `צפי הגעה ${String(sibling.expected_date).split("-").reverse().join("/")}`
        : "ללא צפי הגעה";
      await supabase.from("alerts").insert({
        type:    "customer_order_joins_shipment",
        title:   "הזמנת לקוחה אצל ספק עם משלוח בדרך",
        message: `${customerName} הזמינה מ${supplierName ?? "הספק"}. יש כבר הזמנה פתוחה אצל אותו ספק (${when}) — אפשר לצרף.`,
        status:  "unread",
        payload: {
          supplierId,
          supplierName:   supplierName ?? "",
          orderId:        data.id,
          existingOrderId: sibling.id,
          customerName,
          expectedDate:   sibling.expected_date ?? null,
        },
      });
    }
  }

  return json({ id: data.id }, 201);
}

/**
 * "הגיע" — one click (§7.e), and the only place an order touches the pipeline.
 *
 * Full arrival: the order is marked arrived and a delivery row is opened for it,
 * entering at `awaiting_invoice` — goods in hand, no invoice yet.
 *
 * PARTIAL arrival (§7.5) is the subtle one: a NEW order is created for what came,
 * and **the original keeps waiting** for the rest. The new one is what feeds the
 * pipeline. Splitting rather than editing is what keeps the outstanding remainder
 * visible instead of quietly shrinking an order nobody re-reads.
 */
/**
 * An invoice that arrived before its goods opens a pipeline of its own.
 *
 * The model the owner settled on: order, delivery and invoice are three parts of
 * one chain, and EACH can start it — every part first looks for a pipeline it
 * belongs to, and opens one only when there is none. Two of the three legs
 * existed; this is the third. `awaiting_goods` was drawn, labelled and filterable
 * from the start, but nothing ever wrote it, so an invoice that came first was
 * invisible to the pipeline and there was nothing to attach it to.
 *
 * That case is not an edge: in the first months most invoices will arrive with no
 * order behind them at all.
 *
 * The pipeline row lives in `delivery_notes` because that table IS the spine —
 * `note_number` stays empty and `intake_source` says where it came from, so a row
 * with no goods behind it is never mistaken for a delivery that happened.
 */
async function openPipelineForInvoice(
  supabase: SupabaseClient, invoiceId: string, actor?: string,
): Promise<Response> {
  const { data: inv, error: invErr } = await supabase.from("invoices")
    .select("id, supplier_id, supplier_name, invoice_date").eq("id", invoiceId).maybeSingle();
  if (invErr) return json({ error: invErr.message }, 500);
  if (!inv)   return json({ error: "Invoice not found" }, 404);

  // Already in a pipeline? Then there is nothing to open — say so rather than
  // opening a second one, which is the duplication this whole rule prevents.
  const { data: existing } = await supabase.from("delivery_note_invoices")
    .select("delivery_note_id").eq("invoice_id", invoiceId).limit(1);
  if (existing && existing.length > 0)
    return json({ success: true, alreadyLinked: true, deliveryNoteId: existing[0].delivery_note_id });

  const { data: note, error } = await supabase.from("delivery_notes").insert({
    supplier_id:   inv.supplier_id,
    supplier_name: inv.supplier_name,
    note_number:   "",
    date:          inv.invoice_date ?? new Date().toISOString().slice(0, 10),
    amount:        0,
    status:        "pending",
    // The invoice is in and the goods are not — the mirror image of the usual start.
    stage:         "awaiting_goods" satisfies PipelineStage,
    intake_source: "invoice",
  }).select("id").single();
  if (error || !note) return json({ error: "Failed to open pipeline", details: error?.message }, 500);

  const { error: linkErr } = await supabase.from("delivery_note_invoices")
    .insert({ delivery_note_id: note.id, invoice_id: invoiceId, created_by: actor ?? null });
  if (linkErr) return json({ error: linkErr.message }, 500);

  return json({ success: true, deliveryNoteId: note.id }, 201);
}

/**
 * Take a pipeline apart without deleting anything it holds.
 *
 * "Dismantle only" is the owner's decision, and it is the right one: deleting a
 * document is a separate action that already exists behind its own confirmation,
 * and folding the two together during a learning period is how an invoice gets
 * deleted by someone who only meant to undo a match. So the links go, the stages
 * reset, and every document stays exactly where it was.
 *
 * The empty shell — a pipeline row that never carried goods — is removed too,
 * because leaving it produces a delivery that never happened.
 */
async function dismantlePipeline(
  supabase: SupabaseClient, noteId: string,
): Promise<Response> {
  const { data: note, error: noteErr } = await supabase.from("delivery_notes")
    .select("id, stage, note_number, intake_source").eq("id", noteId).maybeSingle();
  if (noteErr) return json({ error: noteErr.message }, 500);
  if (!note)   return json({ error: "Pipeline not found" }, 404);

  const { data: links } = await supabase.from("delivery_note_invoices")
    .select("invoice_id").eq("delivery_note_id", noteId);
  const invoiceIds = (links ?? []).map(l => String(l.invoice_id));

  await supabase.from("delivery_note_invoices").delete().eq("delivery_note_id", noteId);
  await supabase.from("orders")
    .update({ delivery_note_id: null, status: "order_waiting", arrived_at: null })
    .eq("delivery_note_id", noteId);

  // A row opened BY an invoice holds no goods of its own, so once the invoice is
  // detached nothing is left to keep. One that recorded a real delivery stays and
  // simply goes back to waiting.
  const wasShell = note.intake_source === "invoice" && !note.note_number;
  if (wasShell) {
    await supabase.from("delivery_notes").delete().eq("id", noteId);
  } else {
    await supabase.from("delivery_notes")
      .update({ invoice_id: null, status: "pending_match", stage: "awaiting_invoice" })
      .eq("id", noteId);
  }

  return json({
    success: true, removedShell: wasShell, releasedInvoices: invoiceIds,
    note: "המסמכים לא נמחקו — רק הקשר ביניהם פורק.",
  });
}

async function markOrderArrived(
  req: Request, supabase: SupabaseClient, id: string, actor?: string,
): Promise<Response> {
  let partial = false;
  let description: string | undefined;
  let adoptId: string | null = null;
  let forceNew = false;
  try {
    const body = await req.json();
    partial = !!body?.partial;
    description = typeof body?.description === "string" ? body.description : undefined;
    // Set by the screen AFTER it asked: adopt this specific waiting delivery, or
    // go ahead and open a new one because none of them is this shipment.
    adoptId  = typeof body?.delivery_note_id === "string" ? body.delivery_note_id : null;
    forceNew = !!body?.force_new;
  } catch { /* no body = a full arrival */ }

  const { data: order, error: fetchErr } = await supabase.from("orders")
    .select("id, supplier_id, supplier_name, description, status, delivery_note_id").eq("id", id).maybeSingle();
  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!order)   return json({ error: "Order not found" }, 404);
  if (order.status !== "order_waiting") {
    // Idempotent, and it protects the split: pressing "הגיע" twice on an order
    // that already produced one must not produce a second.
    return json({ success: true, alreadyArrived: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  // ── Is the delivery ALREADY here? ─────────────────────────────────────────
  //
  // The ordinary case is that the supplier's note arrives by EMAIL before the
  // goods do. This used to insert a fresh row regardless, so pressing "הגיע"
  // produced a SECOND row for one physical delivery and left the employee to
  // guess which was real — the exact confusion the pipeline exists to remove.
  //
  // So look first. A candidate is a delivery from this supplier that is still
  // waiting for an invoice and is not already attached to another order.
  //
  // Nothing is attached automatically. The system SUGGESTS and a person confirms
  // (§6.f): only the caller passing `delivery_note_id` adopts a specific row, and
  // an unresolved match comes back as `candidates` for the screen to ask about.
  // Guessing here would silently merge two different deliveries that happened to
  // share a supplier and a week.
  const ARRIVAL_WINDOW_DAYS = 30;
  const since = new Date(Date.now() - ARRIVAL_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  let noteId: string | null = null;

  const { data: waiting } = await supabase.from("delivery_notes")
    .select("id, note_number, date, supplier_name")
    .eq("supplier_id", order.supplier_id)
    .eq("stage", "awaiting_invoice")
    .gte("date", since)
    .order("date", { ascending: false })
    .limit(10);

  const claimed = new Set<string>();
  if (waiting && waiting.length > 0) {
    const { data: others } = await supabase.from("orders")
      .select("delivery_note_id").not("delivery_note_id", "is", null);
    for (const o of others ?? []) claimed.add(String(o.delivery_note_id));
  }
  // The order's own row is not a candidate to merge with itself.
  const candidates = (waiting ?? [])
    .filter(n => !claimed.has(String(n.id)) && String(n.id) !== String(order.delivery_note_id ?? ""));

  // The order opened a row when it was created, so "arrived" normally MOVES that
  // row rather than making another. The offer below is about merging: if the
  // supplier also emailed a note for this same shipment, two rows describe one
  // delivery and the emailed one — which carries the document — should win.
  const ownRow = order.delivery_note_id ? String(order.delivery_note_id) : null;

  if (adoptId) {
    // The screen asked the person and she picked one.
    if (!candidates.some(c => String(c.id) === adoptId))
      return json({ error: "That delivery is not available to attach" }, 409);
    noteId = adoptId;
    // The order's own placeholder held nothing; keeping it would leave a delivery
    // that never happened beside the one that did.
    if (ownRow && ownRow !== adoptId) {
      await supabase.from("delivery_note_invoices").delete().eq("delivery_note_id", ownRow);
      await supabase.from("delivery_notes").delete().eq("id", ownRow).eq("intake_source", "order");
    }
  } else if (ownRow && candidates.length === 0) {
    // Nothing else to merge with: this row IS the delivery, and the goods just
    // turned up in it.
    await supabase.from("delivery_notes")
      .update({ stage: "awaiting_invoice" satisfies PipelineStage, date: today })
      .eq("id", ownRow);
    noteId = ownRow;
  } else if (candidates.length > 0 && !forceNew) {
    // Hand the choice back rather than deciding it. The order is left untouched,
    // so nothing has happened yet and the call is safe to repeat.
    return json({ success: false, needsChoice: true, candidates }, 200);
  }

  if (!noteId) {
    // The delivery row. Goods are in hand and no invoice is attached — the pipeline's
    // starting state. No amount: an order carries no figure worth trusting (D22), and
    // inventing one here would put a number nobody measured in front of a person.
    const { data: note, error: noteErr } = await supabase.from("delivery_notes").insert({
      supplier_id:   order.supplier_id,
      supplier_name: order.supplier_name,
      note_number:   "",
      date:          today,
      amount:        0,
      status:        "pending",
      stage:         "awaiting_invoice" satisfies PipelineStage,
      intake_source: "manual",
    }).select("id").single();
    if (noteErr || !note) return json({ error: "Failed to open delivery", details: noteErr?.message }, 500);
    noteId = String(note.id);
  }
  const note = { id: noteId };

  if (partial) {
    const { data: split, error: splitErr } = await supabase.from("orders").insert({
      supplier_id:      order.supplier_id,
      supplier_name:    order.supplier_name,
      description:      description ?? `הגיע: ${order.description ?? ""}`.trim(),
      date:             today,
      status:           "order_partial",
      arrived_at:       nowIso,
      delivery_note_id: note.id,
      created_by:       actor ?? null,
    }).select("id").single();
    if (splitErr) return json({ error: splitErr.message }, 500);
    // The original is deliberately NOT touched: it stays `order_waiting` until the
    // rest of the goods turn up.
    return json({ success: true, partial: true, newOrderId: split?.id, deliveryNoteId: note.id });
  }

  const { error } = await supabase.from("orders")
    .update({ status: "order_arrived", arrived_at: nowIso, delivery_note_id: note.id })
    .eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, deliveryNoteId: note.id });
}

/** §7.j — what arrived differs from what was ordered. DOCUMENTATION ONLY. */
async function markOrderDiffers(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("orders").update({ arrived_differs: true }).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Returns ──────────────────────────────────────────────────────────────────
// Whitelist: supplier_id, date (from dateIso), amount, reason, invoice_id,
//            status, created_by, email_sender
// Excluded: id (DB auto-generates), date display string, supplier name (no column),
//           dateIso key (value maps to `date`), originalInvoiceId key → invoice_id

function returnToRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (body.supplierId        !== undefined) row.supplier_id = body.supplierId;
  if (body.dateIso           !== undefined) row.date        = body.dateIso;   // ISO value → date column
  row.amount = body.amount ?? 0;   // tracking-only returns have no amount → default 0 (NOT NULL)
  if (body.reason            !== undefined) row.reason      = body.reason;
  if (body.detail            !== undefined) row.detail      = body.detail;
  if (body.originalInvoiceId !== undefined) row.invoice_id  = body.originalInvoiceId;
  if (body.status            !== undefined) row.status      = body.status;
  if (body.employeeId        !== undefined) row.employee_id = body.employeeId || null;
  // Sending address of the supplier credit note that closed this return
  // (migration 20260802010000). Ingest writes it directly with the service role;
  // it is whitelisted here so a re-file / hand correction through the API can
  // carry it too instead of silently dropping it. snake_case first, camelCase
  // second so the frontend value wins — same ordering rule as the statement and
  // invoice mappings.
  if (body.email_sender      !== undefined) row.email_sender = body.email_sender;
  if (body.senderEmail       !== undefined) row.email_sender = body.senderEmail;
  // Intentionally excluded: body.id, body.date (display), body.supplier (no column), body.createdBy (display)
  return row;
}

async function createReturn(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  // Returns are tracking-only: amount is NOT required (defaults to 0; the matching
  // credit note sets it later). Only supplier + reason are mandatory (spec/01-PRD.md §6).
  if (!body.supplierId || !body.reason)
    return json({ error: "supplierId and reason are required" }, 400);

  const row = returnToRow(body);
  const { data, error } = await supabase.from("returns").insert(row).select("id").single();
  if (error || !data) return json({ error: error?.message }, 500);

  // Balance is computed in the frontend (opening + Σ invoices − Σ non-cancelled
  // payments; credit notes are negative invoices). Returns do NOT move the balance
  // directly — only a matching credit note does. No balance RPC. (spec/06-RULES.md §2)
  return json({ id: data.id }, 201);
}

async function updateReturn(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const row = returnToRow(body);
  if (Object.keys(row).length === 0) return json({ error: "No fields to update" }, 400);

  const { error } = await supabase.from("returns").update(row).eq("id", id);
  if (error) return json({ error: error.message }, 500);

  // No balance mutation — balance is frontend-computed (spec/06-RULES.md §2).
  return json({ success: true });
}

async function updateReturnStatus(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const { status } = await req.json();
  if (!status) return json({ error: "status is required" }, 400);

  const { error } = await supabase.from("returns").update({ status }).eq("id", id);
  if (error) return json({ error: error.message }, 500);

  // No balance mutation — balance is frontend-computed (spec/06-RULES.md §2).
  return json({ success: true });
}

// ─── Statements ───────────────────────────────────────────────────────────────
// Whitelist: supplier_id, month, our_balance, vendor_balance, diff, status, uploaded_at,
//            email_sender, match_method
// Excluded: supplier_name (no DB column), id (DB auto-generates)
// email_sender / match_method record WHO sent the statement and HOW the supplier was
// resolved, so the screen can say so and offer an override. Same camelCase-OR-snake_case
// acceptance as the invoice mapping above (senderEmail → email_sender).

async function createStatement(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  if (!body.supplierId && !body.supplier_id)
    return json({ error: "supplierId is required" }, 400);

  const { data, error } = await supabase.from("vendor_statements")
    .insert({
      supplier_id:    body.supplierId    ?? body.supplier_id,
      month:          body.month,
      our_balance:    body.ourBalance    ?? body.our_balance    ?? 0,
      vendor_balance: body.vendorBalance ?? body.vendor_balance ?? null,
      diff:           body.diff          ?? 0,
      status:         body.status        ?? "pending",
      uploaded_at:    body.uploadedAt    ?? body.uploaded_at    ?? new Date().toISOString(),
      email_sender:   body.senderEmail   ?? body.email_sender   ?? null,
      match_method:   body.matchMethod   ?? body.match_method   ?? null,
      // supplier_name intentionally excluded — no such column in vendor_statements
    })
    .select("id").single();

  if (error || !data) return json({ error: error?.message }, 500);
  // PRD §7: every incoming statement is AUTO-MATCHED against our ledger on arrival —
  // computes our_balance (opening+Σinvoices−Σnon-cancelled payments), sets matched/
  // mismatch + diff, and raises the statement_mismatch alert. Never trust a supplied
  // our_balance (that's how a debit/placeholder figure used to leak through).
  await reconcileStatement(supabase, data.id as string);
  return json({ id: data.id }, 201);
}

async function resolveStatement(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.status        !== undefined) updates.status         = body.status;
  if (body.ourBalance    !== undefined) updates.our_balance    = body.ourBalance;
  if (body.vendorBalance !== undefined) updates.vendor_balance = body.vendorBalance;
  if (body.diff          !== undefined) updates.diff           = body.diff;
  // snake_case first, camelCase second so the frontend value wins — same ordering
  // rule as invoiceToRow (a frontend edit ships BOTH representations).
  if (body.email_sender  !== undefined) updates.email_sender   = body.email_sender;
  if (body.senderEmail   !== undefined) updates.email_sender   = body.senderEmail;
  // The reconciliation note the manager writes while comparing the two ledgers.
  // Without this the screen's "הערות התאמה" box had nowhere to land and a save
  // came back "No fields to update" — the note lived only until the page closed.
  if (body.resolution_notes !== undefined) updates.resolution_notes = body.resolution_notes;
  if (body.resolutionNotes  !== undefined) updates.resolution_notes = body.resolutionNotes;

  // Assigning a supplier HERE is by definition a hand correction — that is what the
  // screen's "change supplier" override does — so the route is recorded as 'manual'.
  const supplierId = body.supplierId ?? body.supplier_id;
  if (supplierId !== undefined) {
    updates.supplier_id  = supplierId;
    updates.match_method = "manual";
  }
  // ...unless the caller states the route explicitly (e.g. re-running an automatic
  // match through this endpoint), which overrides the 'manual' default above.
  if (body.match_method  !== undefined) updates.match_method   = body.match_method;
  if (body.matchMethod   !== undefined) updates.match_method   = body.matchMethod;

  if (Object.keys(updates).length === 0) return json({ error: "No fields to update" }, 400);
  const { error } = await supabase.from("vendor_statements").update(updates).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Statement reconciliation (StatementReconciliation §7) ─────────────────────
// Reconciliation only FLAGS the gap; it never edits data (§5).
//
// This used to hold an inline `computeOurBalance` — a FOURTH copy of the balance rule
// (spec/06-RULES.md §9), and it chose differently from every other copy in two ways:
//   · it summed EVERY invoice, including rows flagged is_duplicate / has_error, so a
//     suspected double-charge inflated what the supplier was owed here while the
//     screens excluded it;
//   · it matched on |diff| < 0.01, a tolerance band the owner's rule does not have —
//     `תואם` is diff EXACTLY zero.
// Both are gone: the figure now comes from the shared engine and nothing else.

interface StatementLedgerResult {
  ourBalance:         number;
  paymentArrangement: boolean;
  /** Carried along so the mismatch alert does not re-read the same supplier row. */
  supplierName:       string;
}

/**
 * OUR balance for a supplier, computed by the SHARED ledger engine — the identical
 * `buildLedger` the statements screen, the supplier page and the supplier list all
 * call (spec/06-RULES.md §9). The DB rows are re-shaped here into exactly the field
 * names `useInvoices` / `usePayments` hand it; feeding it anything else would make
 * the twin worthless and put the server back in disagreement with the screen.
 *
 * ⚠️ The body below is a deliberate line-for-line copy of `computeStatementLedger`
 * in invoices-ingest. Two functions writing the same column from the same engine
 * must map the raw rows the same way, or the divergence merely moves from the
 * arithmetic into the mapping. Change both together.
 *
 * Returns null when a read failed — the caller then leaves the statement's status
 * alone rather than filing a verdict it could not compute.
 */
async function computeStatementLedger(
  supabase:   SupabaseClient,
  supplierId: string,
): Promise<StatementLedgerResult | null> {
  // All three reads are independent — the supplier row is only consumed after the
  // ledger is built, so awaiting it first just serialised a round-trip. `name` rides
  // along because the caller needs it for the mismatch alert and was re-reading this
  // same row to get it.
  const [
    { data: sup, error: supErr },
    { data: invRows, error: invErr },
    { data: payRows, error: payErr },
  ] = await Promise.all([
    supabase.from("suppliers")
      .select("name, opening_balance, payment_arrangement")
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
    console.error("[reconcileStatement] supplier read failed:", supErr.message);
    return null;
  }
  if (invErr || payErr) {
    console.error("[reconcileStatement] ledger read failed:", invErr?.message ?? payErr?.message);
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
    supplierName:       (sup?.name as string | null) ?? "",
  };
}

// Auto-match a vendor statement against our ledger. MATCH → status 'matched'.
// MISMATCH → status 'mismatch' + a statement_mismatch alert (dedup per the alert
// super-rules). A subsequent match resolves the prior alert.
async function reconcileStatement(supabase: SupabaseClient, id: string): Promise<Response> {
  const { data: st } = await supabase.from("vendor_statements")
    .select("id, supplier_id, vendor_balance, month, status").eq("id", id).maybeSingle();
  if (!st) return json({ error: "Statement not found" }, 404);

  // No supplier → nothing to compare against. Same call as invoices-ingest
  // (`if (supplierId && vendorBalance !== null)`): leave the row at needs_review
  // rather than filing a verdict against an empty ledger. The old code queried
  // `supplier_id = null`, got a 0 balance back and confidently wrote 'mismatch'.
  if (!st.supplier_id) {
    return json({ success: true, status: st.status ?? "needs_review", ourBalance: null, vendorBalance: Number(st.vendor_balance ?? 0), diff: null });
  }

  const ledger = await computeStatementLedger(supabase, st.supplier_id as string);
  if (!ledger) return json({ error: "Ledger read failed" }, 500);

  const ourBalance    = ledger.ourBalance;
  const vendorBalance = Number(st.vendor_balance ?? 0);
  // One rule for the whole system — `statementVerdict` in the ledger engine, which
  // rounds to the agora first and allows no tolerance band. It replaced the old
  // inline `< 0.01` here, which silently passed a real one-agora gap as matched.
  const diff          = statementDiff(ourBalance, vendorBalance);   // our − vendor
  const matched       = statementVerdict(ourBalance, vendorBalance) === "matched";

  // A supplier marked בהסדר תשלום is the ONE case with no honest verdict: the flag
  // means "מוחרג ממעקב יתרה". Record the TRUE ledger figures, draw no verdict, raise
  // no alert. Settled, not pending: spec/01-PRD.md §7. Same in ingest and on screen.
  if (ledger.paymentArrangement) {
    await supabase.from("vendor_statements").update({ our_balance: ourBalance, diff }).eq("id", id);
    console.warn(
      `[reconcileStatement] supplier ${st.supplier_id} is on a payment arrangement — ` +
      `recorded balances, no automatic verdict (our ${ourBalance}, vendor ${vendorBalance}, diff ${diff})`,
    );
    return json({ success: true, status: st.status ?? null, ourBalance, vendorBalance, diff, paymentArrangement: true });
  }

  const status = matched ? "matched" : "mismatch";

  await supabase.from("vendor_statements").update({ our_balance: ourBalance, diff, status }).eq("id", id);

  const openAlert = () => supabase.from("alerts").select("id")
    .eq("type", "statement_mismatch").eq("payload->>statementId", id).neq("status", "resolved").limit(1);

  if (!matched) {
    // The name came back with the ledger read above — no second round-trip.
    const name = ledger.supplierName || "ספק";
    const { data: existing } = await openAlert();
    if (!existing?.length) {
      await supabase.from("alerts").insert({
        type:    "statement_mismatch",
        title:   "אי-התאמה בכרטסת",
        message: `אי-התאמה בכרטסת מול ${name} (${st.month ?? ""}): יתרת הספק ${vendorBalance}, היתרה שלנו ${ourBalance}, הפרש ${diff}`,
        status:  "unread",
        payload: { statementId: id, supplierId: st.supplier_id, typedSupplierName: name, vendorBalance, ourBalance, diff, month: st.month },
      });
    }
  } else {
    await supabase.from("alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("type", "statement_mismatch").eq("payload->>statementId", id).neq("status", "resolved");
  }

  return json({ success: true, status, ourBalance, vendorBalance, diff });
}

// ─── Document re-classification (document_misclassified alert) ─────────────────
// The AI filed a document as "not an invoice". When a human picks the correct type
// in the re-classify popup, re-FILE the document into the right table so it shows in
// the correct list, then resolve the originating alert.
//
//   docType (Hebrew)  → target table
//   ─────────────────────────────────────────────────────────────────
//   חשבונית           → invoices        (invoice_type 'חשבונית')
//   זיכוי             → invoices        (invoice_type 'זיכוי' — credit note = negative invoice)
//   תעודת משלוח       → delivery_notes  (status 'unlinked')
//   כרטסת             → vendor_statements (status 'needs_review')
//   אחר               → no record; just resolve the alert
//
// The document reference (drive_file_link / storage_url / message_link / gmail id)
// and the typed supplier name ride along from the alert payload. Amounts/numbers are
// left blank for the owner to complete in the target screen.
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Supplier auto-create (Suppliers PART 3B) ──────────────────────────────────
// Resolve a supplier by ח.פ (PRIMARY) then name; if NEITHER matches, AUTO-CREATE a
// minimal supplier from whatever is available (name and/or hp) and mark it incomplete
// via the `needs_details` flag (the SOURCE OF TRUTH), keeping a short human note too.
// NOTE: the "השלם פרטים" ALERT is piece C — deliberately NOT raised here.
const INCOMPLETE_SUPPLIER_NOTE = "נוצר אוטומטית — יש להשלים פרטי ספק (ח.פ / איש קשר / טלפון)";

// Tax-id normalizer — digits only, so "51-423-789 / 0" and "514237890" compare equal.
function normalizeHp(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

// ─── Fuzzy supplier matching (mirrors invoices-ingest findBestSupplier) ────────
// So the manual/reclassify resolve paths match a name-only supplier despite spelling
// differences ("תנובה" vs "תנובה בע\"מ"), instead of the old exact-name miss → dup.
interface SupplierMatchRow { id: string; name: string; hp: string | null }

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .replace(/[֑-ׇ]/g, "")                              // niqqud / cantillation
    .replace(/['"`׳״‘’“”]/g, "")    // quotes / geresh / gershayim
    .replace(/[^א-תa-z0-9\s]/g, "")                     // keep Hebrew + latin alnum + space
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

// Best name match among the loaded suppliers (score ≥ threshold), or null.
function findBestSupplierRow(typed: string, rows: SupplierMatchRow[], threshold = 0.85): SupplierMatchRow | null {
  let best: { row: SupplierMatchRow; score: number } | null = null;
  for (const s of rows) {
    const score = similarityScore(typed, s.name);
    if (!best || score > best.score) best = { row: s, score };
  }
  return best && best.score >= threshold ? best.row : null;
}

async function resolveOrCreateSupplier(
  supabase: SupabaseClient,
  supplierName: string | undefined,
  hp?: string | undefined,
): Promise<string | null> {
  const normHp = normalizeHp(hp);
  // Load candidates once (small table) so hp + fuzzy-name matching runs in memory.
  const { data: rows } = await supabase.from("suppliers").select("id, name, hp");
  const suppliers = (rows ?? []) as SupplierMatchRow[];

  // 1. PRIMARY — match by ח.פ (business number). Authoritative.
  if (normHp) {
    const byHp = suppliers.find(s => normalizeHp(s.hp) === normHp);
    if (byHp) return byHp.id;
  }
  // 2. FUZZY NAME fallback (same 0.85 matcher as invoice ingest) — used ONLY when
  //    ח.פ gave no match. Catches spelling variants a ".eq(name)" used to miss.
  if (supplierName) {
    const match = findBestSupplierRow(supplierName, suppliers);
    if (match) {
      // Gap #5: matched a name-only supplier but the doc carries a ח.פ it lacks →
      // back-fill so every future doc dedupes by ח.פ (never overwrite a different hp).
      if (normHp && !normalizeHp(match.hp)) {
        await supabase.from("suppliers").update({ hp: normHp }).eq("id", match.id);
      }
      return match.id;
    }
  }
  // 3. Nothing to match on or create from.
  if (!supplierName && !normHp) return null;
  // 4. AUTO-CREATE from whatever is available (name and/or hp), flagged incomplete
  //    via needs_details=true (source of truth) + a short human note.
  const { data, error } = await supabase.from("suppliers")
    .insert({ name: supplierName || "ספק ללא שם", hp: normHp || null, needs_details: true, notes: INCOMPLETE_SUPPLIER_NOTE })
    .select("id").single();
  if (error || !data) return null;
  // PART 3C: raise the "השלם פרטים" alert for the freshly-created incomplete supplier.
  await raiseSupplierIncompleteAlert(supabase, data.id as string, supplierName || "ספק ללא שם");
  return data.id as string;
}

// ─── Supplier "השלם פרטים" alert (Suppliers PART 3C) ───────────────────────────
// Raised when a supplier is auto-created (needs_details=true). Idempotent per the
// alert super-rules (07-ALERTS.md): skips if an unresolved supplier_incomplete alert
// already exists for this supplier. Clicking it opens the supplier (payload.supplierId).
async function raiseSupplierIncompleteAlert(
  supabase: SupabaseClient,
  supplierId: string,
  supplierName: string,
): Promise<void> {
  const { data: existing } = await supabase.from("alerts")
    .select("id")
    .eq("type", "supplier_incomplete")
    .eq("payload->>supplierId", supplierId)
    .neq("status", "resolved")
    .limit(1);
  if (existing && existing.length) return;
  await supabase.from("alerts").insert({
    type:    "supplier_incomplete",
    title:   "ספק – חסר פרטים",
    message: "ספק חדש נוצר — יש להשלים פרטים",
    status:  "unread",
    payload: { supplierId, typedSupplierName: supplierName },
  });
}

async function reclassifyDocument(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const docType: string = (body.docType ?? body.type ?? "").toString().trim();
  if (!docType) return json({ error: "docType is required" }, 400);

  const alertId:        string | undefined = body.alertId;
  const supplierName:   string | undefined = body.supplierName ?? body.typedSupplierName;
  const driveFileLink:  string | undefined = body.driveFileLink ?? body.documentUrl;
  const storageUrl:     string | undefined = body.storageUrl ?? body.storagePath;
  const messageLink:    string | undefined = body.messageLink;
  const gmailMessageId: string | undefined = body.gmailMessageId;

  let table: string | null = null;
  let recordId: string | null = null;

  if (docType === "חשבונית" || docType === "זיכוי") {
    const supplierId = await resolveOrCreateSupplier(supabase, supplierName);
    const { data, error } = await supabase.from("invoices").insert({
      supplier_id:     supplierId,
      supplier_name:   supplierName ?? "",
      invoice_type:    docType,
      status:          "ממתין",
      drive_file_link: driveFileLink ?? null,
      storage_url:     storageUrl ?? null,
      message_link:    messageLink ?? null,
      gmail_message_id: gmailMessageId ?? null,
    }).select("id").single();
    if (error || !data) return json({ error: `Failed to create invoice: ${error?.message}` }, 500);
    table = "invoices"; recordId = data.id;
  } else if (docType === "תעודת משלוח") {
    const supplierId = await resolveOrCreateSupplier(supabase, supplierName);
    const { data, error } = await supabase.from("delivery_notes").insert({
      supplier_id:     supplierId,
      supplier_name:   supplierName ?? "",
      note_number:     "",
      date:            new Date().toISOString().slice(0, 10),
      amount:          0,
      status:          "unlinked",
      drive_file_link: driveFileLink ?? null,
      storage_url:     storageUrl ?? null,
    }).select("id").single();
    if (error || !data) return json({ error: `Failed to create delivery note: ${error?.message}` }, 500);
    table = "delivery_notes"; recordId = data.id;
  } else if (docType === "כרטסת") {
    const supplierId = await resolveOrCreateSupplier(supabase, supplierName);
    const { data, error } = await supabase.from("vendor_statements").insert({
      supplier_id:     supplierId,
      month:           body.month ?? currentMonth(),
      vendor_balance:  0,
      our_balance:     0,
      diff:            0,
      status:          "needs_review",
      uploaded_at:     new Date().toISOString(),
      drive_file_link: driveFileLink ?? null,
      storage_url:     storageUrl ?? null,
    }).select("id").single();
    if (error || !data) return json({ error: `Failed to create statement: ${error?.message}` }, 500);
    table = "vendor_statements"; recordId = data.id;
  }
  // docType 'אחר' (or anything else) → no record created; the alert is still resolved.

  // Resolve the originating alert so it leaves the active queue.
  if (alertId) {
    await supabase.from("alerts").update({ status: "resolved", resolved: true }).eq("id", alertId);
  }

  return json({ success: true, docType, table, id: recordId }, 201);
}

// ─── Gmail helpers (used by createPaymentFromAlert) ───────────────────────────

async function gmailAccessToken(): Promise<string> {
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
  const data = await resp.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Gmail token exchange failed");
  return data.access_token;
}

async function gmailLabelId(token: string, name: string): Promise<string | null> {
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { labels?: Array<{ id: string; name: string }> };
  return data.labels?.find(l => l.name === name)?.id ?? null;
}

async function gmailMarkProcessed(token: string, messageId: string, labelId: string): Promise<void> {
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ["UNREAD"] }),
    },
  );
}

// ─── Payments from alert ───────────────────────────────────────────────────────

async function createPaymentFromAlert(req: Request, supabase: SupabaseClient): Promise<Response> {
  const { alertId, supplierId } = await req.json();
  if (!alertId || !supplierId) return json({ error: "alertId and supplierId are required" }, 400);

  const { data: alert } = await supabase
    .from("alerts")
    .select("*")
    .eq("id", alertId)
    .maybeSingle();

  if (!alert) return json({ error: "Alert not found" }, 404);

  const payload = (alert.payload ?? alert.details) as Record<string, unknown> | null;
  if (!payload) return json({ error: "Alert has no payload" }, 400);

  // Insert payment (unique index on source_message_id prevents duplicates)
  let paymentId: string | null = null;
  const { data: pay, error: payErr } = await supabase.from("payments").insert({
    supplier_id:       supplierId,
    amount:            payload.amount,
    payment_type:      payload.paymentType,
    payment_date:      payload.paymentDate,
    value_date:        payload.valueDate ?? null,
    reference:         payload.reference ?? "",
    notes:             payload.notes ?? "",
    status:            "pending",
    source:            "email",
    email_received_at: payload.emailReceivedAt ?? null,
    source_message_id: payload.gmailMessageId ?? null,
  }).select("id").single();

  if (payErr) {
    if (payErr.code !== "23505") return json({ error: payErr.message }, 500);
    // 23505 = unique violation → payment already exists, proceed to mark+resolve
  } else {
    paymentId = pay?.id ?? null;
  }

  // Mark Gmail message as processed (best effort — don't fail the whole request)
  const gmailMessageId = payload.gmailMessageId as string | null;
  if (gmailMessageId) {
    try {
      const token   = await gmailAccessToken();
      const labelId = await gmailLabelId(token, "תשלומים שנקלטו");
      if (labelId) await gmailMarkProcessed(token, gmailMessageId, labelId);
    } catch (e) {
      console.error("Gmail mark-processed failed:", e);
    }
  }

  // Resolve the alert
  await supabase.from("alerts")
    .update({ status: "resolved", resolved: true })
    .eq("id", alertId);

  return json({ success: true, paymentId });
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

async function createAlert(req: Request, supabase: SupabaseClient): Promise<Response> {
  const { type, message, details } = await req.json();
  if (!type || !message) return json({ error: "type and message are required" }, 400);
  const { data, error } = await supabase.from("alerts")
    .insert({ type, message, details: details ?? null })
    .select("id").single();
  if (error || !data) return json({ error: error?.message }, 500);
  return json({ id: data.id }, 201);
}

// Delete a statement, and the stored copy of the document with it.
//
// A statement is a REPORT, not a financial record: nothing references it, and the
// ledger it is compared against is computed from invoices and payments, so
// removing one moves no balance. That is what makes a hard delete safe here where
// suppliers get deactivation instead.
//
// The Storage object goes too. Leaving it behind would accumulate files no screen
// can reach and no one can account for — the row is the only handle on them.
// A Storage failure is logged and does NOT block the row delete: an orphaned file
// is a smaller problem than a row the owner cannot get rid of.
async function deleteStatement(supabase: SupabaseClient, id: string): Promise<Response> {
  const { data: stmt } = await supabase
    .from("vendor_statements").select("id, storage_url").eq("id", id).maybeSingle();
  if (!stmt) return json({ error: "statement not found" }, 404);

  let storage = "skipped";
  const path = (stmt.storage_url ?? "").trim();
  if (path && !/^https?:\/\//i.test(path)) {
    const { error: rmErr } = await supabase.storage.from("documents").remove([path]);
    storage = rmErr ? `failed: ${rmErr.message}` : "deleted";
  }

  const { error } = await supabase.from("vendor_statements").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, storage });
}

// ─── Supplier notes (per-supplier CRM log) ────────────────────────────────────
//
// A LIST of dated, authored notes — unlike suppliers.notes, which is one
// overwritable blob. Notes belong to the SUPPLIER and are written from wherever a
// supplier is in focus; `tag` records which screen that was.
//
// `author_email` is stamped HERE from the verified JWT and is never read from the
// request body. A client-supplied author is a client-chosen author.

const NOTE_TAGS = ["suppliers", "payments", "statements"];

async function listSupplierNotes(supabase: SupabaseClient, supplierId: string): Promise<Response> {
  if (!supplierId) return json({ error: "supplierId is required" }, 400);
  const { data, error } = await supabase
    .from("supplier_notes")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false });   // newest first — the only order the panel wants
  if (error) return json({ error: error.message }, 500);
  return json(data ?? []);
}

async function createSupplierNote(
  req: Request, supabase: SupabaseClient, authorEmail?: string,
): Promise<Response> {
  const body = await req.json();
  const supplierId = String(body.supplierId ?? body.supplier_id ?? "").trim();
  const text       = String(body.body ?? "").trim();
  if (!supplierId) return json({ error: "supplierId is required" }, 400);
  if (!text)       return json({ error: "an empty note is not saved" }, 400);

  // An unknown tag is coerced rather than rejected: the tag is derived from the
  // screen, so a bad one is our bug, and losing the note would be the wrong
  // punishment for it.
  const rawTag = String(body.tag ?? "suppliers");
  const tag = NOTE_TAGS.includes(rawTag) ? rawTag : "suppliers";

  const { data, error } = await supabase
    .from("supplier_notes")
    .insert({ supplier_id: supplierId, body: text, tag, author_email: authorEmail ?? null })
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);
  return json(data, 201);
}

// Editing changes the TEXT only. The tag records where the note was born and the
// author who wrote it — rewriting either on edit would falsify the record.
async function updateSupplierNote(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const text = String(body.body ?? "").trim();
  if (!text) return json({ error: "an empty note is not saved" }, 400);

  const { data, error } = await supabase
    .from("supplier_notes")
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);
  if (!data)  return json({ error: "note not found" }, 404);
  return json(data);
}

async function deleteSupplierNote(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("supplier_notes").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Employees ────────────────────────────────────────────────────────────────

async function listEmployees(supabase: SupabaseClient): Promise<Response> {
  const { data, error } = await supabase.from("employees").select("*").order("name");
  if (error) return json({ error: error.message }, 500);
  return json(data);
}

async function createEmployee(req: Request, supabase: SupabaseClient): Promise<Response> {
  const { name, role, phone, active } = await req.json();
  if (!name) return json({ error: "name is required" }, 400);
  const { data, error } = await supabase
    .from("employees")
    .insert({ name, role: role ?? null, phone: phone ?? null, active: active ?? true })
    .select("id")
    .single();
  if (error || !data) return json({ error: error?.message, code: error?.code, details: error?.details, hint: error?.hint }, 500);
  return json({ id: data.id }, 201);
}

async function updateEmployee(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const ALLOWED: Record<string, string> = { name: "name", role: "role", phone: "phone", active: "active" };
  const updates: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(ALLOWED)) {
    if (body[key] !== undefined) updates[col] = body[key];
  }
  if (Object.keys(updates).length === 0) return json({ error: "No fields to update" }, 400);
  const { error } = await supabase.from("employees").update(updates).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function deleteEmployee(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Router ───────────────────────────────────────────────────────────────────

// Result of authenticating a request. `role` is the SERVER-DERIVED role
// ('manager' | 'employee') — read from allowed_users by the JWT's verified email,
// NEVER from anything the client can set. `viaKey` marks trusted machine calls.
interface AuthResult {
  ok: boolean;
  role?: "manager" | "employee";
  viaKey?: boolean;
  /** The JWT's VERIFIED email. The only trustworthy identity on a request — used
   *  to stamp authorship server-side so a client cannot claim to be someone else.
   *  Absent on x-hadas-key calls, which have no human behind them. */
  email?: string;
}

// Two valid auth paths:
//   1. x-hadas-key header  — N8N / cron server-to-server calls (trusted → manager)
//   2. Authorization: Bearer <jwt> — frontend user calls; role from allowed_users
async function authenticate(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
  const hadasKey = req.headers.get("x-hadas-key");
  if (hadasKey) {
    // Machine/cron identity — full trust, treated as manager.
    return validateKey(hadasKey) ? { ok: true, role: "manager", viaKey: true } : { ok: false };
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // getUser() verifies the JWT signature server-side — the email below is
    // therefore trustworthy and cannot be forged by the caller.
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { ok: false };
    const { data } = await supabase
      .from("allowed_users")
      .select("role")
      .eq("email", user.email)
      .maybeSingle();
    if (!data) return { ok: false };
    // Mirrors src/hooks/useAuth.ts: 'employee' is the only restricted role;
    // anything else (incl. 'manager' / null) is treated as manager.
    const role = (data.role as string) === "employee" ? "employee" : "manager";
    return { ok: true, role, email: user.email ?? undefined };
  }

  return { ok: false };
}

// Employee WRITE allowlist. hadas-api runs with the service-role key, which
// bypasses RLS, so role enforcement MUST live here — otherwise any authenticated
// employee JWT could create/update/delete anything.
//
// The two long-standing creates, both from EmployeeSupplierView:
//   • POST /returns        — create a manual return   (useReturns.create)
//   • POST /delivery-notes — create a manual goods-receipt (useDeliveryNotes.create)
//
// Plus the goods pipeline (spec §6.7, decision D18 — "גם עובדת וגם מנהלת"). The owner
// was explicit: employees already see invoices at the invoice level; what is withheld
// from them is the FULL LEDGER. Confirming that the goods in front of them match the
// supplier's invoice is their job, and routing it through the manager would add work
// to the one person the pipeline exists to unburden.
//
// This stays safe because the money never becomes visible: `invoices_v` NULLs the
// amount columns for a non-manager and `delivery_notes_v` does the same, so an
// employee's approval screen compares a document to goods, not figures. Aggregate
// balances remain manager-only through those same views.
//
// Everything else — payments, invoice edits, deletes, statement reconcile, bizbox
// stamp, reclassify, category/employee/supplier admin, and every GET (employees read
// via the anon client under RLS, never through this API) — stays manager-only.
// CaptureDocument posts to invoices-ingest, not here.
const EMPLOYEE_PIPELINE_WRITES: RegExp[] = [
  // The orders board is the employee screen (§7). Marking "הגיע" is the gesture the
  // whole chapter is built around, and it moves no money — it opens a delivery row
  // with no amount on it.
  /^\/orders\/[^/]+\/arrived$/,
  // Opening a pipeline for an invoice is the same class of act as attaching one:
  // it says goods are expected, and carries no figure. Dismantling is NOT here —
  // taking a chain apart is the owner's call even during the learning period.
  /^\/invoices\/[^/]+\/open-pipeline$/,
  /^\/orders\/[^/]+\/differs$/,
  /^\/delivery-notes\/[^/]+\/link$/,
  /^\/delivery-notes\/[^/]+\/unlink$/,
  /^\/invoices\/[^/]+\/ledger-approve$/,
  /^\/invoices\/[^/]+\/ledger-unapprove$/,
];

function employeeMayAccess(method: string, path: string): boolean {
  if (method === "POST" && (path === "/returns" || path === "/delivery-notes" || path === "/orders")) return true;
  // The suggestion list is a read, but it is served by this API rather than the anon
  // client because it joins invoices to the link table. Advisory only — it attaches
  // nothing, and the handler masks `total_amount` for a non-manager itself, because
  // running on the service-role key means it does NOT get invoices_v's mask for free.
  if (method === "GET" && /^\/delivery-notes\/[^/]+\/candidates$/.test(path)) return true;
  if (method === "PUT" && EMPLOYEE_PIPELINE_WRITES.some(re => re.test(path))) return true;
  return false;
}

// ─── Categories (Settings → category management) ───────────────────────────────
// Master pool = `categories` (name, usage_count). The category is stored as TEXT on
// invoices.category / suppliers.category / supplier_categories.category, so rename,
// merge and delete-with-reassign must RE-POINT those text columns — never orphaning
// a record. The AI extraction list reads from `categories` (invoices-ingest), so any
// change here feeds the picker AND the AI automatically. Manager-only at the UI level
// (Settings screen); DB role enforcement is the deferred RLS audit.

async function repointCategory(supabase: SupabaseClient, oldName: string, newName: string): Promise<void> {
  await supabase.from("invoices").update({ category: newName }).eq("category", oldName);
  await supabase.from("suppliers").update({ category: newName }).eq("category", oldName);
  await supabase.from("supplier_categories").update({ category: newName }).eq("category", oldName);
}

async function categoryUsage(supabase: SupabaseClient, name: string): Promise<number> {
  const inv = await supabase.from("invoices").select("id", { count: "exact", head: true }).eq("category", name);
  const sup = await supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("category", name);
  return (inv.count ?? 0) + (sup.count ?? 0);
}

async function listCategories(supabase: SupabaseClient): Promise<Response> {
  const { data, error } = await supabase.from("categories").select("id, name, usage_count").order("name");
  if (error) return json({ error: error.message }, 500);
  return json(data ?? []);
}

async function createCategory(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const clean = String(body.name ?? "").trim();
  if (!clean) return json({ error: "name is required" }, 400);
  const { data: existing } = await supabase.from("categories").select("id").eq("name", clean).maybeSingle();
  if (existing) return json({ error: "Category already exists", code: "DUPLICATE" }, 409);
  const { data, error } = await supabase.from("categories").insert({ name: clean, usage_count: 0 }).select("id").single();
  if (error || !data) return json({ error: error?.message }, 500);
  return json({ id: data.id }, 201);
}

async function renameCategory(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const clean = String(body.name ?? "").trim();
  if (!clean) return json({ error: "name is required" }, 400);
  const { data: cat } = await supabase.from("categories").select("name").eq("id", id).maybeSingle();
  if (!cat) return json({ error: "Category not found" }, 404);
  if (cat.name === clean) return json({ success: true });
  const { data: dup } = await supabase.from("categories").select("id").eq("name", clean).maybeSingle();
  if (dup) return json({ error: "A category with that name already exists — use merge", code: "DUPLICATE" }, 409);
  const { error } = await supabase.from("categories").update({ name: clean }).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  await repointCategory(supabase, cat.name, clean);   // cascade rename to all tagged records
  return json({ success: true });
}

async function deleteCategory(supabase: SupabaseClient, id: string, url: URL): Promise<Response> {
  const { data: cat } = await supabase.from("categories").select("name").eq("id", id).maybeSingle();
  if (!cat) return json({ error: "Category not found" }, 404);
  const reassignTo = (url.searchParams.get("reassignTo") ?? "").trim();
  const usage = await categoryUsage(supabase, cat.name);
  if (usage > 0 && !reassignTo) {
    // Never silently orphan — block and report usage so the UI can offer reassignment.
    return json({ error: "Category is in use", code: "IN_USE", usage }, 409);
  }
  if (reassignTo) {
    if (reassignTo === cat.name) return json({ error: "reassignTo must differ" }, 400);
    const { data: target } = await supabase.from("categories").select("id").eq("name", reassignTo).maybeSingle();
    if (!target) return json({ error: "reassignTo category not found" }, 400);
    await repointCategory(supabase, cat.name, reassignTo);
  }
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function mergeCategory(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const fromId = body.fromId as string, intoId = body.intoId as string;
  if (!fromId || !intoId || fromId === intoId) return json({ error: "fromId and intoId (distinct) are required" }, 400);
  const { data: from } = await supabase.from("categories").select("name, usage_count").eq("id", fromId).maybeSingle();
  const { data: into } = await supabase.from("categories").select("name, usage_count").eq("id", intoId).maybeSingle();
  if (!from || !into) return json({ error: "Category not found" }, 404);
  // Re-point every record from `from` → `into` (no orphans), sum usage, remove `from`.
  await repointCategory(supabase, from.name, into.name);
  await supabase.from("categories").update({ usage_count: (into.usage_count ?? 0) + (from.usage_count ?? 0) }).eq("id", intoId);
  const { error } = await supabase.from("categories").delete().eq("id", fromId);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true, into: into.name });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1\/hadas-api/, "")
    .replace(/^\/hadas-api/, "")
    .replace(/\/$/, "") || "/";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // SUPABASE_SERVICE_ROLE_KEY is a built-in secret injected automatically by Supabase
  // into every Edge Function — no manual configuration needed. It bypasses RLS.
  // HADAS_SERVICE_KEY was the previous custom secret; kept as fallback during transition.
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HADAS_SERVICE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const auth = await authenticate(req, supabase);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Role gate (Gap #1): employees are limited to their allowlisted writes.
  // Everything else — payments, invoices, deletes, statement reconcile, bizbox
  // stamp, reclassify, category/employee/supplier admin, and all GETs — is 403.
  if (auth.role === "employee" && !employeeMayAccess(req.method, path)) {
    return json({ error: "Forbidden — manager role required", role: "employee" }, 403);
  }

  try {
    // ── Suppliers ────────────────────────────────────────────────────────────
    if (path === "/suppliers") {
      if (req.method === "POST") return await createSupplier(req, supabase);
    }
    if (path === "/suppliers/merge" && req.method === "POST") return await mergeSuppliers(req, supabase);
    // Exclude "merge" so PUT/DELETE /suppliers/merge never treat it as an id (mirrors
    // the /categories/merge guard below).
    const supplierMatch = path.match(/^\/suppliers\/([^/]+)$/);
    if (supplierMatch && supplierMatch[1] !== "merge") {
      const id = supplierMatch[1];
      if (req.method === "PUT")    return await updateSupplier(req, supabase, id);
      if (req.method === "DELETE") return await deleteSupplier(supabase, id);
    }

    // ── Invoices ─────────────────────────────────────────────────────────────
    if (path === "/invoices") {
      if (req.method === "POST") return await createInvoice(req, supabase);
    }
    const invoiceStatusMatch = path.match(/^\/invoices\/([^/]+)\/status$/);
    if (invoiceStatusMatch && req.method === "PUT")
      return await updateInvoiceStatus(req, supabase, invoiceStatusMatch[1]);

    const invoiceApproveMatch = path.match(/^\/invoices\/([^/]+)\/approve$/);
    if (invoiceApproveMatch && req.method === "PUT")
      return await approveInvoice(supabase, invoiceApproveMatch[1]);

    // The GOODS pipeline's gate — distinct from /approve above, which clears the ₪20K
    // threshold flag. Named in full so the two can never be confused at a call site.
    const ledgerApproveMatch = path.match(/^\/invoices\/([^/]+)\/ledger-approve$/);
    if (ledgerApproveMatch && req.method === "PUT")
      return await ledgerApproveInvoice(supabase, ledgerApproveMatch[1], auth.email);
    const ledgerUnapproveMatch = path.match(/^\/invoices\/([^/]+)\/ledger-unapprove$/);
    if (ledgerUnapproveMatch && req.method === "PUT")
      return await ledgerUnapproveInvoice(supabase, ledgerUnapproveMatch[1]);

    const invoiceMatch = path.match(/^\/invoices\/([^/]+)$/);
    if (invoiceMatch) {
      const id = invoiceMatch[1];
      if (req.method === "PUT")    return await updateInvoice(req, supabase, id);
      if (req.method === "DELETE") return await deleteInvoice(supabase, id);
    }

    // ── Payments ─────────────────────────────────────────────────────────────
    if (path === "/payments") {
      if (req.method === "POST") return await createPayment(req, supabase);
    }
    if (path === "/payments/from-alert" && req.method === "POST")
      return await createPaymentFromAlert(req, supabase);
    if (path === "/payments/mark-bizbox-exported" && req.method === "POST")
      return await markBizboxExported(req, supabase);
    const paymentCancelMatch = path.match(/^\/payments\/([^/]+)\/cancel$/);
    if (paymentCancelMatch && req.method === "PUT")
      return await cancelPayment(supabase, paymentCancelMatch[1]);

    const paymentMatch = path.match(/^\/payments\/([^/]+)$/);
    if (paymentMatch) {
      const id = paymentMatch[1];
      if (req.method === "PUT") return await updatePayment(req, supabase, id);
      if (req.method === "DELETE") return await deletePayment(supabase, id);
    }

    // ── Delivery Notes ────────────────────────────────────────────────────────
    if (path === "/delivery-notes") {
      if (req.method === "POST") return await createDeliveryNote(req, supabase);
      if (req.method === "GET")  return await getDeliveryNotes(req, supabase, url);
    }
    const linkMatch   = path.match(/^\/delivery-notes\/([^/]+)\/link$/);
    const unlinkMatch = path.match(/^\/delivery-notes\/([^/]+)\/unlink$/);
    if (linkMatch   && req.method === "PUT") return await linkDeliveryNote(req, supabase, linkMatch[1], auth.email);
    if (unlinkMatch && req.method === "PUT") return await unlinkDeliveryNote(req, supabase, unlinkMatch[1]);

    // Suggested invoices for a delivery note — advisory only, never attached.
    const dnCandidates = path.match(/^\/delivery-notes\/([^/]+)\/candidates$/);
    if (dnCandidates && req.method === "GET")
      return await deliveryNoteCandidates(supabase, dnCandidates[1], auth.role);

    // PIECE 2 — auto-match an arrived (email) note {id} to a manual goods receipt.
    const dnMatchRoute = path.match(/^\/delivery-notes\/([^/]+)\/match$/);
    if (dnMatchRoute && req.method === "POST") return await matchDeliveryNote(supabase, dnMatchRoute[1]);

    const dnMatch = path.match(/^\/delivery-notes\/([^/]+)$/);
    if (dnMatch) {
      const id = dnMatch[1];
      if (req.method === "PUT")    return await updateDeliveryNote(req, supabase, id);
      if (req.method === "DELETE") return await deleteDeliveryNote(supabase, id);
    }

    // ── Orders ────────────────────────────────────────────────────────────────
    // Each of the three parts can start the chain (the owner's model): the invoice
    // leg was the one that could not.
    const openPipe = path.match(/^\/invoices\/([^/]+)\/open-pipeline$/);
    if (openPipe && req.method === "PUT")
      return await openPipelineForInvoice(supabase, openPipe[1], auth.email);

    const dismantle = path.match(/^\/delivery-notes\/([^/]+)\/dismantle$/);
    if (dismantle && req.method === "DELETE")
      return await dismantlePipeline(supabase, dismantle[1]);

    if (path === "/orders" && req.method === "POST")
      return await createOrder(req, supabase, auth.email);
    const orderArrived = path.match(/^\/orders\/([^/]+)\/arrived$/);
    if (orderArrived && req.method === "PUT")
      return await markOrderArrived(req, supabase, orderArrived[1], auth.email);
    const orderDiffers = path.match(/^\/orders\/([^/]+)\/differs$/);
    if (orderDiffers && req.method === "PUT")
      return await markOrderDiffers(supabase, orderDiffers[1]);

    // ── Returns ───────────────────────────────────────────────────────────────
    if (path === "/returns") {
      if (req.method === "POST") return await createReturn(req, supabase);
    }
    const returnStatusMatch = path.match(/^\/returns\/([^/]+)\/status$/);
    if (returnStatusMatch && req.method === "PUT")
      return await updateReturnStatus(req, supabase, returnStatusMatch[1]);

    const returnMatch = path.match(/^\/returns\/([^/]+)$/);
    if (returnMatch) {
      const id = returnMatch[1];
      if (req.method === "PUT") return await updateReturn(req, supabase, id);
    }

    // ── Statements ────────────────────────────────────────────────────────────
    if (path === "/statements") {
      if (req.method === "POST") return await createStatement(req, supabase);
    }
    const stmtResolveMatch = path.match(/^\/statements\/([^/]+)\/resolve$/);
    if (stmtResolveMatch && req.method === "PUT")
      return await resolveStatement(req, supabase, stmtResolveMatch[1]);
    const stmtReconcileMatch = path.match(/^\/statements\/([^/]+)\/reconcile$/);
    if (stmtReconcileMatch && req.method === "POST")
      return await reconcileStatement(supabase, stmtReconcileMatch[1]);
    const stmtIdMatch = path.match(/^\/statements\/([^/]+)$/);
    if (stmtIdMatch && req.method === "DELETE")
      return await deleteStatement(supabase, stmtIdMatch[1]);

    // ── Supplier notes ────────────────────────────────────────────────────────
    if (path === "/supplier-notes") {
      if (req.method === "GET")
        return await listSupplierNotes(supabase, url.searchParams.get("supplierId") ?? "");
      if (req.method === "POST")
        return await createSupplierNote(req, supabase, auth.email);
    }
    const noteIdMatch = path.match(/^\/supplier-notes\/([^/]+)$/);
    if (noteIdMatch) {
      if (req.method === "PUT")    return await updateSupplierNote(req, supabase, noteIdMatch[1]);
      if (req.method === "DELETE") return await deleteSupplierNote(supabase, noteIdMatch[1]);
    }

    // ── Employees ─────────────────────────────────────────────────────────────
    if (path === "/employees") {
      if (req.method === "GET")  return await listEmployees(supabase);
      if (req.method === "POST") return await createEmployee(req, supabase);
    }
    const employeeMatch = path.match(/^\/employees\/([^/]+)$/);
    if (employeeMatch) {
      const id = employeeMatch[1];
      if (req.method === "PUT")    return await updateEmployee(req, supabase, id);
      if (req.method === "DELETE") return await deleteEmployee(supabase, id);
    }

    // ── Alerts ────────────────────────────────────────────────────────────────
    if (path === "/alerts" && req.method === "POST") return await createAlert(req, supabase);

    // ── Categories (Settings → category management) ────────────────────────────
    if (path === "/categories") {
      if (req.method === "GET")  return await listCategories(supabase);
      if (req.method === "POST") return await createCategory(req, supabase);
    }
    if (path === "/categories/merge" && req.method === "POST") return await mergeCategory(req, supabase);
    const categoryMatch = path.match(/^\/categories\/([^/]+)$/);
    if (categoryMatch && categoryMatch[1] !== "merge") {
      if (req.method === "PUT")    return await renameCategory(req, supabase, categoryMatch[1]);
      if (req.method === "DELETE") return await deleteCategory(supabase, categoryMatch[1], url);
    }

    // ── Documents ─────────────────────────────────────────────────────────────
    // Re-classify a misclassified document into the correct table (see document_misclassified).
    if (path === "/documents/reclassify" && req.method === "POST") return await reclassifyDocument(req, supabase);

    return json({ error: "Not Found" }, 404);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal Server Error", details: msg }, 500);
  }
});
