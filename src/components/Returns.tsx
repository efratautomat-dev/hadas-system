import { useState, useEffect } from 'react'
import { Plus, Pencil, X, CheckCircle2, Clock, XCircle, RotateCcw } from 'lucide-react'
import { useSuppliers } from '../hooks/useSuppliers'
import { useInvoices } from '../hooks/useInvoices'
import { useReturns } from '../hooks/useReturns'

type ReturnStatus = 'אושר' | 'בטיפול' | 'נדחה'

interface ReturnEntry {
  id: string
  date: string
  dateIso: string
  supplierId: string
  supplier: string
  amount: number
  reason: string
  originalInvoiceId: string | null
  status: ReturnStatus
  createdBy: string
}

interface FormState {
  supplierId: string
  dateIso: string
  amountStr: string
  reason: string
  originalInvoiceId: string
  createdBy: string
  status: ReturnStatus
}

const EMPLOYEES = ['שרה כהן', 'רחל לוי', 'מיכל דוד']
const CURRENT_USER = EMPLOYEES[0]

const STATUS_CONFIG: Record<ReturnStatus, { bg: string; color: string; Icon: React.ElementType }> = {
  'אושר':   { bg: '#DCFCE7', color: '#166534', Icon: CheckCircle2 },
  'בטיפול': { bg: '#FEF3C7', color: '#D97706', Icon: Clock },
  'נדחה':   { bg: '#FEE2E2', color: '#DC2626', Icon: XCircle },
}


function fmtILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function emptyForm(): FormState {
  return {
    supplierId: '',
    dateIso: new Date().toISOString().slice(0, 10),
    amountStr: '',
    reason: '',
    originalInvoiceId: '',
    createdBy: CURRENT_USER,
    status: 'בטיפול',
  }
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

function StatusBadge({ status }: { status: ReturnStatus }) {
  const cfg = STATUS_CONFIG[status]
  const { Icon } = cfg
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      {status}
    </span>
  )
}

const inputBase: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '12px',
  border: '2px solid #E2E4E9',
  fontSize: '14px',
  color: '#1A1D23',
  background: 'white',
  outline: 'none',
  direction: 'rtl',
}

const labelBase: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '6px',
  textAlign: 'right',
}

interface FormModalProps {
  form: FormState
  setForm: (f: FormState) => void
  isEdit: boolean
  onSave: () => void
  onClose: () => void
  suppliers: { id: string; name: string; status: string; balance: number }[]
  invoices: { id: string; supplierId: string; amount?: number; date?: string }[]
}

function FormModal({ form, setForm, isEdit, onSave, onClose, suppliers, invoices }: FormModalProps) {
  const supplierInvoices = invoices.filter(inv => inv.supplierId === form.supplierId)
  const selectedSupplier = suppliers.find(s => s.id === form.supplierId)
  const canSave = !!form.supplierId && !!form.amountStr && Number(form.amountStr) > 0 && !!form.reason.trim() && !!form.dateIso

  const focus = (e: React.FocusEvent<HTMLElement>) => ((e.target as HTMLElement & { style: CSSStyleDeclaration }).style.borderColor = '#7C3AED')
  const blur  = (e: React.FocusEvent<HTMLElement>) => ((e.target as HTMLElement & { style: CSSStyleDeclaration }).style.borderColor = '#E2E4E9')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full"
        style={{ maxWidth: '560px', maxHeight: '90vh', direction: 'rtl', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#E2E4E9' }}>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold text-gray-800">
            {isEdit ? 'עריכת חזרה' : 'הוסף חזרה חדשה'}
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Supplier */}
          <div>
            <label style={labelBase}>ספק *</label>
            <select
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value, originalInvoiceId: '' })}
              style={inputBase}
              onFocus={focus as React.FocusEventHandler<HTMLSelectElement>}
              onBlur={blur as React.FocusEventHandler<HTMLSelectElement>}
            >
              {suppliers.filter(s => s.status === 'פעיל').map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {selectedSupplier && (
              <p className="text-right mt-1" style={{ fontSize: '12px', color: '#9CA3AF' }}>
                יתרה נוכחית: {fmtILS(selectedSupplier.balance)}
              </p>
            )}
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelBase}>סכום (₪) *</label>
              <input
                type="number"
                value={form.amountStr}
                onChange={(e) => setForm({ ...form, amountStr: e.target.value })}
                placeholder="0"
                dir="ltr"
                style={{ ...inputBase, textAlign: 'left' }}
                onFocus={focus as React.FocusEventHandler<HTMLInputElement>}
                onBlur={blur as React.FocusEventHandler<HTMLInputElement>}
              />
            </div>
            <div>
              <label style={labelBase}>תאריך *</label>
              <input
                type="date"
                value={form.dateIso}
                onChange={(e) => setForm({ ...form, dateIso: e.target.value })}
                dir="ltr"
                style={inputBase}
                onFocus={focus as React.FocusEventHandler<HTMLInputElement>}
                onBlur={blur as React.FocusEventHandler<HTMLInputElement>}
              />
            </div>
          </div>

          {/* Original invoice */}
          <div>
            <label style={labelBase}>חשבונית מקורית (אופציונלי)</label>
            <select
              value={form.originalInvoiceId}
              onChange={(e) => setForm({ ...form, originalInvoiceId: e.target.value })}
              style={inputBase}
              onFocus={focus as React.FocusEventHandler<HTMLSelectElement>}
              onBlur={blur as React.FocusEventHandler<HTMLSelectElement>}
            >
              <option value="">— ללא חשבונית מקורית —</option>
              {supplierInvoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.id}{inv.amount ? ` · ${fmtILS(inv.amount)}` : ''}{inv.date ? ` · ${inv.date}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label style={labelBase}>סיבה *</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="תאר את סיבת החזרה..."
              rows={3}
              style={{ ...inputBase, resize: 'vertical', minHeight: '80px' }}
              onFocus={focus as React.FocusEventHandler<HTMLTextAreaElement>}
              onBlur={blur as React.FocusEventHandler<HTMLTextAreaElement>}
            />
          </div>

          {/* Status + Created by */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelBase}>סטטוס</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ReturnStatus })}
                style={inputBase}
                onFocus={focus as React.FocusEventHandler<HTMLSelectElement>}
                onBlur={blur as React.FocusEventHandler<HTMLSelectElement>}
              >
                <option value="בטיפול">בטיפול</option>
                <option value="אושר">אושר</option>
                <option value="נדחה">נדחה</option>
              </select>
            </div>
            <div>
              <label style={labelBase}>נוצר על ידי</label>
              <input
                type="text"
                value={form.createdBy}
                readOnly
                style={{ ...inputBase, background: '#F8F9FA', color: '#6B7280', cursor: 'default' }}
              />
            </div>
          </div>

          {/* Balance notice */}
          {form.status === 'אושר' && Number(form.amountStr) > 0 && (
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
              style={{ background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }}
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              יתרת הספק תרד ב-{fmtILS(Number(form.amountStr))} עם השמירה
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: '#E2E4E9' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold border-2 transition-colors"
            style={{ borderColor: '#E2E4E9', color: '#6B7280' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
          >
            ביטול
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="px-6 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#7C3AED' }}
            onMouseEnter={(e) => { if (canSave) (e.currentTarget as HTMLElement).style.background = '#6D28D9' }}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
          >
            {isEdit ? 'שמור שינויים' : 'הוסף חזרה'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Returns() {
  const isTablet = useIsTablet()
  const { data: serverReturns, loading, error, create: createReturn, update: updateReturn } = useReturns()
  const { data: suppliersData } = useSuppliers()
  const { data: invoicesData } = useInvoices()
  const [returns, setReturns] = useState<ReturnEntry[]>([])
  const [filterSupplier, setFilterSupplier] = useState('all')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterStatus, setFilterStatus] = useState<ReturnStatus | 'all'>('all')
  const [filterEmployee, setFilterEmployee] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())

  useEffect(() => {
    setReturns(serverReturns as ReturnEntry[])
  }, [serverReturns])

  const filtered = returns
    .filter(r => {
      if (filterSupplier !== 'all' && r.supplierId !== filterSupplier) return false
      if (filterMonth && !r.dateIso.startsWith(filterMonth)) return false
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      if (filterEmployee !== 'all' && r.createdBy !== filterEmployee) return false
      return true
    })
    .sort((a, b) => (b.dateIso || '').localeCompare(a.dateIso || ''))

  const totalApproved = returns.filter(r => r.status === 'אושר').reduce((s, r) => s + r.amount, 0)
  const countPending  = returns.filter(r => r.status === 'בטיפול').length

  function openAdd() {
    setEditId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function openEdit(id: string) {
    const r = returns.find(ret => ret.id === id)
    if (!r) return
    setEditId(id)
    setForm({
      supplierId: r.supplierId,
      dateIso: r.dateIso,
      amountStr: String(r.amount),
      reason: r.reason,
      originalInvoiceId: r.originalInvoiceId ?? '',
      createdBy: r.createdBy,
      status: r.status,
    })
    setShowForm(true)
  }

  function handleSave() {
    const amount = Number(form.amountStr)
    if (!form.supplierId || !amount || !form.reason.trim() || !form.dateIso) return

    const sup = suppliersData.find(s => s.id === form.supplierId)
    const supplierName = sup?.name ?? ''

    if (editId) {
      const body = {
        supplierId: form.supplierId,
        supplier: supplierName,
        date: isoToDisplay(form.dateIso),
        dateIso: form.dateIso,
        amount,
        reason: form.reason,
        originalInvoiceId: form.originalInvoiceId || null,
        status: form.status,
        createdBy: form.createdBy,
      }
      setReturns(prev => prev.map(r => r.id !== editId ? r : { ...r, ...body }))
      updateReturn(editId, body).catch(() => {})
    } else {
      const newId = `RET-${String(returns.length + 1).padStart(3, '0')}`
      const entry = {
        id: newId,
        date: isoToDisplay(form.dateIso),
        dateIso: form.dateIso,
        supplierId: form.supplierId,
        supplier: supplierName,
        amount,
        reason: form.reason,
        originalInvoiceId: form.originalInvoiceId || null,
        status: form.status,
        createdBy: form.createdBy,
      }
      setReturns(prev => [entry, ...prev])
      createReturn(entry).catch(() => {})
    }

    setShowForm(false)
    setEditId(null)
  }

  const hasFilter = filterSupplier !== 'all' || filterMonth !== '' || filterStatus !== 'all' || filterEmployee !== 'all'

  const COL = isTablet
    ? '95px 1fr 100px 2fr 110px 100px'
    : '95px 1fr 110px 2fr 140px 105px 110px 72px'
  const MIN_W = isTablet ? '580px' : '880px'

  if (loading && returns.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#E8645A' }} />
      </div>
    )
  }

  return (
    <div className="space-y-6" dir="rtl">
      {error && (
        <div className="rounded-xl p-3 text-sm text-right" style={{ background: '#FEF9C3', color: '#92400E' }}>
          לא ניתן לטעון נתונים מהשרת — מוצגים נתוני ברירת מחדל
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-xl font-bold text-white transition-all"
          style={{ minHeight: '44px', padding: '0 20px', background: '#7C3AED', fontSize: '15px' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#6D28D9')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
        >
          <Plus className="w-4 h-4" />
          הוסף חזרה
        </button>
        <div className="text-right">
          <h1 className="text-2xl font-black text-gray-800">חזרות וזיכויים</h1>
          <p className="text-gray-500 text-sm mt-0.5">ניהול החזרות וזיכויים מול ספקים</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#E2E4E9' }}>
          <p className="text-2xl font-black" style={{ color: '#7C3AED' }}>{returns.length}</p>
          <p className="text-gray-500 text-sm mt-1">סה"כ חזרות</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#E2E4E9' }}>
          <p className="text-2xl font-black" style={{ color: '#166534' }}>{fmtILS(totalApproved)}</p>
          <p className="text-gray-500 text-sm mt-1">זוכה מאושר</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#E2E4E9' }}>
          <p className="text-2xl font-black" style={{ color: countPending > 0 ? '#D97706' : '#6B7280' }}>
            {countPending}
          </p>
          <p className="text-gray-500 text-sm mt-1">בטיפול</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border p-4" style={{ borderColor: '#E2E4E9' }}>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <div>
            <p className="text-right mb-1.5 text-xs font-semibold text-gray-500">ספק</p>
            <select
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #E2E4E9', fontSize: '14px', background: 'white', direction: 'rtl', color: '#1A1D23', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">כל הספקים</option>
              {suppliersData.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <p className="text-right mb-1.5 text-xs font-semibold text-gray-500">חודש</p>
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #E2E4E9', fontSize: '14px', background: 'white', direction: 'ltr', cursor: 'pointer', outline: 'none' }}
            />
          </div>

          <div>
            <p className="text-right mb-1.5 text-xs font-semibold text-gray-500">סטטוס</p>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as ReturnStatus | 'all')}
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #E2E4E9', fontSize: '14px', background: 'white', direction: 'rtl', color: '#1A1D23', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">כל הסטטוסים</option>
              <option value="אושר">אושר</option>
              <option value="בטיפול">בטיפול</option>
              <option value="נדחה">נדחה</option>
            </select>
          </div>

          <div>
            <p className="text-right mb-1.5 text-xs font-semibold text-gray-500">עובדת</p>
            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #E2E4E9', fontSize: '14px', background: 'white', direction: 'rtl', color: '#1A1D23', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">כל העובדות</option>
              {EMPLOYEES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {hasFilter && (
            <div className="flex items-end">
              <button
                onClick={() => { setFilterSupplier('all'); setFilterMonth(''); setFilterStatus('all'); setFilterEmployee('all') }}
                className="flex items-center gap-1.5 px-3 rounded-xl text-sm font-semibold border transition-colors"
                style={{ borderColor: '#E2E4E9', color: '#6B7280', height: '40px' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
              >
                <X className="w-3.5 h-3.5" />
                נקה
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#E2E4E9' }}>
          <span className="text-sm text-gray-400">{filtered.length} רשומות</span>
          <h2 className="font-bold text-gray-800">רשימת חזרות</h2>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div
            className="grid text-xs font-bold text-gray-500 border-b"
            style={{ gridTemplateColumns: COL, minWidth: MIN_W, padding: '10px 16px', background: '#F8F9FA', borderColor: '#E2E4E9', textAlign: 'right' }}
          >
            <span>תאריך</span>
            <span>ספק</span>
            <span>סכום</span>
            <span>סיבה</span>
            <span>חשבונית מקורית</span>
            <span>סטטוס</span>
            {!isTablet && <span>נוצר ע"י</span>}
            {!isTablet && <span className="text-center">פעולות</span>}
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <RotateCcw className="w-10 h-10 mx-auto mb-3" style={{ color: '#E2E4E9' }} />
              <p className="text-gray-400 text-sm">לא נמצאו חזרות</p>
            </div>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                className="grid items-center border-b transition-colors cursor-pointer"
                style={{ gridTemplateColumns: COL, minWidth: MIN_W, padding: '14px 16px', borderColor: '#E2E4E9', textAlign: 'right' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                onClick={() => openEdit(r.id)}
              >
                <span className="text-sm text-gray-500">{r.date}</span>
                <span className="text-sm font-semibold text-gray-800">{r.supplier}</span>
                <span className="text-sm font-bold" style={{ color: '#7C3AED' }}>{fmtILS(r.amount)}</span>
                <span className="text-sm text-gray-600 truncate" title={r.reason} style={{ paddingLeft: '8px' }}>{r.reason}</span>
                <span className="text-xs font-mono" style={{ color: r.originalInvoiceId ? '#6B7280' : '#D1D5DB' }}>
                  {r.originalInvoiceId ?? '—'}
                </span>
                <StatusBadge status={r.status} />
                {!isTablet && <span className="text-sm text-gray-500">{r.createdBy}</span>}
                {!isTablet && (
                  <div
                    className="flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => openEdit(r.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                      style={{ background: '#FFF0EF', color: '#9CA3AF' }}
                      title="עריכה"
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#E8645A')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showForm && (
        <FormModal
          form={form}
          setForm={setForm}
          isEdit={editId !== null}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null) }}
          suppliers={suppliersData}
          invoices={invoicesData}
        />
      )}
    </div>
  )
}
