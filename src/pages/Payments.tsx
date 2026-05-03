import { useState, useEffect, useRef } from 'react'
import { Plus, Search, Pencil, X, RotateCcw, CreditCard } from 'lucide-react'

// ─── types ───────────────────────────────────────────────────────────────────

type PaymentType = 'transfer' | 'check' | 'cash' | 'credit'
type PaymentStatus = 'paid' | 'pending' | 'cancelled'

interface Payment {
  id: number
  supplier: string
  amount: number
  type: PaymentType
  date: string        // YYYY-MM-DD
  ref: string
  valueDate: string | null
  notes: string
  status: PaymentStatus
}

interface FormState {
  supplier: string
  amount: string
  type: PaymentType | ''
  date: string
  ref: string
  valueDate: string
  notes: string
}

interface EditForm {
  supplier: string
  amount: string
  type: PaymentType
  date: string
  ref: string
  valueDate: string
  notes: string
  status: PaymentStatus
}

interface Toast {
  id: number
  msg: string
  type: 'success' | 'warning' | 'error'
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function daysFromToday(dateStr: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 86_400_000)
}

function fmtILS(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

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

// ─── constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<PaymentType, string> = {
  transfer: 'העברה',
  check: "צ'ק",
  cash: 'מזומן',
  credit: 'אשראי',
}

const TYPE_EMOJI: Record<PaymentType, string> = {
  transfer: '🏦',
  check: '📄',
  cash: '💵',
  credit: '💳',
}

const TYPE_COLORS: Record<PaymentType, { bg: string; color: string; accent: string }> = {
  transfer: { bg: '#EFF6FF', color: '#1D4ED8', accent: '#1D4ED8' },
  check:    { bg: '#FEF3C7', color: '#92400E', accent: '#D97706' },
  cash:     { bg: '#F0FDF4', color: '#16A34A', accent: '#16A34A' },
  credit:   { bg: '#F5F3FF', color: '#7C3AED', accent: '#7C3AED' },
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'שולם',
  pending: 'ממתין',
  cancelled: 'בוטל',
}

const STATUS_COLORS: Record<PaymentStatus, { bg: string; color: string }> = {
  paid:      { bg: '#F0FDF4', color: '#16A34A' },
  pending:   { bg: '#FEF3C7', color: '#92400E' },
  cancelled: { bg: '#F3F4F6', color: '#6B7280' },
}

const EMPTY_FORM: FormState = {
  supplier: '',
  amount: '',
  type: '',
  date: todayStr(),
  ref: '',
  valueDate: '',
  notes: '',
}

// ─── mock data ────────────────────────────────────────────────────────────────

const INITIAL_PAYMENTS: Payment[] = [
  {
    id: 1,
    supplier: 'תנובה',
    amount: 45200,
    type: 'transfer',
    date: '2026-04-24',
    ref: 'TRF-2026-001',
    valueDate: null,
    notes: 'תשלום חודשי מוצרי חלב',
    status: 'paid',
  },
  {
    id: 2,
    supplier: 'תבורי בע"מ',
    amount: 12500,
    type: 'check',
    date: '2026-04-29',
    ref: 'CHK-1042',
    valueDate: '2026-05-08',
    notes: 'משקאות קמעוני',
    status: 'pending',
  },
  {
    id: 3,
    supplier: 'מקורות מים',
    amount: 8300,
    type: 'cash',
    date: '2026-05-01',
    ref: 'קבלה 0088',
    valueDate: null,
    notes: '',
    status: 'paid',
  },
  {
    id: 4,
    supplier: 'נסטלה ישראל',
    amount: 23100,
    type: 'credit',
    date: '2026-05-02',
    ref: 'CC-5544',
    valueDate: '2026-05-26',
    notes: 'שתייה חמה ומשלימים',
    status: 'pending',
  },
  {
    id: 5,
    supplier: 'אסם השקעות',
    amount: 6800,
    type: 'transfer',
    date: '2026-04-20',
    ref: 'TRF-2026-005',
    valueDate: null,
    notes: '',
    status: 'paid',
  },
  {
    id: 6,
    supplier: 'עלית',
    amount: 3200,
    type: 'check',
    date: '2026-05-03',
    ref: 'CHK-1043',
    valueDate: '2026-05-07',
    notes: 'ממתקים חודש מאי',
    status: 'pending',
  },
]

// ─── sub-components ───────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: PaymentType }) {
  const c = TYPE_COLORS[type]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-lg font-medium"
      style={{ background: c.bg, color: c.color, fontSize: '12px', padding: '3px 9px' }}
    >
      {TYPE_EMOJI[type]} {TYPE_LABELS[type]}
    </span>
  )
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const c = STATUS_COLORS[status]
  return (
    <span
      className="inline-flex items-center rounded-lg font-medium"
      style={{ background: c.bg, color: c.color, fontSize: '12px', padding: '3px 9px' }}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

export default function Payments() {
  const isTablet = useIsTablet()
  const nextIdRef = useRef(INITIAL_PAYMENTS.length + 1)
  const toastIdRef = useRef(0)

  const [payments, setPayments] = useState<Payment[]>(INITIAL_PAYMENTS)
  const [activeTab, setActiveTab] = useState<'all' | 'future'>('all')
  const [showForm, setShowForm] = useState(true)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const [fltSupplier, setFltSupplier] = useState('')
  const [fltType, setFltType] = useState('')
  const [fltMonth, setFltMonth] = useState('')
  const [fltStatus, setFltStatus] = useState('')

  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)

  const [confirmId, setConfirmId] = useState<number | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])

  // ── derived ──────────────────────────────────────────────────────────────

  const filtered = payments.filter((p) => {
    if (fltSupplier && !p.supplier.includes(fltSupplier)) return false
    if (fltType && p.type !== fltType) return false
    if (fltMonth && !p.date.startsWith(fltMonth)) return false
    if (fltStatus && p.status !== fltStatus) return false
    return true
  })

  const futurePayments = payments
    .filter((p) => p.status !== 'cancelled' && p.valueDate && daysFromToday(p.valueDate) > 0)
    .sort((a, b) => new Date(a.valueDate!).getTime() - new Date(b.valueDate!).getTime())

  const futureTotal = futurePayments.reduce((s, p) => s + p.amount, 0)
  const activeTotal = payments
    .filter((p) => p.status !== 'cancelled')
    .reduce((s, p) => s + p.amount, 0)

  const monthOptions = [...new Set(payments.map((p) => p.date.slice(0, 7)))].sort().reverse()

  const needsValueDate = form.type === 'check' || form.type === 'credit'
  const needsEditValueDate = editForm?.type === 'check' || editForm?.type === 'credit'

  // ── handlers ─────────────────────────────────────────────────────────────

  function showToast(msg: string, type: Toast['type'] = 'success') {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, msg, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.type) return
    const p: Payment = {
      id: nextIdRef.current++,
      supplier: form.supplier.trim(),
      amount: parseFloat(form.amount),
      type: form.type as PaymentType,
      date: form.date,
      ref: form.ref.trim(),
      valueDate: needsValueDate ? form.valueDate || null : null,
      notes: form.notes.trim(),
      status:
        form.valueDate && needsValueDate && daysFromToday(form.valueDate) > 0
          ? 'pending'
          : 'paid',
    }
    setPayments((prev) => [p, ...prev])
    setForm({ ...EMPTY_FORM, date: todayStr() })
    showToast('✅ תשלום נוסף בהצלחה')
  }

  function openEdit(id: number) {
    const p = payments.find((x) => x.id === id)
    if (!p) return
    setEditId(id)
    setEditForm({
      supplier: p.supplier,
      amount: String(p.amount),
      type: p.type,
      date: p.date,
      ref: p.ref,
      valueDate: p.valueDate ?? '',
      notes: p.notes,
      status: p.status,
    })
  }

  function closeEdit() {
    setEditId(null)
    setEditForm(null)
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId || !editForm) return
    setPayments((prev) =>
      prev.map((p) =>
        p.id === editId
          ? {
              ...p,
              supplier: editForm.supplier.trim(),
              amount: parseFloat(editForm.amount),
              type: editForm.type,
              date: editForm.date,
              ref: editForm.ref.trim(),
              valueDate:
                editForm.type === 'check' || editForm.type === 'credit'
                  ? editForm.valueDate || null
                  : null,
              notes: editForm.notes.trim(),
              status: editForm.status,
            }
          : p
      )
    )
    closeEdit()
    showToast('💾 תשלום עודכן בהצלחה')
  }

  function doCancel() {
    if (!confirmId) return
    setPayments((prev) =>
      prev.map((p) => (p.id === confirmId ? { ...p, status: 'cancelled' } : p))
    )
    setConfirmId(null)
    showToast('🚫 תשלום בוטל', 'warning')
  }

  function handleRestore(id: number) {
    setPayments((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              status:
                p.valueDate && daysFromToday(p.valueDate) > 0 ? 'pending' : 'paid',
            }
          : p
      )
    )
    showToast('↩️ תשלום שוחזר')
  }

  // ── shared style helpers ─────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    border: '1.5px solid #F0E8E7',
    borderRadius: '10px',
    padding: isTablet ? '11px 14px' : '9px 12px',
    fontSize: isTablet ? '16px' : '14px',
    background: 'white',
    color: '#1F2937',
    width: '100%',
    direction: 'rtl',
    outline: 'none',
    minHeight: isTablet ? '48px' : '40px',
    fontFamily: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6B7280',
    marginBottom: '5px',
    display: 'block',
  }

  // ── days-chip helper ──────────────────────────────────────────────────────

  function DaysChip({ days }: { days: number }) {
    const label =
      days === 0 ? 'היום' : days === 1 ? 'מחר' : `${days} ימים`
    const style: React.CSSProperties =
      days <= 3
        ? { background: '#FEF2F2', color: '#DC2626' }
        : days <= 7
        ? { background: '#FEF3C7', color: '#92400E' }
        : days <= 30
        ? { background: '#FFF7ED', color: '#C2410C' }
        : { background: '#EFF6FF', color: '#1D4ED8' }
    return (
      <span
        className="rounded-xl font-bold whitespace-nowrap text-center"
        style={{ ...style, fontSize: '13px', padding: '5px 12px' }}
      >
        {label}
      </span>
    )
  }

  // ── render: payment card row ──────────────────────────────────────────────

  function PaymentRow({ p }: { p: Payment }) {
    const tc = TYPE_COLORS[p.type]
    const isCancelled = p.status === 'cancelled'
    const isFutureValue = p.valueDate && daysFromToday(p.valueDate) > 0

    return (
      <div
        className="flex items-center gap-3 bg-white rounded-2xl transition-all cursor-pointer"
        style={{
          border: `1.5px solid #F0E8E7`,
          borderRight: `4px solid ${tc.accent}`,
          padding: isTablet ? '14px 16px' : '12px 14px',
          minHeight: isTablet ? '72px' : undefined,
          opacity: isCancelled ? 0.55 : 1,
        }}
        onClick={() => openEdit(p.id)}
        onMouseEnter={(e) =>
          !isCancelled &&
          ((e.currentTarget as HTMLElement).style.borderColor = tc.accent)
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.borderColor = '#F0E8E7')
        }
      >
        {/* Icon */}
        <div
          className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: tc.bg,
            width: isTablet ? '48px' : '42px',
            height: isTablet ? '48px' : '42px',
            fontSize: isTablet ? '22px' : '18px',
          }}
        >
          {TYPE_EMOJI[p.type]}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center justify-end gap-2 mb-1 flex-wrap">
            {isFutureValue && (
              <span
                className="rounded-lg font-medium"
                style={{
                  background: '#FEF3C7',
                  color: '#92400E',
                  fontSize: '11px',
                  padding: '2px 8px',
                }}
              >
                📅 ערך {fmtDate(p.valueDate)}
              </span>
            )}
            <StatusBadge status={p.status} />
            <TypeBadge type={p.type} />
            <p
              className="font-bold text-gray-800 truncate"
              style={{ fontSize: isTablet ? '16px' : '14px' }}
            >
              {p.supplier}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 flex-wrap">
            <span className="text-gray-400" style={{ fontSize: '12px' }}>
              {fmtDate(p.date)}
            </span>
            {p.ref && (
              <span className="text-gray-400" style={{ fontSize: '12px' }}>
                🔖 {p.ref}
              </span>
            )}
            {p.notes && (
              <span className="text-gray-400 truncate" style={{ fontSize: '12px', maxWidth: '180px' }}>
                {p.notes}
              </span>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="text-left flex-shrink-0 px-2">
          <p className="font-black text-gray-900" style={{ fontSize: isTablet ? '18px' : '16px' }}>
            {fmtILS(p.amount)}
          </p>
        </div>

        {/* Actions */}
        <div
          className="flex flex-col gap-1.5 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="rounded-lg flex items-center justify-center text-gray-400 transition-colors"
            style={{ background: '#FFF0EF', width: isTablet ? '44px' : '36px', height: isTablet ? '36px' : '32px' }}
            onClick={() => openEdit(p.id)}
            title="עריכה"
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#E8645A')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
          >
            <Pencil className="w-4 h-4" />
          </button>
          {isCancelled ? (
            <button
              className="rounded-lg flex items-center justify-center text-gray-400 transition-colors"
              style={{ background: '#F0FDF4', width: isTablet ? '44px' : '36px', height: isTablet ? '36px' : '32px' }}
              onClick={() => handleRestore(p.id)}
              title="שחזור"
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#16A34A')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          ) : (
            <button
              className="rounded-lg flex items-center justify-center text-gray-400 transition-colors"
              style={{ background: '#FEF2F2', width: isTablet ? '44px' : '36px', height: isTablet ? '36px' : '32px' }}
              onClick={() => setConfirmId(p.id)}
              title="ביטול"
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#DC2626')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── render: future card ────────────────────────────────────────────────────

  function FutureRow({ p }: { p: Payment }) {
    const days = daysFromToday(p.valueDate!)
    const borderColor = days <= 7 ? '#DC2626' : days <= 30 ? '#D97706' : '#1D4ED8'
    const tc = TYPE_COLORS[p.type]

    return (
      <div
        className="flex items-center gap-3 bg-white rounded-2xl transition-all cursor-pointer"
        style={{
          border: `1.5px solid ${borderColor}`,
          padding: isTablet ? '14px 16px' : '12px 14px',
          minHeight: isTablet ? '72px' : undefined,
        }}
        onClick={() => openEdit(p.id)}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.boxShadow =
            '0 4px 12px rgba(0,0,0,.08)')
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.boxShadow = 'none')
        }
      >
        <div
          className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: tc.bg,
            width: isTablet ? '48px' : '42px',
            height: isTablet ? '48px' : '42px',
            fontSize: isTablet ? '22px' : '18px',
          }}
        >
          {TYPE_EMOJI[p.type]}
        </div>

        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center justify-end gap-2 mb-1">
            <TypeBadge type={p.type} />
            <p className="font-bold text-gray-800" style={{ fontSize: isTablet ? '16px' : '14px' }}>
              {p.supplier}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 flex-wrap">
            <span className="text-gray-400" style={{ fontSize: '12px' }}>
              📅 ערך: {fmtDate(p.valueDate)}
            </span>
            <span className="text-gray-400" style={{ fontSize: '12px' }}>
              תשלום: {fmtDate(p.date)}
            </span>
            {p.ref && (
              <span className="text-gray-400" style={{ fontSize: '12px' }}>
                🔖 {p.ref}
              </span>
            )}
          </div>
        </div>

        <div className="text-left flex-shrink-0 px-2">
          <p className="font-black text-gray-900" style={{ fontSize: isTablet ? '18px' : '16px' }}>
            {fmtILS(p.amount)}
          </p>
        </div>

        <div className="flex-shrink-0">
          <DaysChip days={days} />
        </div>
      </div>
    )
  }

  // ── future groups ─────────────────────────────────────────────────────────

  const urgentList = futurePayments.filter((p) => daysFromToday(p.valueDate!) <= 7)
  const soonList = futurePayments.filter((p) => {
    const d = daysFromToday(p.valueDate!)
    return d > 7 && d <= 30
  })
  const laterList = futurePayments.filter((p) => daysFromToday(p.valueDate!) > 30)

  // ─────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5" style={{ direction: 'rtl' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div
          className="flex gap-3 flex-wrap"
          style={{ fontSize: isTablet ? '14px' : '13px' }}
        >
          <div
            className="rounded-xl px-4 py-2 font-semibold"
            style={{ background: '#EFF6FF', color: '#1D4ED8' }}
          >
            סה"כ פעיל: {fmtILS(activeTotal)}
          </div>
          <div
            className="rounded-xl px-4 py-2 font-semibold"
            style={{ background: '#FEF3C7', color: '#92400E' }}
          >
            עתידי: {fmtILS(futureTotal)}
          </div>
          <div
            className="rounded-xl px-4 py-2 font-semibold"
            style={{ background: '#FFF0EF', color: '#8B1A3A' }}
          >
            {futurePayments.length} תשלומים ממתינים
          </div>
        </div>
        <div className="text-right">
          <h1 className="font-black text-gray-800" style={{ fontSize: isTablet ? '24px' : '22px' }}>
            תשלומים
          </h1>
          <p className="text-gray-400 mt-0.5" style={{ fontSize: isTablet ? '15px' : '13px' }}>
            {payments.length} תשלומים במערכת
          </p>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div
        className="flex gap-1 p-1 rounded-xl"
        style={{ background: '#F3F4F6', width: 'fit-content' }}
      >
        {(
          [
            { id: 'all', label: 'כל התשלומים', count: null },
            { id: 'future', label: 'תשלומים עתידיים', count: futurePayments.length },
          ] as const
        ).map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-2 rounded-lg font-semibold transition-all"
            style={{
              padding: isTablet ? '10px 18px' : '8px 16px',
              fontSize: isTablet ? '15px' : '14px',
              minHeight: isTablet ? '44px' : '38px',
              background: activeTab === id ? 'white' : 'transparent',
              color: activeTab === id ? '#8B1A3A' : '#6B7280',
              boxShadow: activeTab === id ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
            }}
          >
            {label}
            {count !== null && count > 0 && (
              <span
                className="rounded-full font-bold text-white"
                style={{
                  background: '#E8A020',
                  fontSize: '11px',
                  padding: '1px 7px',
                  minWidth: '20px',
                  textAlign: 'center',
                }}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: ALL ─────────────────────────────────────────────────────── */}
      {activeTab === 'all' && (
        <>
          {/* Add form card */}
          <div
            className="bg-white rounded-2xl shadow-sm border overflow-hidden"
            style={{ borderColor: '#F0E8E7' }}
          >
            <div
              className="flex items-center justify-between px-5 py-3 border-b"
              style={{ borderColor: '#F5EEEE', background: '#FFF8F7' }}
            >
              <button
                className="text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
                style={{ color: '#8B1A3A', background: '#FFF0EF' }}
                onClick={() => setShowForm((v) => !v)}
              >
                {showForm ? 'הסתר' : 'הצג'}
              </button>
              <div className="flex items-center gap-2 font-bold text-gray-700">
                הוספת תשלום חדש
                <Plus className="w-4 h-4" style={{ color: '#8B1A3A' }} />
              </div>
            </div>

            {showForm && (
              <form onSubmit={handleAddSubmit} className="p-5">
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: isTablet
                      ? 'repeat(2, 1fr)'
                      : 'repeat(3, 1fr)',
                  }}
                >
                  {/* Supplier */}
                  <div>
                    <label style={labelStyle}>
                      ספק <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      type="text"
                      placeholder="שם הספק"
                      value={form.supplier}
                      onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                      required
                      onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                      onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label style={labelStyle}>
                      סכום (₪) <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      type="number"
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      required
                      onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                      onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label style={labelStyle}>
                      סוג תשלום <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <select
                      style={inputStyle}
                      value={form.type}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          type: e.target.value as PaymentType | '',
                          valueDate: '',
                        }))
                      }
                      required
                      onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                      onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                    >
                      <option value="">— בחר סוג —</option>
                      <option value="transfer">🏦 העברה בנקאית</option>
                      <option value="check">📄 צ'ק</option>
                      <option value="cash">💵 מזומן</option>
                      <option value="credit">💳 אשראי</option>
                    </select>
                  </div>

                  {/* Date */}
                  <div>
                    <label style={labelStyle}>
                      תאריך תשלום <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <input
                      style={inputStyle}
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      required
                      onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                      onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                    />
                  </div>

                  {/* Ref */}
                  <div>
                    <label style={labelStyle}>אסמכתא / מס' מסמך</label>
                    <input
                      style={inputStyle}
                      type="text"
                      placeholder="מס' צ'ק / אסמכתא..."
                      value={form.ref}
                      onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))}
                      onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                      onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                    />
                  </div>

                  {/* Value date (conditional) */}
                  {needsValueDate && (
                    <div>
                      <label style={labelStyle}>
                        תאריך ערך <span style={{ color: '#DC2626' }}>*</span>
                      </label>
                      <input
                        style={inputStyle}
                        type="date"
                        value={form.valueDate}
                        onChange={(e) => setForm((f) => ({ ...f, valueDate: e.target.value }))}
                        required
                        onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                        onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                      />
                    </div>
                  )}

                  {/* Notes */}
                  <div style={{ gridColumn: isTablet ? '1 / -1' : needsValueDate ? '1 / -1' : undefined }}>
                    <label style={labelStyle}>הערות</label>
                    <input
                      style={inputStyle}
                      type="text"
                      placeholder="הערות נוספות..."
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                      onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-5">
                  <button
                    type="submit"
                    className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all"
                    style={{
                      background: 'linear-gradient(135deg, #8B1A3A, #E8645A)',
                      padding: isTablet ? '12px 24px' : '10px 20px',
                      fontSize: isTablet ? '16px' : '14px',
                      minHeight: '44px',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                  >
                    <Plus className="w-4 h-4" />
                    שמור תשלום
                  </button>
                  <button
                    type="button"
                    className="rounded-xl font-semibold transition-all"
                    style={{
                      border: '1.5px solid #F0E8E7',
                      background: 'white',
                      color: '#6B7280',
                      padding: isTablet ? '12px 20px' : '10px 16px',
                      fontSize: isTablet ? '16px' : '14px',
                      minHeight: '44px',
                    }}
                    onClick={() => setForm({ ...EMPTY_FORM, date: todayStr() })}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F9FAFB')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
                  >
                    נקה
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Filters card */}
          <div
            className="bg-white rounded-2xl shadow-sm border"
            style={{ borderColor: '#F0E8E7' }}
          >
            <div
              className="flex items-center justify-between px-5 py-3 border-b"
              style={{ borderColor: '#F5EEEE', background: '#FFF8F7' }}
            >
              <span className="text-gray-400" style={{ fontSize: '13px' }}>
                {filtered.length} תשלומים
                {filtered.length !== payments.length && ` מתוך ${payments.length}`}
              </span>
              <div className="flex items-center gap-2 font-bold text-gray-700">
                סינון ומיון
                <Search className="w-4 h-4 text-gray-400" />
              </div>
            </div>
            <div
              className="p-4 flex gap-3 flex-wrap"
              style={{ alignItems: 'flex-end' }}
            >
              {/* Supplier search */}
              <div className="flex flex-col gap-1" style={{ flex: '1 1 150px' }}>
                <label style={labelStyle}>ספק</label>
                <div
                  className="flex items-center gap-2 bg-white rounded-xl border px-3"
                  style={{
                    borderColor: '#F0E8E7',
                    minHeight: isTablet ? '44px' : '38px',
                  }}
                >
                  <Search className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="חיפוש..."
                    value={fltSupplier}
                    onChange={(e) => setFltSupplier(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-right text-gray-700"
                    style={{ fontSize: isTablet ? '15px' : '14px' }}
                  />
                </div>
              </div>

              {/* Type */}
              <div className="flex flex-col gap-1" style={{ flex: '1 1 120px' }}>
                <label style={labelStyle}>סוג</label>
                <select
                  style={{ ...inputStyle, minHeight: isTablet ? '44px' : '38px' }}
                  value={fltType}
                  onChange={(e) => setFltType(e.target.value)}
                  onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                  onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                >
                  <option value="">הכל</option>
                  <option value="transfer">העברה</option>
                  <option value="check">צ'ק</option>
                  <option value="cash">מזומן</option>
                  <option value="credit">אשראי</option>
                </select>
              </div>

              {/* Month */}
              <div className="flex flex-col gap-1" style={{ flex: '1 1 140px' }}>
                <label style={labelStyle}>חודש</label>
                <select
                  style={{ ...inputStyle, minHeight: isTablet ? '44px' : '38px' }}
                  value={fltMonth}
                  onChange={(e) => setFltMonth(e.target.value)}
                  onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                  onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                >
                  <option value="">כל החודשים</option>
                  {monthOptions.map((m) => {
                    const [y, mo] = m.split('-')
                    const label = new Date(
                      parseInt(y),
                      parseInt(mo) - 1
                    ).toLocaleDateString('he-IL', { year: 'numeric', month: 'long' })
                    return (
                      <option key={m} value={m}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Status */}
              <div className="flex flex-col gap-1" style={{ flex: '1 1 120px' }}>
                <label style={labelStyle}>סטטוס</label>
                <select
                  style={{ ...inputStyle, minHeight: isTablet ? '44px' : '38px' }}
                  value={fltStatus}
                  onChange={(e) => setFltStatus(e.target.value)}
                  onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                  onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                >
                  <option value="">הכל</option>
                  <option value="paid">שולם</option>
                  <option value="pending">ממתין</option>
                  <option value="cancelled">בוטל</option>
                </select>
              </div>

              {(fltSupplier || fltType || fltMonth || fltStatus) && (
                <button
                  className="rounded-xl font-medium transition-all flex-shrink-0"
                  style={{
                    border: '1.5px solid #F0E8E7',
                    background: 'white',
                    color: '#6B7280',
                    padding: '0 14px',
                    minHeight: isTablet ? '44px' : '38px',
                    fontSize: '13px',
                    alignSelf: 'flex-end',
                  }}
                  onClick={() => {
                    setFltSupplier('')
                    setFltType('')
                    setFltMonth('')
                    setFltStatus('')
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FFF8F7')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
                >
                  נקה סינון
                </button>
              )}
            </div>
          </div>

          {/* Payment list */}
          {filtered.length === 0 ? (
            <div
              className="bg-white rounded-2xl shadow-sm border flex flex-col items-center justify-center py-16"
              style={{ borderColor: '#F0E8E7' }}
            >
              <CreditCard className="w-12 h-12 mb-3" style={{ color: '#F0E8E7' }} />
              <p className="text-gray-400" style={{ fontSize: '16px' }}>
                לא נמצאו תשלומים
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((p) => (
                <PaymentRow key={p.id} p={p} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── TAB: FUTURE ──────────────────────────────────────────────────── */}
      {activeTab === 'future' && (
        <div
          className="bg-white rounded-2xl shadow-sm border overflow-hidden"
          style={{ borderColor: '#F0E8E7' }}
        >
          <div
            className="px-5 py-3 border-b font-bold text-gray-700 flex items-center justify-end gap-2"
            style={{ borderColor: '#F5EEEE', background: '#FFF8F7', fontSize: isTablet ? '16px' : '14px' }}
          >
            תשלומים עתידיים — צ'קים ואשראי
            <span className="text-xl">🗓️</span>
          </div>

          <div className="p-5 space-y-6">
            {futurePayments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <span className="text-5xl mb-3">🎉</span>
                <p className="text-gray-400" style={{ fontSize: '16px' }}>
                  אין תשלומים עתידיים ממתינים
                </p>
              </div>
            ) : (
              <>
                {urgentList.length > 0 && (
                  <div>
                    <div
                      className="flex items-center justify-end gap-2 mb-3 pb-2 border-b font-bold uppercase tracking-wide"
                      style={{ borderColor: '#FEE2E2', color: '#DC2626', fontSize: '12px' }}
                    >
                      דחוף — תוך 7 ימים ({urgentList.length})
                      <span>🔴</span>
                    </div>
                    <div className="space-y-2.5">
                      {urgentList.map((p) => (
                        <FutureRow key={p.id} p={p} />
                      ))}
                    </div>
                  </div>
                )}

                {soonList.length > 0 && (
                  <div>
                    <div
                      className="flex items-center justify-end gap-2 mb-3 pb-2 border-b font-bold uppercase tracking-wide"
                      style={{ borderColor: '#FEF3C7', color: '#D97706', fontSize: '12px' }}
                    >
                      בקרוב — 8–30 ימים ({soonList.length})
                      <span>🟠</span>
                    </div>
                    <div className="space-y-2.5">
                      {soonList.map((p) => (
                        <FutureRow key={p.id} p={p} />
                      ))}
                    </div>
                  </div>
                )}

                {laterList.length > 0 && (
                  <div>
                    <div
                      className="flex items-center justify-end gap-2 mb-3 pb-2 border-b font-bold uppercase tracking-wide"
                      style={{ borderColor: '#DCFCE7', color: '#16A34A', fontSize: '12px' }}
                    >
                      מאוחר יותר — מעל 30 יום ({laterList.length})
                      <span>🟢</span>
                    </div>
                    <div className="space-y-2.5">
                      {laterList.map((p) => (
                        <FutureRow key={p.id} p={p} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Total */}
                <div
                  className="flex items-center justify-between rounded-xl px-5 py-4 mt-2"
                  style={{ background: '#FFF8F7', border: '1.5px solid #F0E8E7' }}
                >
                  <p className="font-black text-gray-900" style={{ fontSize: isTablet ? '22px' : '20px' }}>
                    {fmtILS(futureTotal)}
                  </p>
                  <p className="font-semibold text-gray-500" style={{ fontSize: isTablet ? '15px' : '14px' }}>
                    סה"כ תשלומים עתידיים
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Modal ───────────────────────────────────────────────────── */}
      {editId !== null && editForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)' }}
          onClick={closeEdit}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
            style={{ maxWidth: '560px', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10"
              style={{ borderColor: '#F0E8E7' }}
            >
              <button
                className="rounded-xl flex items-center justify-center text-gray-400 transition-colors"
                style={{ background: '#F3F4F6', width: '40px', height: '40px' }}
                onClick={closeEdit}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#1F2937')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
              >
                <X className="w-5 h-5" />
              </button>
              <h3 className="font-bold text-gray-800" style={{ fontSize: isTablet ? '18px' : '16px' }}>
                ✏️ עריכת תשלום
              </h3>
            </div>

            {/* Modal body */}
            <form onSubmit={saveEdit} className="p-5">
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
              >
                <div>
                  <label style={labelStyle}>ספק</label>
                  <input
                    style={inputStyle}
                    type="text"
                    value={editForm.supplier}
                    onChange={(e) => setEditForm((f) => f && { ...f, supplier: e.target.value })}
                    required
                    onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                    onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                  />
                </div>
                <div>
                  <label style={labelStyle}>סכום (₪)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={editForm.amount}
                    onChange={(e) => setEditForm((f) => f && { ...f, amount: e.target.value })}
                    required
                    onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                    onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                  />
                </div>
                <div>
                  <label style={labelStyle}>סוג תשלום</label>
                  <select
                    style={inputStyle}
                    value={editForm.type}
                    onChange={(e) =>
                      setEditForm((f) =>
                        f && { ...f, type: e.target.value as PaymentType, valueDate: '' }
                      )
                    }
                    onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                    onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                  >
                    <option value="transfer">🏦 העברה בנקאית</option>
                    <option value="check">📄 צ'ק</option>
                    <option value="cash">💵 מזומן</option>
                    <option value="credit">💳 אשראי</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>תאריך תשלום</label>
                  <input
                    style={inputStyle}
                    type="date"
                    value={editForm.date}
                    onChange={(e) => setEditForm((f) => f && { ...f, date: e.target.value })}
                    required
                    onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                    onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                  />
                </div>
                <div>
                  <label style={labelStyle}>אסמכתא</label>
                  <input
                    style={inputStyle}
                    type="text"
                    value={editForm.ref}
                    onChange={(e) => setEditForm((f) => f && { ...f, ref: e.target.value })}
                    onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                    onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                  />
                </div>
                {needsEditValueDate && (
                  <div>
                    <label style={labelStyle}>תאריך ערך</label>
                    <input
                      style={inputStyle}
                      type="date"
                      value={editForm.valueDate}
                      onChange={(e) => setEditForm((f) => f && { ...f, valueDate: e.target.value })}
                      onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                      onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                    />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>סטטוס</label>
                  <select
                    style={inputStyle}
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm((f) => f && { ...f, status: e.target.value as PaymentStatus })
                    }
                    onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                    onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                  >
                    <option value="paid">✅ שולם</option>
                    <option value="pending">⏳ ממתין</option>
                    <option value="cancelled">🚫 בוטל</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>הערות</label>
                  <input
                    style={inputStyle}
                    type="text"
                    value={editForm.notes}
                    onChange={(e) => setEditForm((f) => f && { ...f, notes: e.target.value })}
                    onFocus={(e) => (e.target.style.borderColor = '#8B1A3A')}
                    onBlur={(e) => (e.target.style.borderColor = '#F0E8E7')}
                  />
                </div>
              </div>

              <div
                className="flex gap-3 mt-5 pt-4 border-t"
                style={{ borderColor: '#F0E8E7' }}
              >
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #8B1A3A, #E8645A)',
                    padding: '12px 24px',
                    fontSize: isTablet ? '16px' : '14px',
                    minHeight: '44px',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                >
                  💾 שמור שינויים
                </button>
                <button
                  type="button"
                  className="rounded-xl font-semibold transition-all"
                  style={{
                    border: '1.5px solid #F0E8E7',
                    background: 'white',
                    color: '#6B7280',
                    padding: '12px 20px',
                    fontSize: isTablet ? '16px' : '14px',
                    minHeight: '44px',
                  }}
                  onClick={closeEdit}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F9FAFB')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
                >
                  ביטול
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Confirm Cancel Dialog ─────────────────────────────────────────── */}
      {confirmId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)' }}
          onClick={() => setConfirmId(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-8 text-center"
            style={{ maxWidth: '380px', width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl mb-4">⚠️</div>
            <h3 className="font-bold text-gray-800 mb-2" style={{ fontSize: '18px' }}>
              ביטול תשלום
            </h3>
            <p className="text-gray-500 mb-6" style={{ fontSize: '14px' }}>
              האם לבטל את התשלום לספק{' '}
              <strong>{payments.find((p) => p.id === confirmId)?.supplier}</strong>?
            </p>
            <div className="flex gap-3 justify-center">
              <button
                className="rounded-xl text-white font-semibold transition-all"
                style={{
                  background: '#DC2626',
                  padding: '12px 24px',
                  fontSize: '15px',
                  minHeight: '48px',
                }}
                onClick={doCancel}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#B91C1C')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#DC2626')}
              >
                אישור ביטול
              </button>
              <button
                className="rounded-xl font-semibold transition-all"
                style={{
                  border: '1.5px solid #F0E8E7',
                  background: 'white',
                  color: '#6B7280',
                  padding: '12px 20px',
                  fontSize: '15px',
                  minHeight: '48px',
                }}
                onClick={() => setConfirmId(null)}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F9FAFB')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
              >
                חזרה
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ───────────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-6 left-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none"
        style={{ transform: 'translateX(-50%)' }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-white shadow-lg"
            style={{
              background:
                t.type === 'success'
                  ? '#16A34A'
                  : t.type === 'warning'
                  ? '#D97706'
                  : '#DC2626',
              fontSize: '14px',
              animation: 'fadeInUp 0.25s ease',
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
