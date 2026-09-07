import { useMemo, useState } from 'react'
import { PackageCheck, Plus, LayoutGrid, Table2 } from 'lucide-react'
import { useDeliveryNotes } from '../../hooks/useDeliveryNotes'
import { useInvoices } from '../../hooks/useInvoices'
import { useOrders } from '../../hooks/useOrders'
import { useSuppliers } from '../../hooks/useSuppliers'
import OrderForm from './OrderForm'
import SupplierPicker from './SupplierPicker'
import ArrivalChoice from './ArrivalChoice'
import GoodsIntake from './GoodsIntake'
import CustomerOrdersBook from './CustomerOrdersBook'
import { pendingPairFor } from '../../lib/deliveryPairs'

import type { ArrivalCandidate } from '../../hooks/useOrders'
import DeliveryPage from './DeliveryPage'
import { StatusBadge } from '../StatusBadge'
import { PipelineStrip } from './PipelineStrip'
import { useIsWide } from '../../hooks/useIsWide'
import { useDeliveryLinks } from '../../hooks/useDeliveryLinks'
import { FilterTabs } from '../ui/FilterTabs'
import { newestFirst } from '../../lib/recency'
import type { OrderLink } from '../../lib/pipelineSteps'
import type { DeliveryNote, PipelineStage } from '../../data/mockData'

// ── מעקב הזמנות וסחורה (spec ch. 6–7, decision D24) ─────────────────────────
//
// One area, one chain: an order is placed, goods arrive, an invoice is attached,
// a person approves, it lands in the ledger. The screen used to be called
// "תעודות משלוח" and showed only the middle of that — which is why the owner
// held the two ends in her head.
//
// The umbrella name is the reason orders live HERE and not behind their own nav
// item: splitting one chain across two screens is what this replaces.

/** Filters over the goods list, named by what the user is looking for. */
type GoodsFilter = 'all' | 'customer' | PipelineStage

// One list, not two tabs. Since an order opens its pipeline the moment it is
// placed, every order ALREADY appears here as a row — the orders tab was showing
// the same records a second time. What it uniquely offered (the arrival button,
// the customer) belongs on the row and in the page, which is where they now are.
const GOODS_FILTERS: { key: GoodsFilter; label: string }[] = [
  { key: 'all',               label: 'הכל' },
  // Not a stage — a lens. "מתי מגיע?" is asked about a person, and answering it
  // meant scanning every row for a name. A customer is waiting behind these and
  // behind no others, which is the whole reason they are worth separating.
  { key: 'customer',          label: 'הזמנות לקוחות' },
  { key: 'awaiting_goods',    label: 'ממתין לסחורה' },
  { key: 'awaiting_invoice',  label: 'ממתין לחשבונית' },
  { key: 'awaiting_approval', label: 'ממתין לאישור' },
  { key: 'in_ledger',         label: 'בכרטסת' },
]

function fmtILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

export default function GoodsTracking({ userEmail, initialNoteId = null }: {
  userEmail?: string
  /** Land straight on one delivery — the supplier card's rows link here. */
  initialNoteId?: string | null
}) {
  const { data: notes, loading: notesLoading, link, unlink, candidates, update, dismantle, create: createNote, resolvePair, settleByReceipt, undoReceipt, reload: reloadNotes } = useDeliveryNotes()
  const { data: invoices, ledgerApprove } = useInvoices()
  const { data: orders, create: createOrder, markArrived, setCustomerStatus, markDiffers } = useOrders()
  const { data: suppliers } = useSuppliers()
  const [newOrder, setNewOrder] = useState(false)
  const [reassign, setReassign] = useState<string | null>(null)
  const [intake, setIntake] = useState(false)
  const isWide = useIsWide()
  const { invoicesFor } = useDeliveryLinks()
  // Cards ⇄ rows, in the exact shape the suppliers screen uses and remembered the
  // same way. Two screens offering the same choice through two different controls
  // is how a system stops feeling like one system.
  const [view, setView] = useState<'cards' | 'table'>(
    () => (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('goodsView') === 'cards') ? 'cards' : 'table',
  )
  const setViewPersist = (v: 'cards' | 'table') => {
    setView(v)
    try { sessionStorage.setItem('goodsView', v) } catch { /* private mode */ }
  }
  // "הגיע" can come back asking which delivery this is, when the supplier's note
  // already arrived by email. The pending gesture is kept so answering resumes it.
  const [arrival, setArrival] = useState<
    { orderId: string; partial: boolean; candidates: ArrivalCandidate[] } | null
  >(null)

  const arrive = async (id: string, partial: boolean, choice?: { adopt?: string; forceNew?: boolean }) => {
    const res = await markArrived(id, partial, choice)
    if (res.needsChoice) { setArrival({ orderId: id, partial, candidates: res.candidates ?? [] }); return }
    setArrival(null)
    // Land ON the goods, not back on a list the order just left. Marking arrival
    // is the moment the order becomes work, and leaving her to find the row it
    // turned into is a step the system can take for her.
    if (res.deliveryNoteId) {
      setOpenId(res.deliveryNoteId)
    }
  }
  const [filter, setFilter] = useState<GoodsFilter>('all')
  const [openId, setOpenId] = useState<string | null>(initialNoteId)

  // Which deliveries came from an order, and did that order arrive? Built once
  // here rather than looked up per row — and it is the ONLY thing the strip takes
  // from the orders table. Nothing numeric crosses over (D22).
  // The order that opened this row, when there is one. Arrival is offered from the
  // page itself now, so the page needs the id and not only the state.
  const orderIdByNote = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) {
      if (o.deliveryNoteId && o.status === 'order_waiting') m.set(o.deliveryNoteId, o.id)
    }
    return m
  }, [orders])

  /** Customer names waiting on each delivery row. */
  const customersByNote = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const o of orders) {
      if (!o.deliveryNoteId || !o.customerName) continue
      m.set(o.deliveryNoteId, [...(m.get(o.deliveryNoteId) ?? []), o.customerName])
    }
    return m
  }, [orders])

  /** What the order behind a row says about itself — description and customer. */
  const orderMeta = useMemo(() => {
    const m = new Map<string, { description: string; customerName: string | null }>()
    for (const o of orders) {
      if (o.deliveryNoteId) m.set(o.deliveryNoteId, { description: o.description, customerName: o.customerName })
    }
    return m
  }, [orders])

  const orderByNote = useMemo(() => {
    const m = new Map<string, OrderLink>()
    for (const o of orders) {
      if (!o.deliveryNoteId) continue
      m.set(o.deliveryNoteId, o.status === 'order_waiting' ? 'waiting' : 'arrived')
    }
    return m
  }, [orders])

  const stageOf = (n: DeliveryNote): PipelineStage => n.stage ?? 'awaiting_invoice'

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const n of notes) c[stageOf(n)] = (c[stageOf(n)] ?? 0) + 1
    // Counted off the ORDERS, not the rows: the notebook keeps arrived orders too,
    // and a count that dropped when something arrived would contradict the page it
    // labels.
    c.customer = orders.filter(o => !!o.customerName).length
    return c
  }, [notes, orders])

  const shown = useMemo(
    () => notes
      .filter(n =>
        filter === 'all' ? true
        : filter === 'customer' ? !!orderMeta.get(n.id)?.customerName
        : stageOf(n) === filter)
      // Newest first, by WHEN THE ROW ENTERED — see src/lib/recency.ts for why
      // that is not the same as the date on the document.
      .sort(newestFirst),
    [notes, filter, orderMeta],
  )

  const openOrders = useMemo(
    () => orders.filter(o => o.status !== 'order_arrived'),
    [orders],
  )

  const openNote = useMemo(() => notes.find(n => n.id === openId) ?? null, [notes, openId])

  // A page, not a dialog: comparing two documents needs the whole width, and a
  // list competing for attention underneath is exactly what made the modal feel
  // cramped. Same shape the invoice screen uses.
  if (openNote) {
    // The picker is rendered HERE, inside the early return. It used to live only
    // beside the list, which the return above never reaches — so "שינוי ספק" set
    // its state and nothing appeared. A modal that belongs to a page has to be
    // mounted by that page.
    return (
      <>
      <DeliveryPage
        note={openNote}
        stage={stageOf(openNote)}
        order={orderByNote.get(openNote.id) ?? 'none'}
        linked={invoicesFor(openNote.id).map(id => invoices.find(i => i.id === id)).filter(Boolean) as typeof invoices}
        invoices={invoices}
        isWide={isWide}
        onBack={() => setOpenId(null)}
        customerOrders={orders.filter(o => o.deliveryNoteId === openNote.id && !!o.customerName)}
            onSetCustomerStatus={setCustomerStatus}
        onLoadCandidates={candidates}
        onLink={async (id, invoiceId) => { await link(id, invoiceId) }}
        onUnlink={async (id, invoiceId) => { await unlink(id, invoiceId) }}
        onApprove={ledgerApprove}
        onChangeSupplier={() => setReassign(openNote.id)}
        onDismantle={async () => { await dismantle(openNote.id) }}
        onSettleByReceipt={async (paymentIds) => { await settleByReceipt(openNote.id, paymentIds) }}
        onUndoReceipt={async () => { await undoReceipt(openNote.id) }}
        pendingPair={pendingPairFor(openNote, notes)}
        onResolvePair={async (arrivedId, action) => { await resolvePair(openNote.id, arrivedId, action) }}
        onMarkDiffers={
          orderIdByNote.has(openNote.id)
            ? async () => { await markDiffers(orderIdByNote.get(openNote.id)!) }
            : undefined
        }
        onArrived={
          orderIdByNote.has(openNote.id)
            ? (partial: boolean) => arrive(orderIdByNote.get(openNote.id)!, partial)
            : undefined
        }
      />
      {reassign && (
        <SupplierPicker
          current={openNote.supplierId ?? ''}
          suppliers={suppliers.map(s => ({ id: s.id, name: s.name, hp: (s as { hp?: string }).hp }))}
          onClose={() => setReassign(null)}
          onPick={async supplierId => {
            await update(reassign, { supplierId } as Parameters<typeof update>[1])
            setReassign(null)
          }}
        />
      )}
      </>
    )
  }

  return (
    <div style={{ direction: 'rtl' }}>
      {/* No page title here: Layout already prints it in the top bar, the same as
          every other screen. Repeating it put the same words on screen twice. */}
      <div className="flex items-center justify-end gap-3 flex-wrap mb-4">
        <button
            onClick={() => setIntake(true)}
            className="font-semibold inline-flex items-center gap-1.5 text-white"
            style={{ background: 'var(--brand-primary)', border: 'none', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
          ><PackageCheck className="w-4 h-4" />קליטת סחורה</button>
          {/* Both entry points sit in the header now, because there is one list
              below them and neither belongs to a half of it. */}
          <button
            onClick={() => setNewOrder(true)}
            className="font-semibold inline-flex items-center gap-1.5"
            style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
          ><Plus className="w-4 h-4" />הזמנה חדשה</button>
      </div>

          {/* Stage filters. The counts are the point — they say where the work is. */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <FilterTabs
              tabs={GOODS_FILTERS
                .map(f => ({
                  key: f.key,
                  label: f.label,
                  count: f.key === 'all' ? notes.length : (counts[f.key] ?? 0),
                }))
                // A filter that would show nothing is not a choice — it is a dead
                // end wearing the same clothes as a live one. "הכל" always stays.
                .filter(t => t.key === 'all' || t.count > 0)}
              value={filter}
              onChange={setFilter}
              style={{ flex: 1 }}
            />
            <div className="flex items-center gap-1 bg-white border p-1 flex-shrink-0" style={{ borderColor: '#EEEEF2', marginInlineStart: 'auto' }}>
              {([
                { key: 'table', Icon: Table2,     label: 'תצוגת שורות' },
                { key: 'cards', Icon: LayoutGrid, label: 'תצוגת כרטיסים' },
              ] as const).map(({ key, Icon, label }) => (
                <button
                  key={key}
                  onClick={() => setViewPersist(key)}
                  title={label}
                  aria-label={label}
                  className="flex items-center justify-center transition-all"
                  style={{
                    width: '38px', height: '34px', border: 'none', cursor: 'pointer',
                    background: view === key ? 'var(--brand-primary)' : 'transparent',
                    color: view === key ? 'white' : '#9CA3AF',
                  }}
                ><Icon className="w-4 h-4" /></button>
              ))}
            </div>
          </div>

          {/* The customer filter opens the NOTEBOOK, not the pipeline table.
              "מחברת פתוחה" was the owner's word for it and it is the spec: read
              down the page, customer first, phone in reach — a record you look
              through, not a table you sort. */}
          {filter === 'customer' ? (
            <CustomerOrdersBook orders={orders} onOpen={setOpenId} onSetStatus={setCustomerStatus} />
          ) : view === 'cards' ? (
            <GoodsCards
              notes={shown}
              orderByNote={orderByNote}
              stageOf={stageOf}
              onOpen={setOpenId}
              customers={customersByNote}
              invoicesFor={invoicesFor}
            />
          ) : (
          <div className="bg-white border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                <thead>
                  <tr>
                    {['ספק', 'תעודה', 'תאריך', 'מצב', 'סטטוס', 'סכום'].map(h => (
                      <th
                        key={h}
                        className="text-right font-semibold"
                        style={{ fontSize: '11px', color: '#9CA3AF', padding: '10px 16px', borderBottom: '1px solid #E2E4E9' }}
                      >{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(n => (
                    <tr
                      key={n.id}
                      onClick={() => setOpenId(n.id)}
                      style={{ cursor: 'pointer' }}
                      title="פתיחת המשלוח"
                    >
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #E2E4E9', fontSize: '13.5px' }}>
                        <span className="font-semibold text-gray-800">{n.supplierName}</span>
                        <div style={{ fontSize: '11.5px', color: '#9CA3AF' }}>
                          {/* An order-opened row says so, and names its customer:
                              with the orders tab gone this row is the only place
                              that information now lives. */}
                          {n.intakeSource === 'order'
                            ? (orderMeta.get(n.id)?.customerName
                                ? `הזמנה · עבור ${orderMeta.get(n.id)!.customerName}`
                                : 'הזמנה')
                            : n.intakeSource === 'email' ? 'הגיע במייל'
                            : n.intakeSource === 'photo' ? 'צילום' : 'קליטה ידנית'}
                        </div>
                        {/* Who is waiting for this, on the ROW. Opening every
                            delivery to find out whether a customer was promised
                            something in it is not a search anyone performs. */}
                        {/* A duplicate says so ON THE ROW. It is the only place
                            the two rows sit side by side, and the alert that
                            raised it lives on another screen. */}
                        {n.isDuplicate && (
                          <div style={{ fontSize: '11.5px', color: '#B91C1C', fontWeight: 700, marginTop: '2px' }}>
                            תעודה כפולה — יש לפרק את השגויה
                          </div>
                        )}
                        {customersByNote.get(n.id)?.length ? (
                          <div style={{ fontSize: '11.5px', color: 'var(--brand-primary)', fontWeight: 700, marginTop: '2px' }}>
                            {customersByNote.get(n.id)!.length === 1
                              ? `עבור ${customersByNote.get(n.id)![0]}`
                              : `${customersByNote.get(n.id)!.length} לקוחות מחכות`}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #E2E4E9', fontSize: '13.5px', fontVariantNumeric: 'tabular-nums' }}>
                        {n.noteNumber || '—'}
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #E2E4E9', fontSize: '12.5px', color: '#9CA3AF', fontVariantNumeric: 'tabular-nums' }}>
                        {n.date}
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #E2E4E9' }}>
                        <PipelineStrip
                          stage={stageOf(n)}
                          order={orderByNote.get(n.id) ?? 'none'}
                          hasInvoice={invoicesFor(n.id).length > 0}
                          compact
                        />
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #E2E4E9' }}>
                        <StatusBadge status={stageOf(n)} />
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #E2E4E9', fontSize: '13.5px', fontVariantNumeric: 'tabular-nums' }}>
                        {/* NULL for an employee — the masking view, not this screen,
                            decides that. Showing a dash is honest; showing ₪0 is not. */}
                        {n.amount ? fmtILS(n.amount) : '—'}
                      </td>
                    </tr>
                  ))}
                  {!notesLoading && shown.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF', fontSize: '14px' }}>
                      אין סחורה במצב הזה
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}

      {newOrder && (
        <OrderForm
          suppliers={suppliers.map(s => ({ id: s.id, name: s.name, hp: (s as { hp?: string }).hp }))}
          onClose={() => setNewOrder(false)}
          openOrders={openOrders.map(o => ({ id: o.id, supplierId: o.supplierId, description: o.description, date: o.date, expectedDate: o.expectedDate, customerName: o.customerName }))}
          onCreate={async d => { await createOrder(d) }}
        />
      )}


      {intake && (
        <GoodsIntake
          suppliers={suppliers.map(s => ({ id: s.id, name: s.name, hp: (s as { hp?: string }).hp }))}
          capturedBy={userEmail}
          onClose={() => setIntake(false)}
          onCreate={async d => { await createNote(d); await reloadNotes() }}
        />
      )}


      {arrival && (
        <ArrivalChoice
          supplierName={orders.find(o => o.id === arrival.orderId)?.supplierName ?? ''}
          candidates={arrival.candidates}
          onClose={() => setArrival(null)}
          onPick={async id => { await arrive(arrival.orderId, arrival.partial, { adopt: id }) }}
          onNew={async () => { await arrive(arrival.orderId, arrival.partial, { forceNew: true }) }}
        />
      )}

      {reassign && (
        <SupplierPicker
          current={notes.find(n => n.id === reassign)?.supplierId ?? ''}
          suppliers={suppliers.map(s => ({ id: s.id, name: s.name, hp: (s as { hp?: string }).hp }))}
          onClose={() => setReassign(null)}
          onPick={async supplierId => {
            // The name is NOT sent. hadas-api resolves it from the id so the two
            // cannot drift — the same rule the invoice screen follows.
            await update(reassign, { supplierId } as Parameters<typeof update>[1])
            setReassign(null)
          }}
        />
      )}
    </div>
  )
}

// ── The same rows, as cards ──────────────────────────────────────────────────
// Offered because the suppliers screen offers it, in the same control and the same
// two shapes. What changes is density, not information: the strip, the badge and
// the supplier are in both, so a person moving between views is not re-learning
// the screen.
function GoodsCards({ notes, orderByNote, stageOf, onOpen, customers, invoicesFor }: {
  notes: DeliveryNote[]
  orderByNote: Map<string, OrderLink>
  stageOf: (n: DeliveryNote) => PipelineStage
  onOpen: (id: string) => void
  customers: Map<string, string[]>
  /** Passed in rather than re-read: one answer about which invoices a row carries. */
  invoicesFor: (noteId: string) => string[]
}) {
  if (notes.length === 0) {
    return (
      <div className="bg-white border text-center" style={{ borderColor: '#EEEEF2', padding: '34px 16px', fontSize: '13.5px', color: '#9CA3AF' }}>
        אין סחורה במצב הזה
      </div>
    )
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
      {notes.map(n => (
        <div
          key={n.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(n.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpen(n.id) }}
          className="bg-white border"
          style={{ borderColor: '#EEEEF2', padding: '14px', cursor: 'pointer' }}
        >
          <h3 className="font-bold text-gray-800" style={{ fontSize: '13.5px', margin: '0 0 3px' }}>
            {n.supplierName || '—'}
          </h3>
          <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 11px' }}>
            {n.noteNumber ? `תעודה ${n.noteNumber} · ` : ''}{n.date}
          </p>
          <PipelineStrip
            stage={stageOf(n)}
            order={orderByNote.get(n.id) ?? 'none'}
            hasInvoice={invoicesFor(n.id).length > 0}
            compact
            showLabels={false}
          />
          {customers.get(n.id)?.length ? (
            <div style={{ fontSize: '11.5px', color: 'var(--brand-primary)', fontWeight: 700, marginTop: '9px' }}>
              {customers.get(n.id)!.length === 1
                ? `עבור ${customers.get(n.id)![0]}`
                : `${customers.get(n.id)!.length} לקוחות מחכות`}
            </div>
          ) : null}
          <div style={{ marginTop: '11px' }}>
            <StatusBadge status={stageOf(n)} />
          </div>
        </div>
      ))}
    </div>
  )
}
