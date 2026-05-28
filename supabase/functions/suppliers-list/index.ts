import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return !!expected && key === expected;
}

// ─── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("HADAS_SERVICE_KEY") ??
    "";
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    // Suppliers with a usable email — `status` is not a DB column, so the
    // active-only intent collapses to "has an address we can mail to".
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, email")
      .not("email", "is", null)
      .neq("email", "")
      .order("name", { ascending: true });

    if (error) {
      return json({ error: error.message }, 500);
    }

    const suppliers = (data ?? []).map((s) => ({
      id:    s.id as string,
      name:  s.name as string,
      email: s.email as string,
    }));

    return json({ count: suppliers.length, suppliers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
