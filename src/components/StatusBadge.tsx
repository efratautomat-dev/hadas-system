import type { CSSProperties } from 'react'
import { STATUS, SEMANTIC, type Swatch } from '../theme/status'

// ── Shared status badge ─────────────────────────────────────────────────────
// Single source of truth for the unified status taxonomy (spec/06-RULES.md §1).
// Maps every INTERNAL status key to its Hebrew label + FUNCTIONAL color. Colors
// come from the fixed, brand-independent tokens in src/theme/status.ts — they are
// the same for every client (blue/orange/yellow/green/red/gray), never reskinned.
//
// FALLBACK (mandatory): any status NOT in the map renders GRAY with its RAW value
// as the label and never crashes — protects un-migrated rows and future statuses.

type StatusStyle = { label: string; bg: string; color: string }

const GRAY = { bg: STATUS.gray.bg, color: STATUS.gray.fg }
const badge = (label: string, sw: Swatch): StatusStyle => ({ label, bg: sw.bg, color: sw.fg })

const STATUS_MAP: Record<string, StatusStyle> = {
  new:         badge('חדש', SEMANTIC.new),
  in_progress: badge('בטיפול', SEMANTIC.in_progress),
  done:        badge('טופל', SEMANTIC.done),
  cancelled:   badge('בוטל', SEMANTIC.cancelled),
  mismatch:    badge('אי-התאמה', SEMANTIC.mismatch),
  matched:     badge('תואם', SEMANTIC.matched),
  closed:      badge('נסגר', SEMANTIC.closed),

  // ── The goods pipeline (spec ch. 6–7) ─────────────────────────────────────
  // Registered HERE rather than given a badge of their own. The generic four
  // above would have worked mechanically — a delivery waiting for its invoice is
  // "new" — but they throw away the only words that say WHAT it is waiting for,
  // and those words were already settled in the spec. So: the spec's vocabulary,
  // this component's fixed functional colours, one badge in the app.
  //
  // The colour still carries the same meaning it does everywhere else: blue =
  // waiting its turn, orange = a person has to act, green = done, red = something
  // is wrong. A reader who has never seen these screens still reads the row.
  awaiting_invoice:  badge('ממתין לחשבונית',   SEMANTIC.new),
  awaiting_approval: badge('ממתין לאישור',      SEMANTIC.in_progress),
  in_ledger:         badge('בכרטסת',            SEMANTIC.done),
  // Red, not orange: an invoice with no goods behind it is not a queue position,
  // it is a discrepancy — the same reading `mismatch` has on a statement.
  awaiting_goods:    badge('חשבונית ללא סחורה', SEMANTIC.mismatch),

  // Orders (§7.3). Stored as English keys like every other column added in this
  // chapter; the Hebrew lives here, where every other Hebrew label lives.
  order_waiting: badge('ממתינה',       SEMANTIC.new),
  order_arrived: badge('הגיעה',        SEMANTIC.done),
  order_partial: badge('הגיעה חלקית',  SEMANTIC.in_progress),
}

export function StatusBadge({
  status,
  className = '',
  style,
}: {
  status: string
  className?: string
  style?: CSSProperties
}) {
  const cfg = STATUS_MAP[status]
  // Unknown status → gray + raw value. Never throws.
  const bg = cfg?.bg ?? GRAY.bg
  const color = cfg?.color ?? GRAY.color
  const label = cfg?.label ?? status

  return (
    <span
      className={`inline-flex items-center rounded-lg font-bold whitespace-nowrap ${className}`}
      style={{ background: bg, color, fontSize: '12px', padding: '3px 9px', ...style }}
    >
      {label}
    </span>
  )
}

/**
 * A FLAG is not a status, and must not look like one.
 *
 * A row has exactly ONE status — where it stands. It can carry SEVERAL flags at
 * once: over the approval threshold, not yet let into the ledger, arrived
 * different from what was ordered, sent to the accountant. Drawing both as the
 * same filled badge is why `הועבר לרו״ח` reads as "a status that doesn't update
 * everywhere" (spec/11-STATUS-REDESIGN.md) — it is entered as a flag and drawn
 * as a state.
 *
 * So a flag is a DASHED OUTLINE, never a filled block. The distinction is in the
 * shape, deliberately not in the colour: the functional palette is fixed and
 * brand-independent (src/theme/status.ts), and adding a sixth hue to mean "this
 * one is a flag" would have expanded a system that is closed on purpose.
 */
export function StatusFlag({
  label,
  tone = 'pending',
  className = '',
  style,
}: {
  label: string
  /** Which fixed functional colour to draw in. */
  tone?: 'pending' | 'in_progress' | 'urgent' | 'neutral'
  className?: string
  style?: CSSProperties
}) {
  const sw = SEMANTIC[tone] ?? SEMANTIC.neutral
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${className}`}
      style={{
        color: sw.fg,
        background: 'transparent',
        border: `1px dashed ${sw.fg}`,
        fontSize: '11px',
        padding: '2px 9px',
        ...style,
      }}
    >
      {label}
    </span>
  )
}

export default StatusBadge
