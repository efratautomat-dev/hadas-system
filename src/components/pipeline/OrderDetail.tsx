import { useState } from 'react'
import { Package, X, User, Phone, ExternalLink } from 'lucide-react'
import { StatusBadge, StatusFlag } from '../StatusBadge'
import type { Order } from '../../hooks/useOrders'

// ── One order, opened ────────────────────────────────────────────────────────
//
// An order used to be a card you could only press "הגיע" on. Everything else
// about it — who it is for, when it is expected, which chain it became — was
// visible nowhere, so a customer phoning to ask could not be answered from the
// screen that exists to answer her.
//
// There is deliberately no status picker. The three states are produced by
// events — placed, arrived, partly arrived — and a state set by hand is one that
// stops matching what happened.

export default function OrderDetail({
  order, onClose, onArrived, onOpenPipeline,
}: {
  order: Order
  onClose: () => void
  onArrived: (partial: boolean) => Promise<void>
  /** Jump to the goods chain this order opened. */
  onOpenPipeline?: (deliveryNoteId: string) => void
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const waiting = order.status === 'order_waiting'

  const run = async (partial: boolean) => {
    setBusy(true)
    try { await onArrived(partial); onClose() } finally { setBusy(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '24px 12px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white shadow-2xl w-full" style={{ maxWidth: '560px', direction: 'rtl' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
          <span className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
            <Package className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            {order.supplierName}
            <StatusBadge status={order.status} />
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
            title="סגירה"
          ><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 grid gap-3">
          <div>
            <span style={{ fontSize: '11.5px', color: '#9CA3AF', fontWeight: 700 }}>מה הוזמן</span>
            <p style={{ fontSize: '14px', margin: '3px 0 0', whiteSpace: 'pre-wrap' }}>{order.description || '—'}</p>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field k="הוזמן" v={order.date || '—'} />
            {/* Only shown when known: most orders have no promised date, and an
                em-dash there would read as a date that went missing. */}
            <Field k="צפי הגעה" v={order.expectedDate || 'לא ידוע'} />
          </div>

          {order.customerName && (
            <div style={{ background: 'var(--brand-active-bg)', border: '1px solid #F3D6DD', padding: '12px 14px' }}>
              <span style={{ fontSize: '11.5px', color: '#9CA3AF', fontWeight: 700 }}>הזמנה עבור לקוחה</span>
              <p className="flex items-center gap-2" style={{ fontSize: '13.5px', margin: '4px 0 0', fontWeight: 700 }}>
                <User className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary)' }} />
                {order.customerName}
              </p>
              {order.customerPhone && (
                <p className="flex items-center gap-2" style={{ fontSize: '13px', margin: '3px 0 0', color: '#4B5563' }}>
                  <Phone className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                  <span dir="ltr">{order.customerPhone}</span>
                </p>
              )}
            </div>
          )}

          {order.arrivedDiffers && <StatusFlag label="שונה מהמוזמן" tone="pending" />}

          {order.deliveryNoteId && onOpenPipeline && (
            <button
              onClick={() => { onOpenPipeline(order.deliveryNoteId!); onClose() }}
              className="inline-flex items-center gap-1.5 font-semibold"
              style={{ background: 'transparent', border: 'none', color: 'var(--brand-primary)', fontSize: '13px', cursor: 'pointer', padding: 0, justifySelf: 'start' }}
            ><ExternalLink className="w-3.5 h-3.5" />פתיחת הסחורה בפייפליין</button>
          )}
        </div>

        <div className="px-5 pb-5 flex items-center gap-2 flex-wrap">
          {waiting ? (
            asking ? (
              <>
                <span style={{ fontSize: '13px', color: '#4B5563' }}>מה הגיע?</span>
                <button
                  disabled={busy}
                  onClick={() => run(false)}
                  className="font-semibold text-white"
                  style={{ background: 'var(--brand-primary)', border: 'none', padding: '9px 16px', fontSize: '13px', cursor: busy ? 'wait' : 'pointer' }}
                >הכל</button>
                <button
                  disabled={busy}
                  onClick={() => run(true)}
                  style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
                >חלק</button>
                <button
                  onClick={() => setAsking(false)}
                  style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 14px', fontSize: '13px', cursor: 'pointer' }}
                >ביטול</button>
                <span style={{ fontSize: '11.5px', color: '#9CA3AF', flexBasis: '100%' }}>
                  "חלק" פותח הזמנה נוספת למה שהגיע, וזו נשארת ממתינה.
                </span>
              </>
            ) : (
              <button
                onClick={() => setAsking(true)}
                className="font-semibold text-white"
                style={{ background: 'var(--brand-primary)', border: 'none', padding: '9px 18px', fontSize: '13px', cursor: 'pointer' }}
              >הגיע</button>
            )
          ) : (
            <span style={{ fontSize: '12.5px', color: '#9CA3AF' }}>ההזמנה כבר נכנסה לפייפליין.</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span style={{ fontSize: '11.5px', color: '#9CA3AF', fontWeight: 700 }}>{k}</span>
      <p style={{ fontSize: '13.5px', margin: '3px 0 0', fontVariantNumeric: 'tabular-nums' }}>{v}</p>
    </div>
  )
}
