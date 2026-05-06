import { useState } from 'react'
import { FileText, Search, ChevronRight, ExternalLink, Save } from 'lucide-react'
import { mockInvoices, mockSuppliers, type Invoice } from '../data/mockData'

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

function formatILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

// ── Field primitives ────────────────────────────────────────────────────────

const BASE: React.CSSProperties = {
  border: '1.5px solid #E5D9D9',
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
        style={{ ...BASE, borderColor: f.on && !readOnly ? '#8B1A3A' : '#E5D9D9', background: readOnly ? '#FAF5F5' : 'white' }}
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
        style={{ ...BASE, borderColor: f.on ? '#8B1A3A' : '#E5D9D9', cursor: 'pointer' }}
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
        border: checked ? '2px solid #8B1A3A' : '2px solid #D1C4C4',
        background: checked ? '#8B1A3A' : 'white',
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
        style={{ ...BASE, borderColor: f.on ? '#8B1A3A' : '#E5D9D9', resize: 'vertical', lineHeight: 1.6 }}
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
          style={{ ...BASE, flex: 1, textAlign: 'left', borderColor: f.on ? '#8B1A3A' : '#E5D9D9' }}
        />
        {value && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '9px 11px', borderRadius: '10px', border: '1.5px solid #E5D9D9',
              color: '#8B1A3A', display: 'flex', alignItems: 'center', flexShrink: 0, textDecoration: 'none',
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
    <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #E2E4E9', overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid #E2E4E9', background: '#F8F9FA' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#8B1A3A', textAlign: 'right' }}>{title}</h3>
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
    const sup = mockSuppliers.find(s => s.id === supplierId)
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
            background: '#7C3AED', color: 'white', border: 'none', borderRadius: '12px',
            padding: '10px 22px', fontSize: '15px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '7px',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#6D28D9')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
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
            <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#1F2937' }}>{form.id}</h2>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#9CA3AF' }}>{form.supplier}</p>
        </div>

        <button
          onClick={onBack}
          style={{
            background: 'white', border: '1.5px solid #E5D9D9', borderRadius: '12px',
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
              options={mockSuppliers.map(s => ({ value: s.id, label: s.name }))}
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
            background: '#F8F9FA', border: '1.5px solid #F0D4DA', borderRadius: '12px',
            padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#8B1A3A' }}>{formatILS(total)}</span>
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

type Filter = 'all' | 'ממתין' | 'בטיפול' | 'הושלם' | 'שגיאה'

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(mockInvoices)
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  if (selected) {
    return (
      <InvoiceDetail
        invoice={selected}
        onBack={() => setSelected(null)}
        onSave={(updated) => {
          setInvoices(prev => prev.map(inv => inv.id === updated.id ? updated : inv))
          setSelected(null)
        }}
      />
    )
  }

  const filtered = invoices.filter(inv => {
    const matchSearch = inv.supplier.includes(search) || inv.id.includes(search)
    const matchFilter = filter === 'all' || inv.status === filter
    return matchSearch && matchFilter
  })

  const counts = {
    ממתין: invoices.filter(i => i.status === 'ממתין').length,
    הושלם: invoices.filter(i => i.status === 'הושלם').length,
    בטיפול: invoices.filter(i => i.status === 'בטיפול').length,
    שגיאה: invoices.filter(i => i.status === 'שגיאה').length,
  }
  const total = invoices.reduce((s, i) => s + i.amount, 0)

  return (
    <div className="space-y-5" dir="rtl">

      {/* Header */}
      <div className="text-right">
        <h1 className="text-2xl font-black text-gray-800">חשבוניות</h1>
        <p className="text-gray-500 mt-0.5" style={{ fontSize: '14px' }}>
          {invoices.length} חשבוניות במערכת
        </p>
      </div>

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
            style={{ borderColor: '#E2E4E9' }}
          >
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: '13px' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <div
          className="bg-white rounded-xl border p-1 flex-shrink-0"
          style={{ borderColor: '#E2E4E9', display: 'flex', gap: '2px' }}
        >
          {(['all', 'ממתין', 'בטיפול', 'הושלם', 'שגיאה'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                borderRadius: '8px', padding: '7px 12px', fontSize: '14px', fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: filter === f ? '#8B1A3A' : 'transparent',
                color: filter === f ? 'white' : '#6B7280',
              }}
            >
              {f === 'all' ? 'הכל' : f}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-2 flex-1 bg-white rounded-xl border px-4"
          style={{ borderColor: '#E2E4E9', minHeight: '44px' }}
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

      {/* List */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p style={{ fontSize: '16px' }}>לא נמצאו חשבוניות</p>
          </div>
        ) : (
          <div>
            {filtered.map((inv, i) => {
              const st = STATUS_STYLE[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
              const flags = [
                inv.isDuplicate && { label: 'כפילות', bg: '#FEF3C7', color: '#92400E' },
                inv.hasError    && { label: 'שגיאה',  bg: '#FEE2E2', color: '#DC2626' },
                inv.sentToAccountant && { label: 'הועבר לרוה"ח', bg: '#F0FDF4', color: '#166534' },
              ].filter(Boolean) as { label: string; bg: string; color: string }[]

              return (
                <div
                  key={inv.id}
                  onClick={() => setSelected(inv)}
                  style={{
                    padding: '14px 20px',
                    borderTop: i > 0 ? '1px solid #E2E4E9' : undefined,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8F9FA')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Left: status + amount + flags */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span
                      style={{ ...st, fontSize: '13px', fontWeight: 700, padding: '4px 12px', borderRadius: '8px', flexShrink: 0 }}
                    >
                      {inv.status}
                    </span>
                    <span style={{ fontSize: '17px', fontWeight: 800, color: '#1F2937' }}>
                      {formatILS(inv.amount)}
                    </span>
                    {flags.map(fl => (
                      <span
                        key={fl.label}
                        style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: fl.bg, color: fl.color }}
                      >
                        {fl.label}
                      </span>
                    ))}
                  </div>

                  {/* Right: supplier + id + date + category */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#1F2937', margin: 0 }}>{inv.supplier}</p>
                    <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '3px 0 0' }}>
                      {inv.id} · {inv.date}
                      {inv.category && <span> · {inv.category}</span>}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
