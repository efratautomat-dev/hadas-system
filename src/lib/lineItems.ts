import { completeAmounts, vatRateFor, type Amounts } from './vat'

// ── פריטים, כמויות ומחירים — the data half ───────────────────────────────────
//
// Split from the editor component because a file that exports components must
// export ONLY components (react-refresh). Same reason the customer-status labels
// live apart from StatusBadge: one source, two readers, and neither is a screen.

export interface Line {
  key: string
  item: string
  quantity: string
  /**
   * Cost per UNIT, as written on the goods.
   *
   * The owner's decision: three columns to fill by hand — item, quantity, unit
   * price — and the system does the arithmetic. Which is why the column is
   * labelled "מחיר ליחידה" and not "מחיר": one word decides whether every total
   * comes out right or multiplied by the quantity, and a wrong total that looks
   * plausible is the kind nobody catches.
   */
  price: string
  /** Set only by the reader — a line it was unsure of. Cleared once edited. */
  uncertain?: boolean
}

export const newLine = (): Line => ({
  key: `l_${Math.random().toString(36).slice(2, 9)}`,
  item: '', quantity: '', price: '',
})

/**
 * Σ price × quantity — and ONLY when every filled line carries a price.
 *
 * A partial sum looks like the delivery's value and is not, which is worse than no
 * number at all: nobody re-checks a figure that is already sitting there. `null`
 * means "not known", which is a different claim from zero.
 */
/** One line's cost: unit price × quantity. Quantity absent counts as one. */
export function rowTotal(l: Line): number | null {
  if (!l.price.trim()) return null
  return (Number(l.price) || 0) * (Number(l.quantity) || 1)
}

export function lineTotal(lines: Line[]): number | null {
  const filled = lines.filter(l => l.item.trim())
  if (filled.length === 0) return null
  if (filled.some(l => !l.price.trim())) return null
  return filled.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 1), 0)
}

/**
 * The three amounts a typed grid produces — net, VAT and gross.
 *
 * The owner's rule, and it is how her suppliers' own notes are written: the price
 * column is **before VAT**, exactly as it is printed on the goods, and the total
 * the delivery is worth adds VAT on top. Summing the column and calling it the
 * total under-states every delivery recorded by hand by 18%, and it under-states
 * it in the direction of paying less than is owed — the error nobody notices
 * until the supplier's statement disagrees.
 *
 * The rate is keyed on the delivery's DATE, never on today: `vatRateFor` knows
 * 17% before 1.1.2025 and 18% after it. `null` when the column is not fully
 * priced, because a partial total looks like a real one.
 */
export function lineAmounts(lines: Line[], isoDate?: string | null): Amounts | null {
  const net = lineTotal(lines)
  if (net === null) return null
  return completeAmounts({ net }, { rate: vatRateFor(isoDate), edited: 'net' })
}

/** One line per item, in the shape a typed receipt has always been stored in. */
export function linesToText(lines: Line[]): string {
  return lines
    .filter(l => l.item.trim())
    .map(l => {
      const q = l.quantity.trim() ? ` — ${l.quantity.trim()}` : ''
      const p = l.price.trim() ? ` · ₪${l.price.trim()}` : ''
      return `${l.item.trim()}${q}${p}`
    })
    .join('\n')
}

