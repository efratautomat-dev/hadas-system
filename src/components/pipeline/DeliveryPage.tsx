import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight, ChevronDown, Check, Link2, Unlink, UserCog, Scissors, FileText,
  Truck, Eye, ExternalLink, PackageCheck, TriangleAlert,
} from 'lucide-react'
import { PipelineStrip } from './PipelineStrip'
import GoodsIntake from './GoodsIntake'
import { intakeLong, noDocumentReason, documentExpected } from '../../lib/intakeSource'
import { ReceiptSettle } from './ReceiptSettle'
import { parseLines, parsedTotal, type ParsedLine } from '../../lib/lineItemsFormat'
import { StatusBadge } from '../StatusBadge'
import { PdfPreviewButton, PdfPreviewModal, DocumentBody } from '../PdfPreviewModal'
import { supabase } from '../../lib/supabase'
import type { OrderLink } from '../../lib/pipelineSteps'
import type { DeliveryNote, Invoice, InvoiceCandidate, PipelineStage } from '../../data/mockData'
import type { Order } from '../../hooks/useOrders'
import type { CustomerStatus } from '../../lib/customerStatus'
import { CustomerStatusControl } from './CustomerOrdersBook'

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

// ── The note's table, as a table ─────────────────────────────────────────────
//
// "יש בכל תעודה טבלה מסודרת של פריט מחיר עלות וכמות למה זה לא עולה?" — it did not
// come up because the extractor was told to flatten it. Now that the three columns
// survive, showing them as a paragraph would waste them a second time.
//
// The total is computed, not read: it is the only figure here nobody printed, and
// it appears ONLY when every line carries a price. A partial sum looks like the
// delivery's value and is not — and nobody re-checks a number already sitting there.
function LineItemsTable({ lines }: { lines: ParsedLine[] }) {
  const total = parsedTotal(lines)
  const anyFigures = lines.some(l => l.quantity || l.price)
  return (
    <div style={{ marginTop: '11px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
        <thead>
          <tr style={{ color: '#9CA3AF', fontSize: '11px', fontWeight: 700 }}>
            <th style={{ textAlign: 'start', padding: '0 0 5px' }}>פריט</th>
            {anyFigures && <th style={{ textAlign: 'start', padding: '0 0 5px', width: '58px' }}>כמות</th>}
            {anyFigures && <th style={{ textAlign: 'start', padding: '0 0 5px', width: '74px' }}>מחיר ליחידה</th>}
            {anyFigures && <th style={{ textAlign: 'start', padding: '0 0 5px', width: '74px' }}>סה"כ</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const row = l.price ? (Number(l.price) || 0) * (Number(l.quantity) || 1) : null
            return (
              <tr key={i} style={{ borderTop: '1px solid #EEEEF2' }}>
                <td style={{ padding: '5px 0', color: '#4B5563' }}>{l.item || '—'}</td>
                {anyFigures && <td style={{ padding: '5px 0', color: '#6B6E73', fontVariantNumeric: 'tabular-nums' }}>{l.quantity || '—'}</td>}
                {anyFigures && <td style={{ padding: '5px 0', color: '#6B6E73', fontVariantNumeric: 'tabular-nums' }}>{l.price ? fmtILS(Number(l.price)) : '—'}</td>}
                {anyFigures && <td style={{ padding: '5px 0', color: '#4B5563', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row == null ? '—' : fmtILS(row)}</td>}
              </tr>
            )
          })}
        </tbody>
        {total != null && (
          <tfoot>
            <tr style={{ borderTop: '1.5px solid #E2E4E9' }}>
              <td colSpan={3} style={{ padding: '6px 0', color: '#9CA3AF', fontSize: '11.5px', fontWeight: 700 }}>
                סה"כ לפי הפריטים
              </td>
              <td style={{ padding: '6px 0', fontWeight: 800, color: 'var(--brand-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtILS(total)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export default function DeliveryPage({
  note, stage, order, linked, invoices, isWide,
  onBack, onLoadCandidates, onLink, onUnlink, onApprove,
  onChangeSupplier, onDismantle, onOpenInvoice, onArrived, onMarkDiffers, customerOrders = [],
  onSetCustomerStatus, pendingPair, onResolvePair, onSettleByReceipt, onUndoReceipt,
  onRecordGoods, capturedBy, onReload,
}: {
  note: DeliveryNote
  stage: PipelineStage
  order: OrderLink
  /**
   * EVERY invoice attached to this delivery, not one.
   *
   * The owner's rule: one order is one row, and several invoices belong ON that
   * row — a supplier who bills a delivery in parts does not make it two
   * deliveries. The link table has always allowed it; the screen read a single
   * column, so a second invoice was stored and invisible.
   */
  linked: Invoice[]
  /** Every invoice, for naming a candidate without a second fetch. */
  invoices: Invoice[]
  isWide: boolean
  onBack: () => void
  onLoadCandidates: (noteId: string) => Promise<InvoiceCandidate[]>
  onLink: (noteId: string, invoiceId: string) => Promise<void>
  /** Detach ONE invoice — a row may carry several. */
  onUnlink: (noteId: string, invoiceId?: string) => Promise<void>
  onApprove: (invoiceId: string) => Promise<number>
  onChangeSupplier?: () => void
  /** Manager only. Absent = the control is not rendered at all. */
  onDismantle?: () => Promise<void>
  /**
   * For the suppliers who never issue an invoice: a receipt closes the payment and
   * with it this delivery. Absent = the control is not rendered — the same
   * convention onDismantle uses, and the reason both are optional rather than
   * role-checked inside this component.
   */
  onSettleByReceipt?: (paymentIds: string[]) => Promise<void>
  onUndoReceipt?: () => Promise<void>
  onOpenInvoice?: (invoiceId: string) => void
  /** Present only while the goods have not arrived — an order still waiting. */
  onArrived?: (partial: boolean) => Promise<void>
  /**
   * Record what arrived INTO this row, from this page.
   *
   * The owner's rule: every part that arrives opens a pipeline, and the work
   * continues FROM the row. A chain opened by an invoice knew its supplier and
   * knew it was waiting for goods, and the only way to feed it was to leave the
   * page, open קליטת סחורה, choose the supplier again, and then answer a
   * duplicate question about the row you were just standing on. The answer to
   * that question is on the screen, so it should not be asked.
   *
   * Same component the intake door uses, saving with `adopt` — so a delivery
   * recorded here and one recorded there are the same record, not two shapes of
   * one thing.
   */
  onRecordGoods?: (draft: {
    supplierId: string; supplierName: string
    isoDate: string; lineItems: string; noteNumber?: string
    amount?: number | null; storageUrl?: string | null
    employeeId?: string; adopt?: string; forceNew?: boolean
  }) => Promise<{ needsChoice?: boolean } | void>
  /** Who is looking at this — passed to the handwritten reader for its log. */
  capturedBy?: string
  /** Re-read the row after the camera wrote straight into it (that path does not
   *  go through `onRecordGoods`, so nothing else would know it changed). */
  onReload?: () => Promise<void> | void
  /**
   * §7.j — mark that what came differs from what was ordered. Documentation only;
   * the difference is settled against the invoice. Offered where the person is
   * standing when she notices, which is here.
   */
  onMarkDiffers?: () => Promise<void>
  /**
   * Customer orders riding on this delivery.
   *
   * Someone is waiting for these by name. Without them on this screen the person
   * approving a delivery cannot see that a customer has been promised something
   * in it — and the call telling her it arrived is the whole point of having
   * written her down.
   */
  customerOrders?: Order[]
  /**
   * Move a waiting customer's line from HERE.
   *
   * She marks "נמסרה הודעה" the moment she puts the phone down, and that moment
   * is while she is looking at the delivery it arrived in. Sending her to another
   * screen to record it is how it stops being recorded.
   */
  onSetCustomerStatus?: (orderId: string, next: CustomerStatus) => Promise<void>
  /**
   * The supplier's own note, arrived after this delivery was typed by hand — and
   * the answer to whether they are the same shipment. Absent = nothing to ask.
   */
  pendingPair?: DeliveryNote | null
  onResolvePair?: (arrivedId: string, action: 'absorb' | 'keep') => Promise<void>
}) {
  const [candidates, setCandidates] = useState<InvoiceCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'approve' | 'dismantle' | 'arrived' | null>(null)
  const [docView, setDocView] = useState<{ url: string; previewSrc?: string } | null>(null)
  // Shut until asked for. The block is the widest thing on the page and most
  // visits to a row are to READ it — what arrived, what it was billed against —
  // not to add to it. An open form at the top pushes the row's own facts down
  // the screen on every visit to serve the one visit that came to write.
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [pane, setPane] = useState<'note' | 'invoice'>('note')
  // A supplier who bills one delivery in parts is ordinary, so attaching another
  // invoice stays possible — behind a click, because it is not the common case and
  // an always-open candidate list reads as "this is unfinished".
  const [showMore, setShowMore] = useState(false)

  // A delivery still wants an invoice while it has none. With one or more
  // attached the list stays reachable — a second invoice on the same goods is
  // ordinary — but it is no longer what the screen is asking for.
  const invoice = linked[0]
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

  // The note's own table. `parseLines` is forgiving by design: a row written
  // before the extractor asked for the columns comes back as an item with no
  // figures, which is exactly what it is — the panel degrades to the list it used
  // to be instead of going blank.
  const parsedLines = useMemo(() => parseLines(note.lineItems), [note.lineItems])

  const noteDoc    = note.driveFileLink || note.storageUrl || ''
  const invoiceDoc = invoice?.driveFileLink || ''
  const shown      = pane === 'note' ? noteDoc : invoiceDoc

  // ── The pane SHOWS the document ────────────────────────────────────────────
  //
  // It used to hold a line of grey text telling the reader to press "הגדל", which
  // made half the screen an advertisement for a button. The invoice screen renders
  // the document inline and has done since it was built; this pane exists to be
  // the same surface for a delivery, so it resolves on mount rather than on click.
  //
  // Precedence copied from the invoice pane deliberately: a signed URL from the
  // private bucket first (it works without Drive permissions), Drive only for
  // legacy rows that predate Storage. `direct` marks a URL that is already
  // embeddable so DocumentBody skips the Drive-preview transform.
  //
  // One hour, not two minutes: the pane stays mounted for as long as she is
  // reading, and a short URL expires into a blank frame mid-comparison.
  const [docSrc, setDocSrc]     = useState<{ url: string; direct: boolean } | null>(null)
  const [docState, setDocState] = useState<'loading' | 'ready' | 'none'>('loading')

  const paneStoragePath = pane === 'note'
    ? (note.driveFileLink ? '' : (note.storageUrl ?? ''))
    : (invoice?.storage_url ?? '')
  const paneDriveLink = pane === 'note' ? (note.driveFileLink ?? '') : invoiceDoc

  useEffect(() => {
    let cancelled = false
    const settle = (src: { url: string; direct: boolean } | null) => {
      if (cancelled) return
      setDocSrc(src)
      setDocState(src ? 'ready' : 'none')
    }
    ;(async () => {
      // Inside the async body, not the effect's: switching panes must clear the
      // previous document (otherwise the note's scan sits under the חשבונית tab
      // for a beat and reads as the wrong file), but a synchronous setState in an
      // effect body is a cascading render.
      setDocState('loading')
      const path = paneStoragePath.trim()
      if (path) {
        if (/^https?:\/\//i.test(path)) return settle({ url: path, direct: true })
        const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
        if (!error && data?.signedUrl) return settle({ url: data.signedUrl, direct: true })
        console.error('[delivery] pane createSignedUrl failed:', error)
      }
      const drive = paneDriveLink.trim()
      if (drive) return settle({ url: drive, direct: false })
      settle(null)
    })()
    return () => { cancelled = true }
  }, [paneStoragePath, paneDriveLink])

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
        {/* Which door this row came through, beside its name. The owner asked for
            it after meeting a delivery whose items were on screen and whose
            document was not: with four intakes writing one word, nothing on the
            page said whether that was a typed receipt (no document ever existed)
            or a reading whose photograph had been lost. */}
        <span
          style={{
            padding: '4px 10px', fontSize: '12px', background: '#F3F4F6',
            border: '1px solid #E2E4E9', color: '#4B5563', fontWeight: 600,
          }}
        >{intakeLong(note.intakeSource)}</span>
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
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', minHeight: 0 }}>
            {docState === 'loading' ? (
              <div style={{ margin: 'auto', fontSize: '13px', color: '#9CA3AF' }}>טוען מסמך…</div>
            ) : docState === 'none' ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: '#9CA3AF', padding: '20px' }}>
                <FileText size={34} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.5 }} />
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
                  {pane === 'invoice' ? 'אין חשבונית מוצמדת' : 'אין מסמך מצורף'}
                </div>
                <div style={{ fontSize: '12px', maxWidth: '260px', margin: '0 auto' }}>
                  {pane === 'invoice'
                    ? 'לתעודה הזו עוד לא הוצמדה חשבונית'
                    : noDocumentReason(note.intakeSource)}
                </div>
                {/* A missing file on a row that was MADE from a document is a
                    loss, not a state, and it is said in the colour of one. */}
                {pane === 'note' && documentExpected(note.intakeSource) && (
                  <div style={{ fontSize: '12px', color: '#B45309', fontWeight: 700, marginTop: '6px' }}>
                    הפענוח נשמר בלי המסמך שממנו נקרא
                  </div>
                )}
              </div>
            ) : (
              <DocumentBody
                url={docSrc!.url}
                previewSrc={docSrc!.direct ? docSrc!.url : undefined}
              />
            )}
          </div>
        </div>

        {/* ── Details + actions ──────────────────────────────────────────── */}
        <div style={{ flex: isWide ? '1 1 50%' : undefined, width: isWide ? undefined : '100%', display: 'grid', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 180px', gap: '14px' }}>
            <div style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
              {/* ── The goods are what this row is missing ──────────────────
                  Only while it is actually waiting for them, and only when the
                  caller offers the write. `onArrived` is NOT the same thing: that
                  one belongs to an ORDER and moves the order's own state. This is
                  for any row waiting on goods — most often one an invoice opened,
                  where nothing else on the page could feed it. */}
              {stage === 'awaiting_goods' && onRecordGoods && (
                intakeOpen ? (
                  <div>
                    <GoodsIntake
                      inline
                      adoptNoteId={note.id}
                      suppliers={[]}
                      lockedSupplier={{ id: note.supplierId, name: note.supplierName }}
                      capturedBy={capturedBy}
                      onCreate={onRecordGoods}
                      onClose={() => { setIntakeOpen(false); void onReload?.() }}
                    />
                    <button
                      onClick={() => setIntakeOpen(false)}
                      className="inline-flex items-center gap-1"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF',
                        fontSize: '12px', fontWeight: 600, fontFamily: 'inherit', padding: '6px 2px 0',
                      }}
                    ><ChevronDown className="w-3.5 h-3.5" style={{ transform: 'rotate(180deg)' }} />סגירה</button>
                  </div>
                ) : (
                  // The closed state is still an INVITATION, not a bare arrow: a
                  // row waiting for goods is waiting for exactly this, and the
                  // line has to say so or the triangle is a control nobody opens.
                  <button
                    onClick={() => setIntakeOpen(true)}
                    className="bg-white border flex items-center gap-2 w-full text-right"
                    style={{
                      borderColor: '#E2E4E9', padding: '11px 14px', cursor: 'pointer',
                      font: 'inherit', color: '#1F2125',
                    }}
                  >
                    <ChevronDown className="w-4 h-4" style={{ color: 'var(--brand-primary)', flex: 'none' }} />
                    <PackageCheck className="w-4 h-4" style={{ color: 'var(--brand-primary)', flex: 'none' }} />
                    <span style={{ fontSize: '13.5px', fontWeight: 700 }}>הסחורה הגיעה?</span>
                    <span style={{ fontSize: '12px', color: '#9CA3AF' }}>
                      הקלדה · דף בכתב יד · צילום התעודה
                    </span>
                  </button>
                )
              )}

              <section className="bg-white border" style={{ borderColor: '#E2E4E9', padding: '14px 16px' }}>
                <h4 className="font-bold" style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '0 0 9px' }}>מה הגיע</h4>
                <Row k="תעודה" v={note.noteNumber || '—'} />
                <Row k="תאריך" v={note.date || '—'} />
                <Row k="סכום" v={fmtILS(note.amount || null)} />
                {parsedLines.length > 0 && <LineItemsTable lines={parsedLines} />}
              </section>

              <section className="bg-white border" style={{ borderColor: '#E2E4E9', padding: '14px 16px' }}>
                <h4 className="font-bold" style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '0 0 9px' }}>על מה חויבנו</h4>
                {linked.length > 0 ? (
                  linked.map((inv, i) => (
                    <div key={inv.id} style={{ paddingTop: i > 0 ? '10px' : 0, marginTop: i > 0 ? '10px' : 0, borderTop: i > 0 ? '1px solid #F3F4F6' : undefined }}>
                      <Row k="חשבונית" v={inv.invoiceNumber || inv.id} />
                      <Row k="תאריך" v={inv.date || '—'} />
                      {/* NULL for an employee — the masking view decides that, not
                          this screen. A dash is honest; ₪0 would not be. */}
                      <Row k="סכום" v={fmtILS(inv.amount ?? null)} />
                      <div className="flex items-center gap-2" style={{ marginTop: '6px' }}>
                        {inv.driveFileLink ? (
                          <PdfPreviewButton url={inv.driveFileLink} title="צפייה בחשבונית" />
                        ) : null}
                        {onOpenInvoice && (
                          <button
                            onClick={() => onOpenInvoice(inv.id)}
                            className="inline-flex items-center gap-1.5 font-semibold"
                            style={{ background: 'transparent', border: 'none', color: 'var(--brand-primary)', fontSize: '12px', cursor: 'pointer', padding: 0 }}
                          ><ExternalLink className="w-3.5 h-3.5" />פתיחה</button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => act(() => onUnlink(note.id, inv.id))}
                          className="inline-flex items-center gap-1.5"
                          style={{ background: 'transparent', border: 'none', color: '#9CA3AF', fontSize: '12px', cursor: busy ? 'wait' : 'pointer', padding: 0 }}
                        ><Unlink className="w-3.5 h-3.5" />ניתוק</button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>עדיין לא הוצמדה חשבונית.</p>
                )}
              </section>

              {/* ── The supplier's note turned up ─────────────────────────────
                  Same block as the customer one below, on purpose: both are
                  "someone else's fact about this delivery", and a person reading
                  the page should recognise the shape before reading the words.
                  Answered here, where the goods and the document are both on
                  screen — the only place the question can honestly be settled. */}
              {pendingPair && onResolvePair && (
                <section
                  className="border"
                  style={{ borderColor: '#FDE68A', background: '#FFFBEB', padding: '14px 16px' }}
                >
                  <h4 className="font-bold" style={{ fontSize: '11.5px', color: '#92400E', margin: '0 0 6px' }}>
                    הגיעה תעודת משלוח מהספק
                  </h4>
                  <p style={{ fontSize: '13px', color: '#6B6E73', margin: '0 0 4px' }}>
                    {pendingPair.noteNumber ? `תעודה ${pendingPair.noteNumber}` : 'תעודה ללא מספר'}
                    {pendingPair.date ? ` · ${pendingPair.date}` : ''}
                  </p>
                  <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 10px' }}>
                    האם זו אותה סחורה שנקלטה כאן ידנית?
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(pendingPair.driveFileLink || pendingPair.storageUrl) && (
                      <button
                        onClick={() => (pendingPair.driveFileLink
                          ? setDocView({ url: pendingPair.driveFileLink })
                          : openStored(pendingPair.storageUrl!))}
                        className="inline-flex items-center gap-1.5"
                        style={{ padding: '6px 11px', border: '1px solid #DEDFE5', background: 'white', color: 'var(--brand-primary)', fontSize: '12.5px', cursor: 'pointer', fontFamily: 'inherit' }}
                      ><Eye size={13} />צפייה בתעודה</button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => act(async () => { await onResolvePair(pendingPair.id, 'absorb'); onBack() })}
                      className="font-semibold text-white"
                      style={{ background: 'var(--brand-primary)', border: 'none', padding: '6px 13px', fontSize: '12.5px', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                    >כן — התעודה מחליפה</button>
                    <button
                      disabled={busy}
                      onClick={() => act(() => onResolvePair(pendingPair.id, 'keep'))}
                      style={{ background: 'white', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '6px 13px', fontSize: '12.5px', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                    >לא — משלוח אחר</button>
                  </div>
                  {/* Said plainly, because "מחליפה" beside a document reads like
                      deletion and the answer is not obvious from the button. */}
                  <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '8px 0 0' }}>
                    "מחליפה" משאירה את התעודה של הספק ואת המסמך שלה, ומוחקת את השורה הידנית.
                  </p>
                </section>
              )}

              {customerOrders.length > 0 && (
                <section
                  className="border"
                  style={{ borderColor: '#F3D6DD', background: 'var(--brand-active-bg)', padding: '14px 16px' }}
                >
                  <h4 className="font-bold" style={{ fontSize: '11.5px', color: 'var(--brand-primary)', margin: '0 0 9px' }}>
                    {customerOrders.length === 1 ? 'לקוחה מחכה למשלוח הזה' : `${customerOrders.length} לקוחות מחכות למשלוח הזה`}
                  </h4>
                  {customerOrders.map(o => (
                    <div
                      key={o.id}
                      className="flex items-start justify-between gap-3 flex-wrap"
                      style={{ padding: '6px 0', borderTop: '1px solid #F3D6DD' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <p className="font-bold text-gray-800" style={{ fontSize: '13.5px', margin: 0 }}>
                          {o.customerName}
                          {o.customerPhone && (
                            <span dir="ltr" style={{ fontWeight: 400, color: '#6B6E73', fontSize: '12.5px' }}>
                              {` · ${o.customerPhone}`}
                            </span>
                          )}
                        </p>
                        <p style={{ fontSize: '12.5px', color: '#6B6E73', margin: '2px 0 0' }}>{o.description || '—'}</p>
                      </div>
                      <div style={{ flex: 'none' }}>
                        <CustomerStatusControl order={o} onSet={onSetCustomerStatus} />
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {(needsInvoice || showMore) && (
                <section className="bg-white border" style={{ borderColor: '#E2E4E9', padding: '14px 16px' }}>
                  <h4 className="font-bold text-gray-700" style={{ fontSize: '13px', margin: '0 0 3px' }}>
                    {linked.length > 0 ? 'הצמדת חשבונית נוספת' : 'חשבוניות אפשריות'}
                  </h4>
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
                        // Already on this row — offering it again invites a
                        // duplicate link that resolves to nothing.
                        if (linked.some(l => l.id === c.invoice_id)) return null
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

              {/* Only while the delivery is still waiting for a document, or once
                  it has been closed this way. Offering it beside "אישור — הכנס
                  לכרטסת" on a delivery that HAS its invoice would be offering two
                  different endings to the same story. */}
              {onSettleByReceipt && onUndoReceipt && (stage === 'awaiting_invoice' || note.receiptSettledAt) && (
                <ReceiptSettle
                  supplierId={note.supplierId ?? ''}
                  settledAt={note.receiptSettledAt}
                  onSettle={onSettleByReceipt}
                  onUndo={onUndoReceipt}
                  btnStyle={BTN_BASE}
                />
              )}

              {linked.length > 0 && !showMore && (
                <button onClick={() => setShowMore(true)} style={BTN_BASE}>
                  <Link2 className="w-4 h-4" />הצמדת חשבונית נוספת
                </button>
              )}
              {onMarkDiffers && (
                <button disabled={busy} onClick={() => act(onMarkDiffers)} style={BTN_BASE}>
                  <TriangleAlert className="w-4 h-4" />שונה מהמוזמן
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
