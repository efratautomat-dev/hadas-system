import { useState, useEffect, useMemo } from 'react'
import { FileText, Search, ChevronRight, ExternalLink, Eye, Save, AlertTriangle, X, Trash2 } from 'lucide-react'
import { type Invoice, type Alert } from '../data/mockData'
import { useInvoices } from '../hooks/useInvoices'
import { useSuppliers } from '../hooks/useSuppliers'
import { useCategories } from '../hooks/useCategories'
import { PdfPreviewButton, PdfPreviewModal } from './PdfPreviewModal'
import { SearchableSelect } from './SearchableSelect'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabase'
import { tableWrap, tableHeadRow, tableHeadCell, tableRow, TABLE_HOVER } from './ui/tableStyles'

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  'ספקים ביגוד', 'ספקים כיסויי ראש', 'ספקים בגדי ים', 'ספקים שונות',
  'הוצאות ניהול', 'הוצאות משרד', 'תשלומי מס הכנסה', 'משכורות', 'שונות',
]

const QUALITIES = ['גבוהה', 'בינונית', 'נמוכה']

// ── Derived status ───────────────────────────────────────────────────────────
// Status is computed live (never read from the stored `status` column, which
// drifts). Exactly three values, in priority order: transferred → under review
// → waiting. See deriveInvoiceStatus below.
const STATUS_TRANSFERRED = 'הועבר לרו״ח'
const STATUS_REVIEW      = 'בבדיקה'
const STATUS_WAITING     = 'ממתין'

// Map the derived Hebrew status onto the unified taxonomy (spec/06-RULES.md §1):
// waiting → new, under-review → in_progress, transferred-to-accountant → done.
const INVOICE_STATUS_INTERNAL: Record<string, string> = {
  [STATUS_WAITING]:     'new',
  [STATUS_REVIEW]:      'in_progress',
  [STATUS_TRANSFERRED]: 'done',
}

// An alert "points at" an invoice when its payload references the invoice id
// (under any of the known keys) or shares the same Gmail message id. Backend
// currently emits existingInvoiceId + gmailMessageId; invoiceId/duplicateInvoiceId
// are matched too for forward-compatibility. relatedId covers mock data.
function alertRefersToInvoice(alert: Alert, invoice: Invoice): boolean {
  const p = (alert.payload ?? {}) as Record<string, unknown>
  const ids = [p.invoiceId, p.existingInvoiceId, p.duplicateInvoiceId, alert.relatedId]
  if (invoice.id && ids.includes(invoice.id)) return true
  const gm = p.gmailMessageId as string | undefined
  return !!gm && !!invoice.gmailMessageId && gm === invoice.gmailMessageId
}

// Live status, in priority order:
//   1. transferred to accountant (sentToAccountant ← transferred_at) → "הועבר לרו״ח"
//   2. any UNRESOLVED alert (new/read) points at this invoice        → "בבדיקה"
//   3. otherwise                                                     → "ממתין"
function deriveInvoiceStatus(invoice: Invoice, alerts: Alert[]): string {
  if (invoice.sentToAccountant) return STATUS_TRANSFERRED
  const underReview = alerts.some(
    a => a.status !== 'resolved' && alertRefersToInvoice(a, invoice),
  )
  return underReview ? STATUS_REVIEW : STATUS_WAITING
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
        style={{ ...BASE, borderColor: f.on && !readOnly ? 'var(--brand-primary)' : '#DEDFE5', background: readOnly ? '#F8F8FA' : 'white' }}
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
        style={{ ...BASE, borderColor: f.on ? 'var(--brand-primary)' : '#DEDFE5', cursor: 'pointer' }}
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
        border: checked ? '2px solid var(--brand-primary)' : '2px solid #D1C4C4',
        background: checked ? 'var(--brand-primary)' : 'white',
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
        style={{ ...BASE, borderColor: f.on ? 'var(--brand-primary)' : '#DEDFE5', resize: 'vertical', lineHeight: 1.6 }}
      />
    </div>
  )
}

function TLink({ label, value, onChange, showPreview = false }: { label: string; value: string; onChange: (v: string) => void; showPreview?: boolean }) {
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
          style={{ ...BASE, flex: 1, textAlign: 'left', borderColor: f.on ? 'var(--brand-primary)' : '#DEDFE5' }}
        />
        {value && showPreview && <PdfPreviewButton url={value} />}
        {value && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '9px 11px', borderRadius: '10px', border: '1.5px solid #DEDFE5',
              color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', flexShrink: 0, textDecoration: 'none',
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
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--brand-primary)', textAlign: 'right' }}>{title}</h3>
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

export function InvoiceDetail({
  invoice, derivedStatus, onBack, onSave, onOpenSupplier, onDelete,
}: {
  invoice: Invoice; derivedStatus: string; onBack: () => void; onSave: (inv: Invoice) => void
  onOpenSupplier?: (supplierId: string) => void
  // Manager-only: EmployeeSupplierView omits this prop, hiding the button.
  onDelete?: (id: string) => void
}) {
  const { data: suppliersData } = useSuppliers()
  const [form, setForm] = useState<Invoice>({ ...invoice })
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Document preview: resolve a viewable URL on demand. Prefer a signed URL from
  // the private "documents" bucket (works without Drive permissions); fall back
  // to the Drive link for legacy rows that have no storage_url. `direct` marks a
  // ready-to-embed URL so the modal skips the Drive-preview transform.
  const [docPreview, setDocPreview] = useState<{ url: string; direct: boolean } | null>(null)

  async function openDocument() {
    const path = (form.storage_url ?? '').trim()
    if (path) {
      if (/^https?:\/\//i.test(path)) { setDocPreview({ url: path, direct: true }); return }
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 120)
      if (!error && data?.signedUrl) { setDocPreview({ url: data.signedUrl, direct: true }); return }
      console.error('[invoices] createSignedUrl failed:', error)
    }
    const drive = (form.driveFileLink ?? '').trim()
    if (drive) { setDocPreview({ url: drive, direct: false }); return }
    alert('לא ניתן לפתוח את הקובץ כעת')
  }

  // Category options from the managed pool (Settings → categories), with fallback
  // to the built-in list and the current value always selectable.
  const { data: cats } = useCategories()
  const managedCats = cats.map(c => c.name)
  const baseCats = managedCats.length ? managedCats : CATEGORIES
  const catOptions = form.category && !baseCats.includes(form.category) ? [form.category, ...baseCats] : baseCats

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
  const internalStatus = INVOICE_STATUS_INTERNAL[derivedStatus] ?? derivedStatus

  return (
    <div dir="rtl" style={{ maxWidth: '800px', margin: '0 auto' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="primary" onClick={() => onSave(form)}>
            <Save size={16} />
            שמור
          </Button>
          {onDelete && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} />
              מחק
            </Button>
          )}
        </div>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <StatusBadge status={internalStatus} style={{ fontWeight: 600, padding: '4px 12px' }} />
            <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 600, color: '#1F2937' }}>{form.id}</h2>
          </div>
          {form.supplier && form.supplierId && onOpenSupplier ? (
            <button
              type="button"
              onClick={() => onOpenSupplier(form.supplierId)}
              style={{
                margin: '3px 0 0', padding: 0, fontSize: '13px', color: 'var(--brand-primary)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                textDecoration: 'underline', fontFamily: 'inherit',
              }}
              title="פתח כרטיס ספק"
            >
              {form.supplier}
            </button>
          ) : (
            <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#9CA3AF' }}>{form.supplier}</p>
          )}
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
            <div>
              <Lbl t="קישור לספק" />
              <SearchableSelect
                value={form.supplierId}
                onChange={handleSupplier}
                placeholder="-- בחר --"
                options={suppliersData.map(s => ({
                  value: s.id,
                  label: s.name,
                  keywords: (s as { hp?: string }).hp,
                }))}
              />
            </div>
            <TInput label="שם ספק" value={form.supplier} onChange={set('supplier')} />
          </Row2>
          <TSelect label="קטגוריה" value={form.category} onChange={set('category')} options={catOptions} />
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
            <span style={{ fontSize: '24px', fontWeight: 600, color: 'var(--brand-primary)' }}>{formatILS(total)}</span>
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
          {(form.storage_url || form.driveFileLink) && (
            <div>
              <Lbl t="מסמך מצורף" />
              <button
                type="button"
                onClick={openDocument}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '8px',
                  padding: '9px 16px', borderRadius: '10px', border: '1.5px solid #DEDFE5',
                  background: 'white', color: 'var(--brand-primary)', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-active-bg)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
              >
                <Eye size={16} />
                צפייה במסמך
              </button>
            </div>
          )}
          <TLink label="קישור לקובץ בדרייב" value={form.driveFileLink} onChange={set('driveFileLink')} />
          <TLink label="קישור לתיקיית החודש" value={form.monthFolderLink} onChange={set('monthFolderLink')} />
          <TLink label="קישור למייל המקורי" value={form.originalEmailLink} onChange={set('originalEmailLink')} />
        </Group>

        {/* 5 – מטא נתונים */}
        <Group title="מטא נתונים">
          <TInput label="נושא המייל" value={form.emailSubject ?? ''} readOnly />
          <Row2>
            <TInput label="תאריך ושעת קבלת מייל" value={form.emailReceivedAt} onChange={set('emailReceivedAt')} type="datetime-local" />
            <TInput label="מזהה מייל" value={form.emailId} readOnly />
          </Row2>
          <TInput label="תאריך העלאה" value={form.uploadDate} readOnly />
        </Group>

        {/* 6 – סטטוס ובקרה */}
        <Group title="סטטוס ובקרה">
          <Row2>
            {/* Status is derived (transferred → under review → waiting), not
                manually editable — shown read-only as a badge. */}
            <div>
              <Lbl t="סטטוס טיפול" />
              <StatusBadge status={internalStatus} style={{ fontSize: '14px', fontWeight: 700, padding: '9px 16px', borderRadius: '10px' }} />
            </div>
            <TSelect label="איכות פענוח" value={form.decodeQuality} onChange={set('decodeQuality')} options={QUALITIES} />
          </Row2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
            <TCheckbox label="כפילות" checked={form.isDuplicate} onChange={set('isDuplicate')} />
            <TCheckbox label="שגיאה" checked={form.hasError} onChange={set('hasError')} />
            <TCheckbox label='הועבר לרו״ח' checked={form.sentToAccountant} onChange={set('sentToAccountant')} />
          </div>
          {form.hasError && (
            <TLink label="קישור לשגיאה ב-N8N" value={form.n8nErrorLink} onChange={set('n8nErrorLink')} />
          )}
        </Group>

      </div>

      {/* Delete confirmation — Drive file is removed too, hence the explicit warning.
          Deletes by the ORIGINAL invoice.id, never form.id (the id field is editable). */}
      {confirmDelete && onDelete && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => setConfirmDelete(false)}
        >
          <div
            style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '420px', padding: '32px', textAlign: 'center' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: '44px', marginBottom: '12px' }}>🗑️</div>
            <h3 style={{ margin: '0 0 10px', fontSize: '18px', fontWeight: 700, color: '#1F2937' }}>
              מחיקת חשבונית
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#6B7280', lineHeight: 1.6 }}>
              בטוחה שתרצי למחוק את החשבונית?{' '}
              <span style={{ color: '#DC2626', fontWeight: 600 }}>
                הפעולה תמחק גם את הקובץ מהדרייב ולא ניתנת לביטול.
              </span>
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="danger" className="flex-1" onClick={() => onDelete(invoice.id)}>
                כן, מחק
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setConfirmDelete(false)}>
                חזרה
              </Button>
            </div>
          </div>
        </div>
      )}

      {docPreview && (
        <PdfPreviewModal
          url={docPreview.url}
          previewSrc={docPreview.direct ? docPreview.url : undefined}
          onClose={() => setDocPreview(null)}
        />
      )}
    </div>
  )
}

// ── Invoice List ────────────────────────────────────────────────────────────

type Filter = 'all' | 'כפילויות' | typeof STATUS_TRANSFERRED | typeof STATUS_REVIEW | typeof STATUS_WAITING

interface DupModal { invoice: Invoice; pair: Invoice }

interface InvoicesProps {
  initialFilter?: Filter
  // Alerts are passed down (Layout owns useAlerts) so invoice status can be
  // derived live from linked alerts without a second fetch.
  alerts?: Alert[]
  controlledSelectedId?: string | null
  // Auto-open the duplicate-review modal for this invoice on mount.
  // Used by duplicate_invoice alerts so the user lands on the popup, not on the detail view.
  initialDuplicateInvoiceId?: string | null
  onOpenInvoice?: (id: string) => void
  onCloseInvoice?: () => void
  onOpenSupplier?: (supplierId: string) => void
  // Fired after a duplicate pair is resolved (deleted / marked primary / approved)
  // so the parent can clean up the alert(s) that referenced the pair and, when
  // the modal was opened from a duplicate alert, navigate back to where we came from.
  onDuplicateResolved?: (info: DuplicateResolution) => void
  // Fired when the duplicate modal is closed WITHOUT resolving (X / cancel /
  // backdrop) but only when it was deep-linked from an alert — so the parent can
  // return to the alerts page instead of stranding the user on the invoices list.
  onDuplicateDismissed?: () => void
}

// Identifying info for a resolved duplicate pair — enough for the parent to match
// any alert(s) that point at it (by invoice id, or by supplier + invoice number).
export interface DuplicateResolution {
  invoiceNumber: string
  supplierId: string
  ids: string[]
  fromAlert: boolean
}

export default function Invoices({
  initialFilter = 'all', alerts = [], controlledSelectedId, initialDuplicateInvoiceId,
  onOpenInvoice, onCloseInvoice, onOpenSupplier, onDuplicateResolved, onDuplicateDismissed,
}: InvoicesProps) {
  const { data: serverInvoices, loading, error, update: updateInvoice, remove: removeInvoice } = useInvoices()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [internalSelected, setInternalSelected] = useState<Invoice | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [dupModal, setDupModal] = useState<DupModal | null>(null)
  // Which side of the duplicate pair the user chose to delete (null = no pending delete).
  const [deleteTarget, setDeleteTarget] = useState<'invoice' | 'pair' | null>(null)
  // Source-document preview shown INSIDE the duplicate popup (in-app modal, not a new tab).
  const [dupDocPreview, setDupDocPreview] = useState<{ url: string; previewSrc?: string } | null>(null)

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

  // Derived display status per invoice (id → status), recomputed when invoices
  // or alerts change. Single source for the list badge, filtering and counts.
  const statusOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const inv of invoices) m.set(inv.id, deriveInvoiceStatus(inv, alerts))
    return m
  }, [invoices, alerts])
  const statusFor = (inv: Invoice) => statusOf.get(inv.id) ?? deriveInvoiceStatus(inv, alerts)

  // ── duplicate helpers ────────────────────────────────────────────────────
  const dupCount = invoices.filter(i => i.duplicateFlag === 'כפילות אפשרית').length

  const getDupPair = (inv: Invoice): Invoice | undefined =>
    invoices.find(i => i.id !== inv.id &&
      i.invoiceNumber === inv.invoiceNumber && i.supplierId === inv.supplierId)

  // Auto-open the dup modal when arriving from a duplicate-invoice alert.
  // Runs once the invoice list has loaded (so getDupPair can find the pair).
  useEffect(() => {
    if (!initialDuplicateInvoiceId) return
    if (invoices.length === 0) return
    if (dupModal) return  // already open — don't reopen if user closed and the prop hasn't changed
    const inv = invoices.find(i => i.id === initialDuplicateInvoiceId)
    if (!inv) return
    const pair = getDupPair(inv)
    if (!pair) return
    setDupModal({ invoice: inv, pair })
    setDeleteTarget(null)
  // getDupPair closes over invoices, so listing invoices is enough
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDuplicateInvoiceId, invoices])

  const openDupModal = (inv: Invoice, e: React.MouseEvent) => {
    e.stopPropagation()
    const pair = getDupPair(inv)
    if (!pair) return
    setDupModal({ invoice: inv, pair })
    setDeleteTarget(null)
  }

  // Open the ACTUAL source document (PDF/image) for one invoice of the pair in the
  // app's in-page preview modal (NOT a new browser tab). Prefer a signed Storage
  // URL (private "documents" bucket), else the Drive file. Raw scan, not the parsed page.
  const openInvoiceSource = async (inv: Invoice) => {
    const path = (inv.storage_url ?? '').trim()
    if (path && !/^https?:\/\//i.test(path)) {
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 120)
      if (!error && data?.signedUrl) { setDupDocPreview({ url: data.signedUrl, previewSrc: data.signedUrl }); return }
    }
    const url = path && /^https?:\/\//i.test(path) ? path : (inv.driveFileLink ?? '').trim()
    if (url) { setDupDocPreview({ url }); return }
    alert('לא ניתן לפתוח את הקובץ כעת')
  }

  // Close the modal without resolving (X / cancel / backdrop). When we got here
  // from a duplicate alert, also return to the alerts page — same as resolving —
  // instead of leaving the user stranded on the invoices list. When the modal
  // was opened by the user browsing invoices, just close it and stay put.
  const closeDupModal = () => {
    setDupModal(null)
    setDeleteTarget(null)
    if (initialDuplicateInvoiceId) onDuplicateDismissed?.()
  }

  // Describe the pair currently shown in the modal so the parent can find and
  // remove any alert(s) that reference it once it's resolved.
  const resolutionInfo = (saved: DupModal): DuplicateResolution => ({
    invoiceNumber: saved.invoice.invoiceNumber || saved.pair.invoiceNumber || '',
    supplierId:    saved.invoice.supplierId || saved.pair.supplierId || '',
    ids:           [saved.invoice.id, saved.pair.id],
    // We only auto-navigate back when the modal was deep-linked from an alert.
    fromAlert:     !!initialDuplicateInvoiceId,
  })

  // Delete the invoice the user chose to discard. resolutionInfo carries BOTH ids
  // so the parent resolves every alert pointing at the pair.
  //
  // Row deletion path:
  //   1. hadas-api DELETE /invoices/:id — the production path (Drive-aware; Drive
  //      is now skipped gracefully when unconfigured).
  //   2. Fallback: if that fails (e.g. hadas-api not deployed in dev), delete the
  //      row directly via the Supabase client. This requires the manager
  //      invoices-DELETE RLS policy (migration *_invoices_manager_delete_rls.sql);
  //      without it the row can't be removed from the browser.
  // BOTH paired alerts are resolved regardless (alert writes use the anon client +
  // manager RLS, which work even when hadas-api is down).
  const handleDeleteDuplicate = async () => {
    if (!dupModal || !deleteTarget) return
    const saved  = dupModal
    const victim = deleteTarget === 'pair' ? saved.pair : saved.invoice
    setDupModal(null)
    setDeleteTarget(null)
    setDupDocPreview(null)
    // Optimistic local removal so the UI reflects the choice immediately.
    setInvoices(prev => prev.filter(i => i.id !== victim.id))
    try {
      await removeInvoice(victim.id)
    } catch (e) {
      console.warn('[dup delete] hadas-api delete unavailable, trying direct delete:', e)
      const { error } = await supabase.from('invoices').delete().eq('id', victim.id)
      if (error) console.warn('[dup delete] direct delete failed (needs invoices-delete RLS policy):', error.message)
    }
    // Always resolve BOTH paired alerts — the alerts-domain outcome the super-rule
    // requires, independent of the invoice row delete.
    onDuplicateResolved?.(resolutionInfo(saved))
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
      onDuplicateResolved?.(resolutionInfo(saved))
    } catch {
      // hook sets error state
    }
  }

  if (selected) {
    return (
      <InvoiceDetail
        invoice={selected}
        derivedStatus={statusFor(selected)}
        onBack={closeInvoice}
        onOpenSupplier={onOpenSupplier}
        onDelete={async (id) => {
          closeInvoice()
          try {
            await removeInvoice(id)
          } catch {
            // hook sets error state
          }
        }}
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

  const filtered = invoices
    .filter(inv => {
      const q = search.toLowerCase()
      const matchSearch = (inv.supplier || '').toLowerCase().includes(q) || (inv.id || '').toLowerCase().includes(q) ||
        (inv.invoiceNumber || '').toLowerCase().includes(q)
      const matchFilter = filter === 'all'
        ? true
        : filter === 'כפילויות'
          ? inv.duplicateFlag === 'כפילות אפשרית'
          : statusFor(inv) === filter
      return matchSearch && matchFilter
    })
    // Newest first by invoice date, falling back to email-received time. Both
    // are ISO strings (YYYY-MM-DD / full ISO timestamp), so a string compare
    // sorts chronologically; reverse it for descending (newest at the top).
    .sort((a, b) => {
      const da = a.invoiceDate || a.emailReceivedAt || ''
      const db = b.invoiceDate || b.emailReceivedAt || ''
      return da === db ? 0 : da < db ? 1 : -1
    })

  // Mirrors the Returns table: multiple flexible columns so extra width is
  // shared between them, never absorbed by a single column. That kills the
  // "supplier on the right, everything else clumped on the left" gap.
  // Amount and status keep fixed widths so numbers and badges stay tight.
  const COL = isMobile
    ? '1fr 110px 90px'
    : isTablet
      ? '1.5fr 1fr 110px 100px'
      : '1.5fr 1fr 1fr 120px 100px'
  const MIN_W = isMobile ? '360px' : isTablet ? '620px' : '820px'

  const counts = invoices.reduce(
    (acc, inv) => {
      const s = statusFor(inv)
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )
  const total = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0)

  if (loading && invoices.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }} />
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

      {/* Header — same shape as Returns: text block, right-aligned */}
      <div className="text-right">
        <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>חשבוניות</h1>
        <p className="text-gray-500 mt-0.5" style={{ fontSize: '14px' }}>
          {invoices.length} חשבוניות במערכת
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[
          { label: 'סה"כ סכום',         value: formatILS(total),                       color: '#1F2937' },
          { label: STATUS_TRANSFERRED,  value: String(counts[STATUS_TRANSFERRED] ?? 0), color: '#166534' },
          { label: STATUS_REVIEW,       value: String(counts[STATUS_REVIEW] ?? 0),      color: '#1E40AF' },
          { label: STATUS_WAITING,      value: String(counts[STATUS_WAITING] ?? 0),     color: '#A16207' },
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
          {(['all', 'כפילויות', STATUS_TRANSFERRED, STATUS_REVIEW, STATUS_WAITING] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                borderRadius: '8px', padding: '7px 12px', fontSize: '14px', fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: filter === f ? (f === 'כפילויות' ? '#D97706' : 'var(--brand-primary)') : 'transparent',
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

      {/* Duplicate warning banner — RTL: icon + warning text pinned to the
          RIGHT (first in document order), action button on the LEFT. */}
      {dupCount > 0 && filter !== 'כפילויות' && (
        <div
          className="rounded-2xl p-4 border flex items-center justify-between cursor-pointer"
          style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}
          onClick={() => setFilter('כפילויות')}
        >
          {/* RIGHT (first in RTL): icon + warning text */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: '#FEF3C7', color: '#D97706' }}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="text-right">
              <p className="font-bold text-sm" style={{ color: '#92400E' }}>
                נמצאו {dupCount} חשבוניות עם מספר כפול אפשרי
              </p>
              <p className="text-xs text-gray-500 mt-0.5">יש לבדוק ולאשר או למחוק לפני סגירת חודש</p>
            </div>
          </div>
          {/* LEFT (last in RTL): action button */}
          <button
            className="px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0"
            style={{ background: '#D97706' }}
          >
            לבדיקה ←
          </button>
        </div>
      )}

      {/* List — same shape as the Returns table */}
      <div style={{ ...tableWrap }}>
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p style={{ fontSize: '16px' }}>לא נמצאו חשבוניות</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {/* Column headers */}
            <div
              style={{ ...tableHeadRow, display: 'grid', gridTemplateColumns: COL, minWidth: MIN_W }}
            >
              <span style={tableHeadCell}>ספק</span>
              {!isMobile && <span style={tableHeadCell}>מסמך · תאריך</span>}
              {!isMobile && !isTablet && <span style={tableHeadCell}>קטגוריה</span>}
              <span style={tableHeadCell}>סכום</span>
              <span className="text-center" style={tableHeadCell}>סטטוס</span>
            </div>

            {/* Data rows */}
            {filtered.map((inv, index) => {
              const invStatus = statusFor(inv)
              const flags = [
                inv.isDuplicate      && { label: 'כפילות',       bg: '#FEF3C7', color: '#92400E' },
                inv.hasError         && { label: 'שגיאה',         bg: '#FEE2E2', color: '#DC2626' },
                inv.sentToAccountant && { label: 'הועבר לרו״ח', bg: '#F0FDF4', color: '#166534' },
              ].filter(Boolean) as { label: string; bg: string; color: string }[]

              return (
                <div
                  key={inv.id}
                  className="grid items-center transition-colors cursor-pointer"
                  style={{ ...tableRow(index === 0), display: 'grid', gridTemplateColumns: COL, minWidth: MIN_W }}
                  onClick={() => openInvoice(inv)}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = TABLE_HOVER)}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  {/* Col 1: ספק. Eye icon FIRST in document order = rightmost
                      in RTL, so the preview button stays at the right edge of
                      the cell. Supplier name to its left, truncates if long. */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {inv.driveFileLink && <PdfPreviewButton url={inv.driveFileLink} title="תצוגה מקדימה של הקובץ" />}
                      <span
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: '#1F2937',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {inv.supplier}
                      </span>
                      {inv.duplicateFlag === 'כפילות אפשרית' && isMobile && (
                        <button
                          onClick={e => openDupModal(inv, e)}
                          title="קיימת חשבונית נוספת עם אותו מספר לספק זה"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#D97706', display: 'flex', flexShrink: 0 }}
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {flags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                        {flags.map(fl => (
                          <span key={fl.label} style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '5px', background: fl.bg, color: fl.color }}>
                            {fl.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Col 2: מסמך + תאריך (desktop only) — invoice number first
                      in document order so it pins to the right edge of the cell
                      whether or not the duplicate-flag button is rendered. */}
                  {!isMobile && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', color: '#374151' }}>{inv.invoiceNumber || inv.id}</span>
                        {inv.duplicateFlag === 'כפילות אפשרית' && (
                          <button
                            onClick={e => openDupModal(inv, e)}
                            title="קיימת חשבונית נוספת עם אותו מספר לספק זה"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#D97706', display: 'flex', flexShrink: 0 }}
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <span style={{ fontSize: '12px', color: '#9CA3AF', display: 'block', marginTop: '2px' }}>{inv.date}</span>
                    </div>
                  )}

                  {/* Col 3: קטגוריה (desktop only) */}
                  {!isMobile && !isTablet && (
                    <span style={{ fontSize: '12px', color: '#6B7280' }}>{inv.category || ''}</span>
                  )}

                  {/* Col 4: סכום */}
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#1F2937', whiteSpace: 'nowrap' }}>
                    {formatILS(inv.amount)}
                  </span>

                  {/* Col 5: סטטוס */}
                  <div className="flex justify-center">
                    <StatusBadge
                      status={INVOICE_STATUS_INTERNAL[invStatus] ?? invStatus}
                      style={{ fontWeight: 700, padding: '4px 10px' }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Duplicate comparison modal — drops below the doc preview (z-50) when it opens */}
      {dupModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: dupDocPreview ? 40 : 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={closeDupModal}
        >
          <div
            style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #EEEEF2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                onClick={closeDupModal}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px', borderRadius: '8px' }}
              >
                <X className="w-5 h-5" />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: 600, color: '#1F2937', margin: 0 }}>השוואת חשבוניות כפולות</h2>
                <AlertTriangle className="w-5 h-5" style={{ color: '#D97706' }} />
              </div>
            </div>

            {/* Column sub-headers — each side gets an eye (open the real source
                document) and a trash (choose this one to delete). */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', padding: '14px 24px 8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textAlign: 'right' }}>שדה</span>
              {([
                { title: 'חשבונית זו',      inv: dupModal.invoice, color: 'var(--brand-primary)', key: 'invoice' as const },
                { title: 'כפילות אפשרית', inv: dupModal.pair,    color: '#9CA3AF', key: 'pair'    as const },
              ]).map(({ title, inv, color, key }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color, textAlign: 'center' }}>{title}</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => openInvoiceSource(inv)}
                      title="פתח את מסמך המקור"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '8px', background: '#F3F4F6', color: '#374151', border: 'none', cursor: 'pointer' }}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(key)}
                      title="בחר למחיקה"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '8px', background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', cursor: 'pointer' }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Comparison rows */}
            <div style={{ padding: '0 24px 16px' }}>
              {([
                { label: 'ספק',              a: dupModal.invoice.supplier,      b: dupModal.pair.supplier },
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

            {/* Delete confirmation — names WHICH side is being deleted */}
            {deleteTarget && (
              <div style={{ margin: '0 24px 16px', padding: '16px', borderRadius: '12px', background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#991B1B', textAlign: 'right', margin: '0 0 12px' }}>
                  למחוק את {deleteTarget === 'invoice' ? 'החשבונית הזו' : 'הכפילות האפשרית'}? פעולה זו בלתי הפיכה ותמחק גם את הקובץ מ-Drive.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button variant="danger" size="sm" className="flex-1" onClick={handleDeleteDuplicate}>
                    כן, מחק
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => setDeleteTarget(null)}>
                    ביטול
                  </Button>
                </div>
              </div>
            )}

            {/* Keep-both action — deleting is done per-side via the trash icons above */}
            {!deleteTarget && (
              <div style={{ padding: '0 24px 24px' }}>
                <p style={{ fontSize: '12px', color: '#9CA3AF', textAlign: 'right', margin: '0 0 10px' }}>
                  השווה בעזרת 👁, ובחר איזו חשבונית למחוק — או השאר את שתיהן.
                </p>
                <Button variant="primary" className="w-full" onClick={handleApproveAll}>
                  התעלם – שתיהן תקינות
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source-document preview inside the duplicate popup (in-app modal) */}
      {dupDocPreview && (
        <PdfPreviewModal
          url={dupDocPreview.url}
          previewSrc={dupDocPreview.previewSrc}
          onClose={() => setDupDocPreview(null)}
        />
      )}
    </div>
  )
}
