import { useState } from 'react'
import { Camera, Keyboard, X, Check, PackageCheck, FileSignature } from 'lucide-react'
import { SearchableSelect } from '../SearchableSelect'
import { FieldLabel, TextInput, Textarea } from '../ui/form'
import CaptureDocument from '../CaptureDocument'
import HandwrittenSheet from './HandwrittenSheet'
import { FormShell } from './FormShell'

// ── קליטת סחורה — one door, two ways in ──────────────────────────────────────
//
// Photographing a delivery and typing one out were two buttons in two places, and
// the employee had to know which screen each lived on. They produce exactly the
// same row — a delivery at `awaiting_invoice` — so they belong behind one door,
// and the choice inside it is about what is convenient right now, not about what
// kind of record is being made.
//
// Opened from a supplier's card the supplier is fixed and shown, which removes the
// one field that could file goods against the wrong supplier.

type Mode = 'choose' | 'photo' | 'sheet' | 'manual'

export default function GoodsIntake({
  suppliers, lockedSupplier, capturedBy, onClose, onCreate, inline = false,
}: {
  suppliers: { id: string; name: string; hp?: string }[]
  lockedSupplier?: { id: string; name: string }
  capturedBy?: string
  onClose: () => void
  onCreate: (draft: {
    supplierId: string; supplierName: string
    isoDate: string; lineItems: string; noteNumber?: string
  }) => Promise<void>
  /**
   * Render in the page flow instead of over it. The employee screens open these
   * inline — a dialog inside a supplier card on a phone is a letterbox — while a
   * list opens the same component as a dialog, which is right when you are
   * picking one thing off a page you mean to keep.
   */
  inline?: boolean
}) {
  const [mode, setMode] = useState<Mode>('choose')
  const [supplierId, setSupplierId] = useState(lockedSupplier?.id ?? '')
  const [isoDate, setIsoDate] = useState(new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState('')
  const [noteNumber, setNoteNumber] = useState('')
  const [busy, setBusy] = useState(false)

  const supplier = lockedSupplier ?? suppliers.find(s => s.id === supplierId)
  const ready = !!supplierId && items.trim().length > 0

  const save = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      await onCreate({
        supplierId,
        supplierName: supplier?.name ?? '',
        isoDate,
        lineItems: items.trim(),
        noteNumber: noteNumber.trim() || undefined,
      })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <FormShell onClose={onClose} inline={inline} maxWidth={mode === 'photo' ? '680px' : '560px'}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
          <span className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
            <PackageCheck className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            קליטת סחורה{lockedSupplier ? ` — ${lockedSupplier.name}` : ''}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
            title="סגירה"
          ><X className="w-5 h-5" /></button>
        </div>

        {mode === 'choose' && (
          <div className="px-5 py-4 grid gap-3">
            <p style={{ fontSize: '12.5px', color: '#9CA3AF', margin: 0 }}>
              שתי הדרכים מייצרות את אותה שורה, שממתינה לחשבונית. בחרי מה שנוח עכשיו.
            </p>
            <button
              onClick={() => setMode('photo')}
              className="flex items-start gap-3 text-right"
              style={{ border: '1px solid #E2E4E9', background: 'white', padding: '15px', cursor: 'pointer', font: 'inherit' }}
            >
              <Camera className="w-5 h-5" style={{ color: 'var(--brand-primary)', flex: 'none', marginTop: 2 }} />
              <span>
                <b style={{ fontSize: '13.5px', display: 'block' }}>צילום</b>
                <span style={{ fontSize: '12px', color: '#9CA3AF' }}>תעודה של הספק, או דף פריטים בכתב יד.</span>
              </span>
            </button>
            {/* Only offered from inside a supplier's card, because the sheet
                carries no supplier — the card IS the answer. Without one there is
                nothing to attach the reading to. */}
            {lockedSupplier && (
              <button
                onClick={() => setMode('sheet')}
                className="flex items-start gap-3 text-right"
                style={{ border: '1px solid #E2E4E9', background: 'white', padding: '15px', cursor: 'pointer', font: 'inherit' }}
              >
                <FileSignature className="w-5 h-5" style={{ color: 'var(--brand-primary)', flex: 'none', marginTop: 2 }} />
                <span>
                  <b style={{ fontSize: '13.5px', display: 'block' }}>דף בכתב יד</b>
                  <span style={{ fontSize: '12px', color: '#9CA3AF' }}>טופס הפריטים והכמויות שממלאים ליד המשטח.</span>
                </span>
              </button>
            )}
            <button
              onClick={() => setMode('manual')}
              className="flex items-start gap-3 text-right"
              style={{ border: '1px solid #E2E4E9', background: 'white', padding: '15px', cursor: 'pointer', font: 'inherit' }}
            >
              <Keyboard className="w-5 h-5" style={{ color: 'var(--brand-primary)', flex: 'none', marginTop: 2 }} />
              <span>
                <b style={{ fontSize: '13.5px', display: 'block' }}>הקלדה</b>
                <span style={{ fontSize: '12px', color: '#9CA3AF' }}>פריטים וכמויות, שורה לכל פריט. כשאין תעודה בכלל.</span>
              </span>
            </button>
          </div>
        )}

        {mode === 'photo' && (
          <div className="px-5 py-4">
            <CaptureDocument capturedBy={capturedBy} />
            <button
              onClick={() => setMode('choose')}
              style={{ marginTop: '12px', background: 'transparent', border: 'none', color: '#6B6E73', fontSize: '12.5px', cursor: 'pointer', padding: 0 }}
            >← חזרה</button>
          </div>
        )}

        {mode === 'sheet' && lockedSupplier && (
          <div className="px-5 py-4">
            <HandwrittenSheet
              supplierName={lockedSupplier.name}
              capturedBy={capturedBy}
              onCancel={() => setMode('choose')}
              onSave={async lineItems => {
                await onCreate({
                  supplierId: lockedSupplier.id,
                  supplierName: lockedSupplier.name,
                  isoDate: new Date().toISOString().slice(0, 10),
                  lineItems,
                })
                onClose()
              }}
            />
          </div>
        )}

        {mode === 'manual' && (
          <>
            <div className="px-5 py-4 grid gap-4">
              {lockedSupplier ? (
                <div>
                  <FieldLabel>ספק</FieldLabel>
                  <div
                    className="flex items-center justify-between"
                    style={{ background: '#F3F4F6', border: '1px solid #E2E4E9', padding: '10px 14px', fontSize: '13.5px', color: '#4B5563' }}
                  >
                    <span style={{ fontWeight: 700 }}>{lockedSupplier.name}</span>
                    <small style={{ fontSize: '10.5px', color: '#9CA3AF', fontWeight: 700 }}>מכרטיס הספק</small>
                  </div>
                </div>
              ) : (
                <div>
                  <FieldLabel required>ספק</FieldLabel>
                  <SearchableSelect
                    value={supplierId}
                    onChange={setSupplierId}
                    placeholder="-- בחר --"
                    options={suppliers.map(s => ({ value: s.id, label: s.name, keywords: s.hp }))}
                  />
                </div>
              )}
              <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <FieldLabel>תאריך</FieldLabel>
                  <TextInput type="date" value={isoDate} onChange={setIsoDate} />
                </div>
                <div>
                  <FieldLabel>מספר תעודה</FieldLabel>
                  <TextInput value={noteNumber} onChange={setNoteNumber} placeholder="ריק אם אין" />
                </div>
              </div>
              <div>
                <FieldLabel required>מה התקבל</FieldLabel>
                <Textarea rows={5} value={items} onChange={setItems} placeholder={'שם פריט וכמות בכל שורה'} />
                {/* No amount field, deliberately: the figure comes from the invoice,
                    once, and a number typed here would be a second one to reconcile. */}
                <p style={{ margin: '3px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
                  בלי סכומים — הם מגיעים מהחשבונית.
                </p>
              </div>
            </div>
            <div className="px-5 pb-5 flex items-center gap-2">
              <button
                disabled={!ready || busy}
                onClick={save}
                className="font-semibold inline-flex items-center gap-1.5 text-white"
                style={{
                  background: ready ? 'var(--brand-primary)' : '#D6D7DD', border: 'none',
                  padding: '9px 18px', fontSize: '13px',
                  cursor: !ready ? 'not-allowed' : busy ? 'wait' : 'pointer',
                }}
              ><Check className="w-4 h-4" />{busy ? 'שומר…' : 'שמירה'}</button>
              <button
                onClick={() => setMode('choose')}
                style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
              >חזרה</button>
            </div>
          </>
        )}
    </FormShell>
  )
}
