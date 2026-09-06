// ── פריטים, כמויות ומחירים — the data half ───────────────────────────────────
//
// Split from the editor component because a file that exports components must
// export ONLY components (react-refresh). Same reason the customer-status labels
// live apart from StatusBadge: one source, two readers, and neither is a screen.

export interface Line {
  key: string
  item: string
  quantity: string
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
export function lineTotal(lines: Line[]): number | null {
  const filled = lines.filter(l => l.item.trim())
  if (filled.length === 0) return null
  if (filled.some(l => !l.price.trim())) return null
  return filled.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 1), 0)
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

