import type { CSSProperties } from 'react'

// ── The one filter row ───────────────────────────────────────────────────────
//
// Filter chips were solid brand-coloured pills — the same weight as the primary
// ACTION on the page, for something that only changes what you are looking at.
// Five of them in a row read as five decisions to make before you can start.
//
// Underlined tabs instead: text only, and a rule beneath that thickens on the one
// in use. Nothing but weight and a line separates selected from not, which is all
// the distinction actually needs and leaves colour free to mean "do this".
//
// Shared because the same row exists on the goods, invoices, returns and payments
// screens. Four copies of a control is four chances for them to stop matching.

export interface FilterTab<K extends string> {
  key: K
  label: string
  /** Shown beside the label. Omit or 0 to show nothing — a zero is not news. */
  count?: number
}

export function FilterTabs<K extends string>({
  tabs, value, onChange, style,
}: {
  tabs: FilterTab<K>[]
  value: K
  onChange: (key: K) => void
  style?: CSSProperties
}) {
  return (
    <div
      role="tablist"
      className="flex items-end gap-1"
      style={{
        // The hairline runs the full width and the active tab sits ON it, so the
        // row reads as one surface rather than as separate buttons.
        borderBottom: '1px solid #E9EAEF',
        // One row, always. Wrapping put a lone tab on a second line, aligned to
        // the wrong edge and detached from the hairline it is supposed to sit on —
        // which is what a narrow tablet actually does to this row. Scrolling keeps
        // the shape and keeps every tab reachable.
        flexWrap: 'nowrap',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        ...style,
      }}
    >
      {tabs.map(t => {
        const on = t.key === value
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className="inline-flex items-center gap-1.5"
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${on ? 'var(--brand-primary)' : 'transparent'}`,
              borderRadius: 0,
              padding: '8px 12px',
              marginBottom: '-1px',
              fontSize: '13.5px',
              fontWeight: on ? 700 : 500,
              color: on ? 'var(--brand-primary)' : '#7A7D85',
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              // The row scrolls rather than wraps, so a tab must keep its size.
              flexShrink: 0,
            }}
          >
            {t.label}
            {!!t.count && (
              <span
                style={{
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: on ? 'var(--brand-primary)' : '#9CA3AF',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default FilterTabs
