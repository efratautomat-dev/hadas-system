import { useState, useEffect } from 'react'
import { FileText, CreditCard, Pencil, BookOpen, User, Phone, Mail, Hash, Tag, MessageSquare, Trash2, AlertCircle, AlertTriangle, Power, GitMerge, Truck, RotateCcw } from 'lucide-react'
import { useInvoices } from '../hooks/useInvoices'
import { usePayments } from '../hooks/usePayments'
import { useDeliveryNotes } from '../hooks/useDeliveryNotes'
import { useReturns } from '../hooks/useReturns'
import { useStatements } from '../hooks/useStatements'
import { sumNonCancelledPayments } from '../lib/supplierBalance'
import { buildLedger, isExcludedFromBalance } from '../lib/supplierLedger'
import { useAlerts } from '../hooks/useAlerts'
import { invoiceStatusKey } from '../lib/invoiceStatus'
import { StatusBadge } from './StatusBadge'
import SectionHeader from './SectionHeader'
import { Button } from './ui/Button'

function useIsTablet() {
  const [v, setV] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth <= 1024
  )
  useEffect(() => {
    const h = () => setV(window.innerWidth >= 768 && window.innerWidth <= 1024)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
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

export interface Supplier {
  id: string
  name: string
  category: string
  contact: string
  phone: string
  status: string
  paymentTerms: string
  lastOrderDate: string
  balance: number
  hp?: string
  email?: string
  openingBalance?: number
  openingBalanceDate?: string
  notes?: string
  // "בהסדר תשלום": display-only — balance shows 0 and invoices get an informational
  // "בהסדר" tag. Accounting status is unchanged; never mutates rows; reversible.
  paymentArrangement?: boolean
}

interface Props {
  supplier: Supplier
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onMerge?: () => void
  onViewLedger?: () => void
  onViewPayments?: () => void
  onOpenInvoice?: (invoiceId: string) => void
  onToggleActive?: (nextActive: boolean) => void
}

// invoiceStatusStyle removed: it keyed on the STORED vocabulary (ממתין/שולם/בטיפול),
// which the derived status never produces. Rendering now goes through StatusBadge.

// Returns carry a MIXED vocabulary — the UI writes אושר/בטיפול/נדחה while ingest
// closes a matched return with הסתיים (see docs/07-OPEN-ISSUES). Both are live,
// so every value is listed and anything unknown falls through to gray.
const returnStatusStyle: Record<string, { background: string; color: string }> = {
  'אושר':   { background: '#DCFCE7', color: '#166534' },
  'הסתיים': { background: '#DCFCE7', color: '#166534' },
  'נסגר':   { background: '#DCFCE7', color: '#166534' },
  'בטיפול': { background: '#FEF9C3', color: '#A16207' },
  'נדחה':   { background: '#FEE2E2', color: '#DC2626' },
}

const statementStatusStyle: Record<string, { background: string; color: string }> = {
  matched:       { background: '#DCFCE7', color: '#166534' },
  mismatch:      { background: '#FEE2E2', color: '#DC2626' },
  pending:       { background: '#DBEAFE', color: '#1E40AF' },
  investigating: { background: '#FEF9C3', color: '#A16207' },
  needs_review:  { background: '#FEF9C3', color: '#A16207' },
}

const STATEMENT_STATUS_HE: Record<string, string> = {
  matched: 'תואם', mismatch: 'אי-התאמה', pending: 'חדש',
  investigating: 'בבדיקה', needs_review: 'בבדיקה',
}

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

// ── Section cards ───────────────────────────────────────────────────────────

type TabKey = 'ledger' | 'invoices' | 'notes' | 'returns' | 'payments' | 'statements'

// One summary card. Clicking it opens that section in the panel below; the
// selected card carries the brand border + tint so the connection is obvious.
function TabCard({
  label, Icon, value, sub, selected, onClick, alerts = 0,
}: {
  label: string
  Icon: typeof FileText
  /** The headline figure — a count, or a sum for the ledger. */
  value: string
  sub?: string
  selected: boolean
  onClick: () => void
  /** Rows needing attention; surfaced as a red badge on the card. */
  alerts?: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className="bg-white rounded-2xl text-right transition-all relative"
      style={{
        border: `1.5px solid ${selected ? 'var(--brand-primary)' : '#E2E4E9'}`,
        background: selected ? 'var(--brand-active-bg)' : 'white',
        padding: '14px 16px',
        // Touch target — the supplier screen is used on tablet (04-DESIGN).
        minHeight: '76px',
        cursor: 'pointer',
        boxShadow: selected ? 'none' : '0 1px 2px rgba(16,17,21,.04)',
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = '#FAFAFC' }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = 'white' }}
    >
      <div className="flex items-center justify-between gap-2">
        <Icon className="w-4 h-4" style={{ color: selected ? 'var(--brand-primary)' : '#9CA3AF' }} />
        <span
          className="font-semibold truncate"
          style={{ fontSize: '13px', color: selected ? 'var(--brand-primary)' : '#6B7280' }}
        >
          {label}
        </span>
      </div>
      <p className="font-black mt-1" style={{ fontSize: '19px', color: selected ? 'var(--brand-primary)' : '#1F2937' }}>
        {value}
      </p>
      {sub && <p className="text-gray-400" style={{ fontSize: '11px' }}>{sub}</p>}
      {alerts > 0 && (
        <span
          className="absolute rounded-full font-bold flex items-center justify-center"
          title={`${alerts} דורשות טיפול`}
          style={{ top: '8px', insetInlineStart: '8px', minWidth: '20px', height: '20px', padding: '0 6px', background: '#FEE2E2', color: '#DC2626', fontSize: '11px' }}
        >
          {alerts}
        </span>
      )}
    </button>
  )
}

// The white shell every section panel sits in — matches the employee view.
function Panel({ title, Icon, action, children }: {
  title: string
  Icon: typeof FileText
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
      <SectionHeader
        className="px-5 py-4 border-b"
        style={{ borderColor: '#E2E4E9' }}
        title={<><h2 className="font-bold text-gray-800">{title}</h2><Icon className="w-4 h-4 text-gray-400" /></>}
        action={action}
      />
      {children}
    </div>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return <p className="text-center text-gray-400 py-10" style={{ fontSize: '15px' }}>{text}</p>
}

// parseDate removed — ordering now happens in lib/supplierLedger, on the ISO date
// rather than on the day-first display string this used to re-parse.

function fmtDate(d: string): string {
  if (!d) return ''
  if (d.includes('/')) return d
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export default function SupplierDetail({ supplier, onBack, onEdit, onDelete, onMerge, onViewLedger, onViewPayments, onOpenInvoice, onToggleActive }: Props) {
  const isTablet = useIsTablet()
  const isMobile = useIsMobile()
  const [modal, setModal] = useState<null | 'blocked' | 'confirm'>(null)
  // Which section is open. The manager sees the same card-per-section layout the
  // employees already get, plus כרטסת and התאמת כרטסת. Cards sit on top and the
  // chosen section renders full width beneath them — these tables are wide
  // (תאריך·סוג·אסמכתא·חובה·זכות·יתרה) and a half-screen pane would force
  // horizontal scrolling, especially on tablet.
  const [tab, setTab] = useState<TabKey>('ledger')
  const { data: allInvoices } = useInvoices()
  const { data: allPayments } = usePayments()
  const { data: allNotes } = useDeliveryNotes()
  const { data: allReturns } = useReturns()
  const { data: allStatements } = useStatements()
  // Invoice status is DERIVED, never read from the stored column (CLAUDE.md:
  // "the stored status column is considered unreliable and ignored for display").
  // This screen used to print inv.status raw, which is why a status changed on the
  // invoices screen still showed the OLD value here.
  const { data: alerts } = useAlerts()

  // Everything links to this supplier by SUPPLIER_ID, not by name
  // (spec/06-RULES.md §2b). Cancelled payments are excluded from the balance.
  const invoices = allInvoices.filter((inv) => inv.supplierId === supplier.id)
  const payments = allPayments.filter((pay) => pay.supplier_id === supplier.id && pay.status !== 'cancelled')
  const notes      = allNotes.filter((n) => n.supplierId === supplier.id)
  const returns    = allReturns.filter((r) => r.supplierId === supplier.id)
  const statements = allStatements.filter((s) => s.supplier_id === supplier.id)
  // Statements needing attention drive the warning badge on the card.
  const statementAlerts = statements.filter((s) => s.status === 'mismatch' || s.status === 'needs_review').length

  const openingBalance = Number(supplier.openingBalance ?? 0)
  // "בהסדר תשלום": display-only — this supplier is excluded from balance tracking.
  // Balance/pending read 0; invoices keep their status and get a "בהסדר" tag. No data touched.
  const paymentArrangement = supplier.paymentArrangement ?? false

  // ONE balance for this screen, from the ledger engine — headline, ledger card
  // and statement panel all read it. Computing the headline separately is exactly
  // how the list card and this page drifted apart: the helper counts EVERY invoice,
  // while the list (and now the ledger) leave flagged duplicate/errored rows out.
  const ledgerResult = buildLedger(supplier.id, invoices, payments, openingBalance, { paymentArrangement })
  const currentBalance = ledgerResult.closingBalance

  // Σ invoices for the KPI card excludes flagged rows for the same reason — a
  // suspected duplicate should not inflate the headline total either.
  const totalInvoiced = invoices.reduce((s, i) => s + (isExcludedFromBalance(i) ? 0 : i.amount), 0)
  // "שולם" = money actually paid out = Σ non-cancelled payments (NOT an invoice flag,
  // which never carries 'שולם'). "ממתין לתשלום" = outstanding still owed = the balance.
  const paidAmount    = sumNonCancelledPayments(payments)
  const pendingAmount = paymentArrangement ? 0 : Math.max(0, currentBalance)

  // Ledger reflects the balance formula (spec/06-RULES.md §2): opening balance,
  // then invoices (+, debit), credit notes (negative invoices → −, credit), and
  // non-cancelled payments (−, credit), with a running total. Returns are NOT here
  // — only their matching credit note (a negative invoice) moves the balance.

  const ledger = [
    ...(openingBalance !== 0
      ? [{ id: 'opening', date: fmtDate(supplier.openingBalanceDate ?? ''), description: 'יתרת פתיחה', debit: 0, credit: 0, balance: openingBalance, undated: false }]
      : []),
    ...ledgerResult.rows.map(r => ({
      id: r.id,
      date: r.undated ? 'ללא תאריך' : r.displayDate,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      balance: r.balance,
      undated: r.undated,
    })),
  ]
  const txEntries = ledgerResult.rows

  // running (final) equals currentBalance from the shared helper — same formula.
  const totalDebit  = txEntries.reduce((s, e) => s + e.debit, 0)
  const totalCredit = txEntries.reduce((s, e) => s + e.credit, 0)
  // In-card ledger shows NEWEST entry on top (opening row falls to the bottom).
  const ledgerDisplay = [...ledger].reverse()
  const todayStr = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const fs = (big: string, small: string) => (isTablet ? big : small)

  const handleDeleteClick = () => {
    setModal(invoices.length > 0 ? 'blocked' : 'confirm')
  }

  const handleConfirmDelete = () => {
    onDelete()
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className={isMobile ? 'flex flex-col gap-3' : 'flex items-center justify-between gap-4'}>
        {/* RIGHT (first in RTL): action buttons */}
        <div className={isMobile ? 'flex items-center gap-2 overflow-x-auto pb-1' : 'flex items-center gap-2 flex-shrink-0'}>
          {onViewLedger && (
            <Button variant="secondary" onClick={onViewLedger}>
              <BookOpen className="w-4 h-4" />
              כרטסת ספק
            </Button>
          )}
          {onToggleActive && (() => {
            const isActive = supplier.status === 'פעיל'
            // Clear active⇄inactive toggle: colored switch + current-state label.
            // Click flips the `active` column via hadas-api.
            return (
              <button
                onClick={() => onToggleActive(!isActive)}
                title={isActive ? 'לחצי כדי להשבית את הספק' : 'לחצי כדי להפעיל את הספק מחדש'}
                className="flex items-center gap-2 rounded-xl font-semibold transition-all"
                style={{
                  minHeight: '44px', padding: '0 14px', fontSize: fs('16px', '14px'),
                  background: isActive ? '#DCFCE7' : '#F3F4F6',
                  color: isActive ? '#15803D' : '#6B7280',
                  border: `1px solid ${isActive ? '#BBF7D0' : '#E5E7EB'}`,
                }}
              >
                <Power className="w-4 h-4" />
                <span>{isActive ? 'פעיל' : 'לא פעיל'}</span>
                {/* switch track (green=active / gray=inactive); knob slides on toggle */}
                <span style={{ position: 'relative', width: '38px', height: '22px', borderRadius: '999px', flexShrink: 0, transition: 'background .2s', background: isActive ? '#16A34A' : '#CBD5E1' }}>
                  <span style={{ position: 'absolute', top: '2px', left: '2px', width: '18px', height: '18px', borderRadius: '50%', background: 'white', transition: 'transform .2s', transform: isActive ? 'translateX(16px)' : 'translateX(0)' }} />
                </span>
              </button>
            )
          })()}
          <Button variant="primary" onClick={onEdit}>
            <Pencil className="w-4 h-4" />
            עריכה
          </Button>
          <button
            onClick={onBack}
            className="rounded-xl font-semibold transition-all"
            style={{ minHeight: '44px', padding: '0 18px', background: '#F3F4F6', color: '#6B7280', fontSize: fs('16px', '14px') }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
          >
            חזרה לרשימה
          </button>
        </div>

        {/* LEFT (last in RTL): name + status */}
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="rounded-lg font-bold flex-shrink-0"
            style={{
              fontSize: '13px', padding: '5px 12px',
              background: supplier.status === 'פעיל' ? '#DCFCE7' : '#F3F4F6',
              color:      supplier.status === 'פעיל' ? '#16A34A' : '#6B7280',
            }}
          >
            {supplier.status}
          </span>
          {paymentArrangement && (
            <span
              className="rounded-lg font-bold flex-shrink-0"
              style={{ fontSize: '13px', padding: '5px 12px', background: '#DBEAFE', color: '#1E40AF' }}
              title="ספק בהסדר תשלום — מוחרג ממעקב יתרה, חשבוניות מוצגות כמשולמות"
            >
              בהסדר תשלום
            </span>
          )}
          <div className="text-right min-w-0">
            <h1 className="font-black text-gray-800 truncate" style={{ fontSize: fs('26px', '22px') }}>
              {supplier.name}
            </h1>
            <p className="text-gray-500 mt-0.5 truncate" style={{ fontSize: fs('15px', '13px') }}>
              {supplier.contact} · {supplier.phone}
            </p>
          </div>
        </div>
      </div>

      {/* ── Details + money, in TWO compact strips ────────────────────────
          This used to be ~700px of chrome before the section cards: a
          six-row contact card, four identity cards (with קטגוריה duplicated
          between them) and four large money cards. The six section cards —
          the thing this screen exists for — started below the fold.
          Borrowed from the employee view: say it once, say it tightly. */}
      <div className="bg-white rounded-2xl shadow-sm border" style={{ borderColor: '#E2E4E9', padding: '14px 18px' }}>
        <div className="flex flex-wrap items-center" style={{ gap: '8px 26px' }}>
          {[
            { Icon: Hash,          label: 'ח.פ / ע.מ',   value: supplier.hp ?? '' },
            { Icon: Tag,           label: 'קטגוריה',      value: supplier.category },
            { Icon: User,          label: 'איש קשר',      value: supplier.contact },
            { Icon: Phone,         label: 'טלפון',         value: supplier.phone },
            { Icon: Mail,          label: 'מייל',          value: supplier.email ?? '' },
            { Icon: CreditCard,    label: 'תנאי תשלום',   value: supplier.paymentTerms },
          ].filter(f => (f.value ?? '').toString().trim()).map(({ Icon, label, value }) => (
            <span key={label} className="inline-flex items-center gap-2" style={{ minWidth: 0 }}>
              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#9CA3AF' }} />
              <span style={{ fontSize: '12px', color: '#9CA3AF' }}>{label}</span>
              <span className="font-semibold truncate" style={{ fontSize: '14px', color: '#1F2937' }} title={String(value)}>
                {value}
              </span>
            </span>
          ))}
          <span className="inline-flex items-center gap-2">
            <span style={{ fontSize: '12px', color: '#9CA3AF' }}>מזהה</span>
            <span className="font-semibold" style={{ fontSize: '13px', color: '#9CA3AF' }}>{supplier.id}</span>
          </span>
        </div>
        {/* Notes only when there ARE notes — an empty labelled row is pure noise. */}
        {supplier.notes?.trim() && (
          <div className="flex items-start gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #F1F2F4' }}>
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#9CA3AF', marginTop: '3px' }} />
            <span className="text-right" style={{ fontSize: '13px', color: '#4B5563', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {supplier.notes}
            </span>
          </div>
        )}
      </div>

      {/* Money — one strip, not four big cards. The current balance keeps the
          emphasis; the opening balance rides along instead of on its own line. */}
      <div
        className="bg-white rounded-2xl shadow-sm border grid grid-cols-2 lg:grid-cols-4"
        style={{ borderColor: '#E2E4E9', overflow: 'hidden' }}
      >
        {[
          { label: 'סה"כ חשבוניות', value: formatILS(totalInvoiced),  sub: '',                                                     color: '#1F2937' },
          { label: 'שולם',          value: formatILS(paidAmount),      sub: '',                                                     color: '#166534' },
          { label: 'ממתין לתשלום', value: formatILS(pendingAmount),    sub: '',                                                     color: '#A16207' },
          { label: 'יתרה עדכנית',  value: formatILS(currentBalance),  sub: `נכון ל־${todayStr} · פתיחה ${formatILS(openingBalance)}`, color: 'var(--brand-primary)' },
        ].map(({ label, value, sub, color }, i) => (
          <div
            key={label}
            className="text-center"
            style={{ padding: '12px 10px', borderInlineStart: i > 0 ? '1px solid #F1F2F4' : undefined }}
          >
            <p className="font-black" style={{ color, fontSize: fs('20px', '18px') }}>{value}</p>
            <p className="text-gray-500 mt-0.5" style={{ fontSize: '12px' }}>{label}</p>
            {sub && <p className="text-gray-400 mt-0.5" style={{ fontSize: '10px' }}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Section cards — click one to open it in the panel below ── */}
      <div role="tablist" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <TabCard
          label="כרטסת" Icon={CreditCard} value={formatILS(currentBalance)} sub={`${ledger.length} תנועות`}
          selected={tab === 'ledger'} onClick={() => setTab('ledger')}
        />
        <TabCard
          label="חשבוניות" Icon={FileText} value={String(invoices.length)}
          selected={tab === 'invoices'} onClick={() => setTab('invoices')}
        />
        <TabCard
          label="תעודות משלוח" Icon={Truck} value={String(notes.length)}
          selected={tab === 'notes'} onClick={() => setTab('notes')}
        />
        <TabCard
          label="חזרות" Icon={RotateCcw} value={String(returns.length)}
          selected={tab === 'returns'} onClick={() => setTab('returns')}
        />
        <TabCard
          label="תשלומים" Icon={CreditCard} value={String(payments.length)}
          selected={tab === 'payments'} onClick={() => setTab('payments')}
        />
        <TabCard
          label="התאמת כרטסת" Icon={BookOpen} value={String(statements.length)} alerts={statementAlerts}
          selected={tab === 'statements'} onClick={() => setTab('statements')}
        />
      </div>

      {/* ── כרטסת (ledger) ── */}
      {tab === 'ledger' && (ledger.length === 0 ? (
        <Panel title="כרטסת" Icon={CreditCard}>
          <EmptyPanel text="אין תנועות עבור ספק זה" />
        </Panel>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
          <SectionHeader
            className="px-5 py-4 border-b"
            style={{ borderColor: '#E2E4E9', cursor: onViewLedger ? 'pointer' : 'default' }}
            onClick={onViewLedger}
            hoverBg={onViewLedger ? '#FAFAFC' : undefined}
            title={<><h2 className="font-bold text-gray-800">כרטסת</h2><CreditCard className="w-4 h-4 text-gray-400" /></>}
            action={onViewLedger ? <span className="text-sm font-semibold" style={{ color: 'var(--brand-primary)' }}>פתח כרטסת ←</span> : undefined}
          />
          {paymentArrangement && (
            <div className="text-right" style={{ padding: '10px 20px', background: '#DBEAFE', color: '#1E40AF', fontSize: '13px', fontWeight: 600 }}>
              ספק בהסדר תשלום — היתרה מסולקת (0) ומוחרגת ממעקב. התנועות מוצגות למידע בלבד; לא בוצע שינוי בנתונים.
            </div>
          )}
          {/* Table header */}
          <div style={{ overflowX: 'auto' }}>
          <div
            className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
            style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', borderColor: '#E2E4E9', fontSize: '11px', minWidth: '480px', padding: '10px 16px' }}
          >
            <span className="text-right">יתרה</span>
            <span className="text-right">תיאור</span>
            <span className="text-center">זכות</span>
            <span className="text-center">חובה</span>
            <span className="text-right">תאריך</span>
          </div>
          {ledgerDisplay.map((entry) => (
            <div
              key={entry.id}
              className="grid items-center"
              style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', minWidth: '480px', minHeight: '56px', padding: '12px 16px', borderBottom: '1px solid #E2E4E9' }}
            >
              <span className="font-bold text-gray-800 text-right" style={{ fontSize: fs('15px', '13px') }}>
                {formatILS(entry.balance)}
              </span>
              <span className="text-gray-600 text-right" style={{ fontSize: fs('14px', '13px') }}>
                {entry.description}
              </span>
              <span className="text-center font-medium" style={{ color: '#166534', fontSize: fs('14px', '13px') }}>
                {entry.credit > 0 ? formatILS(entry.credit) : '—'}
              </span>
              <span className="text-center font-medium" style={{ color: '#A16207', fontSize: fs('14px', '13px') }}>
                {entry.debit > 0 ? formatILS(entry.debit) : '—'}
              </span>
              <span className="text-right text-gray-400" style={{ fontSize: '12px' }}>{fmtDate(entry.date)}</span>
            </div>
          ))}
          {/* Summary / total row — final running balance matches the headline. */}
          <div
            className="grid items-center"
            style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', minWidth: '480px', padding: '12px 16px', borderTop: '2px solid var(--brand-primary)', background: 'var(--brand-active-bg)' }}
          >
            <span className="font-black text-right" style={{ color: 'var(--brand-primary)', fontSize: fs('16px', '14px') }}>
              {formatILS(currentBalance)}
            </span>
            <span className="font-bold text-right text-gray-600" style={{ fontSize: fs('13px', '12px') }}>סה"כ · יתרה עדכנית</span>
            <span className="text-center font-semibold" style={{ color: '#166534', fontSize: fs('14px', '13px') }}>
              {totalCredit > 0 ? formatILS(totalCredit) : '—'}
            </span>
            <span className="text-center font-semibold" style={{ color: '#A16207', fontSize: fs('14px', '13px') }}>
              {totalDebit > 0 ? formatILS(totalDebit) : '—'}
            </span>
            <span />
          </div>
          </div>
        </div>
      ))}

      {/* ── Invoices ── */}
      {tab === 'invoices' && (
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <SectionHeader
          className="px-5 py-4 border-b"
          style={{ borderColor: '#E2E4E9' }}
          title={<><h2 className="font-bold text-gray-800">חשבוניות</h2><FileText className="w-4 h-4 text-gray-400" /></>}
        />
        {invoices.length === 0 ? (
          <p className="text-center text-gray-400 py-8" style={{ fontSize: '15px' }}>אין חשבוניות עבור ספק זה</p>
        ) : (
          <div>
            <div
              className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
              style={{ gridTemplateColumns: '1fr 80px 120px', borderColor: '#E2E4E9', fontSize: '11px', padding: '10px 16px' }}
            >
              <span className="text-right">תאריך · מספר</span>
              <span className="text-center">סטטוס</span>
              <span className="text-left">סכום</span>
            </div>
            {invoices.map((inv) => {
              const statusKey = invoiceStatusKey(inv, alerts)
              const clickable = !!onOpenInvoice
              return (
                <div
                  key={inv.id}
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: '1fr 80px 120px',
                    borderBottom: '1px solid #E2E4E9',
                    minHeight: '56px',
                    padding: '12px 16px',
                    cursor: clickable ? 'pointer' : 'default',
                    transition: 'background 0.12s',
                  }}
                  onClick={clickable ? () => onOpenInvoice!(inv.id) : undefined}
                  onMouseEnter={clickable ? (e) => ((e.currentTarget as HTMLElement).style.background = '#FDF5F6') : undefined}
                  onMouseLeave={clickable ? (e) => ((e.currentTarget as HTMLElement).style.background = 'transparent') : undefined}
                >
                  <p className="text-right text-gray-400" style={{ fontSize: '12px' }}>{inv.id} · {inv.date}</p>
                  <div className="flex justify-center items-center gap-1.5 flex-wrap">
                    <StatusBadge status={statusKey} style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700 }} />
                    {paymentArrangement && (
                      <span
                        className="rounded-lg font-bold"
                        title="ספק בהסדר תשלום (מידע בלבד — אינו משנה את סטטוס החשבונית)"
                        style={{ fontSize: '11px', padding: '3px 8px', background: '#DBEAFE', color: '#1E40AF' }}
                      >
                        בהסדר
                      </span>
                    )}
                  </div>
                  <span className="text-left font-black text-gray-800" style={{ fontSize: fs('15px', '14px') }}>
                    {formatILS(inv.amount)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* ── תעודות משלוח ── NEW for the manager (the employees already had it) */}
      {tab === 'notes' && (
        <Panel title="תעודות משלוח" Icon={Truck} action={<span className="text-sm text-gray-400">{notes.length} רשומות</span>}>
          {notes.length === 0 ? (
            <EmptyPanel text="אין תעודות משלוח עבור ספק זה" />
          ) : (
            <div>
              <div
                className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
                style={{ gridTemplateColumns: '1fr 110px 120px', borderColor: '#E2E4E9', fontSize: '11px', padding: '10px 16px' }}
              >
                <span className="text-right">תאריך · מספר</span>
                <span className="text-center">מקור</span>
                <span className="text-left">סכום</span>
              </div>
              {notes.map((n) => (
                <div
                  key={n.id}
                  className="grid items-center"
                  style={{ gridTemplateColumns: '1fr 110px 120px', borderBottom: '1px solid #E2E4E9', minHeight: '56px', padding: '12px 16px' }}
                >
                  <p className="text-right text-gray-600" style={{ fontSize: '13px' }}>
                    {n.noteNumber || n.id}
                    <span className="text-gray-400"> · {n.date}</span>
                  </p>
                  <span className="text-center">
                    <span
                      className="rounded-lg font-bold"
                      style={{ fontSize: '11px', padding: '4px 9px', ...(n.source === 'email' ? { background: '#DBEAFE', color: '#1E40AF' } : { background: '#F3F4F6', color: '#6B7280' }) }}
                    >
                      {n.source === 'email' ? 'הגיע במייל' : 'קליטה ידנית'}
                    </span>
                  </span>
                  <span className="text-left font-black text-gray-800" style={{ fontSize: fs('15px', '14px') }}>
                    {n.amount ? formatILS(n.amount) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* ── חזרות ── NEW for the manager */}
      {tab === 'returns' && (
        <Panel title="חזרות" Icon={RotateCcw} action={<span className="text-sm text-gray-400">{returns.length} רשומות</span>}>
          {returns.length === 0 ? (
            <EmptyPanel text="אין חזרות עבור ספק זה" />
          ) : (
            <div>
              <div
                className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
                style={{ gridTemplateColumns: '1fr 100px 120px', borderColor: '#E2E4E9', fontSize: '11px', padding: '10px 16px' }}
              >
                <span className="text-right">תאריך · סיבה</span>
                <span className="text-center">סטטוס</span>
                <span className="text-left">סכום</span>
              </div>
              {returns.map((r) => (
                <div
                  key={r.id}
                  className="grid items-center"
                  style={{ gridTemplateColumns: '1fr 100px 120px', borderBottom: '1px solid #E2E4E9', minHeight: '56px', padding: '12px 16px' }}
                >
                  <div className="text-right">
                    <p className="text-gray-600 font-medium" style={{ fontSize: '13px' }}>{r.reason || '—'}</p>
                    <p className="text-gray-400" style={{ fontSize: '12px' }}>{r.date}</p>
                  </div>
                  {/* StatusBadge's gray fallback rule (06-RULES §1): returns carry a
                      mixed vocabulary (אושר/בטיפול/נדחה from the UI, הסתיים from
                      ingest), so an unknown value must render gray, never crash. */}
                  <span className="text-center">
                    <span
                      className="rounded-lg font-bold"
                      style={{ fontSize: '12px', padding: '4px 10px', ...(returnStatusStyle[r.status] ?? { background: '#F3F4F6', color: '#6B7280' }) }}
                    >
                      {r.status || '—'}
                    </span>
                  </span>
                  <span className="text-left font-black text-gray-800" style={{ fontSize: fs('15px', '14px') }}>
                    {r.amount ? formatILS(r.amount) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* ── Payments ── */}
      {tab === 'payments' && (
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <SectionHeader
          className="px-5 py-4 border-b"
          style={{ borderColor: '#E2E4E9', cursor: onViewPayments ? 'pointer' : 'default' }}
          onClick={onViewPayments}
          hoverBg={onViewPayments ? '#FAFAFC' : undefined}
          title={<><h2 className="font-bold text-gray-800">תשלומים</h2><CreditCard className="w-4 h-4 text-gray-400" /></>}
          action={onViewPayments ? <span className="text-sm font-semibold" style={{ color: 'var(--brand-primary)' }}>פתח דף תשלומים ←</span> : undefined}
        />
        {payments.length === 0 ? (
          <p className="text-center text-gray-400 py-8" style={{ fontSize: '15px' }}>אין תשלומים עבור ספק זה</p>
        ) : (
          <div>
            <div
              className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
              style={{ gridTemplateColumns: '1fr 80px 120px', borderColor: '#E2E4E9', fontSize: '11px', padding: '10px 16px' }}
            >
              <span className="text-right">שיטה · פירעון</span>
              <span className="text-center">מזהה</span>
              <span className="text-left">סכום</span>
            </div>
            {payments.map((pay) => (
              <div
                key={pay.id}
                className="grid items-center"
                style={{ gridTemplateColumns: '1fr 80px 120px', borderBottom: '1px solid #E2E4E9', minHeight: '56px', padding: '12px 16px' }}
              >
                <div className="text-right">
                  <p className="text-gray-600 font-medium" style={{ fontSize: '13px' }}>{pay.type}</p>
                  <p className="text-gray-400" style={{ fontSize: '12px' }}>פירעון: {fmtDate(pay.date)}</p>
                </div>
                <p className="text-center text-gray-400" style={{ fontSize: '12px' }}>{pay.id}</p>
                <span className="text-left font-black text-gray-800" style={{ fontSize: fs('15px', '14px') }}>
                  {formatILS(pay.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── התאמת כרטסת ── NEW for the manager. Every incoming statement is
          auto-matched against the ledger; a mismatch raises an alert
          (01-PRD §7), so the diff column is the point of this panel. */}
      {tab === 'statements' && (
        <Panel title="התאמת כרטסת" Icon={BookOpen} action={<span className="text-sm text-gray-400">{statements.length} רשומות</span>}>
          {statements.length === 0 ? (
            <EmptyPanel text="אין דפי חשבון עבור ספק זה" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div
                className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
                style={{ gridTemplateColumns: '100px 1fr 1fr 1fr 110px', borderColor: '#E2E4E9', fontSize: '11px', minWidth: '560px', padding: '10px 16px' }}
              >
                <span className="text-right">חודש</span>
                <span className="text-center">היתרה שלנו</span>
                <span className="text-center">יתרת הספק</span>
                <span className="text-center">הפרש</span>
                <span className="text-center">סטטוס</span>
              </div>
              {statements.map((s) => {
                const st = statementStatusStyle[s.status] ?? { background: '#F3F4F6', color: '#6B7280' }
                // Our side of the comparison is the ledger AS IT IS NOW.
                const liveBalance = ledgerResult.closingBalance
                const liveDiff = s.vendor_balance == null ? 0 : liveBalance - s.vendor_balance
                // The verdict follows the LIVE diff — a row must never read "תואם"
                // next to a gap. Workflow states (pending/investigating) are the
                // manager's and are left as they are.
                const liveStatus = (s.status === 'matched' || s.status === 'mismatch')
                  ? (s.vendor_balance != null && Math.abs(liveDiff) > 0.005 ? 'mismatch' : 'matched')
                  : s.status
                return (
                  <div
                    key={s.id}
                    className="grid items-center"
                    style={{ gridTemplateColumns: '100px 1fr 1fr 1fr 110px', minWidth: '560px', borderBottom: '1px solid #E2E4E9', minHeight: '56px', padding: '12px 16px' }}
                  >
                    <span className="text-right text-gray-600 font-medium" style={{ fontSize: '13px' }}>{s.month}</span>
                    {/* LIVE balance, not the stored our_balance column — the stored
                        value was written when the statement arrived and never
                        refreshed, so it drifted from the ledger shown above it. */}
                    <span className="text-center text-gray-700" style={{ fontSize: fs('14px', '13px') }}>{formatILS(liveBalance)}</span>
                    <span className="text-center text-gray-700" style={{ fontSize: fs('14px', '13px') }}>
                      {s.vendor_balance == null ? '—' : formatILS(s.vendor_balance)}
                    </span>
                    <span
                      className="text-center font-black"
                      style={{ fontSize: fs('15px', '14px'), color: Math.abs(liveDiff) > 0.005 ? '#DC2626' : '#166534' }}
                    >
                      {formatILS(liveDiff)}
                    </span>
                    <span className="text-center">
                      <span className="rounded-lg font-bold" style={{ fontSize: '12px', padding: '4px 10px', ...(statementStatusStyle[liveStatus] ?? st) }}>
                        {STATEMENT_STATUS_HE[liveStatus] ?? liveStatus}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      )}

      {/* ── Delete / merge buttons ── */}
      <div className="flex justify-start gap-2 pt-1 pb-2">
        <Button variant="danger" onClick={handleDeleteClick}>
          <Trash2 className="w-4 h-4" />
          מחק ספק
        </Button>
        {onMerge && (
          <Button variant="outline" onClick={onMerge}>
            <GitMerge className="w-4 h-4" />
            מזג עם ספק אחר
          </Button>
        )}
      </div>

      {/* ── Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null) }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full text-right"
            style={{ maxWidth: '400px' }}
          >
            {modal === 'blocked' ? (
              /* ─ חסום: יש חשבוניות ─ */
              <div className="p-6 flex flex-col items-end gap-4">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FFF1F2' }}
                >
                  <AlertCircle className="w-6 h-6" style={{ color: '#BE123C' }} />
                </div>
                <div>
                  <h3 className="font-black text-gray-800 mb-1" style={{ fontSize: '18px' }}>
                    לא ניתן למחוק ספק
                  </h3>
                  <p className="text-gray-500 leading-relaxed" style={{ fontSize: '14px' }}>
                    קיימות <strong className="text-gray-700">{invoices.length}</strong> חשבוניות
                    משויכות לספק זה. יש למחוק תחילה את החשבוניות.
                  </p>
                </div>
                <Button variant="ghost" onClick={() => setModal(null)} className="w-full">
                  הבנתי
                </Button>
              </div>
            ) : (
              /* ─ אישור מחיקה ─ */
              <div className="p-6 flex flex-col items-end gap-4">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FEF9C3' }}
                >
                  <AlertTriangle className="w-6 h-6" style={{ color: '#A16207' }} />
                </div>
                <div>
                  <h3 className="font-black text-gray-800 mb-1" style={{ fontSize: '18px' }}>
                    מחיקת ספק
                  </h3>
                  <p className="text-gray-500 leading-relaxed" style={{ fontSize: '14px' }}>
                    האם אתה בטוח שברצונך למחוק את הספק{' '}
                    <strong className="text-gray-700">"{supplier.name}"</strong>?
                    פעולה זו אינה ניתנת לביטול.
                  </p>
                </div>
                <div className="flex gap-2 w-full">
                  <Button variant="danger" onClick={handleConfirmDelete} className="flex-1">
                    <Trash2 className="w-4 h-4" />
                    מחק
                  </Button>
                  <Button variant="ghost" onClick={() => setModal(null)} className="flex-1">
                    ביטול
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
