import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

// ─── Suppliers ────────────────────────────────────────────────────────────────
// Whitelist: id, name, hp, category, contact, email, phone, opening_balance, notes, alt_names, linked_invoices
// Excluded (no DB column): opening_balance_date, status, paymentTerms, lastOrderDate, balance

async function createSupplier(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const { name, hp, category, contact, email, phone, openingBalance, notes } = body;
  if (!name) return json({ error: "name is required" }, 400);

  const { data, error } = await supabase.from("suppliers")
    .insert({
      name,
      hp:              hp       ?? null,
      category:        category ?? null,
      contact:         contact  ?? null,
      email:           email    ?? null,
      phone:           phone    ?? null,
      opening_balance: openingBalance ?? 0,
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
    notes:          "notes",
  };
  const updates: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(ALLOWED)) {
    if (body[key] !== undefined) updates[col] = body[key];
  }
  if (Object.keys(updates).length === 0) return json({ error: "No fields to update" }, 400);

  const { error } = await supabase.from("suppliers").update(updates).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function deleteSupplier(supabase: SupabaseClient, id: string): Promise<Response> {
  const { count } = await supabase.from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("supplier_id", id);
  if (count && count > 0) return json({ error: "Supplier has invoices", code: "HAS_INVOICES" }, 409);

  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
// Accepts camelCase from the frontend AND snake_case from N8N/direct calls.
// Fields removed: date (display string), isPartialReturn, emailId, uploadDate,
//                 duplicateFlag, duplicateNote (no DB columns for these).

function invoiceToRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  // camelCase → DB snake_case (frontend)
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

  // snake_case passthrough (N8N / direct API)
  const SNAKE = [
    "supplier_id", "supplier_name", "invoice_date", "invoice_number",
    "amount_before_vat", "vat_amount", "total_amount", "line_items",
    "sender_name", "email_sender", "drive_file_link", "drive_folder_link",
    "message_link", "received_at", "execution_log_url", "ai_confidence",
    "is_duplicate", "has_error", "status", "category",
    "invoice_type", "external_link", "error_reason", "html_content",
    "ai_missing_fields", "transferred_at",
  ];
  for (const col of SNAKE) {
    if (body[col] !== undefined) row[col] = body[col];
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

  const { error } = await supabase.from("invoices").update(row).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function updateInvoiceStatus(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const { status } = await req.json();
  if (!status) return json({ error: "status is required" }, 400);
  const { error } = await supabase.from("invoices").update({ status }).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function deleteInvoice(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Payments ─────────────────────────────────────────────────────────────────
// Whitelist: supplier_id (resolved from name if needed), amount, payment_type,
//            payment_date, reference, value_date, notes, status
// Excluded (no DB column): supplier (name stored in suppliers table, not here)

async function resolveSupplierIdByName(
  supabase: SupabaseClient,
  name: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("suppliers")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  return data?.id ?? null;
}

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
  } else if (body.supplier) {
    supplierId = await resolveSupplierIdByName(supabase, body.supplier as string);
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
  } else if (body.supplier) {
    supplierId = await resolveSupplierIdByName(supabase, body.supplier as string);
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

// ─── Delivery Notes ───────────────────────────────────────────────────────────
// updateDeliveryNote whitelist: status, invoice_id, amount, date, supplier_name
// Excluded (no DB column): notes, isoDate

async function createDeliveryNote(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  const { supplier_name, note_number, date, amount, amount_before_vat, vat_amount, line_items, source_email, received_at } = body;
  if (!supplier_name || !note_number || !date || amount == null)
    return json({ error: "Missing required fields" }, 400);

  let supplierId: string;
  const { data: existing } = await supabase.from("suppliers").select("id").eq("name", supplier_name).maybeSingle();
  if (existing) {
    supplierId = existing.id;
  } else {
    const { data: created, error: createErr } = await supabase.from("suppliers").insert({ name: supplier_name }).select("id").single();
    if (createErr || !created) return json({ error: "Failed to create supplier", details: createErr?.message }, 500);
    supplierId = created.id;
  }

  const { data: note, error: noteErr } = await supabase.from("delivery_notes")
    .insert({
      supplier_id: supplierId, supplier_name, note_number, date, amount,
      amount_before_vat: amount_before_vat ?? null,
      vat_amount:        vat_amount        ?? null,
      line_items:        line_items        ?? null,
      source_email:      source_email      ?? null,
      received_at:       received_at       ?? null,
      status: "unlinked",
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

async function linkDeliveryNote(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const { invoice_id } = await req.json();
  if (!invoice_id) return json({ error: "invoice_id is required" }, 400);
  const { error } = await supabase.from("delivery_notes")
    .update({ invoice_id, status: "linked" })
    .eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function unlinkDeliveryNote(supabase: SupabaseClient, id: string): Promise<Response> {
  const { error } = await supabase.from("delivery_notes")
    .update({ invoice_id: null, status: "unlinked" })
    .eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ─── Returns ──────────────────────────────────────────────────────────────────
// Whitelist: supplier_id, date (from dateIso), amount, reason, invoice_id,
//            status, created_by
// Excluded: id (DB auto-generates), date display string, supplier name (no column),
//           dateIso key (value maps to `date`), originalInvoiceId key → invoice_id

function returnToRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (body.supplierId        !== undefined) row.supplier_id = body.supplierId;
  if (body.dateIso           !== undefined) row.date        = body.dateIso;   // ISO value → date column
  if (body.amount            !== undefined) row.amount      = body.amount;
  if (body.reason            !== undefined) row.reason      = body.reason;
  if (body.originalInvoiceId !== undefined) row.invoice_id  = body.originalInvoiceId;
  if (body.status            !== undefined) row.status      = body.status;
  if (body.createdBy         !== undefined) row.created_by  = body.createdBy;
  // Intentionally excluded: body.id, body.date (display), body.supplier (no column)
  return row;
}

async function createReturn(req: Request, supabase: SupabaseClient): Promise<Response> {
  const body = await req.json();
  if (!body.supplierId || !body.amount || !body.reason)
    return json({ error: "supplierId, amount, reason are required" }, 400);

  const row = returnToRow(body);
  const { data, error } = await supabase.from("returns").insert(row).select("id").single();
  if (error || !data) return json({ error: error?.message }, 500);

  if (body.status === "אושר") {
    await supabase.rpc("decrement_supplier_balance", { p_supplier_id: body.supplierId, p_amount: body.amount });
  }

  return json({ id: data.id }, 201);
}

async function updateReturn(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const { data: prev } = await supabase.from("returns")
    .select("status, supplier_id, amount")
    .eq("id", id)
    .maybeSingle();

  const row = returnToRow(body);
  if (Object.keys(row).length === 0) return json({ error: "No fields to update" }, 400);

  const { error } = await supabase.from("returns").update(row).eq("id", id);
  if (error) return json({ error: error.message }, 500);

  if (prev) {
    const supplierId = body.supplierId ?? prev.supplier_id;
    const newAmount  = body.amount     ?? prev.amount;
    if (prev.status !== "אושר" && body.status === "אושר") {
      await supabase.rpc("decrement_supplier_balance", { p_supplier_id: supplierId, p_amount: newAmount });
    } else if (prev.status === "אושר" && body.status && body.status !== "אושר") {
      await supabase.rpc("increment_supplier_balance", { p_supplier_id: supplierId, p_amount: prev.amount });
    } else if (prev.status === "אושר" && body.status === "אושר" && body.amount !== undefined && body.amount !== prev.amount) {
      const diff = body.amount - prev.amount;
      if (diff !== 0) await supabase.rpc("decrement_supplier_balance", { p_supplier_id: supplierId, p_amount: diff });
    }
  }

  return json({ success: true });
}

async function updateReturnStatus(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const { status } = await req.json();
  if (!status) return json({ error: "status is required" }, 400);

  const { data: prev } = await supabase.from("returns")
    .select("status, supplier_id, amount")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("returns").update({ status }).eq("id", id);
  if (error) return json({ error: error.message }, 500);

  if (prev) {
    if (prev.status !== "אושר" && status === "אושר") {
      await supabase.rpc("decrement_supplier_balance", { p_supplier_id: prev.supplier_id, p_amount: prev.amount });
    } else if (prev.status === "אושר" && status !== "אושר") {
      await supabase.rpc("increment_supplier_balance", { p_supplier_id: prev.supplier_id, p_amount: prev.amount });
    }
  }

  return json({ success: true });
}

// ─── Statements ───────────────────────────────────────────────────────────────
// Whitelist: supplier_id, month, our_balance, vendor_balance, diff, status, uploaded_at
// Excluded: supplier_name (no DB column), id (DB auto-generates)

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
      // supplier_name intentionally excluded — no such column in vendor_statements
    })
    .select("id").single();

  if (error || !data) return json({ error: error?.message }, 500);
  return json({ id: data.id }, 201);
}

async function resolveStatement(req: Request, supabase: SupabaseClient, id: string): Promise<Response> {
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.status        !== undefined) updates.status         = body.status;
  if (body.ourBalance    !== undefined) updates.our_balance    = body.ourBalance;
  if (body.vendorBalance !== undefined) updates.vendor_balance = body.vendorBalance;
  if (body.diff          !== undefined) updates.diff           = body.diff;

  if (Object.keys(updates).length === 0) return json({ error: "No fields to update" }, 400);
  const { error } = await supabase.from("vendor_statements").update(updates).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
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

// ─── Router ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1\/hadas-api/, "")
    .replace(/^\/hadas-api/, "")
    .replace(/\/$/, "") || "/";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("HADAS_SERVICE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const hadasKey = req.headers.get("x-hadas-key");
  if (!validateKey(hadasKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    // ── Suppliers ────────────────────────────────────────────────────────────
    if (path === "/suppliers") {
      if (req.method === "POST") return await createSupplier(req, supabase);
    }
    const supplierMatch = path.match(/^\/suppliers\/([^/]+)$/);
    if (supplierMatch) {
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
    const paymentCancelMatch = path.match(/^\/payments\/([^/]+)\/cancel$/);
    if (paymentCancelMatch && req.method === "PUT")
      return await cancelPayment(supabase, paymentCancelMatch[1]);

    const paymentMatch = path.match(/^\/payments\/([^/]+)$/);
    if (paymentMatch) {
      const id = paymentMatch[1];
      if (req.method === "PUT") return await updatePayment(req, supabase, id);
    }

    // ── Delivery Notes ────────────────────────────────────────────────────────
    if (path === "/delivery-notes") {
      if (req.method === "POST") return await createDeliveryNote(req, supabase);
      if (req.method === "GET")  return await getDeliveryNotes(req, supabase, url);
    }
    const linkMatch   = path.match(/^\/delivery-notes\/([^/]+)\/link$/);
    const unlinkMatch = path.match(/^\/delivery-notes\/([^/]+)\/unlink$/);
    if (linkMatch   && req.method === "PUT") return await linkDeliveryNote(req, supabase, linkMatch[1]);
    if (unlinkMatch && req.method === "PUT") return await unlinkDeliveryNote(supabase, unlinkMatch[1]);

    const dnMatch = path.match(/^\/delivery-notes\/([^/]+)$/);
    if (dnMatch) {
      const id = dnMatch[1];
      if (req.method === "PUT")    return await updateDeliveryNote(req, supabase, id);
      if (req.method === "DELETE") return await deleteDeliveryNote(supabase, id);
    }

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

    // ── Alerts ────────────────────────────────────────────────────────────────
    if (path === "/alerts" && req.method === "POST") return await createAlert(req, supabase);

    return json({ error: "Not Found" }, 404);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: "Internal Server Error", details: msg }, 500);
  }
});
