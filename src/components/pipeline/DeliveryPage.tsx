import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight, Check, Link2, Unlink, UserCog, Scissors, FileText,
  Truck, Eye, ExternalLink, PackageCheck,
} from 'lucide-react'
import { PipelineStrip } from './PipelineStrip'
import { StatusBadge } from '../StatusBadge'
import { PdfPreviewModal } from '../PdfPreviewModal'
import { supabase } from '../../lib/supabase'
import type { OrderLink } from '../../lib/pipelineSteps'
import type { DeliveryNote, Invoice, InvoiceCandidate, PipelineStage } from '../../data/mockData'

// ── One delivery, as a PAGE ──────────────────────────────────────────────────
//
// This was a modal. The owner asked for full screens, and she is right for a
// reason beyond taste: the work here is COMPARING two documents, and a dialog
// floating over a list gives the documents a third of the room while the list
// underneath competes for attention. The invoice screen settled this argument
// already — document on one side, everything else on the other — so this follows
// it rather than inventing a third arrangement.
//
// Actions live in a rail down the side, not in a row at the bottom: the bottom of
// a two-pane page is somewhere you have to scroll to, and the decision is the
// point of the screen.
//
// Buttons are quiet by default. Exactly ONE action per state is filled with brand
// colour — the one the screen exists for. A colour that appears five times has
// stopped saying "this one".

function fmtILS(n: number | null | undefined) {
  return n == null ? '—' : '₪' + n.toLocaleString('he-IL')
}

const BTN_BASE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '7px', width: '100%',
  padding: '9px 13px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  border: '1px solid #E2E4E9', background: 'white', color: '#4B5563',
  fontFamily: 'inherit', textAlign: 'right', justifyContent: 'flex-start',
}
const BTN_PRIMARY: React.CSSProperties = {
  ...BTN_BASE, background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)',
  color: 'white', fontWeight: 700,
}
const BTN_QUIET: React.CSSProperties = {
  ...BTN_BASE, border: 'none', background: 'transparent', color: '#9CA3AF', fontWeight: 500,
}

export default function DeliveryPage({
  note, stage, order, invoice, invoices, isWide,
  onBack, onLoadCandidates, onLink, onUnlink, onApprove,
  onChangeSupplier, onDismantle, onOpenInvoice, onArrived,
}: {
  note: DeliveryNote
  stage: PipelineStage
  order: OrderLink
  invoice?: Invoice
  invoices: Invoice[]
  isWide: boolean
  onBack: () => void
  onLoadCandidates: (noteId: string) => Promise<InvoiceCandidate[]>
  onLink: (noteId: string, invoiceId: string) => Promise<void>
  onUnlink: (noteId: string) => Promise<void>
  onApprove: (invoiceId: string) => Promise<number>
  onChangeSupplier?: () => void
  /** Manager only. Absent = the control is not rendered at all. */
  onDismantle?: () => Promise<void>
  onOpenInvoice?: (invoiceId: string) => void
  /** Present only while the goods have not arrived — an order still waiting. */
  onArrived?: (partial: boolean) => Promise<void>
}) {
  const [candidates, setCandidates] = useState<InvoiceCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'approve' | 'dismantle' | 'arrived' | null>(null)
  const [docView, setDocView] = useState<{ url: string; previewSrc?: string } | null>(null)
  const [pane, setPane] = useState<'note' | 'invoice'>('note')

  const needsInvoice = stage === 'awaiting_invoice' || stage === 'awaiting_goods'

  useEffect(() => {
    if (!needsInvoice) return
    let alive = true
    onLoadCandidates(note.id).then(c => { if (alive) setCandidates(c) })
    return () => { alive = false }
  }, [note.id, needsInvoice, onLoadCandidates])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false); setConfirm(null) }
  }

  // A Storage path is not a URL — ingested notes carry only a path, signed here on
  // demand. Drive links open directly.
  const openStored = async (path: string) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
    if (data?.signedUrl) setDocView({ url: path, previewSrc: data.signedUrl })
  }

  const noteDoc    = note.driveFileLink || note.storageUrl || ''
  const invoiceDoc = invoice?.driveFileLink || ''
  const shown      = pane === 'note' ? noteDoc : invoiceDoc

  const siblings = useMemo(() => (invoice ? 1 : 0), [invoice])

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5"
        style={{ background: 'transparent', border: 'none', color: '#6B6E73', fontSize: '13.5px', cursor: 'pointer', padding: 0 }}
      ><ChevronRight className="w-4 h-4" />חזרה למעקב</button>

      <div className="flex items-center gap-3 flex-wrap">
        <Truck className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
        <h1 className="font-bold text-gray-800" style={{ fontSize: '19px', margin: 0 }}>
          {note.supplierName}{note.noteNumber ? ` · תעודה ${note.noteNumber}` : ''}
        </h1>
        <StatusBadge status={stage} />
      </div>

      <PipelineStrip stage={stage} order={order} hasInvoice={!!invoice} />

      <div
        style={{
          display: 'flex', gap: '16px', alignItems: 'flex-start',
          flexDirection: isWide ? 'row' : 'column',
        }}
      >
        {/* ── Document pane. Same shape as the invoice screen: the working
              surface gets half the width and stays put while the other side
              scrolls. Two documents share it through a switch, because the job
              is comparing them and side-by-side thirds are unreadable. */}
        <div style={{
          background: '#F3F4F6', border: '1px solid #DEDFE5', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          ...(isWide
            ? { flex: '1 1 50%', position: 'sticky' as const, top: '8px', height: 'calc(100vh - 150px)' }
            : { width: '100%', height: '55vh' }),
        }}>
          <div className="flex items-center justify-between" style={{ padding: '8px 12px', background: '#FAFAFC', borderBottom: '1px solid #E2E4E9', flexShrink: 0 }}>
            <div className="flex gap-1">
              {([['note', 'תעודה'], ['invoice', 'חשבונית']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setPane(k)}
                  disabled={k === 'invoice' && !invoice}
                  style={{
                    padding: '5px 12px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer',
                    border: '1px solid ' + (pane === k ? 'var(--brand-primary)' : '#E2E4E9'),
                    background: pane === k ? 'var(--brand-primary)' : 'white',
                    color: pane === k ? 'white' : (k === 'invoice' && !invoice) ? '#C9C7CC' : '#6B6E73',
                    fontFamily: 'inherit',
                  }}
                >{label}</button>
              ))}
            </div>
            {shown && (
              <button
                onClick={() => (pane === 'note' && !note.driveFileLink && note.storageUrl)
                  ? openStored(note.storageUrl)
                  : setDocView({ url: shown })}
                className="inline-flex items-center gap-1.5"
                style={{ padding: '5px 10px', border: '1px solid #DEDFE5', background: 'white', color: 'var(--brand-primary)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
              ><Eye size={13} />הגדל</button>
            )}
          </div>
          <div className="grid place-items-center" style={{ flex: 1, color: '#B7B9C0', fontSize: '13px', padding: '16px', textAlign: 'center' }}>
            {shown
              ? <span>לחצי "הגדל" לצפייה במסמך</span>
              : pane === 'invoice'
                ? <span>אין חשבונית מוצמדת</span>
                : <span>לא נשמר מסמך לתעודה הזו</span>}
          </div>
        </div>

        {/* ── Details + actions ──────────────────────────────────────────── */}
        <div style={{ flex: isWide ? '1 1 50%' : undefined, width: isWide ? undefined : '100%', display: 'grid', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 180px', gap: '14px' }}>
            <div style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
              <section className="bg-white border" style={{ borderColor: '#E2E4E9', padding: '14px 16px' }}>
                <h4 className="font-bold" style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '0 0 9px' }}>מה הגיע</h4>
                <Row k="תעודה" v={note.noteNumber || '—'} />
                <Row k="תאריך" v={note.date || '—'} />
                <Row k="סכום" v={fmtILS(note.amount || null)} />
                {note.lineItems && (
                  <p style={{ fontSize: '12.5px', color: '#6B6E73', marginTop: '9px', whiteSpace: 'pre-wrap' }}>{note.lineItems}</p>
                )}
              </section>

              <section className="bg-white border" style={{ borderColor: '#E2E4E9', padding: '14px 16px' }}>
                <h4 className="font-bold" style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '0 0 9px' }}>על מה חויבנו</h4>
                {invoice ? (
                  <>
                    <Row k="חשבונית" v={invoice.invoiceNumber || invoice.id} />
                    <Row k="תאריך" v={invoice.date || '—'} />
                    {/* NULL for an employee — the masking view decides that, not
                        this screen. A dash is honest; ₪0 would not be. */}
                    <Row k="סכום" v={fmtILS(invoice.amount ?? null)} />
                  </>
                ) : (
                  <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>עדיין לא הוצמדה חשבונית.</p>
                )}
              </section>

              {needsInvoice && (
                <section className="bg-white border" style={{ borderColor: '#E2E4E9', padding: '14px 16px' }}>
                  <h4 className="font-bold text-gray-700" style={{ fontSize: '13px', margin: '0 0 3px' }}>חשבוניות אפשריות</h4>
                  <p style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '0 0 10px' }}>
                    לפי ספק, קרבת תאריך וסכום. ההצמדה רק בלחיצה שלך.
                  </p>
                  {candidates === null ? (
                    <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>טוען…</p>
                  ) : candidates.length === 0 ? (
                    <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>לא נמצאה חשבונית מתאימה בחודש וחצי האחרונים.</p>
                  ) : (
                    <div className="grid gap-2">
                      {candidates.map(c => {
                        const inv = invoices.find(i => i.id === c.invoice_id)
                        return (
                          <div key={c.invoice_id} className="flex items-center justify-between gap-2 border flex-wrap" style={{ borderColor: '#E2E4E9', padding: '10px 12px' }}>
                            <div style={{ fontSize: '12.5px', minWidth: 0 }}>
                              <span className="font-semibold">{inv?.invoiceNumber || c.invoice_number || c.invoice_id}</span>
                              <span style={{ color: '#9CA3AF' }}>
                                {' · '}{inv?.date || c.invoice_date || '—'}
                                {c.day_gap != null && ` · הפרש ${c.day_gap} ימים`}
                              </span>
                              {c.amount_match && <span style={{ color: '#166534', fontWeight: 700 }}>{' · סכום זהה'}</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {inv?.driveFileLink && (
                                <button
                                  onClick={() => setDocView({ url: inv.driveFileLink! })}
                                  title="צפייה בחשבונית"
                                  style={{ padding: '5px 8px', border: '1px solid #DEDFE5', background: 'white', color: 'var(--brand-primary)', cursor: 'pointer' }}
                                ><Eye size={13} /></button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() => act(() => onLink(note.id, c.invoice_id))}
                                className="inline-flex items-center gap-1.5"
                                style={{ padding: '6px 11px', fontSize: '12.5px', fontWeight: 700, border: '1px solid var(--brand-primary)', background: 'white', color: 'var(--brand-primary)', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                              ><Link2 className="w-3.5 h-3.5" />הצמדה</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* ── The action rail ──────────────────────────────────────────
                Down the side and sticky, because the decision is what the page
                is for and it should never be somewhere you scroll to find. */}
            <aside style={{ display: 'grid', gap: '7px', alignContent: 'start', position: 'sticky', top: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#9CA3AF', letterSpacing: '.05em' }}>פעולות</span>

              {onArrived && (
                confirm === 'arrived' ? (
                  <>
                    <button disabled={busy} onClick={() => act(() => onArrived(false))} style={BTN_PRIMARY}>
                      <PackageCheck className="w-4 h-4" />הכל הגיע
                    </button>
                    <button disabled={busy} onClick={() => act(() => onArrived(true))} style={BTN_BASE}>חלק הגיע</button>
                    <button onClick={() => setConfirm(null)} style={BTN_QUIET}>ביטול</button>
                  </>
                ) : (
                  <button onClick={() => setConfirm('arrived')} style={BTN_PRIMARY}>
                    <PackageCheck className="w-4 h-4" />הסחורה הגיעה
                  </button>
                )
              )}

              {stage === 'awaiting_approval' && invoice && (
                confirm === 'approve' ? (
                  <>
                    <p style={{ fontSize: '12px', color: '#4B5563', margin: 0 }}>
                      הסכום ייכנס ליתרת הספק{siblings > 1 ? `, וכל ${siblings} המשלוחים ייסגרו יחד` : ''}.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => act(async () => { await onApprove(invoice.id); onBack() })}
                      style={BTN_PRIMARY}
                    ><Check className="w-4 h-4" />כן, הכנס לכרטסת</button>
                    <button onClick={() => setConfirm(null)} style={BTN_QUIET}>ביטול</button>
                  </>
                ) : (
                  <button onClick={() => setConfirm('approve')} style={BTN_PRIMARY}>
                    <Check className="w-4 h-4" />אישור — הכנס לכרטסת
                  </button>
                )
              )}

              {invoice && (
                <button disabled={busy} onClick={() => act(() => onUnlink(note.id))} style={BTN_BASE}>
                  <Unlink className="w-4 h-4" />החלפת חשבונית
                </button>
              )}
              {invoice && onOpenInvoice && (
                <button onClick={() => onOpenInvoice(invoice.id)} style={BTN_BASE}>
                  <ExternalLink className="w-4 h-4" />פתיחת החשבונית
                </button>
              )}
              {onChangeSupplier && (
                <button onClick={onChangeSupplier} style={BTN_BASE}>
                  <UserCog className="w-4 h-4" />שינוי ספק
                </button>
              )}

              {stage === 'in_ledger' && (
                <p className="inline-flex items-center gap-1.5" style={{ fontSize: '12.5px', color: '#166534', margin: '4px 0 0' }}>
                  <FileText className="w-3.5 h-3.5" />נכנס לכרטסת. נספר פעם אחת.
                </p>
              )}

              {onDismantle && (
                confirm === 'dismantle' ? (
                  <>
                    <p style={{ fontSize: '12px', color: '#4B5563', margin: '8px 0 0' }}>
                      הקשרים יפורקו. <b>המסמכים יישארו</b> ואפשר יהיה לשייך מחדש.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => act(async () => { await onDismantle(); onBack() })}
                      style={{ ...BTN_BASE, borderColor: '#B91C1C', color: '#B91C1C', fontWeight: 700 }}
                    >כן, פרקי</button>
                    <button onClick={() => setConfirm(null)} style={BTN_QUIET}>ביטול</button>
                  </>
                ) : (
                  <button onClick={() => setConfirm('dismantle')} style={{ ...BTN_QUIET, marginTop: '8px' }}>
                    <Scissors className="w-3.5 h-3.5" />פירוק הפייפליין
                  </button>
                )
              )}
            </aside>
          </div>
        </div>
      </div>

      {docView && (
        <PdfPreviewModal url={docView.url} previewSrc={docView.previewSrc} onClose={() => setDocView(null)} />
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ padding: '4px 0', fontSize: '13.5px' }}>
      <span style={{ color: '#6B6E73' }}>{k}</span>
      <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  )
}
