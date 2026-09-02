import { useState } from 'react'
import { Truck, Plus, X } from 'lucide-react'
import type { ArrivalCandidate } from '../../hooks/useOrders'

// ── "הגיע" met a delivery that is already here ───────────────────────────────
//
// The supplier's note usually arrives by EMAIL before the goods do. Marking the
// order arrived used to open a second row regardless, so one physical delivery
// became two records and the employee had to guess which was real.
//
// So the system offers what it found and a person decides. It cannot decide for
// her: two deliveries from one supplier in one week are ordinary, and merging
// them silently would lose a shipment rather than duplicate one — the worse of
// the two errors, because a duplicate is visible and a merge is not.

export default function ArrivalChoice({
  supplierName, candidates, onPick, onNew, onClose,
}: {
  supplierName: string
  candidates: ArrivalCandidate[]
  onPick: (id: string) => Promise<void>
  onNew: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', overflowY: 'auto', padding: '40px 12px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white shadow-2xl w-full" style={{ maxWidth: '540px', direction: 'rtl' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
          <span className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
            <Truck className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            כבר יש תעודה ממתינה
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
            title="סגירה"
          ><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4">
          <p style={{ fontSize: '13.5px', color: '#4B5563', margin: '0 0 4px' }}>
            מ<b>{supplierName}</b> כבר הגיעה תעודת משלוח שממתינה לחשבונית.
          </p>
          <p style={{ fontSize: '12.5px', color: '#9CA3AF', margin: '0 0 14px' }}>
            אם זו הסחורה שהגיעה עכשיו — בחרי אותה, ולא תיפתח שורה כפולה.
          </p>

          <div className="grid gap-2">
            {candidates.map(c => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => run(() => onPick(c.id))}
                className="flex items-center justify-between gap-3 border text-right w-full"
                style={{
                  borderColor: '#E2E4E9', background: 'white', padding: '12px 14px',
                  cursor: busy ? 'wait' : 'pointer', font: 'inherit',
                }}
              >
                <span style={{ fontSize: '13.5px' }}>
                  <b>{c.note_number || 'ללא מספר תעודה'}</b>
                  <span style={{ color: '#9CA3AF' }}>{c.date ? ` · ${c.date}` : ''}</span>
                </span>
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--brand-primary)' }}>
                  זו היא
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 pb-5 flex items-center gap-2 flex-wrap">
          <button
            disabled={busy}
            onClick={() => run(onNew)}
            className="font-semibold inline-flex items-center gap-1.5"
            style={{
              background: 'white', color: 'var(--brand-primary)',
              border: '1px solid var(--brand-primary)', padding: '9px 16px',
              fontSize: '13px', cursor: busy ? 'wait' : 'pointer',
            }}
          ><Plus className="w-4 h-4" />לא, זו סחורה אחרת</button>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
          >ביטול</button>
        </div>
      </div>
    </div>
  )
}
