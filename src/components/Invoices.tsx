import { useState, useEffect } from 'react'
import { FileText, Search, ChevronRight, ExternalLink, Save, AlertTriangle, X, RefreshCw } from 'lucide-react'
import { type Invoice } from '../data/mockData'
import { useInvoices } from '../hooks/useInvoices'
import { useSuppliers } from '../hooks/useSuppliers'

// ── Email-sync helper ──────────────────────────────────────────────────────

interface SyncResult { processed: number; alerts: number; skipped?: number; errors?: string[] }

async function triggerInvoicesIngest(): Promise<SyncResult> {
  const base = import.meta.env.VITE_SUPABASE_URL as string
  const key  = import.meta.env.VITE_HADAS_API_KEY as string
  const res = await fetch(`${base}/functions/v1/invoices-ingest`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-hadas-key': key },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as SyncResult
}

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  'ספקים ביגוד', 'ספקים כיסויי ראש', 'ספקים בגדי ים', 'ספקים שונות',
  'הוצאות ניהול', 'הוצאות משרד', 'תשלומי מס הכנסה', 'משכורות', 'שונות',
]

const STATUSES = ['ממתין', 'בטיפול', 'הושלם', 'שגיאה']
const QUALITIES = ['גבוהה', 'בינונית', 'נמוכה']

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: '#FEF9C3', color: '#A16207' },
  'בטיפול': { bg: '#DBEAFE', color: '#1E40AF' },
  'הושלם':  { bg: '#DCFCE7', color: '#166534' },
  'שגיאה':  { bg: '#FEE2E2', color: '#DC2626' },
}

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

// ── Field primitives ────────────────────────────────────────────────────────

const BASE: React.CSSProperties = {
  border: '1.5px solid #DEDFE5',
  borderRadius: '10px',
  padding: '9px 13px',
  fontSize: '15px',
  textAlign: 'right',
  direction: 'rtl',
  background: 'white',
  width: '100%',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

function useFocus() {
  const [on, set] = useState(false)
  return { on, onFocus: () => set(true), onBlur: () => set(false) }
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

function useIsTablet() {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640 && window.innerWidth <= 1024)
  useEffect(() => {
    const h = () => setV(window.innerWidth >= 640 && window.innerWidth <= 1024)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

function Lbl({ t }: { t: string }) {
  return (
    <span style={{ fontSize: '13px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '5px', textAlign: 'right' }}>
      {t}
    </span>
  )
}

function TInput({
  label, value, onChange, type = 'text', readOnly = false,
}: {
  label: string; value: string; onChange?: (v: string) => void; type?: string; readOnly?: boolean
}) {
  const f = useFocus()
  return (
    <div>
      <Lbl t={label} />
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        readOnly={readOnly}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{ ...BASE, borderColor: f.on && !readOnly ? '#D32F4A' : '#DEDFE5', background: readOnly ? '#F8F8FA' : 'white' }}
      />
    </div>
  )
}

function TSelect({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void
  options: string[] | { value: string; label: string }[]
}) {
  const f = useFocus()
  const opts = (options as any[]).map((o: any) =>
    typeof o === 'string' ? { value: o, label: o } : o
  )
  return (
    <div>
      <Lbl t={label} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{ ...BASE, borderColor: f.on ? '#D32F4A' : '#DEDFE5', cursor: 'pointer' }}
      >
        <option value="">-- בחר --</option>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function TCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', cursor: 'pointer', padding: '8px 0', userSelect: 'none' }}
      onClick={() => onChange(!checked)}
    >
      <span style={{ fontSize: '15px', color: '#374151' }}>{label}</span>
      <div style={{
        width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0,
        border: checked ? '2px solid #D32F4A' : '2px solid #D1C4C4',
        background: checked ? '#D32F4A' : 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}>
        {checked && (
          <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
            <path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  )
}

function TTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const f = useFocus()
  return (
    <div>
      <Lbl t={label} />
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        rows={4}
        style={{ ...BASE, borderColor: f.on ? '#D32F4A' : '#DEDFE5', resize: 'vertical', lineHeight: 1.6 }}
      />
    </div>
  )
}

function TLink({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const f = useFocus()
  return (
    <div>
      <Lbl t={label} />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={f.onFocus}
          onBlur={f.onBlur}
          placeholder="https://..."
          dir="ltr"
          style={{ ...BASE, flex: 1, textAlign: 'left', borderColor: f.on ? '#D32F4A' : '#DEDFE5' }}
        />
        {value && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '9px 11px', borderRadius: '10px', border: '1.5px solid #DEDFE5',
              color: '#D32F4A', display: 'flex', alignItems: 'center', flexShrink: 0, textDecoration: 'none',
            }}
          >
            <ExternalLink size={16} />
          </a>
        )}
      </div>
    </div>
  )
}

// ── Group ───────────────────────────────────────────────────────────────────

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #EEEEF2', overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid #EEEEF2', background: '#FAFAFC' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#D32F4A', textAlign: 'right' }}>{title}</h3>
      </div>
      <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {children}
      </div>
    </div>
  )
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
      {children}
    </div>
  )
}

// ── Invoice Detail ──────────────────────────────────────────────────────────

function InvoiceDetail({
  invoice, onBack, onSave,
}: {
  invoice: Invoice; onBack: () => void; onSave: (inv: Invoice) => void
}) {
  const { data: suppliersData } = useSuppliers()
  const [form, setForm] = useState<Invoice>({ ...invoice })

  const set = (field: keyof Invoice) => (value: any) => {
    setForm(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'amountBeforeVat') {
        next.vat = Math.round((parseFloat(value) || 0) * 0.17)
      }
      if (field === 'amountBeforeVat' || field === 'vat') {
        next.amount = (parseFloat(next.amountBeforeVat as any) || 0) + (parseFloat(next.vat as any) || 0)
      }
      return next
    })
  }

  const handleSupplier = (supplierId: string) => {
    const sup = suppliersData.find(s => s.id === supplierId)
    setForm(prev => ({ ...prev, supplierId, supplier: sup?.name ?? prev.supplier }))
  }

  const total = (Number(form.amountBeforeVat) || 0) + (Number(form.vat) || 0)
  const st = STATUS_STYLE[form.status] ?? { bg: '#F3F4F6', color: '#6B7280' }

  return (
    <div dir="rtl" style={{ maxWidth: '800px', margin: '0 auto' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <button
          onClick={() => onSave(form)}
          style={{
            background: '#D32F4A', color: 'white', border: 'none', borderRadius: '12px',
            padding: '10px 22px', fontSize: '15px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '7px',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#A8213B')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#D32F4A')}
        >
          <Save size={16} />
          שמור
        </button>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <span
              style={{ ...st, fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: '8px' }}
            >
              {form.status}
            </span>
            <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 600, color: '#1F2937' }}>{form.id}</h2>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#9CA3AF' }}>{form.supplier}</p>
        </div>

        <button
          onClick={onBack}
          style={{
            background: 'white', border: '1.5px solid #DEDFE5', borderRadius: '12px',
            padding: '10px 16px', fontSize: '14px', color: '#6B7280', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
        >
          <ChevronRight size={16} />
          חזרה
        </button>
      </div>

      {/* Groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* 1 – פרטי חשבונית */}
        <Group title="פרטי חשבונית">
          <Row2>
            <TInput label="מספר חשבונית" value={form.id} onChange={set('id')} />
            <TInput label="תאריך חשבונית" value={form.invoiceDate} onChange={set('invoiceDate')} type="date" />
          </Row2>
          <Row2>
            <TSelect
              label="קישור לספק"
              value={form.supplierId}
              onChange={handleSupplier}
              options={suppliersData.map(s => ({ value: s.id, label: s.name }))}
            />
            <TInput label="שם ספק" value={form.supplier} onChange={set('supplier')} />
          </Row2>
          <TSelect label="קטגוריה" value={form.category} onChange={set('category')} options={CATEGORIES} />
          <TCheckbox label="האם החזר חלקי" checked={form.isPartialReturn} onChange={set('isPartialReturn')} />
          <TTextarea label="פירוט שורות" value={form.lineDetails} onChange={set('lineDetails')} />
        </Group>

        {/* 2 – סכומים */}
        <Group title="סכומים">
          <Row2>
            <TInput label='סכום לפני מע"מ (₪)' value={String(form.amountBeforeVat || '')} onChange={set('amountBeforeVat')} type="number" />
            <TInput label='מע"מ (₪)' value={String(form.vat || '')} onChange={set('vat')} type="number" />
          </Row2>
          <div style={{
            background: '#FAFAFC', border: '1.5px solid #F0D4DA', borderRadius: '12px',
            padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '24px', fontWeight: 600, color: '#D32F4A' }}>{formatILS(total)}</span>
            <span style={{ fontSize: '14px', color: '#9CA3AF' }}>סכום כולל (מחושב אוטומטית)</span>
          </div>
        </Group>

        {/* 3 – פרטי שולח */}
        <Group title="פרטי שולח">
          <Row2>
            <TInput label="שם השולח" value={form.senderName} onChange={set('senderName')} />
            <TInput label="כתובת מייל שולח" value={form.senderEmail} onChange={set('senderEmail')} type="email" />
          </Row2>
        </Group>

        {/* 4 – קישורי גישה */}
        <Group title="קישורי גישה">
          <TLink label="קישור לקובץ בדרייב" value={form.driveFileLink} onChange={set('driveFileLink')} />
          <TLink label="קישור לתיקיית החודש" value={form.monthFolderLink} onChange={set('monthFolderLink')} />
          <TLink label="קישור למייל המקורי" value={form.originalEmailLink} onChange={set('originalEmailLink')} />
        </Group>

        {/* 5 – מטא נתונים */}
        <Group title="מטא נתונים">
          <Row2>
            <TInput label="תאריך ושעת קבלת מייל" value={form.emailReceivedAt} onChange={set('emailReceivedAt')} type="datetime-local" />
            <TInput label="מזהה מייל" value={form.emailId} readOnly />
          </Row2>
          <TInput label="תאריך העלאה" value={form.uploadDate} readOnly />
        </Group>

        {/* 6 – סטטוס ובקרה */}
        <Group title="סטטוס ובקרה">
          <Row2>
            <TSelect label="סטטוס טיפול" value={form.status} onChange={set('status')} options={STATUSES} />
            <TSelect label="איכות פענוח" value={form.decodeQuality} onChange={set('decodeQuality')} options={QUALITIES} />
          </Row2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
            <TCheckbox label="כפילות" checked={form.isDuplicate} onChange={set('isDuplicate')} />
            <TCheckbox label="שגיאה" checked={form.hasError} onChange={set('hasError')} />
            <TCheckbox label='הועבר לרוה"ח' checked={form.sentToAccountant} onChange={set('sentToAccountant')} />
          </div>
          {form.hasError && (
            <TLink label="קישור לשגיאה ב-N8N" value={form.n8nErrorLink} onChange={set('n8nErrorLink')} />
          )}
        </Group>

      </div>
    </div>
  )
}

// ── Invoice List ────────────────────────────────────────────────────────────

type Filter = 'all' | 'ממתין' | 'בטיפול' | 'הושלם' | 'שגיאה' | 'כפילויות'

interface DupModal { invoice: Invoice; pair: Invoice }

interface InvoicesProps {
  initialFilter?: Filter
  controlledSelectedId?: string | null
  onOpenInvoice?: (id: string) => void
  onCloseInvoice?: () => void
}

export default function Invoices({ initialFilter = 'all', controlledSelectedId, onOpenInvoice, onCloseInvoice }: InvoicesProps) {
  const { data: serverInvoices, loading, error, update: updateInvoice, remove: removeInvoice } = useInvoices()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [internalSelected, setInternalSelected] = useState<Invoice | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [dupModal, setDupModal] = useState<DupModal | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncToast, setSyncToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncToast(null)
    try {
      const r = await triggerInvoicesIngest()
      setSyncToast({ msg: `${r.processed} עובדו, ${r.alerts} התראות`, kind: 'success' })
      // refresh list via the hook (its load is triggered by serverInvoices state on next render — easiest: reload page-level data)
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setSyncToast({ msg: `שגיאת סנכרון: ${e instanceof Error ? e.message : String(e)}`, kind: 'error' })
    } finally {
      setSyncing(false)
      window.setTimeout(() => setSyncToast(null), 4000)
    }
  }

  useEffect(() => {
    setInvoices(serverInvoices)
  }, [serverInvoices])

  const isMobile = useIsMobile()
  const isTablet = useIsTablet()

  const selected     = controlledSelectedId !== undefined
    ? (invoices.find(inv => inv.id === controlledSelectedId) ?? null)
    : internalSelected
  const openInvoice  = (inv: Invoice) => onOpenInvoice  ? onOpenInvoice(inv.id)  : setInternalSelected(inv)
  const closeInvoice = ()             => onCloseInvoice ? onCloseInvoice()        : setInternalSelected(null)

  // ── duplicate helpers ────────────────────────────────────────────────────
  const dupCount = invoices.filter(i => i.duplicateFlag === 'כפילות אפשרית').length

  const getDupPair = (inv: Invoice): Invoice | undefined =>
    invoices.find(i => i.id !== inv.id &&
      i.invoiceNumber === inv.invoiceNumber && i.supplierId === inv.supplierId)

  const openDupModal = (inv: Invoice, e: React.MouseEvent) => {
    e.stopPropagation()
    const pair = getDupPair(inv)
    if (!pair) return
    setDupModal({ invoice: inv, pair })
    setConfirmDelete(false)
  }

  const handleSetPrimary = async () => {
    if (!dupModal) return
    const saved = dupModal
    setDupModal(null)
    try {
      await updateInvoice(saved.invoice.id, { duplicateFlag: null })
    } catch {
      // hook sets error state
    }
  }

  const handleDeleteDuplicate = async () => {
    if (!dupModal) return
    const saved = dupModal
    setDupModal(null)
    try {
      await removeInvoice(saved.invoice.id)
    } catch {
      // hook sets error state
    }
  }

  const handleApproveAll = async () => {
    if (!dupModal) return
    const saved = dupModal
    setDupModal(null)
    try {
      await Promise.all([
        updateInvoice(saved.invoice.id, { duplicateFlag: null, duplicateNote: 'אושר ידנית' }),
        updateInvoice(saved.pair.id,    { duplicateFlag: null, duplicateNote: 'אושר ידנית' }),
      ])
    } catch {
      // hook sets error state
    }
  }

  if (selected) {
    return (
      <InvoiceDetail
        invoice={selected}
        onBack={closeInvoice}
        onSave={async (updated) => {
          closeInvoice()
          try {
            await updateInvoice(updated.id, updated)
          } catch {
            // hook sets error state
          }
        }}
      />
    )
  }

  const filtered = invoices.filter(inv => {
    const matchSearch = (inv.supplier || '').includes(search) || (inv.id || '').includes(search) ||
      (inv.invoiceNumber || '').includes(search)
    const matchFilter = filter === 'all'
      ? true
      : filter === 'כפילויות'
        ? inv.duplicateFlag === 'כפילות אפשרית'
        : inv.status === filter
    return matchSearch && matchFilter
  })

  const COL = isMobile ? '1fr 110px 75px' : isTablet ? '1fr 130px 110px 80px' : '1fr 145px 130px 110px 80px'

  const counts = {
    ממתין: invoices.filter(i => i.status === 'ממתין').length,
    הושלם: invoices.filter(i => i.status === 'הושלם').length,
    בטיפול: invoices.filter(i => i.status === 'בטיפול').length,
    שגיאה: invoices.filter(i => i.status === 'שגיאה').length,
  }
  const total = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0)

  if (loading && invoices.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#D32F4A' }} />
      </div>
    )
  }

  return (
    <div className="space-y-5" dir="rtl">
      {error && (
        <div className="rounded-xl p-3 text-sm text-right" style={{ background: '#FEF9C3', color: '#92400E' }}>
          לא ניתן לטעון נתונים מהשרת — מוצגים נתוני ברירת מחדל
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: syncing ? '#F3F4F6' : '#D32F4A',
            color: syncing ? '#9CA3AF' : 'white',
            border: 'none', borderRadius: '12px',
            padding: '10px 18px', fontSize: '14px', fontWeight: 700,
            cursor: syncing ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'מסנכרן...' : 'סנכרן מיילים'}
        </button>
        <div className="text-right">
          <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>חשבוניות</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: '14px' }}>
            {invoices.length} חשבוניות במערכת
          </p>
        </div>
      </div>

      {syncToast && (
        <div
          className="rounded-xl p-3 text-sm text-right"
          style={{
            background: syncToast.kind === 'success' ? '#DCFCE7' : '#FEE2E2',
            color:      syncToast.kind === 'success' ? '#166534' : '#991B1B',
          }}
        >
          {syncToast.msg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[
          { label: 'סה"כ סכום',  value: formatILS(total),        color: '#1F2937' },
          { label: 'ממתין',      value: String(counts['ממתין']),  color: '#A16207' },
          { label: 'בטיפול',     value: String(counts['בטיפול']), color: '#1E40AF' },
          { label: 'הושלם',      value: String(counts['הושלם']),  color: '#166534' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-white rounded-2xl p-4 shadow-sm border text-center"
            style={{ borderColor: '#EEEEF2' }}
          >
            <p className="text-2xl" style={{ color, fontWeight: 500 }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: '13px' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div
          className="bg-white rounded-xl border p-1 flex-shrink-0"
          style={{ borderColor: '#EEEEF2', display: 'flex', gap: '2px' }}
        >
          {(['all', 'ממתין', 'בטיפול', 'הושלם', 'שגיאה', 'כפילויות'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                borderRadius: '8px', padding: '7px 12px', fontSize: '14px', fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: filter === f ? (f === 'כפילויות' ? '#D97706' : '#D32F4A') : 'transparent',
                color: filter === f ? 'white' : f === 'כפילויות' ? '#D97706' : '#6B7280',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}
            >
              {f === 'all' ? 'הכל' : f}
              {f === 'כפילויות' && dupCount > 0 && (
                <span style={{
                  fontSize: '10px', fontWeight: 700,
                  background: filter === 'כפילויות' ? 'rgba(255,255,255,0.3)' : '#FEF9C3',
                  color: filter === 'כפילויות' ? 'white' : '#92400E',
                  borderRadius: '10px', padding: '1px 6px', lineHeight: 1.4,
                }}>
                  {dupCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-2 flex-1 bg-white rounded-xl border px-4"
          style={{ borderColor: '#EEEEF2', minHeight: '44px' }}
        >
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="חיפוש לפי ספק או מספר חשבונית..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-gray-700 text-right"
            style={{ fontSize: '15px' }}
          />
        </div>
      </div>

      {/* Duplicate warning banner */}
      {dupCount > 0 && filter !== 'כפילויות' && (
        <div
          className="rounded-2xl p-4 border flex items-center justify-between cursor-pointer"
          style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}
          onClick={() => setFilter('כפילויות')}
        >
          <button
            className="px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0"
            style={{ background: '#D97706' }}
          >
            לבדיקה ←
          </button>
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="font-bold text-sm" style={{ color: '#92400E' }}>
                נמצאו {dupCount} חשבוניות עם מספר כפול אפשרי
              </p>
              <p className="text-xs text-gray-500 mt-0.5">יש לבדוק ולאשר או למחוק לפני סגירת חודש</p>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: '#FEF3C7', color: '#D97706' }}>
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p style={{ fontSize: '16px' }}>לא נמצאו חשבוניות</p>
          </div>
        ) : (
          <div>
            {/* Column headers */}
            <div
              className="grid font-semibold text-gray-400 uppercase tracking-wider border-b"
              style={{ gridTemplateColumns: COL, borderColor: '#EEEEF2', fontSize: '11px', padding: '10px 16px' }}
            >
              <span className="text-right">ספק</span>
              {!isMobile && <span className="text-right">מסמך · תאריך</span>}
              {!isMobile && !isTablet && <span className="text-right">קטגוריה</span>}
              <span className="text-left">סכום</span>
              <span className="text-center">סטטוס</span>
            </div>

            {/* Data rows */}
            {filtered.map((inv) => {
              const st = STATUS_STYLE[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
              const flags = [
                inv.isDuplicate      && { label: 'כפילות',       bg: '#FEF3C7', color: '#92400E' },
                inv.hasError         && { label: 'שגיאה',         bg: '#FEE2E2', color: '#DC2626' },
                inv.sentToAccountant && { label: 'הועבר לרוה"ח', bg: '#F0FDF4', color: '#166534' },
              ].filter(Boolean) as { label: string; bg: string; color: string }[]

              return (
                <div
                  key={inv.id}
                  className="grid items-center cursor-pointer"
                  style={{
                    gridTemplateColumns: COL,
                    borderBottom: '1px solid #EEEEF2',
                    minHeight: '56px',
                    padding: '12px 16px',
                    transition: 'background 0.12s',
                  }}
                  onClick={() => openInvoice(inv)}
                  onMouseEnter={e => (e.currentTarget.style.background = '#FDF5F6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Col 1: ספק + flags */}
                  <div className="text-right">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                      {inv.duplicateFlag === 'כפילות אפשרית' && isMobile && (
                        <button
                          onClick={e => openDupModal(inv, e)}
                          title="קיימת חשבונית נוספת עם אותו מספר לספק זה"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#D97706', display: 'flex', flexShrink: 0 }}
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                      )}
                      <p style={{ fontSize: '14px', fontWeight: 700, color: '#1F2937', margin: 0 }}>{inv.supplier}</p>
                    </div>
                    {flags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-end', marginTop: '4px' }}>
                        {flags.map(fl => (
                          <span key={fl.label} style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '5px', background: fl.bg, color: fl.color }}>
                            {fl.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Col 2: מסמך + תאריך (desktop only) */}
                  {!isMobile && (
                    <div className="text-right">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '5px' }}>
                        {inv.duplicateFlag === 'כפילות אפשרית' && (
                          <button
                            onClick={e => openDupModal(inv, e)}
                            title="קיימת חשבונית נוספת עם אותו מספר לספק זה"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#D97706', display: 'flex', flexShrink: 0 }}
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </button>
                        )}
                        <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>{inv.invoiceNumber || inv.id}</p>
                      </div>
                      <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '2px 0 0' }}>{inv.date}</p>
                    </div>
                  )}

                  {/* Col 3: קטגוריה (desktop only) */}
                  {!isMobile && !isTablet && (
                    <span className="text-right" style={{ fontSize: '12px', color: '#6B7280' }}>
                      {inv.category || '—'}
                    </span>
                  )}

                  {/* Col 4: סכום */}
                  <span className="text-left font-bold" style={{ fontSize: '15px', color: '#1F2937' }}>
                    {formatILS(inv.amount)}
                  </span>

                  {/* Col 5: סטטוס */}
                  <div className="flex justify-center">
                    <span style={{ ...st, fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '8px' }}>
                      {inv.status}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Duplicate comparison modal */}
      {dupModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => { setDupModal(null); setConfirmDelete(false) }}
        >
          <div
            style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #EEEEF2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                onClick={() => { setDupModal(null); setConfirmDelete(false) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px', borderRadius: '8px' }}
              >
                <X className="w-5 h-5" />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: 600, color: '#1F2937', margin: 0 }}>השוואת חשבוניות כפולות</h2>
                <AlertTriangle className="w-5 h-5" style={{ color: '#D97706' }} />
              </div>
            </div>

            {/* Column sub-headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', padding: '14px 24px 8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textAlign: 'right' }}>שדה</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#D32F4A', textAlign: 'center' }}>חשבונית זו</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', textAlign: 'center' }}>כפילות אפשרית</span>
            </div>

            {/* Comparison rows */}
            <div style={{ padding: '0 24px 16px' }}>
              {([
                { label: 'מס׳ חשבונית ספק', a: dupModal.invoice.invoiceNumber, b: dupModal.pair.invoiceNumber },
                { label: 'מס׳ פנימי',        a: dupModal.invoice.id,            b: dupModal.pair.id },
                { label: 'תאריך',             a: dupModal.invoice.date,          b: dupModal.pair.date },
                { label: 'סכום',              a: formatILS(dupModal.invoice.amount), b: formatILS(dupModal.pair.amount) },
                { label: 'סטטוס',             a: dupModal.invoice.status,        b: dupModal.pair.status },
                { label: 'שולח',              a: dupModal.invoice.senderName,    b: dupModal.pair.senderName },
                { label: 'תאריך העלאה',       a: dupModal.invoice.uploadDate,    b: dupModal.pair.uploadDate },
              ] as { label: string; a: string; b: string }[]).map(({ label, a, b }) => {
                const diff = a !== b
                return (
                  <div
                    key={label}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px',
                      padding: '9px 10px', borderRadius: '8px', marginBottom: '3px',
                      background: diff ? '#FFFBEB' : '#F9FAFB',
                    }}
                  >
                    <span style={{ fontSize: '12px', color: '#6B7280', textAlign: 'right' }}>{label}</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: diff ? '#D97706' : '#1F2937', textAlign: 'center' }}>{a || '—'}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: diff ? '#9CA3AF' : '#374151', textAlign: 'center' }}>{b || '—'}</span>
                  </div>
                )
              })}
            </div>

            {/* Delete confirmation */}
            {confirmDelete && (
              <div style={{ margin: '0 24px 16px', padding: '16px', borderRadius: '12px', background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#991B1B', textAlign: 'right', margin: '0 0 12px' }}>
                  האם למחוק חשבונית זו? פעולה זו בלתי הפיכה.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={handleDeleteDuplicate}
                    style={{ flex: 1, height: '40px', borderRadius: '10px', background: '#DC2626', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '14px', fontFamily: 'inherit' }}>
                    כן, מחק
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    style={{ flex: 1, height: '40px', borderRadius: '10px', background: '#F3F4F6', color: '#6B7280', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px', fontFamily: 'inherit' }}>
                    ביטול
                  </button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!confirmDelete && (
              <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button onClick={handleSetPrimary}
                  style={{ width: '100%', height: '46px', borderRadius: '12px', background: '#D32F4A', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '15px', fontFamily: 'inherit' }}>
                  סמן כחשבונית ראשית
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setConfirmDelete(true)}
                    style={{ flex: 1, height: '42px', borderRadius: '12px', background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', cursor: 'pointer', fontWeight: 600, fontSize: '14px', fontFamily: 'inherit' }}>
                    מחק כפילות
                  </button>
                  <button onClick={handleApproveAll}
                    style={{ flex: 1, height: '42px', borderRadius: '12px', background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0', cursor: 'pointer', fontWeight: 600, fontSize: '14px', fontFamily: 'inherit' }}>
                    התעלם – שתיהן תקינות
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
