import type { ComponentType } from 'react'
import { STATUS } from '../../theme/status'

// ─────────────────────────────────────────────────────────────────────────────
// Shared top-of-screen SUMMARY CARDS — one consistent family across every screen
// (reference: the Payments summary tiles). White card, hairline border, 16px
// radius, soft shadow; right-aligned label + bold value, with a tone-colored icon
// chip on the left. Tones come from the FIXED status tokens (+ brand + neutral),
// so they reskin/stay consistent automatically. Columns adapt to item count.
// ─────────────────────────────────────────────────────────────────────────────

export type SummaryTone = 'brand' | 'blue' | 'orange' | 'yellow' | 'green' | 'red' | 'neutral'

const TONES: Record<SummaryTone, { bg: string; color: string }> = {
  brand:   { bg: 'var(--brand-active-bg)', color: 'var(--brand-primary)' },
  blue:    { bg: STATUS.blue.bg,   color: STATUS.blue.fg },
  orange:  { bg: STATUS.orange.bg, color: STATUS.orange.fg },
  yellow:  { bg: STATUS.yellow.bg, color: STATUS.yellow.fg },
  green:   { bg: STATUS.green.bg,  color: STATUS.green.fg },
  red:     { bg: STATUS.red.bg,    color: STATUS.red.fg },
  neutral: { bg: '#F3F4F6', color: '#6B7280' },
}

export interface SummaryItem {
  label: string
  value: string | number
  Icon: ComponentType<{ className?: string }>
  tone?: SummaryTone
  // Optional: makes the card a clickable control (e.g. click-to-filter). `active`
  // highlights it as the current selection with a brand ring.
  onClick?: () => void
  active?: boolean
}

// ── HIDDEN app-wide (owner's decision, 2026-08-05) ───────────────────────────
// The summary tiles are switched off on every screen until it is decided whether
// and how they come back. Flipping this ONE constant restores them everywhere —
// every call site was left untouched on purpose, so nothing has to be rebuilt.
//
// ⚠️ On most screens these tiles doubled as the STATUS FILTER (they pass
// `onClick` + `active`). Hiding them therefore also hides that filter. The
// filtering state itself still exists in each screen; only the control is gone.
const SHOW_SUMMARY_CARDS = false

export function SummaryCards({ items, className = '' }: { items: SummaryItem[]; className?: string }) {
  if (!SHOW_SUMMARY_CARDS) return null
  // Responsive columns by count: 1-2 → 2-up, 4 → 2-up then 4-up, else 3-up.
  const cols =
    items.length <= 2 ? 'sm:grid-cols-2' :
    items.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' :
    'sm:grid-cols-3'
  return (
    <div className={`grid grid-cols-1 ${cols} gap-3 ${className}`}>
      {items.map(({ label, value, Icon, tone = 'brand', onClick, active }) => {
        const t = TONES[tone]
        const clickable = !!onClick
        return (
          <div
            key={label}
            onClick={onClick}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } } : undefined}
            className="bg-white flex items-center justify-between transition-all"
            style={{
              border: `1px solid ${active ? 'var(--brand-primary)' : '#EEEEF2'}`,
              boxShadow: active
                ? '0 0 0 1px var(--brand-primary), 0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)'
                : '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)',
              borderRadius: '16px',
              padding: '16px 18px',
              cursor: clickable ? 'pointer' : 'default',
            }}
          >
            <div className="text-right min-w-0">
              <p style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>{label}</p>
              <p className="truncate" style={{ fontSize: '22px', fontWeight: 700, color: '#12131A', letterSpacing: '-0.01em', marginTop: '3px' }}>{value}</p>
            </div>
            <div className="rounded-xl flex items-center justify-center flex-shrink-0" style={{ width: '42px', height: '42px', background: t.bg, color: t.color }}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default SummaryCards
