import { useRef, useState } from 'react'
import { ChevronRight, Camera, Check, Loader2, Pencil, Printer } from 'lucide-react'
import { readHandwrittenSheet } from '../../lib/api'
import { printGoodsSheet } from '../../utils/pdf/goodsSheetPdf'
import LineItemsEditor from './LineItemsEditor'
import { newLine, lineTotal, linesToText, type Line } from '../../lib/lineItems'

// ── קליטת סחורה מדף בכתב יד ──────────────────────────────────────────────────
//
// The owner's decision: not a free page — a fixed two-column form, item and
// quantity, and nothing else. The two fields that are hardest to read off a
// document are not on it at all:
//
//   the supplier — known, because this opens from inside his card
//   the date     — stamped at capture
//
// Which removes both of the things that actually break ingest — the supplier
// matching chain and amount extraction — from this path entirely.
//
// The reading is a PROPOSAL. Handwriting is the one input where the machine is
// least sure and the person holding the page is completely sure, so every line is
// editable and lines the model doubted are marked rather than dropped. A missing
// line someone can see beats a wrong line nobody can.


function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error ?? new Error('קריאת הקובץ נכשלה'))
    r.readAsDataURL(f)
  })
}

export default function HandwrittenSheet({
  supplierName, capturedBy, onCancel, onSave,
}: {
  supplierName: string
  capturedBy?: string
  onCancel: () => void
  /**
   * The confirmed lines, and a total ONLY when every line was priced.
   * `null` means "not known", which is different from zero and must stay so.
   */
  onSave: (lineItems: string, amount: number | null) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [rows, setRows] = useState<Line[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const read = async (f: File) => {
    setBusy(true); setErr(null)
    try {
      const dataUrl = await fileToDataUrl(f)
      setPhoto(dataUrl)
      const lines = await readHandwrittenSheet({
        imageBase64: dataUrl, mimeType: f.type || 'image/jpeg', capturedBy,
      })
      setRows(lines.map(l => ({ ...l, ...newLine(), item: l.item, quantity: l.quantity, price: l.price, uncertain: l.uncertain })))
      if (lines.length === 0) setErr('לא זוהו שורות בדף. אפשר להוסיף ידנית.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const save = async () => {
    const kept = (rows ?? []).filter(r => r.item.trim())
    if (kept.length === 0) return
    setBusy(true)
    try {
      // Stored the way a typed receipt is stored — one line per item — so nothing
      // downstream needs to know this arrived as a photograph.
      await onSave(linesToText(kept), total)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const uncertain = (rows ?? []).filter(r => r.uncertain).length

  // Σ price × quantity, and ONLY when every line carries a price. A partial total
  // is a number that looks like the delivery's value and is not — worse than no
  // number, because nobody re-checks a figure that is already there.
  const filled = (rows ?? []).filter(r => r.item.trim())
  const priced = filled.filter(r => r.price.trim() !== '')
  const total = lineTotal(rows ?? [])

  return (
    <div className="bg-white border" style={{ borderColor: '#E2E4E9' }}>
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
        <span className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
          <Camera className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
          דף סחורה בכתב יד — {supplierName}
        </span>
        {/* NOT an X. The dialog around this one already has an X that closes
            everything, and two identical icons meaning two different things is a
            control nobody can use — you cannot tell which one you are pressing
            until after you press it. */}
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6E73', fontSize: '12.5px', fontWeight: 600, fontFamily: 'inherit' }}
        ><ChevronRight className="w-4 h-4" />חזרה לבחירה</button>
      </div>

      {!rows && (
        <div className="px-5 py-5 grid gap-3">
          <p style={{ fontSize: '13px', color: '#6B6E73', margin: 0 }}>
            צלמי את הדף כך שהטבלה תמלא את המסגרת. <b>אין צורך לכתוב ספק או תאריך</b> —
            הם נרשמים לבד. אם אין לך טפסים מודפסים, אפשר להדפיס כאן — הטופס יוצא
            עם שם הספק כבר עליו.
          </p>
          <p style={{ fontSize: '12.5px', color: '#9CA3AF', margin: 0 }}>
            עובד גם על טבלה שסורטטה ביד או על פתק — הטופס המודפס רק נקרא הכי טוב.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) read(f) }}
          />
          <div className="flex gap-2 flex-wrap">
            <button
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="font-semibold inline-flex items-center gap-1.5 text-white"
              style={{ background: 'var(--brand-primary)', border: 'none', padding: '10px 18px', fontSize: '13.5px', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {busy ? 'קורא את הדף…' : 'צילום הדף'}
            </button>
            <button
              onClick={() => printGoodsSheet({ supplierName })}
              className="inline-flex items-center gap-1.5"
              style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '10px 16px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}
            ><Printer className="w-4 h-4" />הדפסת הטופס למילוי</button>
          </div>
          {err && <p style={{ margin: 0, fontSize: '13px', color: '#DC2626' }}>{err}</p>}
        </div>
      )}

      {rows && (
        <div className="px-5 py-4 grid gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p style={{ fontSize: '13px', color: '#6B6E73', margin: 0 }}>
              {rows.length} שורות נקראו. אפשר לתקן הכל לפני שמירה.
            </p>
            {uncertain > 0 && (
              <span
                style={{ fontSize: '11.5px', fontWeight: 700, padding: '3px 9px', background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}
              >{uncertain} שורות לא בוודאות — כדאי לבדוק</span>
            )}
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: photo ? '1fr 1fr' : '1fr' }}>
            {photo && (
              // The photo stays ON SCREEN while she corrects. Checking a reading
              // against a page you can no longer see is not checking.
              <img
                src={photo}
                alt="הדף שצולם"
                style={{ width: '100%', border: '1px solid #E2E4E9', objectFit: 'contain', maxHeight: '460px' }}
              />
            )}
            <LineItemsEditor lines={rows} onChange={setRows} />
          </div>

          {err && <p style={{ margin: 0, fontSize: '13px', color: '#DC2626' }}>{err}</p>}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              disabled={busy || rows.every(r => !r.item.trim())}
              onClick={save}
              className="font-semibold inline-flex items-center gap-1.5 text-white"
              style={{
                background: rows.some(r => r.item.trim()) ? 'var(--brand-primary)' : '#D6D7DD',
                border: 'none', padding: '9px 18px', fontSize: '13px',
                cursor: busy ? 'wait' : 'pointer',
              }}
            ><Check className="w-4 h-4" />{busy ? 'שומר…' : 'שמירה כתעודת משלוח'}</button>
            <button
              onClick={() => { setRows(null); setPhoto(null); setErr(null) }}
              className="inline-flex items-center gap-1.5"
              style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
            ><Pencil className="w-3.5 h-3.5" />צילום מחדש</button>
          </div>
          <p style={{ fontSize: '11.5px', color: '#9CA3AF', margin: 0 }}>
            {total !== null
              ? 'הסה"כ מחושב לבד ומשמש להשוואה מול החשבונית — הוא לא נכנס ליתרה.'
              : priced.length > 0
                ? 'חלק מהשורות בלי מחיר — לא יחושב סכום. אפשר להשלים או להשאיר.'
                : 'בלי מחירים — התעודה תישמר ללא סכום, והסכום יגיע מהחשבונית.'}
          </p>
        </div>
      )}
    </div>
  )
}
