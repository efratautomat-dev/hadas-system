import { useMemo, useState } from 'react'
import { Camera, Plus } from 'lucide-react'
import { useDeliveryNotes } from '../../hooks/useDeliveryNotes'
import { useInvoices } from '../../hooks/useInvoices'
import { useOrders, type Order } from '../../hooks/useOrders'
import { useSuppliers } from '../../hooks/useSuppliers'
import OrderForm from './OrderForm'
import SupplierPicker from './SupplierPicker'
import DeliveryDetail from './DeliveryDetail'
import { StatusBadge, StatusFlag } from '../StatusBadge'
import { PipelineStrip } from './PipelineStrip'
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

type Tab = 'goods' | 'orders'

const TABS: { key: Tab; label: string }[] = [
  { key: 'goods',  label: 'סחורה' },
  { key: 'orders', label: 'הזמנות' },
]

/** Filters over the goods list, named by what the user is looking for. */
type GoodsFilter = 'all' | PipelineStage

const GOODS_FILTERS: { key: GoodsFilter; label: string }[] = [
  { key: 'all',               label: 'הכל' },
  { key: 'awaiting_invoice',  label: 'ממתין לחשבונית' },
  { key: 'awaiting_approval', label: 'ממתין לאישור' },
  { key: 'awaiting_goods',    label: 'חשבונית ללא סחורה' },
  { key: 'in_ledger',         label: 'בכרטסת' },
]

function fmtILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

export default function GoodsTracking({ onOpenCapture }: { onOpenCapture?: () => void }) {
  const { data: notes, loading: notesLoading, link, unlink, candidates, update } = useDeliveryNotes()
  const { data: invoices, ledgerApprove } = useInvoices()
  const { data: orders, loading: ordersLoading, create: createOrder, markArrived } = useOrders()
  const { data: suppliers } = useSuppliers()
  const [newOrder, setNewOrder] = useState(false)
  const [reassign, setReassign] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('goods')
  const [filter, setFilter] = useState<GoodsFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  // Which deliveries came from an order, and did that order arrive? Built once
  // here rather than looked up per row — and it is the ONLY thing the strip takes
  // from the orders table. Nothing numeric crosses over (D22).
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
    return c
  }, [notes])

  const shown = useMemo(
    () => notes
      .filter(n => filter === 'all' || stageOf(n) === filter)
      .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || '')),
    [notes, filter],
  )

  const openOrders = useMemo(
    () => orders.filter(o => o.status !== 'order_arrived'),
    [orders],
  )

  const openNote = useMemo(() => notes.find(n => n.id === openId) ?? null, [notes, openId])

  return (
    <div style={{ direction: 'rtl' }}>
      {/* No page title here: Layout already prints it in the top bar, the same as
          every other screen. Repeating it put the same words on screen twice. */}
      <div className="flex items-center justify-end gap-3 flex-wrap mb-4">
        {onOpenCapture && (
          <button
            onClick={onOpenCapture}
            className="inline-flex items-center gap-2 font-bold text-white"
            style={{ background: 'var(--brand-primary)', border: 'none', padding: '9px 18px', fontSize: '14px', cursor: 'pointer' }}
          >
            <Camera className="w-4 h-4" />
            צילום מסמך
          </button>
        )}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(t => {
          const on = tab === t.key
          const n = t.key === 'orders' ? openOrders.length : notes.length
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="inline-flex items-center gap-2 font-semibold"
              style={{
                fontSize: '13.5px', padding: '8px 16px', cursor: 'pointer',
                background: on ? 'var(--brand-primary)' : 'white',
                color: on ? 'white' : '#6B6E73',
                border: `1px solid ${on ? 'var(--brand-primary)' : '#EEEEF2'}`,
              }}
            >
              {t.label}
              {n > 0 && (
                <span
                  className="rounded-full grid place-items-center font-bold"
                  style={{
                    minWidth: '19px', height: '19px', padding: '0 5px', fontSize: '11px',
                    background: on ? 'rgba(255,255,255,0.3)' : '#F3F4F6',
                    color: on ? 'white' : '#6B7280',
                  }}
                >{n}</span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'goods' ? (
        <>
          {/* Stage filters. The counts are the point — they say where the work is. */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {GOODS_FILTERS.map(f => {
              const on = filter === f.key
              const n = f.key === 'all' ? notes.length : (counts[f.key] ?? 0)
              if (f.key !== 'all' && n === 0) return null
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className="inline-flex items-center gap-2"
                  style={{
                    fontSize: '12.5px', fontWeight: 500, padding: '6px 13px', cursor: 'pointer',
                    borderRadius: '999px',
                    background: on ? 'var(--brand-primary)' : 'var(--brand-coral-bg)',
                    color: on ? 'white' : 'var(--brand-primary)',
                    border: `1px solid ${on ? 'var(--brand-primary)' : '#F9BAB5'}`,
                  }}
                >
                  {f.label}
                  <span
                    className="rounded-full grid place-items-center font-bold"
                    style={{
                      minWidth: '18px', height: '18px', padding: '0 5px', fontSize: '10.5px',
                      background: on ? 'rgba(255,255,255,0.3)' : 'white', color: on ? 'white' : 'var(--brand-primary)',
                    }}
                  >{n}</span>
                </button>
              )
            })}
          </div>

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
                          {n.intakeSource === 'email' ? 'הגיע במייל'
                            : n.intakeSource === 'photo' ? 'צילום' : 'קליטה ידנית'}
                        </div>
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
        </>
      ) : (
        <>
          {/* The create button lives INSIDE the orders tab, not in the page header:
              the header belongs to the whole area, and "הזמנה חדשה" is not an action
              on the goods list. */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <p style={{ fontSize: '12.5px', color: '#9CA3AF', margin: 0 }}>
              הזמנה שתסומן "הגיע" הופכת לסחורה שממתינה לחשבונית.
            </p>
            <button
              onClick={() => setNewOrder(true)}
              className="font-semibold inline-flex items-center gap-1.5 text-white"
              style={{ background: 'var(--brand-primary)', border: 'none', padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}
            ><Plus className="w-4 h-4" />הזמנה חדשה</button>
          </div>
          <OrdersList orders={openOrders} allOrders={orders} loading={ordersLoading}
            onArrived={(id, partial) => markArrived(id, partial)} />
        </>
      )}

      {newOrder && (
        <OrderForm
          suppliers={suppliers.map(s => ({ id: s.id, name: s.name, hp: (s as { hp?: string }).hp }))}
          onClose={() => setNewOrder(false)}
          onCreate={async d => { await createOrder(d) }}
        />
      )}

      {openNote && (
        <DeliveryDetail
          note={openNote}
          stage={stageOf(openNote)}
          order={orderByNote.get(openNote.id) ?? 'none'}
          invoice={invoices.find(i => i.id === openNote.linkedInvoiceId)}
          invoices={invoices}
          onClose={() => setOpenId(null)}
          onLoadCandidates={candidates}
          onLink={async (id, invoiceId) => { await link(id, invoiceId) }}
          onUnlink={async id => { await unlink(id) }}
          onApprove={ledgerApprove}
          onChangeSupplier={() => setReassign(openNote.id)}
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

// ── The orders board ─────────────────────────────────────────────────────────
// Nearest first (§7.7). A split pair is drawn as a pair: the original keeps
// waiting and says WHY there is a second row, because two rows for one supplier
// on one day with no explanation reads as a duplicate and someone deletes one.
function OrdersList({ orders, allOrders, loading, onArrived }: {
  orders: Order[]; allOrders: Order[]; loading: boolean
  onArrived: (id: string, partial: boolean) => Promise<void>
}) {
  const splitParents = useMemo(() => {
    const s = new Set<string>()
    for (const o of allOrders) {
      if (o.status !== 'order_partial') continue
      for (const p of allOrders) {
        if (p.id !== o.id && p.supplierId === o.supplierId && p.status === 'order_waiting') s.add(p.id)
      }
    }
    return s
  }, [allOrders])

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
      {orders.map(o => (
        <div
          key={o.id}
          className="bg-white border"
          style={{
            borderColor: '#EEEEF2', padding: '14px',
            borderInlineStartWidth: o.status === 'order_partial' ? '3px' : undefined,
            borderInlineStartColor: o.status === 'order_partial' ? '#C2410C' : undefined,
          }}
        >
          <h3 className="font-bold text-gray-800" style={{ fontSize: '14px', marginBottom: '3px' }}>{o.supplierName}</h3>
          <p style={{ fontSize: '12.5px', color: '#6B6E73', margin: '0 0 11px' }}>{o.description}</p>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <StatusBadge status={o.status} />
            {splitParents.has(o.id) ? (
              // The "הגיע" button is GONE once this order was split — otherwise it
              // gets pressed again and splits a third time.
              <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>חלק ממנה הגיע</span>
            ) : o.status !== 'order_waiting' ? (
              // A partial row IS the goods that already landed. Offering it "הגיע"
              // again invites a second split of something already received.
              <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>נכנסה לפייפליין</span>
            ) : (
              <OrderArrivedButton id={o.id} onArrived={onArrived} />
            )}
          </div>
          {o.arrivedDiffers && (
            <div style={{ marginTop: '9px' }}>
              <StatusFlag label="שונה מהמוזמן" tone="pending" />
            </div>
          )}
          <div style={{ fontSize: '11.5px', color: '#9CA3AF', marginTop: '8px' }}>{o.date}</div>
        </div>
      ))}
      {!loading && orders.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF', fontSize: '14px' }}>
          אין הזמנות פתוחות
        </div>
      )}
    </div>
  )
}


// ── "הגיע", on the manager's board ──────────────────────────────────────────
// It shipped with no onClick at all: a primary-coloured button that did nothing,
// on the one gesture the whole chapter is built around. The employee's rail had
// the handler; this copy did not, which is exactly the drift that having two
// boards invites.
//
// Full vs partial is asked, not assumed — a split creates a row, and a split made
// by accident is confusing to undo.
function OrderArrivedButton({ id, onArrived }: {
  id: string
  onArrived: (id: string, partial: boolean) => Promise<void>
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (partial: boolean) => {
    setBusy(true)
    try { await onArrived(id, partial) } finally { setBusy(false); setAsking(false) }
  }

  if (!asking) {
    return (
      <button
        onClick={() => setAsking(true)}
        className="font-semibold text-white"
        style={{ background: 'var(--brand-primary)', border: 'none', padding: '6px 14px', fontSize: '12.5px', cursor: 'pointer' }}
      >הגיע</button>
    )
  }
  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      <span style={{ fontSize: '11.5px', color: '#6B6E73' }}>מה הגיע?</span>
      <button
        disabled={busy}
        onClick={() => run(false)}
        className="font-semibold text-white"
        style={{ background: 'var(--brand-primary)', border: 'none', padding: '5px 11px', fontSize: '12px', cursor: busy ? 'wait' : 'pointer' }}
      >הכל</button>
      <button
        disabled={busy}
        onClick={() => run(true)}
        style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '5px 11px', fontSize: '12px', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
      >חלק</button>
      <button
        onClick={() => setAsking(false)}
        style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}
      >ביטול</button>
    </div>
  )
}
