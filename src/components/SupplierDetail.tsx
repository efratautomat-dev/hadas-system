import { useState, useEffect } from 'react'
import { FileText, CreditCard, Pencil } from 'lucide-react'
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
}

interface Props {
  supplier: Supplier
  onBack: () => void
  onEdit: () => void
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

export default function SupplierDetail({ supplier, onBack, onEdit }: Props) {
  const isTablet = useIsTablet()

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

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        {/* RIGHT (first in RTL): name + status */}
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="rounded-lg font-semibold flex-shrink-0"
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

      {/* ── Info grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'קטגוריה',       value: supplier.category },
          { label: 'תנאי תשלום',   value: supplier.paymentTerms },
          { label: 'הזמנה אחרונה', value: supplier.lastOrderDate || '—' },
          { label: 'מזהה ספק',     value: supplier.id },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl px-4 py-3 shadow-sm border text-right" style={{ borderColor: '#F0E8E7' }}>
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
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#F0E8E7' }}>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: fs('15px', '13px') }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── כרטסת (ledger) ── */}
      {ledger.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#F0E8E7' }}>
          <div className="px-5 py-4 border-b flex items-center justify-end gap-2" style={{ borderColor: '#F5EEEE' }}>
            <h2 className="font-bold text-gray-800">כרטסת</h2>
            <CreditCard className="w-4 h-4 text-gray-400" />
          </div>
          {/* Table header */}
          <div
            className="grid px-5 py-2 border-b font-semibold text-gray-400 uppercase tracking-wider"
            style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', borderColor: '#F5EEEE', fontSize: '11px' }}
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
              style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr', borderTop: i > 0 ? '1px solid #F5EEEE' : undefined }}
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
      )}

      {/* ── Invoices ── */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#F0E8E7' }}>
        <div className="px-5 py-4 border-b flex items-center justify-end gap-2" style={{ borderColor: '#F5EEEE' }}>
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
                  style={{ padding: fs('16px 20px', '13px 20px'), borderTop: i > 0 ? '1px solid #F5EEEE' : undefined }}
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg font-semibold" style={{ ...st, fontSize: '12px', padding: '4px 10px' }}>
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
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#F0E8E7' }}>
        <div className="px-5 py-4 border-b flex items-center justify-end gap-2" style={{ borderColor: '#F5EEEE' }}>
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
                style={{ padding: fs('16px 20px', '13px 20px'), borderTop: i > 0 ? '1px solid #F5EEEE' : undefined }}
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

    </div>
  )
}
