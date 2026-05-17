import { useState, useEffect, useRef } from 'react'
import { Plus, Search, Pencil, X, RotateCcw, CreditCard, LayoutList, Table2, UserPlus, Download } from 'lucide-react'
import { useSuppliers } from '../hooks/useSuppliers'
import { usePayments as usePaymentsData } from '../hooks/usePayments'

// ─── types ───────────────────────────────────────────────────────────────────

type PaymentType = string
type PaymentStatus = 'paid' | 'pending' | 'cancelled'

interface Payment {
  id: string
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
  type: string
  date: string
  ref: string
  valueDate: string
  notes: string
}

interface EditForm {
  supplier: string
  amount: string
  type: string
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

interface BizboxIssue {
  payment: Payment
  missing: string[]
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

function fmtILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function useIsMobile() {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 640)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

// ─── constants ────────────────────────────────────────────────────────────────

const BIZBOX_TYPES = [
  "צ'ק",
  'עמלה',
  'סליקה',
  'מזומן',
  'כרטיס אשראי',
  'הרשאה לחיוב חשבון',
  'העברה בנקאית',
  'הלוואה',
  'אחר',
] as const

const LEGACY_TYPE_MAP: Record<string, string> = {
  transfer: 'העברה בנקאית',
  check:    "צ'ק",
  cash:     'מזומן',
  credit:   'כרטיס אשראי',
  'העברה':  'העברה בנקאית',
  'אשראי':  'כרטיס אשראי',
}

function normalizeBizboxType(type: string): string {
  if ((BIZBOX_TYPES as readonly string[]).includes(type)) return type
  return LEGACY_TYPE_MAP[type] ?? 'אחר'
}

const TYPE_EMOJI: Record<string, string> = {
  "צ'ק":                    '📄',
  'עמלה':                   '💸',
  'סליקה':                  '🔄',
  'מזומן':                  '💵',
  'כרטיס אשראי':            '💳',
  'הרשאה לחיוב חשבון':      '📋',
  'העברה בנקאית':           '🏦',
  'הלוואה':                 '💰',
  'אחר':                    '📌',
}

const TYPE_COLORS: Record<string, { bg: string; color: string; accent: string }> = {
  "צ'ק":                    { bg: '#FEF3C7', color: '#92400E', accent: '#D97706' },
  'עמלה':                   { bg: '#FDF2F8', color: '#9D174D', accent: '#BE185D' },
  'סליקה':                  { bg: '#EEF2FF', color: '#3730A3', accent: '#4338CA' },
  'מזומן':                  { bg: '#F0FDF4', color: '#16A34A', accent: '#16A34A' },
  'כרטיס אשראי':            { bg: '#F5F3FF', color: '#7C3AED', accent: '#7C3AED' },
  'הרשאה לחיוב חשבון':      { bg: '#FFF7ED', color: '#C2410C', accent: '#EA580C' },
  'העברה בנקאית':           { bg: '#EFF6FF', color: '#1D4ED8', accent: '#1D4ED8' },
  'הלוואה':                 { bg: '#FFF1F2', color: '#9F1239', accent: '#E11D48' },
  'אחר':                    { bg: '#F9FAFB', color: '#374151', accent: '#6B7280' },
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

// ─── sub-components ───────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type] ?? { bg: '#F9FAFB', color: '#374151', accent: '#6B7280' }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-lg font-bold"
      style={{ background: c.bg, color: c.color, fontSize: '12px', padding: '3px 9px' }}
    >
      {TYPE_EMOJI[type] ?? '📌'} {type}
    </span>
  )
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const c = STATUS_COLORS[status]
  return (
    <span
      className="inline-flex items-center rounded-lg font-bold"
      style={{ background: c.bg, color: c.color, fontSize: '12px', padding: '3px 9px' }}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

// ─── SupplierSelect ───────────────────────────────────────────────────────────

function SupplierSelect({
  value,
  onChange,
  suppliers,
  onAddNew,
  fieldStyle,
  labelStyle,
  required = false,
}: {
  value: string
  onChange: (v: string) => void
  suppliers: string[]
  onAddNew: (name: string) => void
  fieldStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  required?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const confirm = () => {
    const name = draft.trim()
    if (!name) return
    onAddNew(name)
    onChange(name)
    setAdding(false)
    setDraft('')
  }

  const cancel = () => { setAdding(false); setDraft('') }

  return (
    <div>
      <label style={labelStyle}>
        ספק{required && <span style={{ color: '#DC2626' }}> *</span>}
      </label>
      <select
        value={adding ? '__new__' : value}
        onChange={e => {
          if (e.target.value === '__new__') { setAdding(true); setDraft('') }
          else onChange(e.target.value)
        }}
        required={required && !adding}
        style={fieldStyle}
        onFocus={e => (e.target.style.borderColor = '#8B1A3A')}
        onBlur={e => (e.target.style.borderColor = '#E2E4E9')}
      >
        <option value="">— בחר ספק —</option>
        {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
        <option value="__new__">＋ הוסף ספק חדש...</option>
      </select>

      {adding && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="שם הספק החדש"
            style={{ ...fieldStyle, flex: 1 }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); confirm() }
              if (e.key === 'Escape') cancel()
            }}
            onFocus={e => (e.target.style.borderColor = '#8B1A3A')}
            onBlur={e => (e.target.style.borderColor = '#E2E4E9')}
          />
          <button
            type="button"
            onClick={confirm}
            disabled={!draft.trim()}
            style={{
              background: draft.trim() ? '#8B1A3A' : '#D1C4C4',
              color: 'white', border: 'none', borderRadius: '10px',
              padding: '0 14px', fontWeight: 700, fontSize: '14px',
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
              minHeight: fieldStyle.minHeight, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: '5px',
            }}
          >
            <UserPlus size={14} />
            הוסף
          </button>
          <button
            type="button"
            onClick={cancel}
            style={{
              background: 'white', border: '1.5px solid #E2E4E9', color: '#6B7280',
              borderRadius: '10px', padding: '0 12px', fontWeight: 600, fontSize: '14px',
              cursor: 'pointer', minHeight: fieldStyle.minHeight, flexShrink: 0,
            }}
          >
            ביטול
          </button>
        </div>
      )}
    </div>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

export default function Payments() {
  const isTablet = useIsTablet()
  const isMobile = useIsMobile()
  const { data: serverSuppliers, loading: suppliersLoading } = useSuppliers()
  const { data: serverPayments, loading: paymentsLoading, create: createPayment, update: updatePaymentApi, cancel: cancelPaymentApi } = usePaymentsData()
  const toastIdRef = useRef(0)

  const [payments, setPayments] = useState<Payment[]>([])
  const [activeTab, setActiveTab] = useState<'all' | 'future'>('all')
  const [showForm, setShowForm] = useState(true)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const [fltSupplier, setFltSupplier] = useState('')
  const [fltType, setFltType] = useState('')
  const [fltMonth, setFltMonth] = useState('')
  const [fltStatus, setFltStatus] = useState('')

  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [allSuppliers, setAllSuppliers] = useState<string[]>([])

  useEffect(() => {
    setPayments(serverPayments as Payment[])
  }, [serverPayments])

  useEffect(() => {
    setAllSuppliers(serverSuppliers.map(s => s.name))
  }, [serverSuppliers])

  function handleAddSupplier(name: string) {
    setAllSuppliers(prev => prev.includes(name) ? prev : [...prev, name])
  }

  // ── BizBox export state ───────────────────────────────────────────────────
  const LS_KEY = 'lastBizboxExport'

  function defaultBizboxRange(): { from: string; to: string } {
    const to = todayStr()
    const stored = localStorage.getItem(LS_KEY)
    if (stored) return { from: stored, to }
    const now = new Date()
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    return { from, to }
  }

  const [showBizbox, setShowBizbox] = useState(false)
  const [bizboxFrom, setBizboxFrom] = useState('')
  const [bizboxTo, setBizboxTo] = useState('')
  const [showBizboxValidation, setShowBizboxValidation] = useState(false)
  const [bizboxIssues, setBizboxIssues] = useState<BizboxIssue[]>([])
  const [highlightedBadIds, setHighlightedBadIds] = useState<Set<string>>(new Set())

  function openBizbox() {
    const range = defaultBizboxRange()
    setBizboxFrom(range.from)
    setBizboxTo(range.to)
    setShowBizbox(true)
  }

  function getMissingFields(p: Payment): string[] {
    const missing: string[] = []
    if (!p.type)              missing.push('סוג_תשלום')
    if (!p.date)              missing.push('תאריך')
    if (!p.ref?.trim())       missing.push('אסמכתא')
    if (!p.amount || p.amount <= 0) missing.push('סכום')
    if (!p.supplier?.trim())  missing.push('תיאור')
    return missing
  }

  function exportBizbox() {
    const rows = payments.filter(p =>
      p.status !== 'cancelled' && p.date >= bizboxFrom && p.date <= bizboxTo
    )

    const issues: BizboxIssue[] = rows
      .map(p => ({ payment: p, missing: getMissingFields(p) }))
      .filter(x => x.missing.length > 0)

    if (issues.length > 0) {
      setBizboxIssues(issues)
      setShowBizboxValidation(true)
      return
    }

    doExportBizbox(rows)
  }

  function doExportBizbox(rows: Payment[]) {
    const fileName = `bizbox_${todayStr()}.xlsx`
    const HEADERS = ['סוג_פעולה', 'סוג_תשלום', 'תאריך', 'אסמכתא', 'סכום', 'תיאור'] as const
    const DATE_FMT = '[$-1010000]d/m/yyyy'

    const writeRows = (XLSX: typeof import('xlsx'), ws: import('xlsx').WorkSheet) => {
      rows.forEach((p, i) => {
        const r = i + 2 // row 1 = headers
        const [y, m, d] = p.date.split('-').map(Number)
        const cells: [string, import('xlsx').CellObject][] = [
          [`A${r}`, { t: 's', v: 'חיוב' }],
          [`B${r}`, { t: 's', v: normalizeBizboxType(p.type) }],
          [`C${r}`, { t: 'd', v: new Date(y, m - 1, d), z: DATE_FMT }],
          [`D${r}`, { t: 's', v: p.ref ?? '' }],
          [`E${r}`, { t: 'n', v: Number(p.amount) || 0 }],
          [`F${r}`, { t: 's', v: p.supplier ?? '' }],
        ]
        cells.forEach(([addr, cell]) => { ws[addr] = cell })
      })
      // extend sheet range to cover written rows
      const ref = ws['!ref'] ?? 'A1:F1'
      const range = XLSX.utils.decode_range(ref)
      range.e.r = Math.max(range.e.r, rows.length + 1)
      ws['!ref'] = XLSX.utils.encode_range(range)
    }

    import('xlsx').then(XLSX => {
      fetch('/add_tazrim_template.xlsx')
        .then(res => res.arrayBuffer())
        .then(buf => {
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellStyles: true, cellDates: true })
          const ws = wb.Sheets['גיליון1']
          writeRows(XLSX, ws)
          XLSX.writeFile(wb, fileName)
        })
        .catch(() => {
          // fallback: build from scratch
          const ws: import('xlsx').WorkSheet = {}
          HEADERS.forEach((h, ci) => {
            const addr = XLSX.utils.encode_cell({ r: 0, c: ci })
            ws[addr] = { t: 's', v: h }
          })
          writeRows(XLSX, ws)
          ws['!cols'] = [14, 12, 10, 11, 11, 22].map(wch => ({ wch }))
          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, 'גיליון1')
          XLSX.writeFile(wb, fileName)
        })
    })

    localStorage.setItem(LS_KEY, bizboxTo)
    setShowBizbox(false)
    setShowBizboxValidation(false)
    showToast(`✅ ${fileName} הורד (${rows.length} תשלומים)`)
  }

  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)

  const [confirmId, setConfirmId] = useState<string | null>(null)

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

  const futureTotal = futurePayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const activeTotal = payments
    .filter((p) => p.status !== 'cancelled')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const monthOptions = [...new Set(payments.map((p) => (p.date || '').slice(0, 7)).filter(Boolean))].sort().reverse()

  const VALUE_DATE_TYPES = ["צ'ק", 'כרטיס אשראי', 'הרשאה לחיוב חשבון']
  const needsValueDate = VALUE_DATE_TYPES.includes(form.type)
  const needsEditValueDate = !!editForm && VALUE_DATE_TYPES.includes(editForm.type)

  // ── handlers ─────────────────────────────────────────────────────────────

  function showToast(msg: string, type: Toast['type'] = 'success') {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, msg, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.type) return
    const status: PaymentStatus =
      form.valueDate && needsValueDate && daysFromToday(form.valueDate) > 0 ? 'pending' : 'paid'
    const payload = {
      supplier_id: '',
      supplier: form.supplier.trim(),
      amount: parseFloat(form.amount),
      type: form.type,
      date: form.date,
      ref: form.ref.trim(),
      valueDate: needsValueDate ? form.valueDate || null : null,
      notes: form.notes.trim(),
      status,
    }
    try {
      await createPayment(payload)
      setForm({ ...EMPTY_FORM, date: todayStr() })
      showToast('✅ תשלום נוסף בהצלחה')
    } catch {
      // hook sets error state
    }
  }

  function openEdit(id: string) {
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

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId || !editForm) return
    const savedId = editId
    const savedForm = editForm
    closeEdit()
    try {
      await updatePaymentApi(savedId, {
        supplier: savedForm.supplier.trim(), amount: parseFloat(savedForm.amount),
        type: savedForm.type, date: savedForm.date, ref: savedForm.ref.trim(),
        notes: savedForm.notes.trim(), status: savedForm.status,
      })
      showToast('💾 תשלום עודכן בהצלחה')
    } catch {
      // hook sets error state
    }
  }

  async function doCancel() {
    if (!confirmId) return
    const savedConfirmId = confirmId
    setConfirmId(null)
    try {
      await cancelPaymentApi(savedConfirmId)
      showToast('🚫 תשלום בוטל', 'warning')
    } catch {
      // hook sets error state
    }
  }

  function handleRestore(id: string) {
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
    border: '1.5px solid #E2E4E9',
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
    const isBad = highlightedBadIds.has(p.id)

    return (
      <div
        className="flex items-center gap-3 rounded-2xl transition-all cursor-pointer"
        style={{
          border: isBad ? '2px solid #DC2626' : `1.5px solid #E2E4E9`,
          borderRight: isBad ? '4px solid #DC2626' : `4px solid ${tc.accent}`,
          background: isBad ? '#FFF5F5' : 'white',
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
          ((e.currentTarget as HTMLElement).style.borderColor = '#E2E4E9')
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

  if ((paymentsLoading || suppliersLoading) && payments.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#E8645A' }} />
      </div>
    )
  }

  return (
    <div className="space-y-5" style={{ direction: 'rtl' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-right">
          <h1 className="font-black text-gray-800" style={{ fontSize: isTablet ? '24px' : '22px' }}>
            תשלומים
          </h1>
          <p className="text-gray-400 mt-0.5" style={{ fontSize: isTablet ? '15px' : '13px' }}>
            {payments.length} תשלומים במערכת
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
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
          <button
            onClick={openBizbox}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              background: 'linear-gradient(135deg, #1D4ED8, #2563EB)',
              color: 'white', border: 'none', borderRadius: '12px',
              padding: isTablet ? '10px 18px' : '8px 14px',
              fontSize: isTablet ? '14px' : '13px', fontWeight: 700,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(29,78,216,0.25)',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#1E40AF')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'linear-gradient(135deg, #1D4ED8, #2563EB)')}
          >
            <Download size={15} />
            ייצא לביזיבוקס
          </button>
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
            style={{ borderColor: '#E2E4E9' }}
          >
            <div
              className="flex items-center justify-between px-5 py-3 border-b"
              style={{ borderColor: '#F5EEEE', background: '#F8F9FA' }}
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
                  <SupplierSelect
                    value={form.supplier}
                    onChange={v => setForm(f => ({ ...f, supplier: v }))}
                    suppliers={allSuppliers}
                    onAddNew={handleAddSupplier}
                    fieldStyle={inputStyle}
                    labelStyle={labelStyle}
                    required
                  />

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
                      onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                      onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
                    >
                      <option value="">— בחר סוג —</option>
                      {BIZBOX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
                      onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                      onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                        onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                      onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-5">
                  <button
                    type="submit"
                    className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all"
                    style={{
                      background: '#7C3AED',
                      padding: isTablet ? '12px 24px' : '10px 20px',
                      fontSize: isTablet ? '16px' : '14px',
                      minHeight: '44px',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#6D28D9')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
                  >
                    <Plus className="w-4 h-4" />
                    שמור תשלום
                  </button>
                  <button
                    type="button"
                    className="rounded-xl font-semibold transition-all"
                    style={{
                      border: '1.5px solid #E2E4E9',
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
            style={{ borderColor: '#E2E4E9' }}
          >
            <div
              className="flex items-center justify-end px-5 py-3 border-b gap-2 font-bold text-gray-700"
              style={{ borderColor: '#F5EEEE', background: '#F8F9FA' }}
            >
              סינון
              <Search className="w-4 h-4 text-gray-400" />
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
                    borderColor: '#E2E4E9',
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
                  onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
                >
                  <option value="">הכל</option>
                  {BIZBOX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
                  onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                  onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                    border: '1.5px solid #E2E4E9',
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
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
                >
                  נקה סינון
                </button>
              )}
            </div>
          </div>

          {/* View toggle + count */}
          <div className="flex items-center justify-between">
            <div
              style={{
                display: 'flex', gap: '3px', background: '#F3F4F6',
                borderRadius: '10px', padding: '3px',
              }}
            >
              <button
                onClick={() => setViewMode('table')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '7px 13px', borderRadius: '8px', fontSize: '13px',
                  fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: viewMode === 'table' ? 'white' : 'transparent',
                  color: viewMode === 'table' ? '#8B1A3A' : '#6B7280',
                  boxShadow: viewMode === 'table' ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                }}
              >
                <Table2 className="w-4 h-4" />
                טבלה
              </button>
              <button
                onClick={() => setViewMode('cards')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '7px 13px', borderRadius: '8px', fontSize: '13px',
                  fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: viewMode === 'cards' ? 'white' : 'transparent',
                  color: viewMode === 'cards' ? '#8B1A3A' : '#6B7280',
                  boxShadow: viewMode === 'cards' ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                }}
              >
                <LayoutList className="w-4 h-4" />
                כרטיסיות
              </button>
            </div>
            <span style={{ fontSize: '13px', color: '#9CA3AF' }}>
              {filtered.length} תשלומים
              {filtered.length !== payments.length && ` מתוך ${payments.length}`}
            </span>
          </div>

          {/* Payment list */}
          {filtered.length === 0 ? (
            <div
              className="bg-white rounded-2xl shadow-sm border flex flex-col items-center justify-center py-16"
              style={{ borderColor: '#E2E4E9' }}
            >
              <CreditCard className="w-12 h-12 mb-3" style={{ color: '#E2E4E9' }} />
              <p className="text-gray-400" style={{ fontSize: '16px' }}>
                לא נמצאו תשלומים
              </p>
            </div>
          ) : viewMode === 'table' ? (() => {
              const pCOL = isMobile
                ? '85px 1fr 110px 80px 80px 80px'
                : '85px 1fr 110px 80px 100px 90px 80px 80px'
              const pMIN = isMobile ? '480px' : '720px'
              const activeTotal = filtered.filter(p => p.status !== 'cancelled').reduce((s, p) => s + (Number(p.amount) || 0), 0)
              const activeCount = filtered.filter(p => p.status !== 'cancelled').length
              return (
                <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
                  <div style={{ overflowX: 'auto' }}>
                    {/* Column headers */}
                    <div
                      className="grid font-bold text-gray-500 border-b"
                      style={{
                        gridTemplateColumns: pCOL, minWidth: pMIN,
                        padding: '10px 16px', fontSize: '12px',
                        background: '#F8F9FA', borderColor: '#E2E4E9', textAlign: 'right',
                      }}
                    >
                      <span>תאריך</span>
                      <span>ספק</span>
                      <span>סכום</span>
                      <span>סוג</span>
                      {!isMobile && <span>אסמכתא</span>}
                      {!isMobile && <span>תאריך ערך</span>}
                      <span>סטטוס</span>
                      <span className="text-center">פעולות</span>
                    </div>

                    {/* Data rows */}
                    {filtered.map((p) => {
                      const isCancelled = p.status === 'cancelled'
                      const isBad = highlightedBadIds.has(p.id)
                      const valueDays = p.valueDate ? daysFromToday(p.valueDate) : null
                      const valueDateColor =
                        valueDays !== null && valueDays <= 3 ? '#DC2626'
                        : valueDays !== null && valueDays <= 7 ? '#D97706'
                        : '#374151'
                      return (
                        <div
                          key={p.id}
                          className="grid items-center"
                          style={{
                            gridTemplateColumns: pCOL,
                            borderBottom: `1px solid ${isBad ? '#FECACA' : '#E2E4E9'}`,
                            background: isBad ? '#FFF5F5' : undefined,
                            outline: isBad ? '2px solid #DC2626' : undefined,
                            outlineOffset: isBad ? '-2px' : undefined,
                            opacity: isCancelled ? 0.6 : 1,
                            cursor: 'pointer',
                            transition: 'background 0.1s',
                            minHeight: '56px',
                            padding: '12px 16px',
                            minWidth: pMIN,
                            textAlign: 'right',
                          }}
                          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = isBad ? '#FEE2E2' : '#F8F9FA')}
                          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = isBad ? '#FFF5F5' : 'transparent')}
                          onClick={() => openEdit(p.id)}
                        >
                          <span style={{ fontSize: isTablet ? '14px' : '13px', color: '#374151' }}>{fmtDate(p.date)}</span>
                          <span style={{ fontSize: isTablet ? '14px' : '13px', fontWeight: 700, color: '#1F2937' }}>{p.supplier}</span>
                          <span style={{ fontSize: isTablet ? '14px' : '13px', fontWeight: 800, color: '#1F2937', whiteSpace: 'nowrap' }}>
                            {fmtILS(p.amount)}
                          </span>
                          <span><TypeBadge type={p.type} /></span>
                          {!isMobile && (
                            <span style={{ fontSize: '12px', color: '#6B7280' }}>
                              {p.ref || <span style={{ color: '#D1D5DB' }}>—</span>}
                            </span>
                          )}
                          {!isMobile && (
                            <span style={{ whiteSpace: 'nowrap' }}>
                              {p.valueDate ? (
                                <span style={{ color: valueDateColor, fontWeight: valueDays !== null && valueDays <= 7 ? 700 : 400, fontSize: isTablet ? '14px' : '13px' }}>
                                  {fmtDate(p.valueDate)}
                                  {valueDays !== null && valueDays > 0 && valueDays <= 7 && (
                                    <span style={{ marginRight: '6px', fontSize: '11px', background: '#FEF2F2', color: '#DC2626', padding: '1px 6px', borderRadius: '5px', fontWeight: 700 }}>
                                      {valueDays === 1 ? 'מחר' : `${valueDays}י׳`}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span style={{ color: '#D1D5DB' }}>—</span>
                              )}
                            </span>
                          )}
                          <span><StatusBadge status={p.status} /></span>
                          <div
                            style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}
                            onClick={e => e.stopPropagation()}
                          >
                            <button
                              style={{ background: '#FFF0EF', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}
                              onClick={() => openEdit(p.id)}
                              title="עריכה"
                              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#E8645A')}
                              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {isCancelled ? (
                              <button
                                style={{ background: '#F0FDF4', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}
                                onClick={() => handleRestore(p.id)}
                                title="שחזור"
                                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#16A34A')}
                                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                style={{ background: '#FEF2F2', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}
                                onClick={() => setConfirmId(p.id)}
                                title="ביטול"
                                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#DC2626')}
                                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Summary row */}
                    <div
                      className="grid items-center"
                      style={{
                        gridTemplateColumns: pCOL, minWidth: pMIN,
                        borderTop: '2px solid #E2E4E9', background: '#F8F9FA',
                        padding: isTablet ? '13px 16px' : '11px 16px',
                        textAlign: 'right',
                      }}
                    >
                      <span style={{ gridColumn: 'span 2', fontWeight: 700, color: '#6B7280', fontSize: isTablet ? '14px' : '13px' }}>
                        סה"כ ({activeCount} פעילים)
                      </span>
                      <span style={{ fontWeight: 900, fontSize: isTablet ? '16px' : '14px', color: '#8B1A3A' }}>
                        {fmtILS(activeTotal)}
                      </span>
                      <span style={{ gridColumn: isMobile ? 'span 3' : 'span 5' }} />
                    </div>
                  </div>
                </div>
              )
            })() : (
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
          style={{ borderColor: '#E2E4E9' }}
        >
          <div
            className="px-5 py-3 border-b font-bold text-gray-700 flex items-center justify-end gap-2"
            style={{ borderColor: '#F5EEEE', background: '#F8F9FA', fontSize: isTablet ? '16px' : '14px' }}
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
                  style={{ background: '#F8F9FA', border: '1.5px solid #E2E4E9' }}
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
              style={{ borderColor: '#E2E4E9' }}
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
                <SupplierSelect
                  value={editForm.supplier}
                  onChange={v => setEditForm(f => f && { ...f, supplier: v })}
                  suppliers={allSuppliers}
                  onAddNew={handleAddSupplier}
                  fieldStyle={inputStyle}
                  labelStyle={labelStyle}
                />
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
                    onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                    onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
                  >
                    {BIZBOX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
                    onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                    onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                      onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                    onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
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
                    onBlur={(e) => (e.target.style.borderColor = '#E2E4E9')}
                  />
                </div>
              </div>

              <div
                className="flex gap-3 mt-5 pt-4 border-t"
                style={{ borderColor: '#E2E4E9' }}
              >
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all"
                  style={{
                    background: '#7C3AED',
                    padding: '12px 24px',
                    fontSize: isTablet ? '16px' : '14px',
                    minHeight: '44px',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#6D28D9')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
                >
                  💾 שמור שינויים
                </button>
                <button
                  type="button"
                  className="rounded-xl font-semibold transition-all"
                  style={{
                    border: '1.5px solid #E2E4E9',
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

      {/* ── BizBox Validation Modal ──────────────────────────────────────── */}
      {showBizboxValidation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)' }}
          onClick={() => setShowBizboxValidation(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl overflow-hidden"
            style={{ width: '100%', maxWidth: '540px', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ background: '#FEF2F2', borderBottom: '1px solid #FECACA', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', direction: 'rtl' }}>
                <button
                  onClick={() => setShowBizboxValidation(false)}
                  style={{
                    background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: '8px',
                    width: '32px', height: '32px', cursor: 'pointer', color: '#6B7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={16} />
                </button>
                <div style={{ textAlign: 'right' }}>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#DC2626' }}>
                    נמצאו {bizboxIssues.length} תשלומים עם נתונים חסרים
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#991B1B' }}>
                    יש לתקן לפני ייצוא, או לייצא רק שורות תקינות
                  </p>
                </div>
                <span style={{ fontSize: '28px' }}>⚠️</span>
              </div>
            </div>

            {/* Issues list */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0', direction: 'rtl' }}>
              {bizboxIssues.map((issue, i) => (
                <div
                  key={issue.payment.id}
                  style={{
                    padding: '12px 20px',
                    borderBottom: i < bizboxIssues.length - 1 ? '1px solid #FEE2E2' : undefined,
                    display: 'flex', alignItems: 'flex-start', gap: '12px',
                  }}
                >
                  <div
                    style={{
                      width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                      background: '#FEE2E2', color: '#DC2626', fontSize: '12px', fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1F2937' }}>
                      תשלום לספק {issue.payment.supplier || <em style={{ color: '#9CA3AF' }}>ללא שם</em>}
                      {' '}
                      <span style={{ fontWeight: 400, color: '#6B7280' }}>
                        מתאריך {fmtDate(issue.payment.date)}
                      </span>
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#DC2626' }}>
                      חסר:{' '}
                      {issue.missing.map((f, j) => (
                        <span key={f}>
                          <span
                            style={{
                              background: '#FEE2E2', color: '#991B1B',
                              padding: '1px 7px', borderRadius: '5px', fontWeight: 700, fontSize: '12px',
                            }}
                          >
                            {f}
                          </span>
                          {j < issue.missing.length - 1 && ' '}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div
              style={{
                padding: '14px 20px', borderTop: '1px solid #F0E8E7',
                display: 'flex', gap: '10px', direction: 'rtl', flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() => {
                  setHighlightedBadIds(new Set(bizboxIssues.map(x => x.payment.id)))
                  setShowBizboxValidation(false)
                  setShowBizbox(false)
                }}
                style={{
                  flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '6px', background: '#8B1A3A', color: 'white', border: 'none',
                  borderRadius: '12px', padding: '12px 16px', fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
              >
                <Pencil size={14} />
                ערוך לפני ייצוא
              </button>
              <button
                onClick={() => {
                  const validRows = payments.filter(p => {
                    if (p.status === 'cancelled') return false
                    if (p.date < bizboxFrom || p.date > bizboxTo) return false
                    return getMissingFields(p).length === 0
                  })
                  doExportBizbox(validRows)
                }}
                style={{
                  flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '6px', background: '#1D4ED8', color: 'white', border: 'none',
                  borderRadius: '12px', padding: '12px 16px', fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
              >
                <Download size={14} />
                ייצא בכל זאת ({bizboxIssues.length > 0
                  ? payments.filter(p =>
                      p.status !== 'cancelled' &&
                      p.date >= bizboxFrom && p.date <= bizboxTo &&
                      getMissingFields(p).length === 0
                    ).length
                  : 0} שורות תקינות)
              </button>
              <button
                onClick={() => setShowBizboxValidation(false)}
                style={{
                  background: 'white', border: '1.5px solid #E5E7EB', color: '#6B7280',
                  borderRadius: '12px', padding: '12px 18px', fontSize: '14px',
                  fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#F9FAFB')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'white')}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BizBox Export Modal ──────────────────────────────────────────── */}
      {showBizbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}
          onClick={() => setShowBizbox(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl overflow-hidden"
            style={{ width: '100%', maxWidth: '420px' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                background: 'linear-gradient(135deg, #1D4ED8, #2563EB)',
                padding: '18px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <button
                onClick={() => setShowBizbox(false)}
                style={{
                  background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '8px',
                  width: '32px', height: '32px', cursor: 'pointer', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={16} />
              </button>
              <div style={{ textAlign: 'right' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'white' }}>
                  ייצוא לביזיבוקס
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'rgba(255,255,255,0.75)' }}>
                  קובץ xlsx מוכן לייבוא
                </p>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: '22px 20px', direction: 'rtl' }}>
              {/* Date range */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#6B7280', display: 'block', marginBottom: '5px' }}>
                    מתאריך
                  </label>
                  <input
                    type="date"
                    value={bizboxFrom}
                    onChange={e => setBizboxFrom(e.target.value)}
                    style={{
                      ...inputStyle,
                      borderColor: '#E5D9D9', borderRadius: '10px',
                      minHeight: '44px', fontSize: '15px',
                    }}
                    onFocus={e => (e.target.style.borderColor = '#1D4ED8')}
                    onBlur={e => (e.target.style.borderColor = '#E5D9D9')}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#6B7280', display: 'block', marginBottom: '5px' }}>
                    עד תאריך
                  </label>
                  <input
                    type="date"
                    value={bizboxTo}
                    onChange={e => setBizboxTo(e.target.value)}
                    style={{
                      ...inputStyle,
                      borderColor: '#E5D9D9', borderRadius: '10px',
                      minHeight: '44px', fontSize: '15px',
                    }}
                    onFocus={e => (e.target.style.borderColor = '#1D4ED8')}
                    onBlur={e => (e.target.style.borderColor = '#E5D9D9')}
                  />
                </div>
              </div>

              {/* Preview count */}
              {(() => {
                const count = payments.filter(p =>
                  p.status !== 'cancelled' && bizboxFrom && bizboxTo &&
                  p.date >= bizboxFrom && p.date <= bizboxTo
                ).length
                const total = payments
                  .filter(p => p.status !== 'cancelled' && bizboxFrom && bizboxTo && p.date >= bizboxFrom && p.date <= bizboxTo)
                  .reduce((s, p) => s + (Number(p.amount) || 0), 0)
                return (
                  <div style={{
                    background: count > 0 ? '#EFF6FF' : '#F9FAFB',
                    borderRadius: '10px', padding: '12px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '16px',
                  }}>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: count > 0 ? '#1D4ED8' : '#9CA3AF' }}>
                      {count > 0 ? fmtILS(total) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', color: count > 0 ? '#1E40AF' : '#9CA3AF' }}>
                      {count > 0 ? `${count} תשלומים לייצוא` : 'אין תשלומים בטווח זה'}
                    </span>
                  </div>
                )
              })()}

              {/* Last export note */}
              {localStorage.getItem(LS_KEY) && (
                <p style={{ fontSize: '12px', color: '#9CA3AF', textAlign: 'right', marginBottom: '16px' }}>
                  ייצוא אחרון: {fmtDate(localStorage.getItem(LS_KEY)!)}
                </p>
              )}

              {/* Columns preview */}
              <div style={{
                border: '1px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden',
                marginBottom: '20px', fontSize: '12px',
              }}>
                <div style={{
                  background: '#F9FAFB', padding: '8px 12px', fontWeight: 700,
                  color: '#6B7280', borderBottom: '1px solid #E5E7EB', textAlign: 'right',
                }}>
                  עמודות בקובץ
                </div>
                <div style={{
                  display: 'flex', gap: '6px', padding: '8px 12px', flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                }}>
                  {['סוג_פעולה', 'סוג_תשלום', 'תאריך', 'אסמכתא', 'סכום', 'תיאור'].map(col => (
                    <span
                      key={col}
                      style={{
                        background: '#EFF6FF', color: '#1D4ED8', padding: '2px 8px',
                        borderRadius: '5px', fontWeight: 600, fontSize: '11px',
                      }}
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={exportBizbox}
                  disabled={!bizboxFrom || !bizboxTo || bizboxFrom > bizboxTo}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: '7px', background: 'linear-gradient(135deg, #1D4ED8, #2563EB)',
                    color: 'white', border: 'none', borderRadius: '12px',
                    padding: '13px', fontSize: '15px', fontWeight: 700,
                    cursor: (!bizboxFrom || !bizboxTo || bizboxFrom > bizboxTo) ? 'not-allowed' : 'pointer',
                    opacity: (!bizboxFrom || !bizboxTo || bizboxFrom > bizboxTo) ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (bizboxFrom && bizboxTo && bizboxFrom <= bizboxTo) (e.currentTarget as HTMLElement).style.opacity = '0.88' }}
                  onMouseLeave={e => { if (bizboxFrom && bizboxTo && bizboxFrom <= bizboxTo) (e.currentTarget as HTMLElement).style.opacity = '1' }}
                >
                  <Download size={16} />
                  הורד קובץ xlsx
                </button>
                <button
                  onClick={() => setShowBizbox(false)}
                  style={{
                    background: 'white', border: '1.5px solid #E5E7EB', color: '#6B7280',
                    borderRadius: '12px', padding: '13px 18px', fontSize: '15px',
                    fontWeight: 600, cursor: 'pointer',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#F9FAFB')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'white')}
                >
                  ביטול
                </button>
              </div>
            </div>
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
                  border: '1.5px solid #E2E4E9',
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
