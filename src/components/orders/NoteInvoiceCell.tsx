import { useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import { Button } from '../ui/Button'
import { STATUS } from '../../theme/status'
import type { DeliveryNote } from '../../data/mockData'
import type { NoteMatching } from './useNoteMatching'

const fmt = (n: number) => '₪' + Math.abs(n).toLocaleString('he-IL')

/**
 * The invoice a delivery note points at, in one of three states — locked, a
 * suggestion with its reasons, or nothing found — and the actions for each:
 * "נעל התאמה", "פתח נעילה", "בחר/החלף חשבונית". Used on the delivery-notes page
 * and in the note's popup, so both say the same thing about the same pair.
 */
export default function NoteInvoiceCell({ note, m, onOpenInvoice, compact = false }: {
  note: DeliveryNote
  m: NoteMatching
  onOpenInvoice?: (invoiceId: string) => void
  compact?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = m.lockedInvoice(note.id)
  const sug = m.suggestion(note)
  const shown = locked ?? sug?.invoice ?? null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
      {shown ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="font-bold underline text-sm" style={{ color: 'var(--brand-primary)' }}
            onClick={() => onOpenInvoice?.(shown.id)}>
            חשבונית {shown.invoiceNumber || '—'}
          </button>
          {locked
            ? <span className="text-xs font-bold rounded-md px-1.5 py-0.5 inline-flex items-center gap-1" style={{ background: STATUS.green.bg, color: STATUS.green.fg }}><Lock size={11} />נעולה</span>
            : <span className="text-xs font-bold rounded-md px-1.5 py-0.5" style={{ background: STATUS.blue.bg, color: STATUS.blue.fg }}>הצעה אוטומטית</span>}
        </div>
      ) : (
        <span className="text-sm" style={{ color: '#9CA3AF' }}>לא נמצאה חשבונית מתאימה{compact ? '' : ' — עוד לא הגיעה?'}</span>
      )}
      {!locked && sug && <span className="text-xs text-gray-500">{sug.reasons.join(' · ')}</span>}
      {locked && <span className="text-xs text-gray-500">{fmt(Number(locked.amount) || 0)} · {locked.date}</span>}

      <div className="flex gap-1.5 flex-wrap">
        {!locked && sug && (
          <Button size="sm" disabled={busy} onClick={() => void run(() => m.lock(note.id, sug.invoice.id))}>נעל התאמה</Button>
        )}
        {locked && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => m.unlock(note.id))}>
            <Unlock size={13} className="inline ml-1" />פתח נעילה
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPicking(true)}>
          {shown ? 'החלף חשבונית' : 'בחר חשבונית'}
        </Button>
      </div>

      {picking && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(17,24,39,.45)' }}
          onClick={() => setPicking(false)}>
          <div className="bg-white rounded-2xl w-full p-5 flex flex-col gap-3" dir="rtl" style={{ maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold">בחירת חשבונית — {note.supplierName}</h2>
            <p className="text-sm text-gray-500">
              לתעודה {note.noteNumber || note.date}. כל החשבוניות של הספק, המתאימה ביותר למעלה; מקושרות לתעודה אחרת מסומנות.
            </p>
            {m.ranked(note).length === 0 && <p className="text-sm text-gray-400">אין לספק הזה חשבוניות במערכת.</p>}
            {m.ranked(note).map(s => {
              const other = s.takenBy ? m.noteById.get(s.takenBy) : null
              return (
                <div key={s.invoice.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: '#E2E4E9' }}>
                  <div className="text-sm">
                    <b>{s.invoice.invoiceNumber || '—'}</b> · {s.invoice.date} · {fmt(Number(s.invoice.amount) || 0)}
                    <div className="text-xs text-gray-500">{s.reasons.join(' · ')}</div>
                    {s.takenBy && (
                      <div className="text-xs font-bold" style={{ color: STATUS.orange.fg }}>
                        מקושרת לתעודה {other?.noteNumber || other?.date || 'אחרת'}
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="outline" disabled={busy || locked?.id === s.invoice.id}
                    onClick={() => void run(async () => {
                      if (locked) await m.unlock(note.id)
                      await m.lock(note.id, s.invoice.id)
                      setPicking(false)
                    })}>
                    {locked?.id === s.invoice.id ? 'נבחרה' : 'בחירה'}
                  </Button>
                </div>
              )
            })}
            <div className="flex justify-start"><Button variant="ghost" onClick={() => setPicking(false)}>ביטול</Button></div>
          </div>
        </div>
      )}
    </div>
  )
}
