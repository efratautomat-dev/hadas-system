import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { CopyButton } from './CopyButton'

// ── An error she can act on, and a code she can pass on ──────────────────────
//
// The owner's ask (18.10.2026): a failed upload showed a long English message
// with raw JSON in it. What she needs is one sentence in Hebrew, plus something
// short she can send the developer — not the technical text itself.
//
// So three layers: the sentence (always), the code (when the server gave one —
// typing it into the לוגי מערכת search finds every log line of that request),
// and the raw details behind a toggle, for whoever is debugging.

export function ErrorNotice({
  message, code, details,
}: {
  message: string
  code?: string
  details?: string
}) {
  const [open, setOpen] = useState(false)
  const showDetails = !!details && details !== message
  return (
    <div className="flex items-start gap-2 rounded-2xl mt-4" style={{ background: '#FFF0EF', padding: '14px 16px' }}>
      <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#E8645A' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: '#B23B3B', fontSize: '14px', lineHeight: 1.6 }}>{message}</div>
        {code && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '12.5px', color: '#7F1D1D' }}>
            <span>קוד תקלה:</span>
            <span dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '0.5px' }}>{code}</span>
            <CopyButton text={code} title="העתקת הקוד" color="#B23B3B" />
          </div>
        )}
        {showDetails && (
          <>
            <button
              onClick={() => setOpen((v) => !v)}
              style={{ background: 'none', border: 'none', padding: 0, marginTop: '6px', color: '#9CA3AF', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {open ? 'הסתרת פרטים' : 'פרטים טכניים'}
            </button>
            {open && (
              <div dir="ltr" style={{ marginTop: '4px', fontSize: '11.5px', color: '#6B7280', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word', maxHeight: '140px', overflowY: 'auto' }}>
                {details}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
