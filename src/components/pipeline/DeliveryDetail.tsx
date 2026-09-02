import { useEffect, useMemo, useState } from 'react'
import { UserCog, Check, Link2, Unlink, X, FileText, Truck, Scissors } from 'lucide-react'
import { PipelineStrip } from './PipelineStrip'
import { StatusBadge } from '../StatusBadge'
import type { OrderLink } from '../../lib/pipelineSteps'
import type { DeliveryNote, Invoice, InvoiceCandidate, PipelineStage } from '../../data/mockData'

// ── One delivery, and what it is waiting for ─────────────────────────────────
//
// The panel does the two things the pipeline actually needs a person for:
//
//   awaiting_invoice   → pick the invoice this delivery belongs to. The system
//                        SUGGESTS (supplier + date + amount) and a human confirms
//                        — §6.f, never a blind attachment.
//   awaiting_approval  → look at the goods beside the bill and let the pair into
//                        the ledger. ONE approval moves every delivery attached to
//                        that invoice, which is what makes a consolidated invoice
//                        one decision instead of five (§6.7).
//
// The amount enters the balance from the INVOICE, once, however many deliveries
// hang off it (§6.c). Nothing here adds it up per note.

function fmtILS(n: number | null | undefined) {
  return n == null ? '—' : '₪' + n.toLocaleString('he-IL')
}

export default function DeliveryDetail({
  note, stage, order, invoice, invoices,
  onClose, onLoadCandidates, onLink, onUnlink, onApprove, onChangeSupplier, onDismantle,
}: {
  note: DeliveryNote
  stage: PipelineStage
  order: OrderLink
  /** The invoice already attached, if any. */
  invoice?: Invoice
  /** Every invoice, for naming a candidate without a second fetch. */
  invoices: Invoice[]
  onClose: () => void
  onLoadCandidates: (noteId: string) => Promise<InvoiceCandidate[]>
  onLink: (noteId: string, invoiceId: string) => Promise<void>
  onUnlink: (noteId: string) => Promise<void>
  onApprove: (invoiceId: string) => Promise<number>
  onChangeSupplier?: () => void
  /**
   * Take this chain apart. Manager only — passing nothing hides the control, which
   * is how the employee's copy of this panel differs: same screen, fewer actions.
   */
  onDismantle?: () => Promise<void>
}) {
  const [candidates, setCandidates] = useState<InvoiceCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [confirmDismantle, setConfirmDismantle] = useState(false)

  const needsInvoice = stage === 'awaiting_invoice' || stage === 'awaiting_goods'

  useEffect(() => {
    if (!needsInvoice) return
    let alive = true
    onLoadCandidates(note.id).then(c => { if (alive) setCandidates(c) })
    return () => { alive = false }
  }, [note.id, needsInvoice, onLoadCandidates])

  // How many deliveries this approval will move. Read from the data already on
  // screen rather than asked for, because the number is the reason the sentence
  // on the button is honest.
  const siblings = useMemo(
    () => (invoice ? 1 : 0),
    [invoice],
  )

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '24px 12px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white shadow-2xl w-full" style={{ maxWidth: '860px', direction: 'rtl' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            <span className="font-bold text-gray-800" style={{ fontSize: '15px' }}>
              {note.supplierName}{note.noteNumber ? ` · תעודה ${note.noteNumber}` : ''}
            </span>
            <StatusBadge status={stage} />
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
            title="סגירה"
          ><X className="w-5 h-5" /></button>
        </div>

        {/* ── Where it stands ────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b" style={{ borderColor: '#EEEEF2' }}>
          <PipelineStrip stage={stage} order={order} />
        </div>

        {/* ── Provenance + the manual override ───────────────────────────────
            The same pair the statements screen uses: say how the supplier was
            identified, and put the correction next to it. A delivery matched to
            the wrong supplier is the same problem a statement has, so it gets the
            same control rather than a new one. */}
        <div className="px-5 pb-3 pt-3 flex flex-wrap items-center gap-2">
          <span
            style={{
              padding: '6px 10px', fontSize: '12px', background: '#F3F4F6',
              border: '1px solid #E2E4E9', color: '#4B5563',
            }}
          >
            {note.intakeSource === 'email'
              ? <>הגיע <strong style={{ fontWeight: 800 }}>במייל</strong> מהספק</>
              : note.intakeSource === 'photo'
                ? <>נקלט <strong style={{ fontWeight: 800 }}>מצילום</strong></>
                : <>נקלט <strong style={{ fontWeight: 800 }}>בהקלדה ידנית</strong></>}
            {note.date ? ` · ${note.date}` : ''}
          </span>
          {onChangeSupplier && (
            <button
              onClick={onChangeSupplier}
              className="font-bold inline-flex items-center gap-1.5"
              style={{
                background: 'white', color: 'var(--brand-primary)',
                border: '1px solid var(--brand-primary)', padding: '6px 12px',
                fontSize: '12px', cursor: 'pointer',
              }}
            ><UserCog className="w-3.5 h-3.5" />שינוי ספק</button>
          )}
        </div>

        {/* ── The pair ───────────────────────────────────────────────────── */}
        <div className="px-5 pb-5 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <section className="border p-4" style={{ borderColor: '#EEEEF2' }}>
            <h4 className="font-bold" style={{ fontSize: '11.5px', color: '#9CA3AF', marginBottom: '10px' }}>מה הגיע</h4>
            <Row k="תעודה" v={note.noteNumber || '—'} />
            <Row k="תאריך" v={note.date || '—'} />
            <Row k="סכום" v={fmtILS(note.amount || null)} />
            {note.lineItems && (
              <p style={{ fontSize: '12.5px', color: '#6B6E73', marginTop: '10px', whiteSpace: 'pre-wrap' }}>
                {note.lineItems}
              </p>
            )}
          </section>

          <section className="border p-4" style={{ borderColor: '#EEEEF2' }}>
            <h4 className="font-bold" style={{ fontSize: '11.5px', color: '#9CA3AF', marginBottom: '10px' }}>על מה חויבנו</h4>
            {invoice ? (
              <>
                <Row k="חשבונית" v={invoice.invoiceNumber || invoice.id} />
                <Row k="תאריך" v={invoice.date || '—'} />
                {/* NULL for an employee — the masking view decides that, not this
                    screen. A dash is honest; ₪0 would not be. */}
                <Row k="סכום" v={fmtILS(invoice.amount ?? null)} />
              </>
            ) : (
              <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>
                עדיין לא הוצמדה חשבונית.
              </p>
            )}
          </section>
        </div>

        {/* ── What to do next ────────────────────────────────────────────── */}
        {needsInvoice ? (
          <div className="px-5 pb-5">
            <h4 className="font-bold text-gray-700" style={{ fontSize: '13px', marginBottom: '8px' }}>
              חשבוניות אפשריות
            </h4>
            <p style={{ fontSize: '12px', color: '#9CA3AF', marginTop: 0, marginBottom: '10px' }}>
              המערכת מציעה לפי ספק, קרבת תאריך וסכום. ההצמדה נעשית רק בלחיצה שלך.
            </p>
            {candidates === null ? (
              <p style={{ fontSize: '13px', color: '#9CA3AF' }}>טוען…</p>
            ) : candidates.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#9CA3AF' }}>
                לא נמצאה חשבונית מתאימה לספק הזה בחודש וחצי האחרונים.
              </p>
            ) : (
              <div className="grid gap-2">
                {candidates.map(c => {
                  const inv = invoices.find(i => i.id === c.invoice_id)
                  return (
                    <div
                      key={c.invoice_id}
                      className="flex items-center justify-between gap-3 border p-3 flex-wrap"
                      style={{ borderColor: '#E2E4E9' }}
                    >
                      <div style={{ fontSize: '13px' }}>
                        <span className="font-semibold">{inv?.invoiceNumber || c.invoice_number || c.invoice_id}</span>
                        <span style={{ color: '#9CA3AF' }}>
                          {' · '}{inv?.date || c.invoice_date || '—'}
                          {c.day_gap != null && ` · הפרש ${c.day_gap} ימים`}
                        </span>
                        {c.amount_match && (
                          <span style={{ color: '#166534', fontWeight: 700 }}>{' · סכום זהה'}</span>
                        )}
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => act(() => onLink(note.id, c.invoice_id))}
                        className="font-semibold inline-flex items-center gap-1.5 text-white"
                        style={{
                          background: 'var(--brand-primary)', border: 'none',
                          padding: '7px 14px', fontSize: '12.5px', cursor: busy ? 'wait' : 'pointer',
                        }}
                      ><Link2 className="w-3.5 h-3.5" />הצמדה</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : stage === 'awaiting_approval' && invoice ? (
          <div className="px-5 pb-5 flex items-center gap-2 flex-wrap">
            {confirmApprove ? (
              <>
                <span style={{ fontSize: '13px', color: '#4B5563' }}>
                  הסכום ייכנס ליתרת הספק{siblings > 1 ? `, וכל ${siblings} המשלוחים ייסגרו יחד` : ''}.
                </span>
                <button
                  disabled={busy}
                  onClick={() => act(async () => { await onApprove(invoice.id); onClose() })}
                  className="font-semibold inline-flex items-center gap-1.5 text-white"
                  style={{ background: 'var(--brand-primary)', border: 'none', padding: '9px 18px', fontSize: '13px', cursor: busy ? 'wait' : 'pointer' }}
                ><Check className="w-4 h-4" />כן, הכנס לכרטסת</button>
                <button
                  onClick={() => setConfirmApprove(false)}
                  style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
                >ביטול</button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setConfirmApprove(true)}
                  className="font-semibold inline-flex items-center gap-1.5 text-white"
                  style={{ background: 'var(--brand-primary)', border: 'none', padding: '9px 18px', fontSize: '13px', cursor: 'pointer' }}
                ><Check className="w-4 h-4" />אישור — הכנס לכרטסת</button>
                <button
                  disabled={busy}
                  onClick={() => act(() => onUnlink(note.id))}
                  className="inline-flex items-center gap-1.5"
                  style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
                ><Unlink className="w-3.5 h-3.5" />ביטול הצמדה</button>
              </>
            )}
          </div>
        ) : (
          <div className="px-5 pb-5 flex items-center gap-2" style={{ fontSize: '13px', color: '#166534' }}>
            <FileText className="w-4 h-4" />
            נכנס לכרטסת. הסכום נספר פעם אחת, מהחשבונית.
          </div>
        )}

        {/* ── Dismantle ────────────────────────────────────────────────────
            Last, quiet, and behind a question — it is a correction, not part of
            the flow. The sentence says what it does NOT do, because "פירוק"
            beside an invoice reads like deletion and nobody should have to
            discover otherwise by trying it. */}
        {onDismantle && (
          <div className="px-5 pb-5" style={{ borderTop: '1px solid #ECECEF', paddingTop: '14px' }}>
            {confirmDismantle ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ fontSize: '12.5px', color: '#4B5563' }}>
                  הקשרים יפורקו. <b>החשבונית והתעודה יישארו במערכת</b> ואפשר יהיה לשייך מחדש.
                </span>
                <button
                  disabled={busy}
                  onClick={() => act(async () => { await onDismantle(); onClose() })}
                  className="font-semibold text-white"
                  style={{ background: '#B91C1C', border: 'none', padding: '7px 14px', fontSize: '12.5px', cursor: busy ? 'wait' : 'pointer' }}
                >כן, פרקי</button>
                <button
                  onClick={() => setConfirmDismantle(false)}
                  style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '7px 12px', fontSize: '12.5px', cursor: 'pointer' }}
                >ביטול</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDismantle(true)}
                className="inline-flex items-center gap-1.5"
                style={{ background: 'transparent', border: 'none', color: '#9CA3AF', fontSize: '12.5px', cursor: 'pointer', padding: 0 }}
              ><Scissors className="w-3.5 h-3.5" />פירוק הפייפליין</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ padding: '5px 0', fontSize: '13.5px' }}>
      <span style={{ color: '#6B6E73' }}>{k}</span>
      <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  )
}
