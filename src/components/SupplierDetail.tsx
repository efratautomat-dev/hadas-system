import { useState, useEffect } from 'react'
import { FileText, CreditCard, Pencil, BookOpen, User, Phone, Mail, Hash, Tag, MessageSquare, Trash2, AlertCircle, AlertTriangle, Power } from 'lucide-react'
import { useInvoices } from '../hooks/useInvoices'
import { usePayments } from '../hooks/usePayments'
import { computeSupplierBalance, sumNonCancelledPayments } from '../lib/supplierBalance'
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
}

interface Props {
  supplier: Supplier
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onViewLedger?: () => void
  onViewPayments?: () => void
  onOpenInvoice?: (invoiceId: string) => void
  onToggleActive?: (nextActive: boolean) => void
}

const invoiceStatusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: '#FEF9C3', color: '#A16207' },
  'שולם':   { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#DBEAFE', color: '#1E40AF' },
}

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

function parseDate(d: string) {
  if (d.includes('-')) {
    const [year, month, day] = d.split('-').map(Number)
    return new Date(year, month - 1, day).getTime()
  }
  const [day, month, year] = d.split('/').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function fmtDate(d: string): string {
  if (!d) return ''
  if (d.includes('/')) return d
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export default function SupplierDetail({ supplier, onBack, onEdit, onDelete, onViewLedger, onViewPayments, onOpenInvoice, onToggleActive }: Props) {
  const isTablet = useIsTablet()
  const isMobile = useIsMobile()
  const [modal, setModal] = useState<null | 'blocked' | 'confirm'>(null)
  const { data: allInvoices } = useInvoices()
  const { data: allPayments } = usePayments()

  // Link invoices/payments to this supplier by SUPPLIER_ID, not by name
  // (spec/06-RULES.md §2b). Cancelled payments are excluded from the balance.
  const invoices = allInvoices.filter((inv) => inv.supplierId === supplier.id)
  const payments = allPayments.filter((pay) => pay.supplier_id === supplier.id && pay.status !== 'cancelled')

  const openingBalance = Number(supplier.openingBalance ?? 0)
  const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0)
  // Current balance via the SHARED helper — identical to the suppliers list card.
  const currentBalance = computeSupplierBalance(openingBalance, invoices, payments)
  // "שולם" = money actually paid out = Σ non-cancelled payments (NOT an invoice flag,
  // which never carries 'שולם'). "ממתין לתשלום" = outstanding still owed = the balance.
  const paidAmount    = sumNonCancelledPayments(payments)
  const pendingAmount = Math.max(0, currentBalance)

  // Ledger reflects the balance formula (spec/06-RULES.md §2): opening balance,
  // then invoices (+, debit), credit notes (negative invoices → −, credit), and
  // non-cancelled payments (−, credit), with a running total. Returns are NOT here
  // — only their matching credit note (a negative invoice) moves the balance.
  const txEntries = [
    ...invoices.map((inv) => {
      const isCredit = inv.amount < 0   // credit note = negative invoice
      return {
        id: inv.id,
        date: inv.date,
        description: `${isCredit ? 'זיכוי' : 'חשבונית'} ${inv.invoiceNumber || inv.id}`,
        debit:  isCredit ? 0 : inv.amount,
        credit: isCredit ? -inv.amount : 0,
      }
    }),
    ...payments.map((pay) => ({
      id: String(pay.id),
      date: pay.date,
      description: `תשלום · ${pay.type}`,
      debit: 0,
      credit: pay.amount,
    })),
  ].sort((a, b) => parseDate(a.date) - parseDate(b.date))

  let running = openingBalance
  const ledger = [
    ...(openingBalance !== 0
      ? [{ id: 'opening', date: fmtDate(supplier.openingBalanceDate ?? ''), description: 'יתרת פתיחה', debit: 0, credit: 0, balance: openingBalance }]
      : []),
    ...txEntries.map((e) => {
      running += e.debit - e.credit
      return { ...e, balance: running }
    }),
  ]
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

      {/* ── פרטי קשר ── */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        {/* Card header — title pinned to the RIGHT (natural RTL flex flow).
            justify-end was the bug: in RTL, flex "end" = left side. */}
        <div
          className="flex items-center gap-2 border-b"
          style={{ padding: '14px 24px', borderColor: '#E2E4E9', background: '#FDFAFA' }}
        >
          <h2 className="font-bold text-gray-800" style={{ fontSize: fs('16px', '15px') }}>פרטי קשר</h2>
          <User className="w-4 h-4 text-gray-400" />
        </div>

        {/* Field rows — 3-column grid (icon | label | value) so icons,
            labels and values line up vertically across rows.
            In RTL, col 1 sits at the right edge; col 3 holds the value. */}
        {[
          { Icon: User,  label: 'שם איש קשר', value: supplier.contact     },
          { Icon: Phone, label: 'טלפון',       value: supplier.phone       },
          { Icon: Mail,  label: 'מייל',         value: supplier.email ?? '' },
          { Icon: Hash,  label: 'ח.פ / ע.מ',  value: supplier.hp    ?? '' },
          { Icon: Tag,   label: 'קטגוריה',     value: supplier.category    },
        ].map(({ Icon, label, value }, i) => (
          // Forced LTR container so flex ordering is immune to inherited direction:
          // value sits on the LEFT, label + icon group on the RIGHT. Text spans
          // restore rtl so Hebrew/labels read correctly.
          <div
            key={label}
            style={{
              direction: 'ltr',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 24px',
              minHeight: '52px',
              borderTop: i > 0 ? '1px solid #E2E4E9' : undefined,
            }}
          >
            {/* LEFT: value */}
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: fs('15px', '14px'), color: '#1F2937', fontWeight: 500 }}>
              {value}
            </span>
            {/* RIGHT: label + icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF' }}>{label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#F8F9FA' }}>
                <Icon className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-dark)' }} />
              </div>
            </div>
          </div>
        ))}

        {/* הערות — same flex layout; value wraps for long text */}
        <div
          style={{
            direction: 'ltr',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '14px 24px',
            minHeight: '52px',
            borderTop: '1px solid #E2E4E9',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: fs('15px', '14px'), color: '#1F2937', whiteSpace: 'pre-wrap', lineHeight: 1.6, paddingTop: '2px' }}>
            {supplier.notes}
          </span>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexShrink: 0 }}>
            <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF', paddingTop: '5px' }}>הערות</span>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#F8F9FA' }}>
              <MessageSquare className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-dark)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Info grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'קטגוריה',       value: supplier.category },
          { label: 'תנאי תשלום',   value: supplier.paymentTerms },
          { label: 'הזמנה אחרונה', value: supplier.lastOrderDate || '—' },
          { label: 'מזהה ספק',     value: supplier.id },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl px-4 py-3 shadow-sm border text-right" style={{ borderColor: '#E2E4E9' }}>
            <p style={{ fontSize: '11px', color: '#9CA3AF' }}>{label}</p>
            <p className="font-bold text-gray-700 mt-0.5" style={{ fontSize: fs('15px', '14px') }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Financial stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'סה"כ חשבוניות', value: formatILS(totalInvoiced),   sub: '',       color: '#1F2937' },
          { label: 'שולם',          value: formatILS(paidAmount),       sub: '',       color: '#166534' },
          { label: 'ממתין לתשלום', value: formatILS(pendingAmount),     sub: '',       color: '#A16207' },
          // Headline: CURRENT computed balance with today's date (not the opening figure).
          { label: 'יתרה עדכנית',  value: formatILS(currentBalance),   sub: todayStr, color: '#E8645A' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#E2E4E9' }}>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: fs('15px', '13px') }}>{label}</p>
            {sub && <p className="text-gray-400 mt-0.5" style={{ fontSize: '11px' }}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* Opening balance — separate smaller reference line (headline above is current). */}
      <p className="text-right text-gray-400" style={{ fontSize: '12px', marginTop: '-8px' }}>
        יתרת פתיחה: {formatILS(openingBalance)}
        {supplier.openingBalanceDate ? ` · ${fmtDate(supplier.openingBalanceDate)}` : ''}
      </p>

      {/* ── כרטסת (ledger) ── */}
      {ledger.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
          <SectionHeader
            className="px-5 py-4 border-b"
            style={{ borderColor: '#E2E4E9', cursor: onViewLedger ? 'pointer' : 'default' }}
            onClick={onViewLedger}
            hoverBg={onViewLedger ? '#FAFAFC' : undefined}
            title={<><h2 className="font-bold text-gray-800">כרטסת</h2><CreditCard className="w-4 h-4 text-gray-400" /></>}
            action={onViewLedger ? <span className="text-sm font-semibold" style={{ color: 'var(--brand-primary)' }}>פתח כרטסת ←</span> : undefined}
          />
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
      )}

      {/* ── Invoices ── */}
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
              const st = invoiceStatusStyle[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
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
                  <div className="flex justify-center">
                    <span className="rounded-lg font-bold" style={{ ...st, fontSize: '12px', padding: '4px 10px' }}>
                      {inv.status}
                    </span>
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

      {/* ── Payments ── */}
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

      {/* ── Delete button ── */}
      <div className="flex justify-start pt-1 pb-2">
        <Button variant="danger" onClick={handleDeleteClick}>
          <Trash2 className="w-4 h-4" />
          מחק ספק
        </Button>
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
