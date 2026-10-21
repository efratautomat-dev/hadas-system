// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  google-auth (shared)                                                     ║
// ║  The ONE place an edge function turns the project's Google refresh token   ║
// ║  into an access token.                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// There is no service account. Drive and Gmail share a single OAuth identity,
// configured project-wide as GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET /
// GMAIL_REFRESH_TOKEN. That identity uploaded the invoice files, so it is also
// the one authorized to list, copy and trash them.
//
// WHY THIS FILE EXISTS. The same token exchange was written inline five times
// (invoices-ingest, hadas-api twice, drive-reconcile, drive-probe, drive-migrate).
// A sixth copy was about to be written for a job that runs UNATTENDED once a
// week — the one caller where a credential change failing silently costs seven
// days before anyone notices. The canonical home now exists; the remaining inline
// copies in drive-probe / drive-migrate are one-off scripts and should migrate
// opportunistically when each is next opened, not in a backup feature's diff.
//
// Depends only on the Fetch API, so it bundles into any of the functions.

/**
 * Exchanges the project's refresh token for a short-lived access token.
 * Throws with the provider's own text on failure — a caller that cannot reach
 * Google must fail loudly, never proceed with an empty token.
 */
export async function getGoogleAccessToken(): Promise<string> {
  const clientId     = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");

  // Named explicitly rather than non-null-asserted: "Google token exchange
  // failed: 400 invalid_request" sends the reader to Google's docs, while
  // "GMAIL_REFRESH_TOKEN is not set" sends them to the one place that fixes it.
  const missing = [
    !clientId     && "GMAIL_CLIENT_ID",
    !clientSecret && "GMAIL_CLIENT_SECRET",
    !refreshToken && "GMAIL_REFRESH_TOKEN",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Google credentials missing from the environment: ${missing.join(", ")}`);
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      client_id:     clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
      grant_type:    "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`Google token exchange failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`No access_token: ${data.error ?? "unknown"}`);
  return data.access_token;
}

/**
 * Are the three Google secrets present? Mirrors the `driveConfigured` check
 * hadas-api already makes before attempting a Drive side-effect, so a function
 * can skip Drive work cleanly instead of failing on a token exchange.
 */
export function googleConfigured(): boolean {
  return !!(
    Deno.env.get("GMAIL_CLIENT_ID") &&
    Deno.env.get("GMAIL_CLIENT_SECRET") &&
    Deno.env.get("GMAIL_REFRESH_TOKEN")
  );
}
