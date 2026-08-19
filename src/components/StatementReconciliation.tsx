import { useState, useEffect, useMemo } from 'react'
import {
  Search as SearchIcon, X, ArrowLeftRight, ArrowRight,
  Eye, Download, FileText, ExternalLink, Maximize2, UserCog,
  AlertTriangle,
} from 'lucide-react'
import { useStatements } from '../hooks/useStatements'
import type {
  VendorStatementStatus,
  StatementMatchMethod,
  VendorStatement as ServerStatement,
} from '../hooks/useStatements'
import { useSuppliers } from '../hooks/useSuppliers'
import { useInvoices } from '../hooks/useInvoices'
import { usePayments } from '../hooks/usePayments'
import { buildLedger, type LedgerResult } from '../lib/supplierLedger'
import { useNotesTarget } from '../lib/notesTargetContext'
import { statementDiff, statementVerdict } from '../lib/ledgerEngine'
import { printStatementPDF } from '../utils/pdf'
import { openStoredFile } from '../lib/storage'
import { isoToDisplay } from '../lib/dates'
import { supabase } from '../lib/supabase'
import SectionHeader from './SectionHeader'
import { SearchableSelect } from './SearchableSelect'
import { StatusBadge as SharedStatusBadge } from './StatusBadge'
import { PdfPreviewModal, DocumentBody } from './PdfPreviewModal'
import { tableWrap, tableHeadRow, tableHeadCell, tableRow, TABLE_HOVER } from './ui/tableStyles'

type VendorStatement = ServerStatement

/** The bits of a supplier this screen needs (picker, mail/WhatsApp recipients). */
interface SupplierLite {
  id: string
  name: string
  /** Searchable in the picker — a supplier is often known by its ח.פ, not its spelling. */
  hp?: string
  email?: string
  phone?: string
}

// Map the statement status vocabulary onto the unified taxonomy (spec/06-RULES.md §1):
// pending → new, matched → matched, mismatch → mismatch, investigating/needs_review → in_progress.
const STATEMENT_STATUS_INTERNAL: Record<VendorStatementStatus, string> = {
  matched:       'matched',
  mismatch:      'mismatch',
  pending:       'new',
  investigating: 'in_progress',
  needs_review:  'in_progress',
}

// ── How this statement was matched to its supplier ───────────────────────────
// Ingest tries ח.פ → name → sender address → an address already known from the
// supplier's invoices, and records which one won (`match_method`). The manager
// cannot judge whether the match is RIGHT without knowing which route produced
// it — a ח.פ hit is proof, an address hit is a guess — so the route is shown
// next to the verdict, with the deciding evidence emphasised.
//
// `tone: 'warn'` = a route that can plausibly land on the wrong supplier (amber,
// as in the approved mockup). ח.פ and a hand-made assignment are not guesses, so
// they read neutral; making every route amber would just teach the eye to skip it.
const MATCH_METHOD_TEXT: Record<
  StatementMatchMethod | 'unknown',
  { lead: string; em: string; tail: string; tone: 'warn' | 'calm' }
> = {
  hp:            { lead: 'זוהה לפי',  em: 'ח.פ במסמך',                 tail: '',                            tone: 'calm' },
  name:          { lead: 'זוהה לפי',  em: 'שם הספק במסמך',              tail: ' — לא נמצא ח.פ במסמך',        tone: 'warn' },
  email:         { lead: 'זוהה לפי',  em: 'כתובת המייל של השולח',       tail: ' — לא נמצא ח.פ במסמך',        tone: 'warn' },
  invoice_email: { lead: 'זוהה לפי',  em: 'כתובת מייל מחשבוניות הספק',  tail: ' — לא נמצא ח.פ במסמך',        tone: 'warn' },
  manual:        { lead: 'שויך',      em: 'ידנית',                      tail: ' — לא זוהה אוטומטית',          tone: 'calm' },
  none:          { lead: 'לא זוהה',   em: 'ספק',                        tail: ' — הכרטסת ממתינה לשיוך',      tone: 'warn' },
  unknown:       { lead: 'לא נרשמה',  em: 'דרך הזיהוי',                 tail: ' — כרטסת שנקלטה לפני העדכון', tone: 'warn' },
}

// The status filter row. Order follows how the owner works the screen: what needs
// looking at first, then the two verdicts, then the workflow states.
const STATUS_FILTERS: { key: VendorStatementStatus | 'all'; label: string }[] = [
  { key: 'all',           label: 'הכל' },
  { key: 'needs_review',  label: 'לבדיקה' },
  { key: 'mismatch',      label: 'אי-התאמה' },
  { key: 'matched',       label: 'תואמות' },
  { key: 'investigating', label: 'בבדיקה' },
  { key: 'pending',       label: 'ממתינות' },
]

function formatILS(n: number | null | undefined) {
  const safe = n ?? 0
  const abs = Math.abs(safe)
  const sign = safe < 0 ? '-' : ''
  return sign + '₪' + abs.toLocaleString('he-IL')
}

// Where does this statement's document live? A private `storage_url` is signed;
// a Drive link is used as-is; an already-absolute storage_url passes through.
//
// ONE resolver on purpose. The inline pane and the "הגדל" popup each had their own
// copy, and the two disagreed on precedence — one preferred `storage_url`, the other
// `drive_file_link`. For a statement carrying both, the pane rendered one document
// and the button opened a different one.
async function statementDocUrl(
  stmt: { storage_url?: string | null; drive_file_link?: string | null } | null | undefined,
): Promise<string | null> {
  const path  = (stmt?.storage_url ?? '').trim()
  const drive = (stmt?.drive_file_link ?? '').trim()
  if (path && !/^https?:\/\//i.test(path)) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
    return data?.signedUrl ?? drive ?? null
  }
  return path || drive || null
}

/**
 * Can this statement be compared at all? Both the list and the detail page ask it,
 * and they must answer identically — a row that reads `—` in the list must not
 * claim a verdict one click later.
 */
function comparableRow(stmt: { supplier_id: string; vendor_balance: number | null }): boolean {
  return !!stmt.supplier_id && stmt.vendor_balance != null
}

/** A statement with no supplier has no ledger of ours — not a zero balance, an absence. */
const EMPTY_LEDGER: LedgerResult = {
  rows: [], periodOpening: 0, closingBalance: 0,
  undatedCount: 0, undatedTotal: 0, excludedCount: 0,
  pendingApprovalCount: 0, pendingApprovalTotal: 0,
}

function StatusBadge({ status }: { status: VendorStatementStatus }) {
  // Unknown/un-migrated statuses fall through to the shared badge's gray + raw-label
  // fallback so the page can never crash on a status the UI doesn't know about.
  return <SharedStatusBadge status={STATEMENT_STATUS_INTERNAL[status] ?? status} />
}

// ── Our ledger, rendered once ────────────────────────────────────────────────
// Used by the left pane AND by the "פתח כרטסת מלאה" overlay, so the two can
// never show different rows for the same supplier.
function LedgerTable({ ledger, showOpening }: { ledger: LedgerResult; showOpening?: boolean }) {
  const th = (align: 'right' | 'left'): React.CSSProperties => ({
    position: 'sticky', top: 0, background: 'white', textAlign: align,
    fontSize: '11px', color: '#9CA3AF', fontWeight: 700, padding: '8px 12px',
    borderBottom: '1px solid #E2E4E9', whiteSpace: 'nowrap',
  })
  const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #F1F2F4' }
  const tdNum: React.CSSProperties = { ...td, textAlign: 'left', direction: 'ltr' }
  const foot: React.CSSProperties = {
    position: 'sticky', bottom: 0, background: 'white',
    borderTop: '2px solid var(--brand-primary)', fontWeight: 800, padding: '10px 12px',
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr>
          {['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'].map((h, i) => (
            <th key={h} style={th(i > 1 ? 'left' : 'right')}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {showOpening && (
          <tr>
            <td style={{ ...td, whiteSpace: 'nowrap', color: '#9CA3AF' }}>—</td>
            <td style={{ ...td, fontWeight: 700 }}>יתרת פתיחה</td>
            <td style={tdNum}>—</td>
            <td style={tdNum}>—</td>
            <td style={{ ...tdNum, fontWeight: 700 }}>{formatILS(ledger.periodOpening)}</td>
          </tr>
        )}
        {ledger.rows.length === 0 && (
          <tr>
            <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#9CA3AF', padding: '28px 12px' }}>
              אין תנועות בכרטסת שלנו
            </td>
          </tr>
        )}
        {ledger.rows.map(r => (
          <tr key={r.id} style={{ opacity: r.excluded ? 0.55 : 1 }}>
            <td style={{ ...td, whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'right' }}>
              {r.undated ? 'ללא תאריך' : r.displayDate}
            </td>
            <td style={td}>
              {r.description}
              {/* Flagged rows are SHOWN but not counted — the chip says why. */}
              {r.excluded && (
                <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 6px', borderRadius: '6px', background: '#FDF3DC', color: '#A16207', marginInlineStart: '6px' }}>
                  כפילות אפשרית
                </span>
              )}
            </td>
            {/* An excluded row's debit/credit are 0 so the totals stay honest, but
                on THIS screen that number is usually the whole explanation for the
                gap against the supplier. Show it struck through: present and
                readable, visibly not counted. */}
            <td style={tdNum}>
              {r.excluded
                ? <span style={{ textDecoration: 'line-through', color: '#A16207' }}>{formatILS(r.movement)}</span>
                : r.debit ? formatILS(r.debit) : '—'}
            </td>
            <td style={{ ...tdNum, color: '#166534' }}>{r.credit ? formatILS(r.credit) : '—'}</td>
            <td style={{ ...tdNum, fontWeight: 700 }}>{formatILS(r.balance)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} style={foot}>יתרה נכון להיום</td>
          <td style={{ ...foot, textAlign: 'left', direction: 'ltr' }}>{formatILS(ledger.closingBalance)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

// ── Supplier picker ──────────────────────────────────────────────────────────
// Reached from "שינוי ספק". It serves BOTH cases: a statement nobody matched,
// and one matched to the WRONG supplier — so it is offered on every statement,
// not only on orphans.
function SupplierPicker({
  suppliers, currentId, onPick, onClose,
}: {
  suppliers: SupplierLite[]
  currentId: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  // Escape closes the dialog. `SearchableSelect` handles Escape for its own dropdown
  // and stops there, so without this the picker could only be dismissed by mouse —
  // the same keyboard gap the hand-rolled list it replaced had.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" style={{ background: 'rgba(0,0,0,0.5)', paddingTop: '14vh' }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl" style={{ width: 'min(460px, 92vw)', direction: 'rtl' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: '#EEEEF2' }}>
          <h3 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>שיוך הכרטסת לספק</h3>
          <button onClick={onClose} className="text-gray-400" style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div style={{ padding: '14px 16px 18px' }}>
          {/* The shared combobox, not a hand-rolled list: it is case-insensitive,
              keyboard-navigable, and — the reason it matters here — searches
              `keywords`, so a supplier is findable by ח.פ. This screen's whole
              provenance chip teaches the manager to reason in ח.פ, and the
              hand-rolled copy this replaced matched the NAME only, case-sensitively. */}
          <SearchableSelect
            value={currentId}
            onChange={(id) => { if (id) onPick(id) }}
            placeholder="חיפוש ספק לפי שם או ח.פ…"
            options={suppliers.map(s => ({ value: s.id, label: s.name, keywords: s.hp }))}
          />
        </div>
      </div>
    </div>
  )
}

interface DetailPageProps {
  stmt: VendorStatement
  ledger: LedgerResult
  /** Supplier flagged בהסדר תשלום — excluded from balance tracking, so no verdict. */
  paymentArrangement: boolean
  savedNotes: string
  suppliers: SupplierLite[]
  docUrl: string | null
  isMobile: boolean
  onBack: () => void
  onExpandDoc: () => void
  onOpenSource: () => void
  /** Save the figure printed on the supplier's statement, and the verdict with it. */
  onVendorBalanceSave: (id: string, vendorBalance: number) => void
  onAssignSupplier: (id: string, supplierId: string) => void
  onSaveNotes: (id: string, notes: string) => Promise<void>
}

// Two-pane reconciliation, per the approved mockup: the supplier's document on
// the RIGHT (RTL puts the first child there), OUR ledger on the LEFT with its own
// internal scroll, and the notes + send buttons pinned BELOW it so they are never
// scrolled away. Header carries amount-vs-amount, the verdict, and how the
// statement was matched to this supplier.
//
// It is a PAGE, not a popup: it replaces the list in place (full width) and the
// back control returns to it. Mounted with key={stmt.id}, so every local draft
// (notes, manual balance) belongs to exactly one statement.
function DetailPage({
  stmt, ledger, paymentArrangement, savedNotes, suppliers, docUrl, isMobile,
  onBack, onExpandDoc, onOpenSource, onVendorBalanceSave,
  onAssignSupplier, onSaveNotes,
}: DetailPageProps) {
  const [manualBalance, setManualBalance] = useState('')
  const [notes, setNotes] = useState(savedNotes)
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [sendVia, setSendVia] = useState<null | 'mail' | 'whatsapp'>(null)
  const [pickSupplier, setPickSupplier] = useState(false)
  const [fullLedger, setFullLedger] = useState(false)

  const ourBalance = ledger.closingBalance
  const vendor = stmt.vendor_balance
  // Three things make a comparison impossible: no vendor figure, no supplier
  // (an unassigned statement has no ledger of ours to compare against — the 0 it
  // would otherwise be measured against is an absence, not a balance), and a
  // supplier on a payment arrangement.
  //
  // בהסדר תשלום is documented as "מוחרג ממעקב יתרה" — the owner has deliberately
  // stopped tracking what this supplier is owed. So we show the TRUE ledger figure
  // (never the engine's display-zero: passing `paymentArrangement` into buildLedger
  // here would print ₪0 beside the supplier's real number and invent an enormous
  // gap) and simply decline to render a verdict. Ingest does the same: it records
  // the figures and raises no alert.
  const comparable = vendor != null && !!stmt.supplier_id && !paymentArrangement
  // One rule, from the engine — see `statementVerdict`. Deriving it here by hand
  // is how the list and the detail of the SAME statement came to disagree.
  const diff    = comparable ? statementDiff(ourBalance, vendor as number) : null
  const matched = comparable && statementVerdict(ourBalance, vendor) === 'matched'
  const supplier = suppliers.find(s => s.id === stmt.supplier_id)

  // Notes written here file under this statement's supplier, tagged כרטסות.
  // An orphan statement has no supplier yet, so the panel stays hidden until one
  // is assigned — a note has to belong to someone.
  useNotesTarget(stmt.supplier_id, supplier?.name ?? stmt.supplier_name ?? '')
  const method = MATCH_METHOD_TEXT[stmt.match_method ?? 'unknown']
  const warn = method.tone === 'warn'

  const subject = `אי-התאמה בכרטסת ${stmt.month} — חנות הדס`
  const defaultMessage =
    `נמצאה אי-התאמה בכרטסת ${stmt.month}.\n\n` +
    `היתרה לפי הכרטסת שלכם: ${vendor == null ? '—' : formatILS(vendor)}\n` +
    `היתרה לפי הספרים שלנו: ${stmt.supplier_id ? formatILS(ourBalance) : '—'}\n` +
    `הפרש: ${diff == null ? '—' : formatILS(diff)}\n\n` +
    (notes.trim() ? `פירוט: ${notes.trim()}\n\n` : '') +
    'נשמח שתבדקו ותחזרו אלינו. תודה.'

  const paneHeader: React.CSSProperties = {
    borderColor: '#E2E4E9', background: '#FAFAFC', flexShrink: 0,
  }
  const paneBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'white',
    border: '1px solid #E2E4E9', borderRadius: '8px', padding: '4px 9px',
    fontSize: '11.5px', fontWeight: 700, color: '#4B5563', cursor: 'pointer',
  }
  const fieldLabel: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#9CA3AF', marginBottom: '4px', display: 'block' }
  const field: React.CSSProperties = {
    width: '100%', fontSize: '13px', background: '#FAFAFC', border: '1px solid #E2E4E9',
    borderRadius: '10px', padding: '8px 10px', fontFamily: 'inherit',
  }

  async function saveNotes() {
    setNoteState('saving')
    try {
      await onSaveNotes(stmt.id, notes)
      setNoteState('saved')
    } catch {
      // The typed text is NEVER dropped — it stays in this box and in the
      // in-memory override — only the server round-trip failed.
      setNoteState('error')
    }
  }

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* ── Back to the list ── */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl font-bold"
          style={{ background: 'white', border: '1px solid #EEEEF2', color: 'var(--brand-primary)', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = TABLE_HOVER)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לרשימת הכרטסות
        </button>
      </div>

      {/* ── Header: amount vs amount, verdict, and how the supplier was identified ── */}
      <div className="bg-white rounded-2xl shadow-sm border" style={{ borderColor: '#EEEEF2' }}>
        <div className="px-5 py-3 flex flex-wrap items-center gap-x-7 gap-y-3">
          <div>
            <h2 className="font-bold text-gray-800" style={{ fontSize: '17px' }}>
              {stmt.supplier_name || 'ספק לא מזוהה'}
            </h2>
            <p className="text-gray-400" style={{ fontSize: '12px' }}>כרטסת {stmt.month}</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-center">
              <p style={{ fontSize: '11px', color: '#9CA3AF' }}>לפי הספק</p>
              <p className="font-black" style={{ fontSize: '20px', direction: 'ltr' }}>{vendor == null ? '—' : formatILS(vendor)}</p>
            </div>
            <span className="text-gray-300">מול</span>
            <div className="text-center">
              <p style={{ fontSize: '11px', color: '#9CA3AF' }}>לפי הכרטסת שלנו</p>
              <p className="font-black" style={{ fontSize: '20px', direction: 'ltr' }}>
                {stmt.supplier_id ? formatILS(ourBalance) : '—'}
              </p>
            </div>
            <div className="text-center">
              <p style={{ fontSize: '11px', color: '#9CA3AF' }}>הפרש</p>
              <p className="font-black" style={{ fontSize: '20px', direction: 'ltr', color: diff == null ? '#9CA3AF' : matched ? '#166534' : '#DC2626' }}>
                {diff == null ? '—' : formatILS(diff)}
              </p>
            </div>
          </div>

          {/* Nothing to compare → no verdict. Claiming "לא תואם" against a blank is
              how the screen used to accuse a supplier of a gap nobody measured. */}
          <span
            className="rounded-full font-bold inline-flex items-center gap-2"
            style={{
              fontSize: '13px', padding: '7px 14px',
              ...(diff == null
                ? { background: '#F3F4F6', color: '#6B7280' }
                : matched
                  ? { background: '#DCFCE7', color: '#166534' }
                  : { background: '#FEE2E2', color: '#DC2626' }),
            }}
          >
            {!stmt.supplier_id ? 'ממתינה לשיוך ספק'
              : paymentArrangement ? 'ספק בהסדר — מוחרג ממעקב'
              : diff == null ? 'טרם התקבלה יתרת ספק'
              : matched ? 'תואם' : 'לא תואם'}
          </span>

          <div style={{ marginInlineStart: 'auto' }}><StatusBadge status={stmt.status} /></div>
        </div>

        {/* Identification provenance + the manual override */}
        <div className="px-5 pb-3 flex flex-wrap items-center gap-2">
          <div
            className="rounded-xl flex flex-wrap items-center gap-x-2 gap-y-1"
            style={{
              padding: '6px 10px', fontSize: '12px',
              background: warn ? '#FDF3DC' : '#F3F4F6',
              border: `1px solid ${warn ? '#E3C27A' : '#E2E4E9'}`,
              color: warn ? '#A16207' : '#4B5563',
            }}
          >
            <span>
              {method.lead}{' '}
              <strong style={{ fontWeight: 800 }}>{method.em}</strong>
              {method.tail}
            </span>
            {stmt.email_sender && (
              <span style={{ opacity: 0.85 }}>
                · מהכתובת <span dir="ltr" style={{ fontWeight: 700 }}>{stmt.email_sender}</span>
              </span>
            )}
          </div>
          <button
            onClick={() => setPickSupplier(true)}
            className="rounded-xl font-bold inline-flex items-center gap-1.5"
            style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
          >
            <UserCog className="w-3.5 h-3.5" />
            שינוי ספק
          </button>
        </div>

        {/* Same banner the two ledger views show for this flag, so the reason the
            verdict is missing is stated rather than left to be guessed. */}
        {paymentArrangement && (
          <div
            className="text-right"
            style={{ padding: '9px 20px', background: '#DBEAFE', color: '#1E40AF', fontSize: '12.5px', fontWeight: 600 }}
          >
            ספק בהסדר תשלום — היתרה מוחרגת ממעקב, ולכן לא נקבע פסק דין אוטומטי לכרטסת.
            הסכומים למטה מוצגים למידע בלבד.
          </div>
        )}
      </div>

      {/* ── Two panes ── */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: '12px',
          height: isMobile ? 'auto' : 'calc(100vh - 330px)',
          minHeight: isMobile ? 0 : '440px',
        }}
      >
        {/* RIGHT (first in RTL): the supplier's document */}
        <section className="bg-white rounded-2xl border overflow-hidden flex flex-col" style={{ borderColor: '#E2E4E9', minHeight: isMobile ? '360px' : 0 }}>
          <div className="px-4 py-2.5 border-b flex items-center gap-2" style={paneHeader}>
            <h3 className="font-bold text-gray-700" style={{ fontSize: '13px' }}>כרטסת הספק</h3>
            {docUrl && (
              <div className="flex items-center gap-1.5" style={{ marginInlineStart: 'auto' }}>
                <button style={paneBtn} onClick={onExpandDoc} title="הצג את המסמך בגודל מלא">
                  <Maximize2 className="w-3.5 h-3.5" />
                  הגדל
                </button>
                <button style={paneBtn} onClick={onOpenSource} title="פתח את הקובץ המקורי בכרטיסייה חדשה">
                  <ExternalLink className="w-3.5 h-3.5" />
                  פתח במקור
                </button>
              </div>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, background: '#F3F4F6', display: 'flex' }}>
            {docUrl
              ? <DocumentBody url={docUrl} />
              : <p className="text-center text-gray-400 py-10 w-full" style={{ fontSize: '14px' }}>אין מסמך מצורף</p>}
          </div>
        </section>

        {/* LEFT: our ledger (scrolls) + notes (never scrolls away) */}
        <section
          className="bg-white rounded-2xl border overflow-hidden"
          style={{ borderColor: '#E2E4E9', display: 'grid', gridTemplateRows: 'minmax(0,1fr) auto', minHeight: isMobile ? '360px' : 0 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="px-4 py-2.5 border-b flex items-center gap-2" style={paneHeader}>
              <h3 className="font-bold text-gray-700" style={{ fontSize: '13px' }}>הכרטסת שלנו</h3>
              <span className="text-gray-400" style={{ fontSize: '12px' }}>{ledger.rows.length} תנועות</span>
              <button style={{ ...paneBtn, marginInlineStart: 'auto' }} onClick={() => setFullLedger(true)} title="הצג את הכרטסת המלאה">
                <Maximize2 className="w-3.5 h-3.5" />
                פתח כרטסת מלאה
              </button>
            </div>
            <div style={{ overflow: 'auto', minHeight: 0 }}>
              <LedgerTable ledger={ledger} />
            </div>
          </div>

          {/* Notes + actions — always visible */}
          <div className="border-t" style={{ borderColor: '#E2E4E9', padding: '10px 12px' }}>
            <label style={fieldLabel}>הערות התאמה</label>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNoteState('idle') }}
              placeholder="מה מסביר את ההפרש…"
              style={{ ...field, resize: 'none', minHeight: '54px' }}
            />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button
                className="rounded-xl font-bold"
                style={{ background: 'var(--brand-primary)', color: 'white', border: '1px solid var(--brand-primary)', padding: '8px 14px', fontSize: '13px', cursor: 'pointer', opacity: noteState === 'saving' ? 0.6 : 1 }}
                disabled={noteState === 'saving'}
                onClick={() => void saveNotes()}
              >
                שמירת הערה
              </button>
              <button className="rounded-xl font-bold" style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }} onClick={() => setSendVia('mail')}>שליחה במייל</button>
              <button className="rounded-xl font-bold" style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }} onClick={() => setSendVia('whatsapp')}>שליחה בוואטסאפ</button>
              <span style={{ marginInlineStart: 'auto', fontSize: '11.5px', color: noteState === 'error' ? '#DC2626' : '#9CA3AF' }}>
                {noteState === 'saving' ? 'שומר…'
                  : noteState === 'saved' ? 'ההערה נשמרה'
                  : noteState === 'error' ? 'ההערה לא נשמרה בשרת — הטקסט נשמר במסך'
                  : 'ההודעה ניתנת לעריכה · השליחה תופעל בהמשך'}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Manual vendor balance — the one figure ingest cannot be trusted to read */}
      <div className="bg-white rounded-2xl shadow-sm border px-5 py-2.5 flex flex-wrap items-center gap-2" style={{ borderColor: '#EEEEF2' }}>
        <span className="text-gray-500" style={{ fontSize: '12.5px' }}>יתרה לפי הספק:</span>
        <input
          type="number" value={manualBalance} onChange={(e) => setManualBalance(e.target.value)}
          placeholder={vendor == null ? 'הזיני סכום' : String(vendor)} dir="ltr"
          style={{ width: '130px', fontSize: '13px', padding: '6px 10px', borderRadius: '9px', border: '1px solid #E2E4E9' }}
        />
        <button
          className="rounded-xl font-bold"
          style={{ background: 'var(--brand-primary)', color: 'white', border: 'none', padding: '6px 14px', fontSize: '13px', cursor: 'pointer' }}
          onClick={() => {
            const v = parseFloat(manualBalance)
            if (!Number.isFinite(v)) return
            // ONE call. This used to fire onBalanceUpdate + onStatusChange side by
            // side: two writes and two refetches racing, each deciding `status` by
            // a different rule.
            onVendorBalanceSave(stmt.id, v)
            setManualBalance('')
          }}
        >שמור והשווה</button>
      </div>

      {/* Full ledger — the same rows the pane shows, with the opening balance and
          the flagged-row count the narrow pane has no room for. */}
      {fullLedger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setFullLedger(false)}>
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ width: '100%', maxWidth: '900px', height: '86vh', direction: 'rtl' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: '#EEEEF2' }}>
              <h3 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>
                כרטסת מלאה — {stmt.supplier_name || 'ספק לא מזוהה'}
              </h3>
              <span className="text-gray-400" style={{ fontSize: '12px' }}>
                {ledger.rows.length} תנועות
                {ledger.excludedCount > 0 && ` · ${ledger.excludedCount} לא נספרות`}
                {ledger.undatedCount > 0 && ` · ${ledger.undatedCount} ללא תאריך`}
              </span>
              <button onClick={() => setFullLedger(false)} className="text-gray-400" style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <LedgerTable ledger={ledger} showOpening />
            </div>
          </div>
        </div>
      )}

      {pickSupplier && (
        <SupplierPicker
          suppliers={suppliers}
          currentId={stmt.supplier_id}
          onClose={() => setPickSupplier(false)}
          onPick={(id) => { setPickSupplier(false); onAssignSupplier(stmt.id, id) }}
        />
      )}

      {/* Send dialog — prefilled, editable, sending not wired yet */}
      {sendVia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setSendVia(null)}>
          <div className="bg-white rounded-2xl shadow-2xl" style={{ width: 'min(560px, 92vw)', direction: 'rtl' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: '#EEEEF2' }}>
              <h3 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>
                {sendVia === 'mail' ? 'שליחת אי-התאמה במייל' : 'שליחת אי-התאמה בוואטסאפ'}
              </h3>
              <button onClick={() => setSendVia(null)} className="text-gray-400" style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={fieldLabel}>אל</label>
                <input
                  defaultValue={sendVia === 'mail' ? (supplier?.email ?? '') : (supplier?.phone ?? '')}
                  placeholder={sendVia === 'mail' ? 'כתובת מייל של הספק' : 'טלפון של הספק'}
                  dir="ltr" style={{ ...field, textAlign: 'left' }}
                />
              </div>
              {sendVia === 'mail' && (
                <div>
                  <label style={fieldLabel}>נושא</label>
                  <input defaultValue={subject} dir="rtl" style={field} />
                </div>
              )}
              <div>
                <label style={fieldLabel}>הודעה</label>
                <textarea
                  defaultValue={defaultMessage}
                  style={{ ...field, minHeight: '170px', fontSize: '13.5px', lineHeight: 1.6, resize: 'vertical' }}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t flex items-center gap-2" style={{ borderColor: '#EEEEF2', background: '#FAFAFC' }}>
              <button disabled className="rounded-xl font-bold" style={{ background: 'var(--brand-primary)', color: 'white', border: 'none', padding: '8px 16px', fontSize: '13px', opacity: 0.45 }}>שלח</button>
              <button onClick={() => setSendVia(null)} className="rounded-xl font-bold" style={{ background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}>סגור</button>
              <span className="text-gray-400" style={{ marginInlineStart: 'auto', fontSize: '11.5px' }}>החיבור יופעל בהמשך</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function useIsMobile() {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 640)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

export default function StatementReconciliation({ initialStatementId }: { initialStatementId?: string | null }) {
  const { data: serverStatements, loading, error, resolve: resolveStatement, remove: removeStatement } = useStatements()
  // Deleting is irreversible and the row carries a document, so it goes through a
  // confirmation naming the supplier and month — not a bare icon.
  const [confirmDelete, setConfirmDelete] = useState<VendorStatement | null>(null)
  const { data: suppliersData } = useSuppliers()
  const [statements, setStatements] = useState<VendorStatement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewDoc, setViewDoc] = useState<string | null>(null)   // arrived statement doc → popup
  const [filterStatus, setFilterStatus] = useState<VendorStatementStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  // Local, optimistic echoes of the two edits this screen makes. A write goes to
  // the server AND lands here, so the manager sees the result immediately instead
  // of waiting for a refetch — and never watches typed text disappear because a
  // round-trip failed.
  const [supplierOverride, setSupplierOverride] = useState<Record<string, string>>({})
  const [notesOverride, setNotesOverride] = useState<Record<string, string>>({})
  const isMobile = useIsMobile()
  // minmax(0,…) on flexible tracks so long ids / multiple action buttons can't
  // stretch a column and knock the rows out of alignment with the header. Fixed
  // px tracks for short columns; the actions column gets a wide, wrapping track.
  // 4 tracks on mobile / 9 on desktop — one per rendered cell, in order. The
  // arrival-date column is DESKTOP-ONLY: mobile already drops מזהה / חודש / both
  // balances to fit 360px, and the date is triage context rather than something
  // the row is acted on by. Adding a track here without adding its cell (or the
  // reverse) silently shifts every column off its header.
  const gridCOL = isMobile
    ? 'minmax(0,1.4fr) 80px 90px minmax(0,1.4fr)'
    : '76px minmax(0,1.5fr) 84px 92px minmax(0,1.05fr) minmax(0,1.05fr) 82px 96px minmax(0,1.9fr)'
  const gridMin = isMobile ? '360px' : '1012px'

  const { data: allInvoices } = useInvoices()
  const { data: allPayments } = usePayments()

  // `SupplierRow` is inferred from mock rows that carry none of these optional
  // fields, so a cast is unavoidable here — but it names each field rather than
  // going through `unknown`, so a rename still fails the typecheck.
  const supplierList: SupplierLite[] = useMemo(
    () => suppliersData.map(s => {
      const raw = s as typeof s & { hp?: string; email?: string; phone?: string }
      return { id: raw.id, name: raw.name, hp: raw.hp, email: raw.email, phone: raw.phone }
    }),
    [suppliersData],
  )

  // `our_balance` is a STORED column, written once when the statement arrived and
  // never refreshed — so it drifted from the real ledger with every invoice,
  // payment and credit-note correction that followed. One supplier read -2,635 on
  // the supplier card and 2,199 here.
  //
  // The comparison that matters is the vendor's figure against OUR balance TODAY,
  // so it is recomputed live from the same ledger engine every other screen uses
  // (spec/01-PRD §7: "every incoming statement is auto-matched against the
  // supplier ledger"). The stored column is kept untouched as a record of what was
  // true on the day the statement was filed.
  useEffect(() => {
    setStatements((serverStatements as VendorStatement[]).map(st0 => {
      // A hand assignment made on this screen wins until the refetch catches up.
      const assigned = supplierOverride[st0.id]
      const st: VendorStatement = assigned
        ? {
            ...st0,
            supplier_id: assigned,
            supplier_name: suppliersData.find(x => x.id === assigned)?.name ?? st0.supplier_name,
            match_method: 'manual',
          }
        : st0
      const sup = suppliersData.find(x => x.id === st.supplier_id) as
        { openingBalance?: number; paymentArrangement?: boolean } | undefined
      if (!sup) return st
      // NOTE the missing `paymentArrangement` option, unlike the supplier screens.
      // The engine zeroes the closing balance for a flagged supplier — a DISPLAY
      // rule — and reconciliation needs the real figure to sit beside the
      // supplier's own number. The flag is honoured below by withholding the
      // verdict instead.
      const live = buildLedger(
        st.supplier_id, allInvoices, allPayments, sup.openingBalance ?? 0,
      ).closingBalance
      const arrangement = sup.paymentArrangement ?? false
      const vendor = st.vendor_balance
      const liveDiff = vendor == null ? 0 : live - vendor
      return {
        ...st,
        our_balance: live,
        // Diff follows the recomputed balance; an unknown vendor figure keeps 0
        // rather than inventing a mismatch.
        diff: liveDiff,
        // The VERDICT must follow the live diff too. Recomputing the diff alone
        // left rows reading "תואם" beside a large gap — the verdict was decided
        // against the stale our_balance and never revisited. Only the two
        // comparison outcomes are overridden; pending / investigating /
        // needs_review are WORKFLOW states the manager owns, and are left alone.
        // A supplier בהסדר תשלום is excluded from balance tracking, so no verdict
        // is drawn for it here either — same rule ingest applies.
        status: (!arrangement && (st.status === 'matched' || st.status === 'mismatch'))
          ? (vendor != null && Math.abs(liveDiff) > 0.005 ? 'mismatch' : 'matched')
          : st.status,
      }
    }))
  }, [serverStatements, suppliersData, allInvoices, allPayments, supplierOverride])

  // Deep-link from a statement alert → open that statement's detail once the list
  // has loaded (once per id). The back control returns to the list, so this is a
  // way IN, never a dead end.
  useEffect(() => {
    if (initialStatementId && serverStatements.some(s => s.id === initialStatementId)) {
      setSelectedId(initialStatementId)
    }
  }, [initialStatementId, serverStatements])

  const counts = {
    matched:       statements.filter((s) => s.status === 'matched').length,
    mismatch:      statements.filter((s) => s.status === 'mismatch').length,
    pending:       statements.filter((s) => s.status === 'pending').length,
    investigating: statements.filter((s) => s.status === 'investigating').length,
    needs_review:  statements.filter((s) => s.status === 'needs_review').length,
  }

  const filtered = statements.filter((s) => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (search && !s.supplier_name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const selectedStmt = selectedId ? statements.find((s) => s.id === selectedId) ?? null : null

  // The ledger behind the open statement — SAME engine as every other screen.
  // Memoized: as a bare IIFE it re-filtered every invoice and payment on EVERY
  // render, including each keystroke in the list's search box.
  const selectedSupplierId = selectedStmt?.supplier_id ?? null
  const { selectedLedger, selectedArrangement } = useMemo(() => {
    if (!selectedSupplierId) {
      return { selectedLedger: EMPTY_LEDGER, selectedArrangement: false }
    }
    const sup = suppliersData.find(x => x.id === selectedSupplierId) as
      { openingBalance?: number; paymentArrangement?: boolean } | undefined
    return {
      // True figure, no display-zeroing — see the note on the list effect above.
      selectedLedger: buildLedger(
        selectedSupplierId, allInvoices, allPayments, sup?.openingBalance ?? 0,
      ),
      selectedArrangement: !!sup?.paymentArrangement,
    }
  }, [selectedSupplierId, suppliersData, allInvoices, allPayments])

  // Signed URL for the statement document, resolved when one is opened.
  const [selectedDocUrl, setSelectedDocUrl] = useState<string | null>(null)
  const storagePath = selectedStmt?.storage_url ?? null
  const driveLink   = selectedStmt?.drive_file_link ?? null
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const url = await statementDocUrl({ storage_url: storagePath, drive_file_link: driveLink })
      if (!cancelled) setSelectedDocUrl(url)
    })()
    return () => { cancelled = true }
    // Only the two document fields matter — re-signing on any other change to the
    // statement would swap the iframe's src mid-read.
  }, [storagePath, driveLink])

  // Open the ARRIVED statement document in the in-page popup viewer.
  async function openDoc(stmt: VendorStatement) {
    const url = await statementDocUrl(stmt)
    if (url) setViewDoc(url)
  }

  // The manager types the figure printed on the SUPPLIER's statement — the one
  // number ingest cannot always read off the document. It goes to
  // `vendor_balance`, and the verdict follows from comparing it with our live
  // ledger.
  //
  // This replaces `handleBalanceUpdate`, which predates the rewrite: back then the
  // box meant "עדכן יתרה ידנית" — OUR balance — and it was left wired to a box that
  // now means the opposite. It wrote the supplier's figure into `our_balance`,
  // never touched `vendor_balance` at all, and matched on a ₪1 tolerance that the
  // rest of the system had already abandoned.
  async function handleVendorBalanceSave(id: string, vendorBalance: number) {
    const stmt = statements.find((s) => s.id === id)
    if (!stmt) return
    // `our_balance` on the row is the LIVE figure — the effect above recomputes it.
    const arrangement = !!(suppliersData.find(x => x.id === stmt.supplier_id) as
      { paymentArrangement?: boolean } | undefined)?.paymentArrangement
    const verdict = arrangement ? null : statementVerdict(stmt.our_balance, vendorBalance)
    try {
      await resolveStatement(id, {
        vendorBalance,
        diff: statementDiff(stmt.our_balance, vendorBalance),
        // No verdict to draw (supplier בהסדר תשלום) → leave the workflow state alone.
        ...(verdict ? { status: verdict } : {}),
      })
    } catch {
      // hook sets error state
    }
  }

  // Reconciliation notes → `resolution_notes`. The optimistic copy is written
  // FIRST so a failed round-trip can never swallow what the manager typed; the
  // failure itself is surfaced by the caller.
  async function handleSaveNotes(id: string, text: string) {
    setNotesOverride(o => ({ ...o, [id]: text }))
    await resolveStatement(id, { resolutionNotes: text })
  }

  if (loading && statements.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }} />
      </div>
    )
  }

  // ── Detail takes over the whole page (mockup): the list is not rendered
  // underneath it, and "חזרה לרשימת הכרטסות" brings it back. `selectedId` stays
  // internal to this component, so Layout's routing is untouched.
  if (selectedStmt) {
    return (
      <>
        <DetailPage
          key={selectedStmt.id}
          stmt={selectedStmt}
          ledger={selectedLedger}
          paymentArrangement={selectedArrangement}
          savedNotes={notesOverride[selectedStmt.id] ?? selectedStmt.resolution_notes ?? ''}
          suppliers={supplierList}
          docUrl={selectedDocUrl}
          isMobile={isMobile}
          onBack={() => setSelectedId(null)}
          onExpandDoc={() => void openDoc(selectedStmt)}
          onOpenSource={() => void openStoredFile(selectedStmt.drive_file_link || selectedStmt.storage_url)}
          onAssignSupplier={async (id, supplierId) => {
            // Assigning a supplier recomputes the balance on the spot; hadas-api
            // records the correction as match_method='manual'.
            setSupplierOverride(o => ({ ...o, [id]: supplierId }))
            try {
              await resolveStatement(id, { supplierId })
            } catch {
              // hook sets error state; the local assignment stays visible
            }
          }}
          onVendorBalanceSave={handleVendorBalanceSave}
          onSaveNotes={handleSaveNotes}
        />
        {viewDoc && <PdfPreviewModal url={viewDoc} onClose={() => setViewDoc(null)} />}
      </>
    )
  }

  return (
    <div className="space-y-6" dir="rtl">
      {error && (
        <div className="rounded-xl p-3 text-sm text-right" style={{ background: '#FEF9C3', color: '#92400E' }}>
          לא ניתן לטעון נתונים מהשרת — מוצגים נתוני ברירת מחדל
        </div>
      )}
      <div>
        <p className="text-gray-500 text-sm mt-0.5">השוואת יתרות מול דפי חשבון ספקים</p>
      </div>

      {/* Stats cards */}
      {/* Status filter — a thin chip row, same pattern as the Invoices screen.
          It replaces the summary tiles, which carried the filter as a side effect
          of being tiles: hiding them app-wide took the only way to filter this
          screen with them. The count rides on the chip, so nothing is lost. */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div
          className="bg-white border p-1 flex-shrink-0"
          style={{ borderColor: '#EEEEF2', display: 'flex', gap: '2px' }}
        >
          {STATUS_FILTERS.map(({ key, label }) => {
            const active = filterStatus === key
            const n = key === 'all' ? statements.length : counts[key]
            return (
              <button
                key={key}
                // Clicking the active chip clears back to הכל — the tiles behaved
                // the same way, and it saves a trip to a separate "clear" control.
                onClick={() => setFilterStatus(active && key !== 'all' ? 'all' : key)}
                style={{
                  padding: '7px 12px', fontSize: '14px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: active ? 'var(--brand-primary)' : 'transparent',
                  color: active ? 'white' : '#6B7280',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                {label}
                <span style={{
                  fontSize: '11px', fontWeight: 700, lineHeight: 1.4, padding: '1px 6px',
                  background: active ? 'rgba(255,255,255,0.28)' : '#F1F2F4',
                  color: active ? 'white' : '#6B7280',
                }}>
                  {n}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="bg-white rounded-2xl shadow-sm border p-4 flex items-center gap-3"
        style={{ borderColor: '#EEEEF2' }}
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש ספק..."
            dir="rtl"
            className="w-full px-4 py-2.5 rounded-xl border-2 text-sm text-gray-800 placeholder:text-gray-400"
            style={{ borderColor: '#EEEEF2' }}
          />
          <SearchIcon className="absolute top-1/2 -translate-y-1/2 left-3 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        {filterStatus !== 'all' && (
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border-2 transition-colors"
            style={{ borderColor: '#EEEEF2', color: '#6B7280' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--brand-primary)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#EEEEF2')}
            onClick={() => setFilterStatus('all')}
          >
            <X className="w-3.5 h-3.5" />
            נקה סינון
          </button>
        )}
      </div>

      {/* Main table */}
      <div style={{ ...tableWrap, overflow: 'hidden' }}>
        <SectionHeader
          className="px-6 py-4 border-b"
          style={{ borderColor: '#EEEEF2' }}
          action={<span className="text-sm text-gray-500">{filtered.length} רשומות</span>}
          title={<><h2 className="font-bold text-gray-800">רשימת כרטסות</h2><ArrowLeftRight className="w-4 h-4 text-gray-400" /></>}
        />

        <div style={{ overflowX: 'auto' }}>
          {/* Header */}
          <div
            className="grid"
            style={{
              ...tableHeadRow,
              display: 'grid',
              gridTemplateColumns: gridCOL,
              minWidth: gridMin,
            }}
          >
            {!isMobile && <span style={tableHeadCell}>מזהה</span>}
            <span style={tableHeadCell}>ספק</span>
            {!isMobile && <span style={tableHeadCell}>חודש</span>}
            {/* When the statement ENTERED the system (`uploaded_at`, DEFAULT now()) —
                not the period it covers; that is the חודש column beside it. */}
            {!isMobile && <span style={tableHeadCell} title="התאריך שבו הכרטסת נקלטה במערכת">תאריך קליטה</span>}
            {!isMobile && <span style={tableHeadCell}>יתרה שלנו</span>}
            {!isMobile && <span style={tableHeadCell}>יתרת ספק</span>}
            <span style={tableHeadCell}>הפרש</span>
            <span style={tableHeadCell}>סטטוס</span>
            <span style={tableHeadCell}>פעולות</span>
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">לא נמצאו רשומות</div>
          ) : (
            filtered.map((stmt, index) => (
              <div
                key={stmt.id}
                className="grid items-center transition-colors"
                style={{
                  ...tableRow(index === 0),
                  display: 'grid',
                  gridTemplateColumns: gridCOL,
                  minWidth: gridMin,
                  minHeight: '56px',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedId(stmt.id)}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = TABLE_HOVER)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                {!isMobile && <span className="text-xs text-gray-400 font-mono truncate" title={stmt.id}>{stmt.id}</span>}
                <span className="text-sm font-semibold text-gray-800 truncate" title={stmt.supplier_name}>
                  {stmt.supplier_name || <span className="text-gray-400">ספק לא מזוהה</span>}
                </span>
                {!isMobile && <span className="text-sm text-gray-600">{stmt.month}</span>}
                {!isMobile && (
                  <span className="text-sm text-gray-600 whitespace-nowrap">
                    {isoToDisplay(stmt.uploaded_at) || <span className="text-gray-400">—</span>}
                  </span>
                )}
                {/* No supplier assigned → we have no ledger to compare against, so
                    the column says so instead of showing a confident ₪0. */}
                {!isMobile && (
                  <span className="text-sm font-semibold text-gray-800">
                    {stmt.supplier_id ? formatILS(stmt.our_balance) : <span className="text-gray-400">—</span>}
                  </span>
                )}
                {!isMobile && (
                  <span className="text-sm font-semibold text-gray-800">
                    {stmt.vendor_balance != null ? formatILS(stmt.vendor_balance) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </span>
                )}
                {/* `—` means "nothing to compare" (no supplier, or no vendor figure
                    yet) and NOTHING else. A gap of exactly zero is the strongest
                    result this screen produces — printing it as `—` made a perfect
                    match look like missing data. */}
                <span
                  className="text-sm font-bold"
                  style={{
                    color: !comparableRow(stmt) ? '#9CA3AF'
                      : stmt.diff > 0 ? '#DC2626' : stmt.diff < 0 ? '#1E40AF' : '#166534',
                  }}
                >
                  {comparableRow(stmt) ? formatILS(stmt.diff) : '—'}
                </span>
                <StatusBadge status={stmt.status} />
                <div className="flex items-center flex-wrap gap-1">
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                    style={{ background: '#F3E8FF', color: '#7C3AED' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#EDE9FE')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#F3E8FF')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(stmt.id)
                    }}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    פירוט
                  </button>
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                    style={{ background: '#FEE2E2', color: '#DC2626' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FECACA')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#FEE2E2')}
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(stmt) }}
                    title="מחיקת הכרטסת"
                  >
                    <X className="w-3.5 h-3.5" />
                    מחק
                  </button>
                  {(stmt.drive_file_link || stmt.storage_url) && (
                    <button
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                      style={{ background: '#E0F2FE', color: '#0369A1' }}
                      title="הצג את מסמך הכרטסת שהתקבל"
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#BAE6FD')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#E0F2FE')}
                      onClick={(e) => { e.stopPropagation(); void openDoc(stmt) }}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      הצג מסמך
                    </button>
                  )}
                  {stmt.storage_url && (
                    <button
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                      style={{ background: '#E0F2FE', color: '#0369A1' }}
                      title="צפה בקובץ הכרטסת"
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#BAE6FD')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#E0F2FE')}
                      onClick={(e) => { e.stopPropagation(); void openStoredFile(stmt.storage_url) }}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      צפה בקובץ
                    </button>
                  )}
                  {stmt.drive_file_link && (
                    <button
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                      style={{ background: '#FEF3C7', color: '#D97706' }}
                      title="פתח בדרייב"
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FDE68A')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#FEF3C7')}
                      onClick={(e) => { e.stopPropagation(); void openStoredFile(stmt.drive_file_link) }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                    style={{ background: 'var(--brand-active-bg)', color: '#9CA3AF' }}
                    title="הורד מסמך"
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--brand-primary)')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
                    onClick={(e) => {
                      e.stopPropagation()
                      const sup = suppliersData.find(s => s.id === stmt.supplier_id)
                      printStatementPDF({
                        id: stmt.id,
                        month: stmt.month,
                        status: stmt.status,
                        our_balance: stmt.our_balance,
                        vendor_balance: stmt.vendor_balance,
                        diff: stmt.diff,
                        // The PDF prints this string as-is, so it is formatted here
                        // (day-first) instead of leaking the raw ISO timestamp.
                        uploaded_at: isoToDisplay(stmt.uploaded_at),
                        supplierName: stmt.supplier_name,
                        supplierHp: (sup as Record<string, string> | undefined)?.hp,
                        supplierContact: sup?.contact,
                        supplierPhone: sup?.phone,
                      })
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Arrived statement document — in-page popup viewer */}
      {viewDoc && <PdfPreviewModal url={viewDoc} onClose={() => setViewDoc(null)} />}

      {/* Delete confirmation. Names the supplier and month, and says what else goes
          with the row — a statement the owner cannot identify is one she cannot
          safely agree to delete. */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null) }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full" style={{ maxWidth: '430px', direction: 'rtl' }}>
            <div className="flex items-center gap-2 border-b" style={{ padding: '15px 20px', borderColor: '#EEEEF2' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#FEE2E2' }}>
                <AlertTriangle className="w-5 h-5" style={{ color: '#DC2626' }} />
              </div>
              <h3 className="font-bold text-gray-800" style={{ fontSize: '16px' }}>מחיקת כרטסת</h3>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <p className="text-gray-700 text-right" style={{ fontSize: '14px' }}>
                למחוק את הכרטסת של <strong>{confirmDelete.supplier_name || 'ספק לא מזוהה'}</strong>
                {confirmDelete.month ? <> לחודש <strong>{confirmDelete.month}</strong></> : null}?
              </p>
              <p className="text-gray-500 text-right mt-2" style={{ fontSize: '13px' }}>
                הקובץ המצורף יימחק יחד איתה. <strong>הפעולה אינה הפיכה.</strong>
              </p>
              <p className="text-gray-400 text-right mt-2" style={{ fontSize: '12.5px' }}>
                חשבוניות ותשלומים אינם מושפעים — יתרת הספק מחושבת מהם, לא מהכרטסת.
              </p>
            </div>
            <div className="flex gap-2 border-t" style={{ padding: '14px 20px', borderColor: '#EEEEF2' }}>
              <button
                className="flex-1 rounded-xl font-bold"
                style={{ background: '#DC2626', color: 'white', border: 'none', padding: '9px 14px', fontSize: '13.5px', cursor: 'pointer' }}
                onClick={async () => {
                  const target = confirmDelete
                  setConfirmDelete(null)
                  if (selectedId === target.id) setSelectedId(null)
                  try { await removeStatement(target.id) } catch { /* hook surfaces the error */ }
                }}
              >מחק</button>
              <button
                className="flex-1 rounded-xl font-bold"
                style={{ background: 'white', color: '#6B7280', border: '1px solid #E2E4E9', padding: '9px 14px', fontSize: '13.5px', cursor: 'pointer' }}
                onClick={() => setConfirmDelete(null)}
              >ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
