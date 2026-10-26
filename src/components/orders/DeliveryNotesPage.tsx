import { useMemo, useState } from 'react'
import { useOrders } from '../../hooks/useOrders'
import { intakeShort } from '../../lib/intakeSource'
import NoteInvoiceCell from './NoteInvoiceCell'
import DeliveryNotePopup from './DeliveryNotePopup'
import { useNoteMatching } from './useNoteMatching'

// ── תעודות משלוח — its own page, like invoices (DEMO ONLY, 26.10.2026) ──────
//
// The owner's 18.10 model: no chain, no stages. Each delivery note shows the
// invoice it points at — locked, or suggested with the reasons — and the same
// pair shows from the invoice's side ("תעודת משלוח קשורה" on the invoices page).

type Filter = 'all' | 'waiting' | 'locked'
const HAIRLINE = '#E2E4E9'

export default function DeliveryNotesPage({ initialNoteId = null, onOpenInvoice }: {
  initialNoteId?: string | null
  onOpenInvoice?: (invoiceId: string) => void
}) {
  const m = useNoteMatching()
  const { data: orders } = useOrders()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(initialNoteId)

  // A row exists once goods came in or a note was filed — an order's own
  // placeholder (still waiting for goods) is not a delivery note yet.
  const all = useMemo(() => m.notes
    .filter(n => n.stage !== 'awaiting_goods' && !n.isDuplicate)
    .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || '')), [m.notes])
  const isLocked = (id: string) => !!m.lockedInvoice(id)
  const shown = all
    .filter(n => filter === 'all' || (filter === 'locked') === isLocked(n.id))
    .filter(n => !q.trim() || `${n.supplierName} ${n.noteNumber ?? ''}`.includes(q.trim()))
  const orderOf = (noteId: string) => orders.find(o => o.deliveryNoteId === noteId)

  const chips: [Filter, string, number][] = [
    ['all', 'הכל', all.length],
    ['waiting', 'ממתינות לחשבונית', all.filter(n => !isLocked(n.id)).length],
    ['locked', 'נעולות', all.filter(n => isLocked(n.id)).length],
  ]

  return (
    <div className="space-y-4" style={{ direction: 'rtl' }}>
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {chips.map(([k, l, n]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className="text-sm rounded-full px-3 py-1.5"
              style={filter === k
                ? { background: 'var(--brand-primary)', color: 'white', border: '1px solid var(--brand-primary)' }
                : { background: 'white', color: '#374151', border: '1px solid #D1D5DB' }}>
              {l} · {n}
            </button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי ספק או מספר תעודה..."
          className="rounded-xl border px-3 py-2 text-sm bg-white" style={{ borderColor: '#D1D5DB', minWidth: 240 }} />
      </div>

      <div className="bg-white rounded-2xl border overflow-x-auto" style={{ borderColor: HAIRLINE }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr className="text-xs text-gray-500 text-right">
              {['ספק', 'תעודה', 'תאריך', 'איך נקלט', 'הזמנה', 'חשבונית קשורה', 'הערות'].map(h =>
                <th key={h} className="font-semibold px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(n => {
              const o = orderOf(n.id)
              return (
                <tr key={n.id} className="cursor-pointer hover:bg-gray-50 align-top" onClick={() => setOpenId(n.id)}>
                  <td className="px-3 py-3 font-bold" style={{ borderBottom: '1px solid #EEF0F3' }}>{n.supplierName}</td>
                  <td className="px-3 py-3" style={{ borderBottom: '1px solid #EEF0F3' }}>
                    <span className="font-bold underline" style={{ color: 'var(--brand-primary)' }}>{n.noteNumber || 'ללא מספר'}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid #EEF0F3' }}>{n.date}</td>
                  <td className="px-3 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid #EEF0F3' }}>{intakeShort(n.intakeSource)}</td>
                  <td className="px-3 py-3" style={{ borderBottom: '1px solid #EEF0F3' }}>{o ? (o.description || o.date) : <span className="text-gray-400">בלי הזמנה</span>}</td>
                  <td className="px-3 py-3" style={{ borderBottom: '1px solid #EEF0F3', minWidth: 260 }}>
                    <NoteInvoiceCell note={n} m={m} onOpenInvoice={onOpenInvoice} compact />
                  </td>
                  <td className="px-3 py-3 text-gray-600" style={{ borderBottom: '1px solid #EEF0F3', maxWidth: 220 }}>{n.notes || '—'}</td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">אין תעודות בסינון הזה</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {openId && (
        <DeliveryNotePopup noteId={openId} m={m} orders={orders} onClose={() => setOpenId(null)} onOpenInvoice={onOpenInvoice} />
      )}
    </div>
  )
}
