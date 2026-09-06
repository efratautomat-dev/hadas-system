import { useState } from 'react'
import { Truck, PackageCheck } from 'lucide-react'
import { StatusBadge, StatusFlag } from '../StatusBadge'
import type { Order } from '../../hooks/useOrders'

// ── לוח ההזמנות — the employee screen's left column ──────────────────────────
//
// This replaces the WhatsApp group (§7). It is not a queue of work: it is what
// the employee GLANCES at while doing something else — to catch goods as they
// land, and to answer a customer asking where her order is.
//
// Two consequences for how it is built:
//   · it STICKS while the page scrolls, because it is looked at mid-task
//   · on a narrow screen it drops BELOW the content instead of disappearing —
//     the same rule the supplier notes panel already follows
//
// Newest first (§7.4).

export default function OrdersRail({
  orders, onArrived, onArrivedPartial,
}: {
  orders: Order[]
  onArrived: (id: string) => Promise<void>
  onArrivedPartial: (id: string) => Promise<void>
}) {
  // Which orders were split. Their "הגיע" button is replaced by a line saying what
  // happened — otherwise it gets pressed again and splits a third time.
  const splitParents = new Set(
    orders
      .filter(o => o.status === 'order_partial')
      .flatMap(o => orders.filter(p => p.id !== o.id && p.supplierId === o.supplierId && p.status === 'order_waiting'))
      .map(p => p.id),
  )

  return (
    <aside style={{ position: 'sticky', top: '12px' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
          <Truck className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
          הזמנות בדרך
        </h2>
        <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>החדש למעלה</span>
      </div>

      <div className="grid gap-2.5">
        {orders.map(o => (
          <OrderCard
            key={o.id}
            order={o}
            split={splitParents.has(o.id)}
            onArrived={onArrived}
            onArrivedPartial={onArrivedPartial}
          />
        ))}
        {orders.length === 0 && (
          <div
            className="bg-white border text-center"
            style={{ borderColor: '#EEEEF2', padding: '22px 14px', fontSize: '13px', color: '#9CA3AF' }}
          >
            אין הזמנות פתוחות
          </div>
        )}
      </div>
    </aside>
  )
}

function OrderCard({
  order: o, split, onArrived, onArrivedPartial,
}: {
  order: Order
  split: boolean
  onArrived: (id: string) => Promise<void>
  onArrivedPartial: (id: string) => Promise<void>
}) {
  // "הגיע" is one click (§7.e) — the partial case is the one that needs a second,
  // because it creates a row, and a split made by accident is confusing to undo.
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false); setAsking(false) }
  }

  const arrived = o.status !== 'order_waiting'

  return (
    <div
      className="bg-white border"
      style={{
        borderColor: '#EEEEF2', padding: '13px',
        borderInlineStartWidth: arrived ? '3px' : split ? '3px' : undefined,
        borderInlineStartColor: arrived ? '#166534' : split ? '#C2410C' : undefined,
      }}
    >
      <h3 className="font-bold text-gray-800" style={{ fontSize: '13.5px', margin: '0 0 3px' }}>{o.supplierName}</h3>
      <p style={{ fontSize: '12.5px', color: '#6B6E73', margin: '0 0 10px' }}>{o.description}</p>

      {asking ? (
        <div className="grid gap-2">
          <span style={{ fontSize: '12px', color: '#4B5563' }}>מה הגיע?</span>
          <div className="flex gap-2 flex-wrap">
            <button
              disabled={busy}
              onClick={() => run(() => onArrived(o.id))}
              className="font-semibold text-white inline-flex items-center gap-1.5"
              style={{ background: 'var(--brand-primary)', border: 'none', padding: '6px 12px', fontSize: '12.5px', cursor: busy ? 'wait' : 'pointer' }}
            ><PackageCheck className="w-3.5 h-3.5" />הכל</button>
            <button
              disabled={busy}
              onClick={() => run(() => onArrivedPartial(o.id))}
              style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '6px 12px', fontSize: '12.5px', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
            >חלק</button>
            <button
              onClick={() => setAsking(false)}
              style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '6px 12px', fontSize: '12.5px', cursor: 'pointer' }}
            >ביטול</button>
          </div>
          <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
            "חלק" פותח הזמנה נוספת למה שהגיע, וזו נשארת ממתינה להמשך.
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <StatusBadge status={o.status} />
          {arrived ? (
            <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>נכנסה לפייפליין</span>
          ) : split ? (
            <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>חלק ממנה הגיע</span>
          ) : (
            <button
              onClick={() => setAsking(true)}
              className="font-semibold text-white"
              style={{ background: 'var(--brand-primary)', border: 'none', padding: '6px 14px', fontSize: '12.5px', cursor: 'pointer' }}
            >הגיע</button>
          )}
        </div>
      )}

      {o.arrivedDiffers && (
        <div style={{ marginTop: '9px' }}>
          <StatusFlag label="שונה מהמוזמן" tone="pending" />
        </div>
      )}
      <div style={{ fontSize: '11.5px', color: '#9CA3AF', marginTop: '8px' }}>{o.date}</div>
    </div>
  )
}
