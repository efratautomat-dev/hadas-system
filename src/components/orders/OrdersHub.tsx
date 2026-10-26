import { useMemo, useState } from 'react'
import { Plus, PackageCheck } from 'lucide-react'
import { Button } from '../ui/Button'
import { StatusBadge } from '../StatusBadge'
import { useOrders } from '../../hooks/useOrders'
import { useSuppliers } from '../../hooks/useSuppliers'
import { useEmployees } from '../../hooks/useEmployees'
import { intakeShort } from '../../lib/intakeSource'
import { CUSTOMER_STATUS_LABEL } from '../../lib/customerStatus'
import OrderForm from '../pipeline/OrderForm'
import GoodsIntake from '../pipeline/GoodsIntake'
import ArrivalChoice from '../pipeline/ArrivalChoice'
import CustomerOrdersBook from '../pipeline/CustomerOrdersBook'
import DeliveryNotePopup from './DeliveryNotePopup'
import { useNoteMatching } from './useNoteMatching'
import type { ArrivalCandidate, Order } from '../../hooks/useOrders'

// ── הזמנות וסחורה — one screen, three tabs (DEMO ONLY, 26.10.2026) ──────────
//
// Built to the 21.10 prototype (https://claude.ai/artifact/NvX2eAwkGZ75Mojx8utKGN):
// tables, no pipeline strip. Every order row carries "קליטת סחורה" and
// "תעודת משלוח", and the customer orders riding on it. A customer order joined
// to a supplier order is no longer its own row here (the 25.10 gap) — it rides
// on the carrying order as a chip, and arrives with it.

type Tab = 'future' | 'intake' | 'customers'
const HAIRLINE = '#E2E4E9'

export default function OrdersHub({ userEmail, initialNoteId = null, onOpenInvoice, onGoNotesPage }: {
  userEmail?: string
  initialNoteId?: string | null
  onOpenInvoice?: (invoiceId: string) => void
  onGoNotesPage?: () => void
}) {
  const m = useNoteMatching()
  const { data: orders, create: createOrder, markArrived, setCustomerStatus, cancel, uncancel } = useOrders()
  const { data: suppliers } = useSuppliers()
  const { data: employees } = useEmployees()
  const [tab, setTab] = useState<Tab>('future')
  const [openNote, setOpenNote] = useState<string | null>(initialNoteId)
  const [newOrder, setNewOrder] = useState(false)
  const [intake, setIntake] = useState<null | { supplier?: { id: string; name: string }; adopt?: string }>(null)
  const [arrival, setArrival] = useState<{ order: Order; candidates: ArrivalCandidate[] } | null>(null)

  const supplierOpts = suppliers.map(s => ({ id: s.id, name: s.name, hp: (s as { hp?: string }).hp }))
  const live = useMemo(() => orders.filter(o => !o.cancelledAt), [orders])
  const future = useMemo(() => live
    .filter(o => o.status !== 'order_arrived' && !o.carriedBy)
    .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || '')), [live])
  const riders = (o: Order) => live.filter(c => c.carriedBy === o.id)
  const received = useMemo(() => m.notes
    .filter(n => n.stage !== 'awaiting_goods' && !n.isDuplicate)
    .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || '')), [m.notes])
  const empName = (id?: string) => employees.find(e => e.id === id)?.name ?? '—'
  const orderOfNote = (id: string) => orders.find(o => o.deliveryNoteId === id && !o.carriedBy)
  const customerCount = live.filter(o => o.customerName && o.customerStatus !== 'customer_delivered').length

  // "קליטת סחורה" on an order: the goods arrive INTO the row the order opened,
  // then the intake doors (photo / typing / handwritten sheet) record what came.
  const arrive = async (o: Order, choice?: { adopt?: string; forceNew?: boolean }) => {
    const res = await markArrived(o.id, false, choice)
    if (res.needsChoice) { setArrival({ order: o, candidates: res.candidates ?? [] }); return }
    setArrival(null)
    await m.notesApi.reload()
    setIntake({ supplier: { id: o.supplierId, name: o.supplierName }, adopt: res.deliveryNoteId ?? undefined })
  }

  const tabs: [Tab, string, number][] = [
    ['future', 'הזמנות עתידיות', future.length],
    ['intake', 'קליטת סחורה', received.length],
    ['customers', 'מחברת לקוחות', customerCount],
  ]
  const td = { borderBottom: '1px solid #EEF0F3' }

  return (
    <div className="space-y-4" style={{ direction: 'rtl' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <nav aria-label="לשוניות" className="flex gap-1 flex-wrap" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          {tabs.map(([k, l, n]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="px-3.5 py-2.5 text-sm"
              style={tab === k
                ? { color: 'var(--brand-primary)', fontWeight: 700, borderBottom: '3px solid var(--brand-primary)' }
                : { color: '#4B5563', borderBottom: '3px solid transparent' }}>
              {l} <span className="text-xs rounded-full px-1.5 py-0.5 mr-1" style={{ background: '#F3F4F6' }}>{n}</span>
            </button>
          ))}
        </nav>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setIntake({})}><PackageCheck className="w-4 h-4 inline ml-1" />קליטת סחורה בלי הזמנה</Button>
          <Button onClick={() => setNewOrder(true)}><Plus className="w-4 h-4 inline ml-1" />הזמנה חדשה</Button>
        </div>
      </div>

      {tab === 'future' && (
        <div className="bg-white rounded-2xl border overflow-x-auto" style={{ borderColor: HAIRLINE }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 940 }}>
            <thead><tr className="text-xs text-gray-500 text-right">
              {['ספק', 'הזמנה', 'הוזמן', 'צפי', 'הזמנות לקוחות', 'מצב', 'פעולות'].map(h =>
                <th key={h} className="font-semibold px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {future.map(o => {
                const note = o.deliveryNoteId ? m.noteById.get(o.deliveryNoteId) : undefined
                const hasGoods = !!note && note.stage !== 'awaiting_goods'
                const chips = [...(o.customerName ? [o] : []), ...riders(o)]
                return (
                  <tr key={o.id} className="align-top">
                    <td className="px-3 py-3 font-bold" style={td}>{o.supplierName}</td>
                    <td className="px-3 py-3" style={{ ...td, maxWidth: 240 }}>{o.description || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap" style={td}>{o.date}</td>
                    <td className="px-3 py-3 whitespace-nowrap" style={td}>{o.expectedDate || '—'}</td>
                    <td className="px-3 py-3" style={td}>
                      <div className="flex gap-1 flex-wrap">
                        {chips.length === 0 && <span className="text-gray-400">—</span>}
                        {chips.map(c => (
                          <button key={c.id} type="button" onClick={() => setTab('customers')}
                            className="text-xs rounded-lg px-2 py-1" style={{ background: '#EFF6FF', color: '#1D4ED8' }}
                            title={c.customerStatus ? CUSTOMER_STATUS_LABEL[c.customerStatus] : ''}>
                            {c.customerName}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3" style={td}><StatusBadge status={o.status} /></td>
                    <td className="px-3 py-3" style={td}>
                      <div className="flex gap-1.5 flex-wrap">
                        {!hasGoods && <Button size="sm" onClick={() => void arrive(o)}>קליטת סחורה</Button>}
                        <Button size="sm" variant="outline" disabled={!hasGoods}
                          title={hasGoods ? '' : 'הסחורה עוד לא הגיעה'}
                          onClick={() => note && setOpenNote(note.id)}>תעודת משלוח</Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {future.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">אין הזמנות פתוחות</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'intake' && (
        <div className="bg-white rounded-2xl border overflow-x-auto" style={{ borderColor: HAIRLINE }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 820 }}>
            <thead><tr className="text-xs text-gray-500 text-right">
              {['תאריך', 'ספק', 'איך נקלט', 'מי קלט', 'הזמנה', 'תעודה', 'הערות'].map(h =>
                <th key={h} className="font-semibold px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {received.map(n => {
                const o = orderOfNote(n.id)
                return (
                  <tr key={n.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenNote(n.id)}>
                    <td className="px-3 py-3 whitespace-nowrap" style={td}>{n.date}</td>
                    <td className="px-3 py-3 font-bold" style={td}>{n.supplierName}</td>
                    <td className="px-3 py-3 whitespace-nowrap" style={td}>{intakeShort(n.intakeSource)}</td>
                    <td className="px-3 py-3" style={td}>{empName(n.employeeId)}</td>
                    <td className="px-3 py-3" style={td}>{o ? (o.description || o.date) : <span className="text-gray-400">בלי הזמנה</span>}</td>
                    <td className="px-3 py-3" style={td}>
                      <span className="font-bold underline" style={{ color: 'var(--brand-primary)' }}>תעודה {n.noteNumber || ''}</span>
                    </td>
                    <td className="px-3 py-3 text-gray-600" style={{ ...td, maxWidth: 220 }}>{n.notes || '—'}</td>
                  </tr>
                )
              })}
              {received.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">עוד לא נקלטה סחורה</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'customers' && (
        <CustomerOrdersBook orders={orders} onOpen={setOpenNote} onSetStatus={setCustomerStatus} onCancel={cancel} onUncancel={uncancel} />
      )}

      {openNote && (
        <DeliveryNotePopup noteId={openNote} m={m} orders={orders} onClose={() => setOpenNote(null)}
          onOpenInvoice={onOpenInvoice} onGoNotesPage={onGoNotesPage} />
      )}

      {newOrder && (
        <OrderForm
          suppliers={supplierOpts}
          onClose={() => setNewOrder(false)}
          openOrders={live.filter(o => o.status !== 'order_arrived').map(o => ({
            id: o.id, supplierId: o.supplierId, description: o.description, date: o.date,
            expectedDate: o.expectedDate, customerName: o.customerName, customerStatus: o.customerStatus,
          }))}
          onCreate={async d => { await createOrder(d) }}
        />
      )}

      {intake && (
        <GoodsIntake
          suppliers={supplierOpts}
          lockedSupplier={intake.supplier}
          adoptNoteId={intake.adopt}
          capturedBy={userEmail}
          onClose={() => setIntake(null)}
          onOpenDelivery={id => { setIntake(null); setOpenNote(id) }}
          onCreate={async d => {
            const res = await m.notesApi.create(d)
            if (res?.needsChoice) return res
            await m.notesApi.reload()
            return res
          }}
        />
      )}

      {arrival && (
        <ArrivalChoice
          supplierName={arrival.order.supplierName}
          candidates={arrival.candidates}
          onClose={() => setArrival(null)}
          onPick={async id => { await arrive(arrival.order, { adopt: id }) }}
          onNew={async () => { await arrive(arrival.order, { forceNew: true }) }}
        />
      )}
    </div>
  )
}
