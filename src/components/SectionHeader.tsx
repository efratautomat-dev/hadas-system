import type { CSSProperties, ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Card section-header bar with RTL-correct sides, guaranteed.
//
//   • `title`  (text + icon) → ALWAYS at the visual RIGHT (the RTL start)
//   • `action` (count / button / link) → ALWAYS at the visual LEFT (the RTL end)
//
// Why this exists — the recurring bug:
//   A plain `flex justify-between` under RTL places the FIRST DOM child at the
//   inline-start, which in RTL is the RIGHT edge. Screens kept writing the
//   count/action first, so it landed on the right and the title flipped to the
//   left. Rather than re-reason about DOM order on every new screen, this
//   component forces `direction: 'ltr'` for the LAYOUT (so flex ordering is
//   immune to inherited/ambient direction) and pins:
//       child 1 → action (left)     child 2 → title (right)
//   Each cluster restores `direction: 'rtl'` internally so Hebrew reads correctly.
//
// Usage — pass your existing title/icon JSX as `title`, and the count/button as
// `action`. Keep cosmetic classes on `className` (padding, border) and colors on
// `style`. Do NOT add `justify-*` / `flex` to className; the component owns layout.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Title cluster (e.g. <><h2>…</h2><Icon/></>). Rendered at the visual RIGHT. */
  title: ReactNode
  /** Action cluster (count text, button, link). Rendered at the visual LEFT. */
  action?: ReactNode
  /** Optional click handler for the whole bar (e.g. open ledger). */
  onClick?: () => void
  /** Cosmetic classes only — padding / border, NOT layout. */
  className?: string
  style?: CSSProperties
  /** Background applied on hover (for clickable bars); reverts to transparent. */
  hoverBg?: string
}

export default function SectionHeader({ title, action, onClick, className, style, hoverBg }: Props) {
  return (
    <div
      className={className}
      onClick={onClick}
      onMouseEnter={hoverBg ? (e) => ((e.currentTarget as HTMLElement).style.background = hoverBg) : undefined}
      onMouseLeave={hoverBg ? (e) => ((e.currentTarget as HTMLElement).style.background = 'transparent') : undefined}
      style={{
        direction: 'ltr',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        ...style,
      }}
    >
      {/* LEFT (RTL end): action / count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{action}</div>
      {/* RIGHT (RTL start): title + icon */}
      <div style={{ direction: 'rtl', display: 'flex', alignItems: 'center', gap: '8px' }}>{title}</div>
    </div>
  )
}
