// The line-item text format — Deno-side copy of `src/lib/lineItemsFormat.ts`.
//
// ⚠️ THE TWO FILES MUST BE CHANGED TOGETHER. `invoices-ingest` WRITES this format
// into `delivery_notes.line_items`; the React screens PARSE it back into a table.
// They cannot be one file: Vite bundles from `src/`, the edge functions run on
// Deno, and `.vercelignore` keeps `supabase/` out of the frontend build.
//
// `scripts/check-twins.mjs` compares everything below this header and fails
// `npm run lint` the moment they diverge. Copy the whole file; do not patch one
// side — a writer and a reader that disagree about a separator lose every
// quantity and every price silently, which is the bug this format was added to fix.
export interface ParsedLine {
  item: string
  /** '' when the note did not say. Not 1 — an assumed quantity is a made-up one. */
  quantity: string
  /** Cost per UNIT, as printed. '' when absent. */
  price: string
}

/** ` — 12` for the quantity, ` · ₪4.90` for the unit price. Both optional. */
export function lineToText(l: ParsedLine): string {
  const item = l.item.trim()
  if (!item) return ''
  const q = l.quantity.trim() ? ` — ${l.quantity.trim()}` : ''
  const p = l.price.trim() ? ` · ₪${l.price.trim()}` : ''
  return `${item}${q}${p}`
}

/** One line per item, in the shape a typed receipt has always been stored in. */
export function linesToText(lines: ParsedLine[]): string {
  return lines.map(lineToText).filter(Boolean).join('\n')
}

/**
 * Read the format back. Best-effort, and deliberately forgiving:
 *
 * - a line that matches fully gives item + quantity + price
 * - a line with only one of them gives that one
 * - a line that matches nothing becomes an item with no figures, which is exactly
 *   what the old rows are and what a photo of a handwritten page produces
 *
 * It never throws and never drops a line. A parser that discards what it cannot
 * read turns a note the reader could still have used into an empty panel.
 */
export function parseLines(text: string | null | undefined): ParsedLine[] {
  if (!text) return []
  return String(text)
    .split('\n')
    .map(raw => raw.trim())
    .filter(Boolean)
    .map(raw => {
      // Price first: it is anchored by the ₪ and so is the least ambiguous.
      // `·` is the separator the writer emits, but a note pasted by hand may use
      // a plain dash, so the currency sign is what actually identifies it.
      let rest = raw
      let price = ''
      const priceMatch = rest.match(/[·|-]?\s*₪\s*([\d.,]+)\s*$/)
      if (priceMatch) {
        price = priceMatch[1].replace(/,/g, '')
        rest = rest.slice(0, priceMatch.index).trim()
      }
      // Quantity: an em-dash and a number at the end of what is left. A dash
      // INSIDE a product name ("קמח 1-2") survives, because the number must be
      // the last thing on the line.
      let quantity = ''
      const qtyMatch = rest.match(/\s[—–-]\s*([\d.,]+)\s*$/)
      if (qtyMatch) {
        quantity = qtyMatch[1].replace(/,/g, '')
        rest = rest.slice(0, qtyMatch.index).trim()
      }
      return { item: rest.replace(/[·—–-]\s*$/, '').trim(), quantity, price }
    })
    .filter(l => l.item || l.quantity || l.price)
}

/** Σ unit price × quantity, and ONLY when every line carries a price.
 *
 * `null` means "not known", which is a different claim from zero. A partial sum
 * looks like the delivery's value and is not — and nobody re-checks a figure that
 * is already sitting there. Same rule as `lineTotal` in `./lineItems`, which is
 * the editor's copy of this arithmetic for lines being typed.
 */
export function parsedTotal(lines: ParsedLine[]): number | null {
  const filled = lines.filter(l => l.item)
  if (filled.length === 0) return null
  if (filled.some(l => !l.price)) return null
  return filled.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 1), 0)
}
