// Israeli VAT rate.
//
// The rate is set by law and changes on a DATE — it rose from 17% to 18% on
// 1 Jan 2025. A single hard-coded constant is therefore wrong: it either
// mis-splits today's invoices (if left at 17%) or retroactively mis-splits every
// invoice dated before the change (if bumped to 18%). Both matter here, because
// the owner still back-enters and corrects older invoices.
//
// So the rate is looked up by the INVOICE DATE, from a table of the bands.

interface VatBand {
  /** First date (inclusive, YYYY-MM-DD) on which this rate applies. */
  from: string
  rate: number
}

// Newest first — vatRateFor() returns the first band whose `from` is on or
// before the date. Add a row at the TOP when the rate changes again.
const VAT_BANDS: VatBand[] = [
  { from: '2025-01-01', rate: 0.18 },
  { from: '2015-10-01', rate: 0.17 },
]

// Anything dated before the oldest band (or with an unparseable date) falls back
// to the oldest known rate rather than throwing.
const OLDEST = VAT_BANDS[VAT_BANDS.length - 1]

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/

function toIsoDay(date?: string | Date | null): string {
  if (date instanceof Date && !isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  if (typeof date === 'string' && ISO_DAY.test(date)) return date.slice(0, 10)
  // No usable date (new invoice, empty form) → today's rate.
  return new Date().toISOString().slice(0, 10)
}

/**
 * The VAT rate that applied on `date` (an ISO `YYYY-MM-DD` string, a Date, or
 * empty for today). Returns a fraction: 0.18, not 18.
 */
export function vatRateFor(date?: string | Date | null): number {
  const day = toIsoDay(date)
  for (const band of VAT_BANDS) {
    if (day >= band.from) return band.rate
  }
  return OLDEST.rate
}

/** The rate as a whole number for display — 18, not 0.18. */
export function vatPercentFor(date?: string | Date | null): number {
  return Math.round(vatRateFor(date) * 100)
}

/** VAT rate in force today. For places with no invoice date to key on. */
export const VAT_RATE_TODAY = vatRateFor()

// ── Completing the three amounts ────────────────────────────────────────────
//
// An invoice always carries THREE amounts: net (before VAT), VAT, and gross
// (total). A supplier document rarely prints all three, and the AI extractor
// returns 0 for whatever it could not read — so rows arrive with holes. This is
// the single place that fills them, used by both the invoice form and ingest.

type AmountLike = number | string | null | undefined

export interface Amounts {
  net: number
  vat: number
  gross: number
}

/** Which field the user just typed. That field is authoritative and is never overwritten. */
export type EditedAmount = 'net' | 'vat' | 'gross'

function num(v: AmountLike): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Round to AGOROT — two decimals. Israeli invoices are billed to the agora, so
 * rounding to whole shekels would throw away real money on every split. The
 * ×100 / ÷100 also pins the binary-float noise (0.1 + 0.2 = 0.30000000000000004)
 * that would otherwise accumulate through the derivations below.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Return all three amounts, completed from whichever ones are present.
 *
 * `edited` names the field the user just typed: it is kept exactly as given and
 * the other two are recomputed from it. With `edited` omitted (opening a
 * document) **nothing already filled in is touched** — only the holes are
 * closed, so a value read off the document always wins over a calculation.
 *
 * Works on MAGNITUDES. Credit notes are negative invoices, but the sign is owned
 * by `applyCreditSign` (`creditNote.ts`) / by ingest, never by this function —
 * so completing amounts can never flip a credit note into a charge.
 *
 * Wherever two amounts are known, the third is their exact difference or sum, so
 * `net + vat === gross` holds to the agora. Only when a single amount is known
 * is the rate used, and then VAT is taken as the REMAINDER (see `06-RULES.md §3`).
 */
export function completeAmounts(
  input: { net?: AmountLike; vat?: AmountLike; gross?: AmountLike },
  opts: { rate: number; edited?: EditedAmount | null },
): Amounts {
  const { rate, edited = null } = opts

  const net   = Math.abs(num(input.net))
  const vat   = Math.abs(num(input.vat))
  const gross = Math.abs(num(input.gross))

  // Split a gross total: net is rounded to the agora, VAT is the remainder, so
  // the total the supplier actually billed is preserved exactly.
  const fromGross = (g: number): Amounts => {
    const n = round2(g / (1 + rate))
    return { net: n, vat: round2(g - n), gross: g }
  }

  if (edited === 'gross') return fromGross(gross)

  if (edited === 'net') {
    const v = round2(net * rate)
    return { net, vat: v, gross: round2(net + v) }
  }

  if (edited === 'vat') {
    // Editing VAT usually means correcting a rounding on a document whose net is
    // printed — so keep the net and let the total absorb the change. Only when
    // there is no net yet is one derived from the VAT.
    const n = net > 0 ? net : round2(vat / rate)
    return { net: n, vat, gross: round2(n + vat) }
  }

  // No edit — fill holes only. A zero VAT is a legitimate value (exempt/foreign
  // supplier), and the pairs below reproduce it exactly: with net and gross both
  // known and equal, VAT comes out 0 rather than being invented.
  const hasNet = net > 0, hasVat = vat > 0, hasGross = gross > 0

  if (hasGross && hasNet) return { net, vat: round2(gross - net), gross }
  if (hasGross && hasVat) return { net: round2(gross - vat), vat, gross }
  if (hasNet && hasVat)   return { net, vat, gross: round2(net + vat) }

  if (hasGross) return fromGross(gross)
  if (hasNet) {
    const v = round2(net * rate)
    return { net, vat: v, gross: round2(net + v) }
  }
  if (hasVat) {
    const n = round2(vat / rate)
    return { net: n, vat, gross: round2(n + vat) }
  }
  return { net: 0, vat: 0, gross: 0 }
}
