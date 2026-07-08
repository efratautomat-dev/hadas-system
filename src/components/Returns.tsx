import { useState, useEffect } from 'react'
import { Plus, Pencil, X, CheckCircle2, RotateCcw, Download, Mail, Link2, Clock } from 'lucide-react'
import { useSuppliers } from '../hooks/useSuppliers'
import { useInvoices } from '../hooks/useInvoices'
import { useReturns } from '../hooks/useReturns'
import { useEmployees } from '../hooks/useEmployees'
import type { Employee } from '../hooks/useEmployees'
import { printReturnPDF } from '../utils/pdf'
import type { ReturnPDFData } from '../utils/pdf'
import { PdfPreviewButton, PdfPreviewModal } from './PdfPreviewModal'
import { SearchableSelect } from './SearchableSelect'
import SectionHeader from './SectionHeader'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/Button'
import { SummaryCards } from './ui/SummaryCards'
import { tableWrap, tableHeadRow, tableHeadCell, tableRow, TABLE_HOVER } from './ui/tableStyles'

export type ReturnStatus = 'אושר' | 'בטיפול' | 'נדחה'

interface ReturnEntry {
  id: string
  date: string
  dateIso: string
  supplierId: string
  supplier: string
  amount: number
  reason: string
  detail: string
  originalInvoiceId: string | null
  status: ReturnStatus
  employeeId: string | null
  createdBy: string
  driveFileLink?: string
  supplierCreditNoteNumber?: string | null
  supplierCreditNoteDate?: string | null
  supplierCreditNoteAmount?: number | null
  source?: string | null
  gmailMessageId?: string | null
  messageLink?: string | null
}

export interface FormState {
  supplierId: string
  dateIso: string
  amountStr: string
  reason: string
  detail: string
  originalInvoiceId: string
  employeeId: string
  status: ReturnStatus
}

// Returns use ONLY new (חדש) → closed (נסגר) (spec/06-RULES.md §2a): a return is
// `closed` once a matching supplier credit note is linked, otherwise `new`. The
// screen's status badge/filter/stats all derive from this — the legacy DB `status`
// column is no longer surfaced in the UI.
function returnStatusInternal(r: ReturnEntry): string {
  const linked = !!r.supplierCreditNoteNumber || r.supplierCreditNoteAmount != null
  return linked ? 'closed' : 'new'
}

// TWO VIEWS split by SOURCE (spec/01-PRD.md §6). Prefer the explicit `source` column;
// when it's missing/null, derive from the email-ingest markers (arrived credit notes
// carry a gmail id / message link). Anything else is treated as a manual entry.
function returnSource(r: ReturnEntry): 'manual' | 'email' {
  if (r.source === 'email' || r.source === 'manual') return r.source
  return (r.gmailMessageId || r.messageLink) ? 'email' : 'manual'
}

// The linked credit-note document URL for a matched (closed) return, if any.
function creditNoteDocUrl(r: ReturnEntry): string | null {
  return r.driveFileLink || null
}

// RETURN ↔ CREDIT-NOTE MATCHING (spec/06-RULES.md §2a): a credit note matches a
// manual return with the SAME supplier and the SAME amount. This is the read-side
// of the rule — it finds the manual return a given arrived credit note belongs to.
// ⚠️ The actual auto-match WRITE (flip status → closed + link the two docs) runs in
// the ingest/hadas-api backend on credit-note arrival — verify after backend deploy.
function matchReturnForCreditNote(cn: ReturnEntry, all: ReturnEntry[]): ReturnEntry | null {
  const cnAmount = cn.supplierCreditNoteAmount ?? cn.amount
  if (!cnAmount) return null
  return all.find(r =>
    returnSource(r) === 'manual' &&
    r.supplierId === cn.supplierId &&
    Math.abs(r.amount) === Math.abs(cnAmount),
  ) ?? null
}

function fmtILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

export function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function emptyForm(): FormState {
  return {
    supplierId: '',
    dateIso: new Date().toISOString().slice(0, 10),
    amountStr: '',
    reason: '',
    detail: '',
    originalInvoiceId: '',
    employeeId: '',
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
  employees: Employee[]
}

export function FormModal({ form, setForm, isEdit, onSave, onClose, suppliers, invoices, employees }: FormModalProps) {
  const supplierInvoices = invoices.filter(inv => inv.supplierId === form.supplierId)
  const selectedSupplier = suppliers.find(s => s.id === form.supplierId)
  // Tracking-only: no amount input; the matching credit note sets the amount later.
  const canSave = !!form.supplierId && !!form.reason.trim() && !!form.dateIso

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
            <SearchableSelect
              value={form.supplierId}
              onChange={(v) => setForm({ ...form, supplierId: v, originalInvoiceId: '' })}
              placeholder="— בחר ספק —"
              options={suppliers.filter(s => s.status === 'פעיל').map(s => ({
                value: s.id,
                label: s.name,
                keywords: (s as { hp?: string }).hp,
              }))}
            />
            {selectedSupplier && (
              <p className="text-right mt-1" style={{ fontSize: '12px', color: '#9CA3AF' }}>
                יתרה נוכחית: {fmtILS(selectedSupplier.balance)}
              </p>
            )}
          </div>

          {/* Date only — returns are tracking-only (no amount at creation) */}
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
              rows={2}
              style={{ ...inputBase, resize: 'vertical', minHeight: '60px' }}
              onFocus={focus as React.FocusEventHandler<HTMLTextAreaElement>}
              onBlur={blur as React.FocusEventHandler<HTMLTextAreaElement>}
            />
          </div>

          {/* Detail */}
          <div>
            <label style={labelBase}>פירוט</label>
            <textarea
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              placeholder="פרטים נוספים: מצב הסחורה, כמות, הערות..."
              rows={2}
              style={{ ...inputBase, resize: 'vertical', minHeight: '60px' }}
              onFocus={focus as React.FocusEventHandler<HTMLTextAreaElement>}
              onBlur={blur as React.FocusEventHandler<HTMLTextAreaElement>}
            />
          </div>

          {/* Created by (no status field — a return is חדש until a credit note closes it) */}
          <div>
            <label style={labelBase}>נוצר על ידי</label>
            <select
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              style={inputBase}
              onFocus={focus as React.FocusEventHandler<HTMLSelectElement>}
              onBlur={blur as React.FocusEventHandler<HTMLSelectElement>}
            >
              <option value="">— בחר עובד —</option>
              {employees.filter(e => e.active).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          {/* Tracking-only notice */}
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
            style={{ background: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}
          >
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            החזרה היא רישום מעקב בלבד — הסכום ייקבע כשתגיע חשבונית זיכוי תואמת.
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: '#E2E4E9' }}>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button variant="primary" onClick={onSave} disabled={!canSave}>
            {isEdit ? 'שמור שינויים' : 'הוסף חזרה'}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ReturnsProps {
  // When set (e.g. via a return_amount_mismatch alert), the matching return's
  // edit modal is opened directly so the user lands on the single-entity view.
  initialEditId?: string
}

export default function Returns({ initialEditId }: ReturnsProps = {}) {
  const isTablet = useIsTablet()
  const { data: serverReturns, loading, error, create: createReturn, update: updateReturn } = useReturns()
  const { data: suppliersData } = useSuppliers()
  const { data: invoicesData } = useInvoices()
  const { data: employees } = useEmployees()
  const [returns, setReturns] = useState<ReturnEntry[]>([])
  const [view, setView] = useState<'manual' | 'arrived'>('manual')
  // Credit-note document shown in the in-app preview modal (from the link button).
  const [creditDoc, setCreditDoc] = useState<string | null>(null)
  const [filterSupplier, setFilterSupplier] = useState('all')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'closed'>('all')
  const [filterEmployee, setFilterEmployee] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [justSaved, setJustSaved] = useState<ReturnPDFData | null>(null)
  const [autoOpenedEditId, setAutoOpenedEditId] = useState<string | null>(null)

  useEffect(() => {
    setReturns(serverReturns as ReturnEntry[])
  }, [serverReturns])

  // TWO VIEWS: (a) arrived credit notes (source=email), (b) manual entries (source=manual).
  const manualReturns  = returns.filter(r => returnSource(r) === 'manual')
  const arrivedReturns = [...returns.filter(r => returnSource(r) === 'email')]
    .sort((a, b) => (b.dateIso || '').localeCompare(a.dateIso || ''))

  const filtered = manualReturns
    .filter(r => {
      if (filterSupplier !== 'all' && r.supplierId !== filterSupplier) return false
      if (filterMonth && !r.dateIso.startsWith(filterMonth)) return false
      if (filterStatus !== 'all' && returnStatusInternal(r) !== filterStatus) return false
      if (filterEmployee !== 'all' && r.employeeId !== filterEmployee) return false
      return true
    })
    .sort((a, b) => (b.dateIso || '').localeCompare(a.dateIso || ''))

  // Returns are only new (חדש) → closed (נסגר) — derived from the credit-note link.
  const countClosed = manualReturns.filter(r => returnStatusInternal(r) === 'closed').length
  const countOpen   = manualReturns.filter(r => returnStatusInternal(r) === 'new').length

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
      detail: r.detail,
      originalInvoiceId: r.originalInvoiceId ?? '',
      employeeId: r.employeeId ?? '',
      status: r.status,
    })
    setShowForm(true)
  }

  // Auto-open the edit modal when arriving from a return_amount_mismatch alert.
  // Guards against reopening if the user closes the modal but the prop hasn't changed.
  useEffect(() => {
    if (!initialEditId) return
    if (returns.length === 0) return
    if (autoOpenedEditId === initialEditId) return
    if (!returns.find(r => r.id === initialEditId)) return
    openEdit(initialEditId)
    setAutoOpenedEditId(initialEditId)
  // openEdit closes over `returns` state; listing it is sufficient
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId, returns])

  async function handleSave() {
    // Tracking-only: amount is not required at creation (0 until a credit note sets it).
    const amount = Number(form.amountStr) || 0
    if (!form.supplierId || !form.reason.trim() || !form.dateIso) return

    const sup = suppliersData.find(s => s.id === form.supplierId)
    const supplierName = sup?.name ?? ''
    const emp = employees.find(e => e.id === form.employeeId)
    const createdByName = emp?.name ?? ''

    setShowForm(false)
    setEditId(null)

    if (editId) {
      const body = {
        supplierId: form.supplierId,
        supplier: supplierName,
        date: isoToDisplay(form.dateIso),
        dateIso: form.dateIso,
        amount,
        reason: form.reason,
        detail: form.detail,
        originalInvoiceId: form.originalInvoiceId || null,
        status: form.status,
        employeeId: form.employeeId || null,
        createdBy: createdByName,
      }
      try {
        await updateReturn(editId, body)
      } catch {
        // hook sets error state
      }
    } else {
      const entry = {
        date: isoToDisplay(form.dateIso),
        dateIso: form.dateIso,
        supplierId: form.supplierId,
        supplier: supplierName,
        amount,
        reason: form.reason,
        detail: form.detail,
        originalInvoiceId: form.originalInvoiceId || null,
        status: form.status,
        employeeId: form.employeeId || null,
        createdBy: createdByName,
      }
      const pdfSnapshot: ReturnPDFData = {
        id: '—',
        date: isoToDisplay(form.dateIso),
        dateIso: form.dateIso,
        status: 'חדש',
        amount,
        reason: form.reason,
        detail: form.detail,
        originalInvoiceId: form.originalInvoiceId || null,
        createdBy: createdByName,
        supplierName,
        supplierHp: (sup as Record<string, string> | undefined)?.hp,
        supplierContact: sup?.contact,
        supplierPhone: sup?.phone,
      }
      try {
        await createReturn(entry)
        setJustSaved(pdfSnapshot)
        setTimeout(() => setJustSaved(null), 9000)
      } catch {
        // hook sets error state
      }
    }
  }

  const hasFilter = filterSupplier !== 'all' || filterMonth !== '' || filterStatus !== 'all' || filterEmployee !== 'all'

  const COL = isTablet
    ? '95px 1fr 100px 2fr 130px 105px 100px'
    : '95px 1fr 110px 2fr 150px 110px 105px 110px 88px'
  const MIN_W = isTablet ? '680px' : '1020px'

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
        <div className="text-right">
          <h1 className="text-2xl font-black text-gray-800">חזרות וזיכויים</h1>
          <p className="text-gray-500 text-sm mt-0.5">ניהול החזרות וזיכויים מול ספקים</p>
        </div>
        <Button variant="primary" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          הוסף חזרה
        </Button>
      </div>

      {/* Stats (manual entries) */}
      <SummaryCards items={[
        { label: 'סה"כ חזרות', value: manualReturns.length, Icon: RotateCcw, tone: 'brand' },
        { label: 'נסגרו (זוכה)', value: countClosed, Icon: CheckCircle2, tone: 'green' },
        { label: 'פתוחות', value: countOpen, Icon: Clock, tone: 'blue' },
      ]} />

      {/* View tabs — (b) manual entries · (a) arrived credit notes */}
      <div className="inline-flex items-center gap-1 rounded-xl p-1" style={{ background: '#F3F4F6' }}>
        {([
          { key: 'manual' as const,  label: `יצירה ידנית · ${manualReturns.length}` },
          { key: 'arrived' as const, label: `מסמכים שהגיעו · ${arrivedReturns.length}` },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className="rounded-lg transition-all"
            style={{
              minHeight: '36px', padding: '0 16px', fontSize: '14px', border: 'none',
              fontWeight: view === key ? 700 : 500,
              background: view === key ? 'var(--brand-active-bg)' : 'transparent',
              color:      view === key ? 'var(--brand-primary)' : '#6B7280',
              boxShadow:  view === key ? '0 1px 2px rgba(16,17,21,.08)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Post-create download banner */}
      {justSaved && (
        <div
          className="flex items-center justify-between rounded-2xl px-5 py-3"
          style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}
        >
          <button onClick={() => setJustSaved(null)} style={{ color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => printReturnPDF(justSaved)}
              className="flex items-center gap-1.5 rounded-xl font-bold text-white transition-all"
              style={{ padding: '6px 14px', background: 'var(--brand-primary)', fontSize: '13px', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary-dark)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary)')}
            >
              <Download className="w-3.5 h-3.5" />
              הורד מסמך
            </button>
            <span className="font-semibold" style={{ fontSize: '14px', color: '#166534' }}>חזרה נוצרה בהצלחה</span>
            <CheckCircle2 className="w-5 h-5" style={{ color: '#16a34a' }} />
          </div>
        </div>
      )}

      {view === 'manual' && (
      <>
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border p-4" style={{ borderColor: '#E2E4E9' }}>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <div>
            <p className="text-right mb-1.5 text-xs font-semibold text-gray-500">ספק</p>
            <SearchableSelect
              value={filterSupplier}
              onChange={setFilterSupplier}
              placeholder="כל הספקים"
              allowClear
              clearValue="all"
              options={suppliersData.map(s => ({
                value: s.id,
                label: s.name,
                keywords: (s as { hp?: string }).hp,
              }))}
              style={{ height: '40px', fontSize: '14px' }}
            />
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
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'new' | 'closed')}
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #E2E4E9', fontSize: '14px', background: 'white', direction: 'rtl', color: '#1A1D23', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">כל הסטטוסים</option>
              <option value="new">חדש</option>
              <option value="closed">נסגר</option>
            </select>
          </div>

          <div>
            <p className="text-right mb-1.5 text-xs font-semibold text-gray-500">עובד</p>
            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: '1px solid #E2E4E9', fontSize: '14px', background: 'white', direction: 'rtl', color: '#1A1D23', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">כל העובדים</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
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
      <div style={tableWrap}>
        <SectionHeader
          className="px-5 py-4 border-b"
          style={{ borderColor: '#EEEEF2' }}
          action={<span className="text-sm text-gray-400">{filtered.length} רשומות</span>}
          title={<h2 className="font-bold text-gray-800">רשימת חזרות</h2>}
        />

        <div style={{ overflowX: 'auto' }}>
          <div
            className="grid"
            style={{ ...tableHeadRow, display: 'grid', gridTemplateColumns: COL, minWidth: MIN_W }}
          >
            <span style={tableHeadCell}>תאריך</span>
            <span style={tableHeadCell}>ספק</span>
            <span style={tableHeadCell}>סכום</span>
            <span style={tableHeadCell}>סיבה</span>
            <span style={tableHeadCell}>תעודת זיכוי מספק</span>
            <span style={tableHeadCell}>סכום זיכוי</span>
            <span style={tableHeadCell}>סטטוס</span>
            {!isTablet && <span style={tableHeadCell}>נוצר ע"י</span>}
            {!isTablet && <span className="text-center" style={tableHeadCell}>פעולות</span>}
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <RotateCcw className="w-10 h-10 mx-auto mb-3" style={{ color: '#E2E4E9' }} />
              <p className="text-gray-400 text-sm">לא נמצאו חזרות</p>
            </div>
          ) : (
            filtered.map((r, index) => (
              <div
                key={r.id}
                className="grid items-center transition-colors cursor-pointer"
                style={{ ...tableRow(index === 0), display: 'grid', gridTemplateColumns: COL, minWidth: MIN_W }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = TABLE_HOVER)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                onClick={() => openEdit(r.id)}
              >
                <span className="text-sm text-gray-500">{r.date}</span>
                <span className="text-sm font-semibold text-gray-800">{r.supplier}</span>
                <span className="text-sm font-bold" style={{ color: '#7C3AED' }}>{fmtILS(r.amount)}</span>
                <span className="text-sm text-gray-600 truncate" title={r.reason} style={{ paddingLeft: '8px' }}>{r.reason}</span>
                {returnStatusInternal(r) === 'closed' && creditNoteDocUrl(r) ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCreditDoc(creditNoteDocUrl(r)) }}
                    className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg"
                    style={{ color: '#166534', background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '4px 8px' }}
                    title={r.supplierCreditNoteNumber ? `חשבונית זיכוי ${r.supplierCreditNoteNumber}` : 'חשבונית זיכוי מקושרת'}
                  >
                    <Link2 className="w-3.5 h-3.5 flex-shrink-0" />
                    קישור לחשבונית זיכוי
                  </button>
                ) : r.supplierCreditNoteNumber ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-mono font-semibold"
                    style={{ color: '#166534' }}
                    title={r.supplierCreditNoteDate ? `הונפק ${isoToDisplay(r.supplierCreditNoteDate)}` : undefined}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    {r.supplierCreditNoteNumber}
                  </span>
                ) : (
                  <span className="text-xs font-medium" style={{ color: '#9CA3AF' }}>ממתין</span>
                )}
                <span className="text-sm font-bold" style={{ color: r.supplierCreditNoteAmount != null ? '#166534' : '#D1D5DB' }}>
                  {r.supplierCreditNoteAmount != null ? fmtILS(r.supplierCreditNoteAmount) : '—'}
                </span>
                <StatusBadge status={returnStatusInternal(r)} />
                {!isTablet && <span className="text-sm text-gray-500">{r.createdBy}</span>}
                {!isTablet && (
                  <div
                    className="flex items-center justify-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.driveFileLink && <PdfPreviewButton url={r.driveFileLink} title="תצוגה מקדימה של זיכוי הספק" />}
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
                    <button
                      onClick={() => {
                        const sup = suppliersData.find(s => s.id === r.supplierId)
                        printReturnPDF({
                          id: r.id,
                          date: r.date,
                          dateIso: r.dateIso,
                          status: returnStatusInternal(r) === 'closed' ? 'נסגר' : 'חדש',
                          amount: r.amount,
                          reason: r.reason,
                          detail: r.detail,
                          originalInvoiceId: r.originalInvoiceId,
                          createdBy: r.createdBy,
                          supplierName: r.supplier,
                          supplierHp: (sup as Record<string, string> | undefined)?.hp,
                          supplierContact: sup?.contact,
                          supplierPhone: sup?.phone,
                        })
                      }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                      style={{ background: 'var(--brand-active-bg)', color: '#9CA3AF' }}
                      title="הורד מסמך"
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--brand-primary)')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      </>
      )}

      {/* Arrived documents view — credit notes received by email (source=email) */}
      {view === 'arrived' && (
        <div style={tableWrap}>
          <SectionHeader
            className="px-5 py-4 border-b"
            style={{ borderColor: '#EEEEF2' }}
            action={<span className="text-sm text-gray-400">{arrivedReturns.length} מסמכים</span>}
            title={<h2 className="font-bold text-gray-800">מסמכים שהגיעו במייל</h2>}
          />
          <div style={{ overflowX: 'auto' }}>
            <div
              className="grid"
              style={{ ...tableHeadRow, display: 'grid', gridTemplateColumns: '110px 1fr 130px 120px 150px 90px', minWidth: '720px' }}
            >
              <span style={tableHeadCell}>תאריך</span>
              <span style={tableHeadCell}>ספק</span>
              <span style={tableHeadCell}>מס׳ זיכוי</span>
              <span style={tableHeadCell}>סכום</span>
              <span style={tableHeadCell}>התאמה להחזרה</span>
              <span className="text-center" style={tableHeadCell}>מסמך</span>
            </div>

            {arrivedReturns.length === 0 ? (
              <div className="py-16 text-center">
                <Mail className="w-10 h-10 mx-auto mb-3" style={{ color: '#E2E4E9' }} />
                <p className="text-gray-400 text-sm">לא התקבלו מסמכי זיכוי במייל</p>
              </div>
            ) : (
              arrivedReturns.map((r, index) => {
                const matchedReturn = matchReturnForCreditNote(r, returns)
                return (
                <div
                  key={r.id}
                  className="grid items-center transition-colors"
                  style={{ ...tableRow(index === 0), display: 'grid', gridTemplateColumns: '110px 1fr 130px 120px 150px 90px', minWidth: '720px' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = TABLE_HOVER)}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <span className="text-sm text-gray-500">{r.date}</span>
                  <span className="text-sm font-semibold text-gray-800">{r.supplier}</span>
                  <span className="text-xs font-mono font-semibold" style={{ color: '#166534' }}>
                    {r.supplierCreditNoteNumber || '—'}
                  </span>
                  <span className="text-sm font-bold" style={{ color: '#7C3AED' }}>
                    {r.supplierCreditNoteAmount != null ? fmtILS(r.supplierCreditNoteAmount) : (r.amount ? fmtILS(r.amount) : '—')}
                  </span>
                  {/* Read-side of the matching rule; the auto-link WRITE is backend (see helper). */}
                  {matchedReturn ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#166534' }}>
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                      תואם · {matchedReturn.supplier}
                    </span>
                  ) : (
                    <span className="text-xs font-medium" style={{ color: '#9CA3AF' }}>ללא החזרה תואמת</span>
                  )}
                  <div className="flex items-center justify-center">
                    {r.driveFileLink
                      ? <PdfPreviewButton url={r.driveFileLink} title="תצוגה מקדימה של חשבונית הזיכוי" />
                      : <span className="text-xs text-gray-300">—</span>}
                  </div>
                </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          form={form}
          setForm={setForm}
          isEdit={editId !== null}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null) }}
          suppliers={suppliersData}
          invoices={invoicesData}
          employees={employees}
        />
      )}

      {/* Linked credit-note document — opened in the app's in-page preview modal */}
      {creditDoc && (
        <PdfPreviewModal url={creditDoc} onClose={() => setCreditDoc(null)} />
      )}
    </div>
  )
}
