import { useState } from 'react'
import { RotateCcw, X } from 'lucide-react'

// ── "לאפס את הכרטסת" ─────────────────────────────────────────────────────────
//
// ONE component, rendered on both ledgers — the one inside the supplier card and
// the ledger screen. The owner asked for it in both places, and the surest way to
// give her two versions of it that drift is to write it twice.
//
// Three states, in this order, and the order is the safety:
//
//   idle    a quiet button, no more prominent than the print button beside it
//   ask     "לאפס את הכרטסת?" — כן / ביטול, and nothing has happened yet
//   reason  the field. Saving is disabled until something is typed.
//
// The confirmation comes BEFORE the reason field rather than after: a dialog that
// opens straight into a form invites you to fill the form, and filling a form
// feels like progress rather than like a decision. Asking first makes the
// decision the first thing that happens.
//
// The reason is required by the API too (400 without one). This is not
// belt-and-braces — the button is disabled here so she is never told "no" after
// typing, and the server refuses because a UI is not a boundary.

export function LedgerResetControl({
  onConfirm,
  disabled,
  open,
  onDismiss,
}: {
  onConfirm: (reason: string) => Promise<void>
  disabled?: boolean
  /**
   * CONTROLLED mode, used when the action is reached from a menu rather than
   * from a button of its own: the idle button is not rendered at all and the
   * panel opens straight at the question. Undefined = the original standalone
   * button, which is still how the ledger SCREEN uses it.
   */
  open?: boolean
  onDismiss?: () => void
}) {
  const controlled = open !== undefined
  const [stage, setStage] = useState<'idle' | 'ask' | 'reason'>(
    controlled && open ? 'ask' : 'idle',
  )
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => { setStage('idle'); setReason(''); setError(null); onDismiss?.() }

  // No effect syncing `stage` to `open`, deliberately: the caller UNMOUNTS this
  // component when it closes it ({resetOpen && <LedgerResetControl open .../>}),
  // so every opening is a fresh mount and the initial state above is already the
  // question. An effect here would be a second source of truth for the same
  // thing, and a cascading render for nothing.

  const save = async () => {
    const text = reason.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(text)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'האיפוס לא נשמר')
    } finally {
      setBusy(false)
    }
  }

  // Controlled and closed: nothing at all. The menu item IS the button.
  if (controlled && stage === 'idle') return null

  if (stage === 'idle') {
    return (
      <button
        onClick={() => setStage('ask')}
        disabled={disabled}
        className="inline-flex items-center gap-1.5"
        style={{
          padding: '6px 12px', border: '1px solid #E2E4E9', background: 'white',
          color: '#6B6E73', fontSize: '12.5px', fontWeight: 600, fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
          borderRadius: 'var(--ui-radius, 2px)',
        }}
      ><RotateCcw size={13} />איפוס כרטסת</button>
    )
  }

  return (
    <div
      style={{
        border: '1px solid var(--brand-primary)', background: '#FFF8F9',
        padding: '12px 14px', borderRadius: 'var(--ui-radius, 2px)',
        minWidth: '280px', maxWidth: '420px',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1D1E22' }}>
          {stage === 'ask' ? 'לאפס את הכרטסת?' : 'מה הסיבה לאיפוס?'}
        </span>
        <button
          onClick={close}
          title="ביטול"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 0, display: 'flex' }}
        ><X size={15} /></button>
      </div>

      {stage === 'ask' ? (
        <>
          <p style={{ fontSize: '12.5px', color: '#6B6E73', margin: '0 0 10px', lineHeight: 1.6 }}>
            היתרה תתאפס ל־0 נכון להיום. החשבוניות והתשלומים נשארים במקומם ואפשר
            לבטל את האיפוס בכל רגע.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setStage('reason')}
              style={{
                padding: '7px 16px', border: '1px solid var(--brand-primary)',
                background: 'var(--brand-primary)', color: 'white', fontSize: '12.5px',
                fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                borderRadius: 'var(--ui-radius, 2px)',
              }}
            >כן</button>
            <button
              onClick={close}
              style={{
                padding: '7px 16px', border: '1px solid #E2E4E9', background: 'white',
                color: '#6B6E73', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', borderRadius: 'var(--ui-radius, 2px)',
              }}
            >ביטול</button>
          </div>
        </>
      ) : (
        <>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            autoFocus
            rows={3}
            placeholder="למשל: סגרנו את החוב במזומן, הכרטסת התבלבלה בהעברה מאיירטייבל"
            style={{
              width: '100%', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit',
              border: '1px solid #E2E4E9', borderRadius: 'var(--ui-radius, 2px)',
              resize: 'vertical', marginBottom: '8px', direction: 'rtl',
            }}
          />
          <p style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '0 0 10px' }}>
            הסיבה והתאריך יופיעו בשורה דקה בתוך הכרטסת. בהדפסה הם לא מופיעים.
          </p>
          {error && (
            <p style={{ fontSize: '12px', color: '#B91C1C', margin: '0 0 8px' }}>{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !reason.trim()}
              style={{
                padding: '7px 16px', border: '1px solid var(--brand-primary)',
                background: reason.trim() ? 'var(--brand-primary)' : '#E2E4E9',
                borderColor: reason.trim() ? 'var(--brand-primary)' : '#E2E4E9',
                color: reason.trim() ? 'white' : '#9CA3AF', fontSize: '12.5px',
                fontWeight: 700, cursor: busy || !reason.trim() ? 'default' : 'pointer',
                fontFamily: 'inherit', borderRadius: 'var(--ui-radius, 2px)',
              }}
            >{busy ? 'מאפס…' : 'אפס כרטסת'}</button>
            <button
              onClick={close}
              disabled={busy}
              style={{
                padding: '7px 16px', border: '1px solid #E2E4E9', background: 'white',
                color: '#6B6E73', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', borderRadius: 'var(--ui-radius, 2px)',
              }}
            >ביטול</button>
          </div>
        </>
      )}
    </div>
  )
}
