import { useEffect, useState } from 'react'
import { checkForUpdate, openExternal, type AppUpdate } from '../lib/native'

// UpdateBanner — the only way a new version of the APP reaches a tablet.
//
// Changes to the SYSTEM arrive on their own: the app loads the live site, so a
// deploy updates every tablet with nothing to install. The shell around it is a
// different matter — a new icon, a permission, a fix in the native layer — and
// Android will not let a sideloaded app update itself silently.
//
// Which left the shop reinstalling by hand, on a tablet with no browser, by
// typing a URL nobody can type. So the app says so itself, in the one place
// nobody can miss, and the whole job becomes one tap plus Android's own confirm.
//
// Deliberately NOT a modal: it must never stand between someone and an invoice
// they are trying to file. It waits at the top of the screen until it is used.
export default function UpdateBanner() {
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    void checkForUpdate().then(setUpdate)
  }, [])

  if (!update?.outdated || dismissed) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        padding: '10px 16px',
        background: 'linear-gradient(135deg, var(--brand-primary-dark), #E8645A)',
        color: 'white',
        fontSize: '14px',
        direction: 'rtl',
      }}
    >
      <span style={{ fontWeight: 700 }}>קיימת גרסה חדשה של האפליקציה</span>
      {update.notes && (
        <span style={{ opacity: 0.9, fontSize: '13px' }}>{update.notes}</span>
      )}

      <button
        onClick={() => void openExternal(update.url)}
        style={{
          marginInlineStart: 'auto',
          padding: '8px 18px',
          minHeight: '40px',
          borderRadius: '10px',
          border: 'none',
          background: 'white',
          color: 'var(--brand-primary-dark)',
          fontSize: '14px',
          fontWeight: 700,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        עדכני עכשיו
      </button>

      {/* Hiding it lasts for this session only. A tablet that is a version behind
          should be asked again tomorrow, not left silently behind forever. */}
      <button
        onClick={() => setDismissed(true)}
        aria-label="סגירה"
        style={{
          padding: '8px 10px',
          borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.4)',
          background: 'transparent',
          color: 'white',
          fontSize: '13px',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        אחר כך
      </button>
    </div>
  )
}
