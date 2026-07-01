import type { CSSProperties } from 'react'

// ── Shared status badge ─────────────────────────────────────────────────────
// Single source of truth for the unified status taxonomy (spec/06-RULES.md §1).
// Maps every INTERNAL status key to its Hebrew label + color. Every status-bearing
// screen renders through this component so labels/colors stay consistent.
//
// Color legend (per taxonomy):
//   new         → blue
//   in_progress → orange
//   done        → green
//   cancelled   → gray
//   mismatch    → red
//   matched     → green
//   closed      → green
//
// FALLBACK (mandatory): any status NOT in the map renders GRAY with its RAW value
// as the label and never crashes — protects un-migrated rows and future statuses.

type StatusStyle = { label: string; bg: string; color: string }

const GRAY = { bg: '#F3F4F6', color: '#6B7280' }

const STATUS_MAP: Record<string, StatusStyle> = {
  new:         { label: 'חדש', bg: '#DBEAFE', color: '#1E40AF' },
  in_progress: { label: 'בטיפול', bg: '#FEF3C7', color: '#D97706' },
  done:        { label: 'טופל', bg: '#DCFCE7', color: '#166534' },
  cancelled:   { label: 'בוטל', bg: GRAY.bg, color: GRAY.color },
  mismatch:    { label: 'אי-התאמה', bg: '#FEE2E2', color: '#DC2626' },
  matched:     { label: 'תואם', bg: '#DCFCE7', color: '#166534' },
  closed:      { label: 'נסגר', bg: '#DCFCE7', color: '#166534' },
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
