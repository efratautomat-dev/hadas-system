import { useState } from 'react'
import { X, FileText } from 'lucide-react'
import { Button } from '../ui/Button'
import { openExternal } from '../../lib/native'
import { intakeShort } from '../../lib/intakeSource'
import NoteInvoiceCell from './NoteInvoiceCell'
import type { NoteMatching } from './useNoteMatching'
import type { Order } from '../../hooks/useOrders'

/**
 * One delivery note, over whatever screen opened it: what came, from which
 * order, and the invoice it points at. Opened from an order row, from the goods
 * list and from the delivery-notes page — the same window from all three.
 */
export default function DeliveryNotePopup({ noteId, m, orders, onClose, onOpenInvoice, onGoNotesPage }: {
  noteId: string
  m: NoteMatching
  orders: Order[]
  onClose: () => void
  onOpenInvoice?: (invoiceId: string) => void
  onGoNotesPage?: () => void
}) {
  const note = m.noteById.get(noteId)
  const [text, setText] = useState(note?.notes ?? '')
  const [saving, setSaving] = useState(false)
  if (!note) return null
  const order = orders.find(o => o.deliveryNoteId === note.id && !o.customerName) ?? orders.find(o => o.deliveryNoteId === note.id)
  const lines = (note.lineItems ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  const doc = note.driveFileLink || ''

  async function close() {
    if (text !== (note!.notes ?? '')) {
      setSaving(true)
      try { await m.notesApi.saveNotes(note!.id, text) } finally { setSaving(false) }
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(17,24,39,.45)' }} onClick={() => void close()}>
      <div className="bg-white rounded-2xl w-full p-5 flex flex-col gap-4" dir="rtl"
        style={{ maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 40px rgba(0,0,0,.2)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold">תעודת משלוח {note.noteNumber || ''}</h2>
            <div className="text-sm text-gray-500">{note.supplierName} · {note.date} · {intakeShort(note.intakeSource)}</div>
          </div>
          <button type="button" aria-label="סגירה" onClick={() => void close()}
            className="rounded-xl border flex items-center justify-center" style={{ width: 44, height: 44, borderColor: '#D1D5DB' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rounded-xl p-3 text-sm" style={{ background: '#F9FAFB', border: '1px solid #EEF0F3' }}>
          {lines.length > 0
            ? <ul className="list-disc pr-5 space-y-0.5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            : <span className="text-gray-400">לא נרשמו פריטים</span>}
          {doc && (
            <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm font-bold underline" style={{ color: 'var(--brand-primary)' }}
              onClick={() => void openExternal(doc)}>
              <FileText size={14} />פתיחת המסמך
            </button>
          )}
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' }}>
          <div>
            <div className="text-xs text-gray-500 mb-1">הזמנה</div>
            <div className="font-bold text-sm">{order ? `${order.description || 'הזמנה'} · ${order.date}` : 'בלי הזמנה'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">חשבונית</div>
            <NoteInvoiceCell note={note} m={m} onOpenInvoice={onOpenInvoice} />
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">הערות
          <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="למשל: חסרים 2 גלילים"
            className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#D1D5DB' }} />
        </label>

        <div className="flex gap-2 justify-between flex-wrap">
          {onGoNotesPage ? <Button variant="outline" onClick={onGoNotesPage}>לעמוד תעודות המשלוח</Button> : <span />}
          <Button disabled={saving} onClick={() => void close()}>סגירה</Button>
        </div>
      </div>
    </div>
  )
}
