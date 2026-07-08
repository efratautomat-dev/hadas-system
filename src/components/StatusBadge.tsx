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

export default StatusBadge
