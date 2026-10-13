import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

// ── The one place a record's actions live ────────────────────────────────────
//
// The supplier card carried seven controls in three places: four in the header,
// "איפוס כרטסת" halfway down beside the ledger, and delete/merge at the very
// bottom past every panel. Nothing was wrong with any one of them; together they
// asked the reader to learn a map.
//
// What stays OUTSIDE this menu is the decision that makes it work:
//   · עריכה — the thing done most often here. Two clicks every day is worse than
//     one crowded header.
//   · חזרה — navigation, not an action on the record. A menu of things you can
//     do to a supplier is not where "leave" belongs.
//   · the active/inactive PILL — state, not an action. It stays visible beside
//     the name; only the switching moved in here.
//
// Items are grouped, and `danger` puts an item below a rule in red. Destructive
// actions do not sit in the same run as the ordinary ones — the cost of a
// mis-click is not the same, so the spacing should not be either.

export interface MenuItem {
  key: string
  label: string
  Icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  onSelect: () => void
  /** Below a rule, in red. For anything that cannot be undone. */
  danger?: boolean
  disabled?: boolean
}

export function ActionsMenu({ items, label = 'פעולות' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  // Where to draw the menu, in viewport coordinates. It is rendered into <body>
  // rather than beside the button, because an absolutely positioned child is
  // clipped by any ancestor that hides overflow — and the content area does, so
  // that a wide table scrolls itself instead of the page. On a desktop the menu
  // had room and nobody noticed; on the shop's tablet it opened past the edge of
  // the pane and looked like a button that does nothing.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  const place = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect()
    if (!r) return
    const MENU_W = 220
    // Keep it on screen: pinned under the button, nudged in if the edge is close.
    const right = Math.min(
      Math.max(window.innerWidth - r.right, 8),
      Math.max(window.innerWidth - MENU_W - 8, 8),
    )
    setAt({ top: r.bottom + 6, right })
  }, [])

  // Close on an outside click or on Escape. Both, because a menu you can only
  // dismiss one way is one people learn to click twice to be sure of.
  useEffect(() => {
    if (!open) return
    place()
    const onDown = (e: Event) => {
      const t = e.target as Node
      if (wrap.current?.contains(t)) return
      // The menu now lives outside this component's DOM, so "outside" has to mean
      // outside BOTH the button and the menu itself.
      if ((t as HTMLElement).closest?.('[data-actions-menu]')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onMove = () => setOpen(false)
    // pointerdown rather than mousedown: a tablet reports a tap as a pointer event
    // first, and a menu that only listens for a mouse is a menu that feels stuck.
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

  const ordinary = items.filter(i => !i.danger)
  const danger   = items.filter(i => i.danger)

  const row = (i: MenuItem) => (
    <button
      key={i.key}
      disabled={i.disabled}
      onClick={() => { setOpen(false); i.onSelect() }}
      className="flex items-center gap-2.5 w-full text-right"
      style={{
        padding: '10px 14px', fontSize: '14px', fontFamily: 'inherit',
        background: 'transparent', border: 'none',
        color: i.disabled ? '#C9C7CC' : i.danger ? '#B91C1C' : '#1D1E22',
        cursor: i.disabled ? 'default' : 'pointer',
      }}
      onMouseEnter={e => { if (!i.disabled) (e.currentTarget as HTMLElement).style.background = '#FAFAFC' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {i.Icon && <i.Icon className="w-4 h-4" style={{ flex: 'none', color: i.danger ? '#B91C1C' : '#9CA3AF' }} />}
      {i.label}
    </button>
  )

  return (
    <div ref={wrap} style={{ position: 'relative', flex: 'none' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className="flex items-center justify-center rounded-xl transition-all"
        style={{
          minHeight: '44px', width: '44px',
          background: open ? '#E5E7EB' : '#F3F4F6', color: '#6B7280',
          border: 'none', cursor: 'pointer',
        }}
      >
        <MoreVertical className="w-5 h-5" />
      </button>

      {open && at && createPortal(
        <div
          role="menu"
          data-actions-menu
          dir="rtl"
          style={{
            position: 'fixed', top: at.top, right: at.right,
            minWidth: '220px', background: 'white', border: '1px solid #E2E4E9',
            boxShadow: '0 8px 24px rgba(16,17,21,.13)', zIndex: 70,
            padding: '4px 0', borderRadius: 'var(--ui-radius, 2px)',
          }}
        >
          {ordinary.map(row)}
          {danger.length > 0 && ordinary.length > 0 && (
            <div style={{ height: '1px', background: '#EEEEF2', margin: '4px 0' }} />
          )}
          {danger.map(row)}
        </div>,
        document.body,
      )}
    </div>
  )
}
