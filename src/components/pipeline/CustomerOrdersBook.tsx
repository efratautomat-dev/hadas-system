import { useState } from 'react'
import { Phone, User, Check } from 'lucide-react'
import { StatusBadge } from '../StatusBadge'
import type { Order } from '../../hooks/useOrders'
import { CUSTOMER_STATUS_FLOW, CUSTOMER_STATUS_LABEL, type CustomerStatus } from '../../lib/customerStatus'

// ── מחברת ההזמנות ────────────────────────────────────────────────────────────
//
// The owner asked for somewhere to see every customer order "like an open
// notebook", and the word is the specification: a notebook is read down the page,
// one entry per line, in the order things happened. It is not a table you sort and
// filter — it is a record you look through to answer "did we ever order that for
// her?".
//
// So this is deliberately NOT the pipeline table:
//   · newest first, grouped by day, the way a page fills up
//   · the CUSTOMER leads each line, not the supplier — she is what you are
//     looking for, and every other screen already leads with the supplier
//   · the phone number is right there, because the reason you looked her up is
//     usually to call her
//
// Arrived orders stay. A notebook you tear pages out of answers nothing about
// last month, and "did it arrive?" is exactly the question that brings someone
// here — so the state is shown rather than used to hide the line.

function dayLabel(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const yest = new Date(today); yest.setDate(today.getDate() - 1)
  if (same(d, today)) return 'היום'
  if (same(d, yest))  return 'אתמול'
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function CustomerOrdersBook({
  orders, onOpen, onSetStatus,
}: {
  orders: Order[]
  /** Jump to the goods chain this order became, when it has one. */
  onOpen?: (deliveryNoteId: string) => void
  /** Move the customer line along. Absent = read-only notebook. */
  onSetStatus?: (orderId: string, next: CustomerStatus) => Promise<void>
}) {
  const withCustomer = orders
    .filter(o => !!o.customerName)
    .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || ''))

  if (withCustomer.length === 0) {
    return (
      <div
        className="bg-white border text-center"
        style={{ borderColor: '#EEEEF2', padding: '38px 16px', fontSize: '13.5px', color: '#9CA3AF' }}
      >
        אין הזמנות של לקוחות
      </div>
    )
  }

  // Group by day, in order, so the page reads like one that was written on.
  const days: { key: string; items: Order[] }[] = []
  for (const o of withCustomer) {
    const k = o.isoDate || ''
    const last = days[days.length - 1]
    if (last && last.key === k) last.items.push(o)
    else days.push({ key: k, items: [o] })
  }

  return (
    <div className="bg-white border" style={{ borderColor: '#EEEEF2' }}>
      {days.map(({ key, items }) => (
        <div key={key}>
          <div
            style={{
              padding: '8px 18px', background: '#FAFAFC', borderBottom: '1px solid #EEEEF2',
              fontSize: '11.5px', fontWeight: 800, color: '#9CA3AF', letterSpacing: '.03em',
            }}
          >{dayLabel(key)}</div>
          {items.map(o => (
            <div
              key={o.id}
              role={o.deliveryNoteId && onOpen ? 'button' : undefined}
              tabIndex={o.deliveryNoteId && onOpen ? 0 : undefined}
              onClick={() => o.deliveryNoteId && onOpen?.(o.deliveryNoteId)}
              onKeyDown={e => {
                if ((e.key === 'Enter' || e.key === ' ') && o.deliveryNoteId) onOpen?.(o.deliveryNoteId)
              }}
              className="flex items-start justify-between gap-4 flex-wrap"
              style={{
                padding: '13px 18px', borderBottom: '1px solid #F3F4F6',
                cursor: o.deliveryNoteId && onOpen ? 'pointer' : undefined,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="flex items-center gap-2 font-bold text-gray-800" style={{ fontSize: '14px', margin: 0 }}>
                  <User className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary)', flex: 'none' }} />
                  {o.customerName}
                  {o.customerPhone && (
                    <span
                      className="inline-flex items-center gap-1"
                      style={{ fontSize: '12px', color: '#6B6E73', fontWeight: 400 }}
                    >
                      <Phone className="w-3 h-3" style={{ color: '#9CA3AF' }} />
                      <span dir="ltr">{o.customerPhone}</span>
                    </span>
                  )}
                </p>
                <p style={{ fontSize: '13.5px', color: '#4B5563', margin: '3px 0 0' }}>{o.description || '—'}</p>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '2px 0 0' }}>
                  {o.supplierName}
                  {o.expectedDate ? ` · צפי ${o.expectedDate}` : ''}
                </p>
              </div>
              <div onClick={e => e.stopPropagation()} style={{ flex: 'none' }}>
                <CustomerStatusControl order={o} onSet={onSetStatus} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}


// ── Moving the customer line ─────────────────────────────────────────────────
// A click opens the five steps, in order, with the current one marked. Not a
// dropdown: there are five, they are a sequence, and seeing the whole line is how
// you know what has and has not been done for her.
//
// `הגיעה לחנות` is offered like the rest — the system sets it when the goods land,
// but nothing stops a person from correcting it. What the system knows is where
// the goods are; what it does not know is what was said to her.
function CustomerStatusControl({ order, onSet }: {
  order: Order
  onSet?: (orderId: string, next: CustomerStatus) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = order.customerStatus ?? 'customer_waiting'

  if (!onSet) return <StatusBadge status={current} />

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
        title="שינוי סטטוס"
      ><StatusBadge status={current} /></button>
    )
  }

  return (
    <div className="grid gap-1" style={{ minWidth: '170px' }}>
      {CUSTOMER_STATUS_FLOW.map(k => {
        const on = k === current
        return (
          <button
            key={k}
            disabled={busy}
            onClick={async () => {
              if (on) { setOpen(false); return }
              setBusy(true)
              try { await onSet(order.id, k) } finally { setBusy(false); setOpen(false) }
            }}
            className="inline-flex items-center gap-2"
            style={{
              padding: '6px 10px', fontSize: '12.5px', fontFamily: 'inherit',
              border: `1px solid ${on ? 'var(--brand-primary)' : '#E2E4E9'}`,
              background: 'white', color: on ? 'var(--brand-primary)' : '#4B5563',
              fontWeight: on ? 700 : 500, cursor: busy ? 'wait' : 'pointer',
              justifyContent: 'flex-start',
            }}
          >
            {on ? <Check className="w-3.5 h-3.5" /> : <span style={{ width: 14 }} />}
            {CUSTOMER_STATUS_LABEL[k]}
          </button>
        )
      })}
      <button
        onClick={() => setOpen(false)}
        style={{ background: 'transparent', border: 'none', color: '#9CA3AF', fontSize: '11.5px', cursor: 'pointer', padding: '2px 0' }}
      >סגירה</button>
    </div>
  )
}
