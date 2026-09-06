import type { ReactNode } from 'react'

// ── One form, two presentations ──────────────────────────────────────────────
//
// The owner asked for full screens instead of popups. But the same form is opened
// from a list (where a dialog is right — you are picking one thing off a page you
// want to keep) and from inside a supplier's card on a phone (where a dialog is a
// letterbox).
//
// So the form does not choose. It renders its content and this decides how it is
// presented, which keeps ONE form rather than a page version and a dialog version
// drifting apart field by field.

export function FormShell({
  onClose, inline = false, maxWidth = '620px', children,
}: {
  onClose: () => void
  /** Render in the page flow instead of over it. */
  inline?: boolean
  maxWidth?: string
  children: ReactNode
}) {
  if (inline) {
    return (
      <div className="bg-white border" style={{ borderColor: '#E2E4E9', maxWidth, direction: 'rtl' }}>
        {children}
      </div>
    )
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '24px 12px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white shadow-2xl w-full" style={{ maxWidth, direction: 'rtl' }}>
        {children}
      </div>
    </div>
  )
}

export default FormShell
