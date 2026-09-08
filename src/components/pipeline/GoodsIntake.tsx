import { useState } from 'react'
import { useEmployees } from '../../hooks/useEmployees'
import { Camera, Keyboard, X, Check, PackageCheck, FileSignature, ChevronRight } from 'lucide-react'
import { SearchableSelect } from '../SearchableSelect'
import { FieldLabel, TextInput } from '../ui/form'
import LineItemsEditor from './LineItemsEditor'
import { newLine, lineTotal, linesToText, type Line } from '../../lib/lineItems'
import CaptureDocument from '../CaptureDocument'
import HandwrittenSheet from './HandwrittenSheet'
import ArrivalChoice from './ArrivalChoice'
import type { ArrivalCandidate } from '../../hooks/useOrders'
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
  suppliers, lockedSupplier, capturedBy, onClose, onCreate, onOpenDelivery,
  inline = false, adoptNoteId,
}: {
  suppliers: { id: string; name: string; hp?: string }[]
  lockedSupplier?: { id: string; name: string }
  capturedBy?: string
  /**
   * Record INTO an existing pipeline row instead of opening one.
   *
   * The owner's rule, and she is right: "כל דבר שמגיע פותח פייפליין והעבודה הלאה
   * היא משם". A row already waiting for goods — an invoice that came first, an
   * order not yet delivered — knows its supplier and knows which chain this
   * belongs to. Asking for a supplier and then asking "is this the delivery you
   * already have?" is asking a question whose answer is on the screen.
   *
   * So every save here carries `adopt`, the server merges into that row instead
   * of inserting, and no duplicate question is raised because there is no
   * ambiguity to raise it about.
   */
  adoptNoteId?: string
  /** Passed to the photo door: a note already on file opens instead of filing. */
  onOpenDelivery?: (deliveryNoteId: string) => void
  onClose: () => void
  onCreate: (draft: {
    supplierId: string; supplierName: string
    isoDate: string; lineItems: string; noteNumber?: string
    /** Σ cost from the sheet, or null when it was not fully priced. */
    amount?: number | null
    /** Where the photographed page was filed, so the row keeps its source. */
    storageUrl?: string | null
    /** Which of the doors below produced this — typed, or read off a photo. */
    intakeSource?: 'manual' | 'sheet'
    /** Who took the delivery — §6.5. */
    employeeId?: string
    adopt?: string; forceNew?: boolean
  }) => Promise<{ needsChoice?: boolean; candidates?: ArrivalCandidate[] } | void>
  /**
   * Render in the page flow instead of over it. The employee screens open these
   * inline — a dialog inside a supplier card on a phone is a letterbox — while a
   * list opens the same component as a dialog, which is right when you are
   * picking one thing off a page you mean to keep.
   */
  inline?: boolean
}) {
  const { data: employees } = useEmployees()
  const [mode, setMode] = useState<Mode>('choose')
  const [supplierId, setSupplierId] = useState(lockedSupplier?.id ?? '')
  const [isoDate, setIsoDate] = useState(new Date().toISOString().slice(0, 10))
  // Same grid the sheet's confirmation uses. A free-text box here and a priced
  // grid there would have been two ways to record one delivery.
  const [lines, setLines] = useState<Line[]>([newLine(), newLine(), newLine()])
  const [noteNumber, setNoteNumber] = useState('')
  // Who physically took the delivery. The old receipt form asked; the single door
  // that replaced it did not, so the column 20260823 added — with a comment saying
  // this had been silently unrecorded — went silently unrecorded again by a new
  // route. §6.5 is built on it.
  const [employeeId, setEmployeeId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)
  // The server answers "there is already a delivery waiting for this supplier"
  // instead of writing. The draft is held so answering resumes the same save.
  const [choice, setChoice] = useState<
    { candidates: ArrivalCandidate[]; draft: Parameters<typeof onCreate>[0] } | null
  >(null)

  const supplier = lockedSupplier ?? suppliers.find(s => s.id === supplierId)
  // The sheet needs a supplier from somewhere: the card it opened from, or the
  // picker it shows when there is no card.
  const sheetSupplier = lockedSupplier ?? suppliers.find(s => s.id === supplierId)
  const ready = !!supplierId && lines.some(l => l.item.trim())

  const submit = async (draft: Parameters<typeof onCreate>[0]) => {
    setBusy(true)
    setErr(null)
    try {
      // Into the row that sent us, when there is one.
      const res = await onCreate(adoptNoteId ? { ...draft, adopt: adoptNoteId } : draft)
      if (res && res.needsChoice) {
        setChoice({ candidates: res.candidates ?? [], draft })
        return
      }
      onClose()
    } catch (e) {
      // A failed save used to be COMPLETELY silent here: the hook logged, set its
      // own error state that nothing on this screen renders, and re-threw into a
      // click handler. The dialog stayed open with no message, which reads as
      // "the button does nothing" — and that is what it was.
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const save = () => {
    if (!ready || busy) return
    return submit({
      supplierId,
      supplierName: supplier?.name ?? '',
      isoDate,
      lineItems: linesToText(lines),
      amount: lineTotal(lines),
      noteNumber: noteNumber.trim() || undefined,
      employeeId: employeeId || undefined,
      intakeSource: 'manual',
    })
  }

  // The same control, in the same place, on every mode. It used to be three
  // different things: "← חזרה" at the bottom of the photo pane, "חזרה" beside the
  // save button on the typed form, and a proper labelled back on the sheet. Three
  // spellings of one action is three things to learn.
  const back = (
    <button
      onClick={() => setMode('choose')}
      className="inline-flex items-center gap-1"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6E73', fontSize: '12.5px', fontWeight: 600, fontFamily: 'inherit', padding: 0 }}
    ><ChevronRight className="w-4 h-4" />חזרה לבחירה</button>
  )

  return (
    <>
    {choice && (
      <ArrivalChoice
        supplierName={supplier?.name ?? ''}
        candidates={choice.candidates}
        onClose={() => setChoice(null)}
        onPick={async id => { setChoice(null); await submit({ ...choice.draft, adopt: id }) }}
        onNew={async () => { setChoice(null); await submit({ ...choice.draft, forceNew: true }) }}
      />
    )}
    <FormShell onClose={onClose} inline={inline} maxWidth={mode === 'photo' ? '680px' : '560px'}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
          <span className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
            <PackageCheck className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            {adoptNoteId
              ? 'הסחורה הגיעה?'
              : `קליטת סחורה${lockedSupplier ? ` — ${lockedSupplier.name}` : ''}`}
          </span>
          {/* No X on a block that lives INSIDE the page it belongs to — there is
              nothing to close, and a close icon on a section reads as "remove". */}
          {!(adoptNoteId && inline) && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
              title="סגירה"
            ><X className="w-5 h-5" /></button>
          )}
        </div>

        {/* Said once, under the header, so it is seen whichever door is open. */}
        {err && (
          <p style={{
            margin: 0, padding: '9px 20px', background: '#FFF0EF', color: '#B23B3B',
            fontSize: '12.5px', borderBottom: '1px solid #F6D9D6',
          }}>{err}</p>
        )}

        {mode === 'choose' && (
          <div className="px-5 py-4 grid gap-3">
            <p style={{ fontSize: '12.5px', color: '#9CA3AF', margin: 0 }}>
              {adoptNoteId
                ? 'רשמי מה הגיע — זה נכנס לשורה הזו, ולא נפתחת שורה שנייה.'
                : 'שתי הדרכים מייצרות את אותה שורה, שממתינה לחשבונית. בחרי מה שנוח עכשיו.'}
            </p>
            {/* The camera door is NOT offered when recording into an existing row.
                It files through ingest, which opens a row of its own — the exact
                duplicate this block exists to avoid. A supplier's own note that
                turns up later is photographed the ordinary way and answered by the
                "הגיעה תעודת משלוח מהספק" question on this same page. */}
            {!adoptNoteId && (
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
            )}
            {/* Offered ALWAYS. It used to be hidden unless a supplier was locked,
                so opening intake from the goods screen simply had one fewer option
                than opening it from a card — with nothing saying why. An option
                that disappears without explanation reads as a missing feature.
                The sheet carries no supplier, so it asks for one instead. */}
            {(
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
            <div style={{ marginBottom: '10px' }}>{back}</div>
            <CaptureDocument capturedBy={capturedBy} onOpenDelivery={onOpenDelivery} />
          </div>
        )}

        {mode === 'sheet' && !sheetSupplier && (
          <div className="px-5 py-4 grid gap-3">
            {back}
            <p style={{ fontSize: '13px', color: '#6B6E73', margin: 0 }}>
              הדף נושא פריטים וכמויות בלבד — <b>הספק לא כתוב עליו</b>. בחרי אותו כאן
              והוא יירשם על התעודה.
            </p>
            <div>
              <FieldLabel required>ספק</FieldLabel>
              <SearchableSelect
                value={supplierId}
                onChange={setSupplierId}
                placeholder="-- בחר --"
                options={suppliers.map(s => ({ value: s.id, label: s.name, keywords: s.hp }))}
              />
            </div>
          </div>
        )}

        {mode === 'sheet' && sheetSupplier && (
          <div className="px-5 py-4">
            <HandwrittenSheet
              supplierName={sheetSupplier.name}
              capturedBy={capturedBy}
              onCancel={() => setMode('choose')}
              onSave={async (lineItems, amount, storageUrl) => {
                await submit({
                  supplierId: sheetSupplier.id,
                  supplierName: sheetSupplier.name,
                  // §7.b — stamped from the capture, never written on the page.
                  isoDate: new Date().toISOString().slice(0, 10),
                  lineItems,
                  amount,
                  storageUrl,
                  employeeId: employeeId || undefined,
                  // The lines look exactly like typed ones, and they are not: a
                  // model read them off a photograph. The row has to say so, or
                  // "items with no document" cannot be told from an honest typed
                  // receipt — and only one of the two is a lost file.
                  intakeSource: 'sheet',
                })
              }}
            />
          </div>
        )}

        {mode === 'manual' && (
          <>
            <div className="px-5 py-4 grid gap-4">
              {back}
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
              <div>
                <FieldLabel>מי קלט/ה</FieldLabel>
                <SearchableSelect
                  value={employeeId}
                  onChange={setEmployeeId}
                  placeholder="— בחירה —"
                  allowClear
                  options={employees.map(e => ({ value: e.id, label: e.name }))}
                />
              </div>
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
                <LineItemsEditor lines={lines} onChange={setLines} />
                <p style={{ margin: '5px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
                  {/* The price is optional and never reaches the ledger — it is
                      what the approval screen compares the invoice against. */}
                  {lineTotal(lines) !== null
                    ? 'הסה"כ מחושב לבד ומשמש להשוואה מול החשבונית — הוא לא נכנס ליתרה.'
                    : 'מחיר לא חובה. בלי מחיר בכל השורות לא יחושב סה"כ — היתרה זזה מהחשבונית בלבד.'}
                </p>
              </div>
            </div>
            <div className="px-5 pb-5 flex items-center gap-2 flex-wrap">
              <button
                disabled={!ready || busy}
                onClick={save}
                className="font-semibold inline-flex items-center gap-1.5 text-white"
                style={{
                  background: ready ? 'var(--brand-primary)' : '#D6D7DD', border: 'none',
                  padding: '9px 18px', fontSize: '13px',
                  cursor: !ready ? 'not-allowed' : busy ? 'wait' : 'pointer',
                }}
              ><Check className="w-4 h-4" />{busy ? 'שומר…' : adoptNoteId ? 'שמירה לשורה הזו' : 'שמירה'}</button>
              {/* WHY it will not save, on the screen. A disabled button is
                  indistinguishable from a broken one: the click does nothing, the
                  console says nothing, and the reasonable conclusion is that the
                  system is broken. It cost a live testing session to learn that. */}
              {!ready && !busy && (
                <span style={{ fontSize: '12px', color: '#B45309', fontWeight: 600 }}>
                  {!supplierId ? 'עוד לא נבחר ספק' : 'עוד לא נרשם אף פריט'}
                </span>
              )}
            </div>
          </>
        )}
    </FormShell>
    </>
  )
}
