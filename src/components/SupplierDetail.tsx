import { useState, useEffect } from 'react'
import { FileText, CreditCard, Pencil, User, Phone, Mail, Hash, Tag, MessageSquare, Trash2, AlertCircle, AlertTriangle } from 'lucide-react'
import { mockInvoices, mockPayments } from '../data/mockData'

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
}

const invoiceStatusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: '#FEF9C3', color: '#A16207' },
  'שולם':   { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#DBEAFE', color: '#1E40AF' },
}

function formatILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

function parseDate(d: string) {
  const [day, month, year] = d.split('/').map(Number)
  return new Date(year, month - 1, day).getTime()
}

export default function SupplierDetail({ supplier, onBack, onEdit, onDelete }: Props) {
  const isTablet = useIsTablet()
  const [modal, setModal] = useState<null | 'blocked' | 'confirm'>(null)

  const invoices = mockInvoices.filter((inv) => inv.supplier === supplier.name)
  const payments = mockPayments.filter((pay) => pay.supplier === supplier.name)

  const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0)
  const paidAmount    = invoices.filter((i) => i.status === 'שולם').reduce((s, i) => s + i.amount, 0)
  const pendingAmount = invoices.filter((i) => i.status === 'ממתין').reduce((s, i) => s + i.amount, 0)

  // Build ledger: invoices = debit, payments = credit, sorted by date
  const rawEntries = [
    ...invoices.map((inv) => ({
      id: inv.id,
      date: inv.date,
      description: `חשבונית ${inv.id}`,
      debit: inv.amount,
      credit: 0,
    })),
    ...payments.map((pay) => ({
      id: pay.id,
      date: pay.dueDate,
      description: `תשלום · ${pay.method}`,
      debit: 0,
      credit: pay.amount,
    })),
  ].sort((a, b) => parseDate(a.date) - parseDate(b.date))

  let running = 0
  const ledger = rawEntries.map((e) => {
    running += e.debit - e.credit
    return { ...e, balance: running }
  })

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
      <div className="flex items-center justify-between gap-4">
        {/* RIGHT (first in RTL): name + status */}
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

        {/* LEFT (last in RTL): action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onEdit}
            className="flex items-center gap-2 rounded-xl font-semibold transition-all"
            style={{ minHeight: '44px', padding: '0 18px', background: '#FFF0EF', color: '#E8645A', fontSize: fs('16px', '14px') }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FFE4E2')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#FFF0EF')}
          >
            <Pencil className="w-4 h-4" />
            עריכה
          </button>
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
      </div>

      {/* ── פרטי קשר ── */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <div
          className="px-5 py-3.5 flex items-center justify-end gap-2 border-b"
          style={{ borderColor: '#E2E4E9', background: '#FDFAFA' }}
        >
          <h2 className="font-bold text-gray-800" style={{ fontSize: fs('16px', '15px') }}>פרטי קשר</h2>
          <User className="w-4 h-4 text-gray-400" />
        </div>

        {/* Field rows */}
        {[
          { Icon: User,         label: 'שם איש קשר', value: supplier.contact,       ltr: false },
          { Icon: Phone,        label: 'טלפון',       value: supplier.phone,         ltr: true  },
          { Icon: Mail,         label: 'מייל',         value: supplier.email ?? '',   ltr: true  },
          { Icon: Hash,         label: 'ח.פ / ע.מ',  value: supplier.hp ?? '',       ltr: true  },
          { Icon: Tag,          label: 'קטגוריה',     value: supplier.category,      ltr: false },
        ].map(({ Icon, label, value }, i) => (
          <div
            key={label}
            className="flex items-center justify-between px-5"
            style={{ minHeight: '52px', borderTop: i > 0 ? '1px solid #E2E4E9' : undefined }}
          >
            {/* Value — LEFT (end in RTL) */}
            <span
              style={{
                fontSize: fs('15px', '14px'),
                color: value ? '#1F2937' : '#9CA3AF',
                fontWeight: value ? 500 : 400,
              }}
            >
              {value || '—'}
            </span>

            {/* Icon + Label — RIGHT (start in RTL) */}
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <span className="text-gray-400" style={{ fontSize: '13px' }}>{label}</span>
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: '#F8F9FA' }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: '#8B1A3A' }} />
              </div>
            </div>
          </div>
        ))}

        {/* הערות — full-width block */}
        <div style={{ borderTop: '1px solid #E2E4E9' }}>
          {supplier.notes ? (
            <div className="px-5 py-4">
              <div className="flex items-center justify-end gap-2.5 mb-2">
                <span className="text-gray-400" style={{ fontSize: '13px' }}>הערות</span>
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: '#F8F9FA' }}
                >
                  <MessageSquare className="w-3.5 h-3.5" style={{ color: '#8B1A3A' }} />
                </div>
              </div>
              <p
                className="text-right leading-relaxed"
                style={{ fontSize: fs('15px', '14px'), color: '#374151' }}
              >
                {supplier.notes}
              </p>
            </div>
          ) : (
            <div
              className="flex items-center justify-between px-5"
              style={{ minHeight: '52px' }}
            >
              <span style={{ fontSize: fs('15px', '14px'), color: '#9CA3AF' }}>—</span>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <span className="text-gray-400" style={{ fontSize: '13px' }}>הערות</span>
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: '#F8F9FA' }}
                >
                  <MessageSquare className="w-3.5 h-3.5" style={{ color: '#8B1A3A' }} />
                </div>
              </div>
            </div>
          )}
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
          { label: 'סה"כ חשבוניות', value: formatILS(totalInvoiced),    color: '#1F2937' },
          { label: 'שולם',          value: formatILS(paidAmount),        color: '#166534' },
          { label: 'ממתין לתשלום', value: formatILS(pendingAmount),      color: '#A16207' },
          { label: 'יתרה פתוחה',   value: formatILS(supplier.balance),  color: '#E8645A' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#E2E4E9' }}>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: fs('15px', '13px') }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── כרטסת (ledger) ── */}
      {ledger.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
          <div className="px-5 py-4 border-b flex items-center justify-end gap-2" style={{ borderColor: '#E2E4E9' }}>
            <h2 className="font-bold text-gray-800">כרטסת</h2>
            <CreditCard className="w-4 h-4 text-gray-400" />
          </div>
          {/* Table header */}
          <div style={{ overflowX: 'auto' }}>
          <div
            className="grid px-5 py-2 border-b font-semibold text-gray-400 uppercase tracking-wider"
            style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', borderColor: '#E2E4E9', fontSize: '11px', minWidth: '480px' }}
          >
            <span className="text-right">יתרה</span>
            <span className="text-right">תיאור</span>
            <span className="text-center">זכות</span>
            <span className="text-center">חובה</span>
            <span className="text-right">תאריך</span>
          </div>
          {ledger.map((entry, i) => (
            <div
              key={entry.id}
              className="grid px-5 py-3 items-center"
              style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', minWidth: '480px', borderTop: i > 0 ? '1px solid #E2E4E9' : undefined }}
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
              <span className="text-right text-gray-400" style={{ fontSize: '12px' }}>{entry.date}</span>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* ── Invoices ── */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <div className="px-5 py-4 border-b flex items-center justify-end gap-2" style={{ borderColor: '#E2E4E9' }}>
          <h2 className="font-bold text-gray-800">חשבוניות</h2>
          <FileText className="w-4 h-4 text-gray-400" />
        </div>
        {invoices.length === 0 ? (
          <p className="text-center text-gray-400 py-8" style={{ fontSize: '15px' }}>אין חשבוניות עבור ספק זה</p>
        ) : (
          <div>
            {invoices.map((inv, i) => {
              const st = invoiceStatusStyle[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between"
                  style={{ padding: fs('16px 20px', '13px 20px'), borderTop: i > 0 ? '1px solid #E2E4E9' : undefined }}
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg font-bold" style={{ ...st, fontSize: '12px', padding: '4px 10px' }}>
                      {inv.status}
                    </span>
                    <span className="font-black text-gray-800" style={{ fontSize: fs('17px', '15px') }}>
                      {formatILS(inv.amount)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400" style={{ fontSize: '12px' }}>{inv.id} · {inv.date}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Payments ── */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <div className="px-5 py-4 border-b flex items-center justify-end gap-2" style={{ borderColor: '#E2E4E9' }}>
          <h2 className="font-bold text-gray-800">תשלומים</h2>
          <CreditCard className="w-4 h-4 text-gray-400" />
        </div>
        {payments.length === 0 ? (
          <p className="text-center text-gray-400 py-8" style={{ fontSize: '15px' }}>אין תשלומים עבור ספק זה</p>
        ) : (
          <div>
            {payments.map((pay, i) => (
              <div
                key={pay.id}
                className="flex items-center justify-between"
                style={{ padding: fs('16px 20px', '13px 20px'), borderTop: i > 0 ? '1px solid #E2E4E9' : undefined }}
              >
                <div>
                  <p className="text-gray-600 font-medium" style={{ fontSize: '13px' }}>{pay.method}</p>
                  <p className="text-gray-400" style={{ fontSize: '12px' }}>פירעון: {pay.dueDate}</p>
                </div>
                <div className="text-right">
                  <p className="font-black text-gray-800" style={{ fontSize: fs('17px', '15px') }}>
                    {formatILS(pay.amount)}
                  </p>
                  <p className="text-gray-400" style={{ fontSize: '12px' }}>{pay.id}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Delete button ── */}
      <div className="flex justify-start pt-1 pb-2">
        <button
          onClick={handleDeleteClick}
          className="flex items-center gap-2 rounded-xl font-semibold transition-all"
          style={{
            minHeight: '44px', padding: '0 20px',
            background: '#FFF1F2', color: '#BE123C',
            fontSize: fs('15px', '14px'),
            border: '1px solid #FECDD3',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = '#FFE4E8'
            ;(e.currentTarget as HTMLElement).style.borderColor = '#FCA5A5'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = '#FFF1F2'
            ;(e.currentTarget as HTMLElement).style.borderColor = '#FECDD3'
          }}
        >
          <Trash2 className="w-4 h-4" />
          מחק ספק
        </button>
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
                <button
                  onClick={() => setModal(null)}
                  className="w-full rounded-xl font-semibold transition-all"
                  style={{ minHeight: '44px', background: '#F3F4F6', color: '#374151', fontSize: '15px' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
                >
                  הבנתי
                </button>
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
                  <button
                    onClick={handleConfirmDelete}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all"
                    style={{ minHeight: '44px', background: '#BE123C', color: 'white', fontSize: '15px' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#9F1239')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#BE123C')}
                  >
                    <Trash2 className="w-4 h-4" />
                    מחק
                  </button>
                  <button
                    onClick={() => setModal(null)}
                    className="flex-1 rounded-xl font-semibold transition-all"
                    style={{ minHeight: '44px', background: '#F3F4F6', color: '#374151', fontSize: '15px' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
