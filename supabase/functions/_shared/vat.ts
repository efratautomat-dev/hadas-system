// Israeli VAT — Deno-side copy of `src/lib/vat.ts`.
//
// ⚠️ THE TWO FILES MUST BE CHANGED TOGETHER. They cannot be one file: the
// frontend is bundled by Vite from `src/`, the edge functions run on Deno and
// `.vercelignore` keeps `supabase/` out of the frontend build, so neither side
// can import the other. The logic below is a deliberate mirror — keep the band
// table and the completion rules identical.
//
// The rate is set by law and changes on a DATE (17% → 18% on 1.1.2025), so it is
// looked up by the INVOICE's own date, never by "today". A document issued in
// 2024 that arrives by email in 2026 must still split at 17%.

interface VatBand {
  /** First date (inclusive, YYYY-MM-DD) on which this rate applies. */
  from: string;
  rate: number;
}

// Newest first. Add a row at the TOP when the rate changes again.
const VAT_BANDS: VatBand[] = [
  { from: "2025-01-01", rate: 0.18 },
  { from: "2015-10-01", rate: 0.17 },
];

const OLDEST = VAT_BANDS[VAT_BANDS.length - 1];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

function toIsoDay(date?: string | null): string {
  if (typeof date === "string" && ISO_DAY.test(date)) return date.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/** The VAT rate that applied on `date` (ISO `YYYY-MM-DD`, or empty for today). */
export function vatRateFor(date?: string | null): number {
  const day = toIsoDay(date);
  for (const band of VAT_BANDS) {
    if (day >= band.from) return band.rate;
  }
  return OLDEST.rate;
}

export interface Amounts {
  net:   number;
  vat:   number;
  gross: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Round to AGOROT — two decimals. Israeli invoices are billed to the agora, so
 * rounding to whole shekels would throw away real money on every split. The
 * ×100 / ÷100 also pins binary-float noise.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Complete the three amounts from whichever ones the extractor managed to read.
 *
 * The AI returns 0 for anything it could not find, so a document that prints
 * only a total lands with net = vat = 0. This closes those holes at INGEST, so
 * the row is complete in the database rather than only in the invoice form.
 *
 * **Only holes are filled** — a value the extractor did read off the document is
 * never overwritten by a calculation. Where two amounts are known the third is
 * their exact difference or sum; only when a single one is known is the rate
 * used, and then VAT is the REMAINDER so `net + vat === gross` exactly.
 *
 * Works on MAGNITUDES. The credit-note sign is forced separately by the caller
 * (`-Math.abs`, see `handleInvoiceFile`), so completion can never flip a sign.
 */
export function completeAmounts(
  input: { net?: unknown; vat?: unknown; gross?: unknown },
  rate: number,
): Amounts {
  const net   = Math.abs(num(input.net));
  const vat   = Math.abs(num(input.vat));
  const gross = Math.abs(num(input.gross));

  const hasNet = net > 0, hasVat = vat > 0, hasGross = gross > 0;

  // A zero VAT is legitimate (exempt / foreign supplier): with net and gross both
  // known and equal, the first branch yields 0 rather than inventing a VAT.
  if (hasGross && hasNet) return { net, vat: round2(gross - net), gross };
  if (hasGross && hasVat) return { net: round2(gross - vat), vat, gross };
  if (hasNet && hasVat)   return { net, vat, gross: round2(net + vat) };

  if (hasGross) {
    const n = round2(gross / (1 + rate));
    return { net: n, vat: round2(gross - n), gross };
  }
  if (hasNet) {
    const v = round2(net * rate);
    return { net, vat: v, gross: round2(net + v) };
  }
  if (hasVat) {
    const n = round2(vat / rate);
    return { net: n, vat, gross: round2(n + vat) };
  }
  return { net: 0, vat: 0, gross: 0 };
}
