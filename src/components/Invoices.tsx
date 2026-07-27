import { useState, useEffect, useMemo } from 'react'
import { FileText, Search, ChevronRight, ExternalLink, Eye, Save, AlertTriangle, X, Trash2, Wallet, CheckCircle, Clock, RotateCcw } from 'lucide-react'
import { type Invoice, type Alert } from '../data/mockData'
import { useInvoices } from '../hooks/useInvoices'
import { useSuppliers } from '../hooks/useSuppliers'
import { useCategories } from '../hooks/useCategories'
import { PdfPreviewButton, PdfPreviewModal, DocumentBody } from './PdfPreviewModal'
import { SearchableSelect } from './SearchableSelect'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/Button'
import { supabase } from '../lib/supabase'
import { tableWrap, tableHeadRow, tableHeadCell, tableRow, TABLE_HOVER } from './ui/tableStyles'
import { SummaryCards } from './ui/SummaryCards'
import { STATUS } from '../theme/status'
import { STATUS_TRANSFERRED, STATUS_REVIEW, STATUS_WAITING, deriveInvoiceStatus } from '../lib/invoiceStatus'
import { isCreditInvoice, applyCreditSign, convertInvoice } from '../lib/creditNote'

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  'ספקים ביגוד', 'ספקים כיסויי ראש', 'ספקים בגדי ים', 'ספקים שונות',
  'הוצאות ניהול', 'הוצאות משרד', 'תשלומי מס הכנסה', 'משכורות', 'שונות',
]

const QUALITIES = ['גבוהה', 'בינונית', 'נמוכה']

// Israeli VAT. Hard-coded by design (see CLAUDE.md) — named so the two directions
// of the amount calculation below can never drift apart.
const VAT_RATE = 0.17

// ── Derived status ───────────────────────────────────────────────────────────
// The derivation (transferred → under review → waiting) lives in
// ../lib/invoiceStatus so the Dashboard KPI and this screen stay in lockstep;
// STATUS_TRANSFERRED / STATUS_REVIEW / STATUS_WAITING and deriveInvoiceStatus are
// imported from there.

// Reviewed-confirmation marker for low-confidence invoices. Written to the stored
// `status` column (which the UI otherwise treats as unreliable / ignores for the
// derived badge, see deriveInvoiceStatus) so a manager's "נבדק" confirmation
// persists without a schema change. isLowConfidence() clears the red list border
// once this is set. Reused via the existing PUT /invoices/:id/status endpoint.
const STATUS_REVIEWED    = 'נבדק'

// Map the derived Hebrew status onto the unified taxonomy (spec/06-RULES.md §1):
// waiting → new, under-review → in_progress, transferred-to-accountant → done.
const INVOICE_STATUS_INTERNAL: Record<string, string> = {
  [STATUS_WAITING]:     'new',
  [STATUS_REVIEW]:      'in_progress',
  [STATUS_TRANSFERRED]: 'done',
}


// Low parse-confidence flag → full red row border in the LIST (dates may be
// wrong; catch the eye for review). Ingest stores English 'low' in ai_confidence;
// mock/demo rows carry the Hebrew 'נמוכה' — match both so the flag shows in the
// live app AND demo mode. Once a manager confirms review (stored status =
// STATUS_REVIEWED), the flag clears so the border leaves the list — only
// confirmed-reviewed low-confidence invoices lose it.
function isLowConfidence(inv: Invoice): boolean {
  if ((inv.status ?? '') === STATUS_REVIEWED) return false
  const q = (inv.decodeQuality ?? '').trim().toLowerCase()
  return q === 'low' || q === 'נמוכה'
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

// Wide enough to show the document and the form side by side without either
// becoming unusable. Below this the invoice screen stacks them instead.
function useIsWide() {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1100)
  useEffect(() => {
    const h = () => setV(window.innerWidth >= 1100)
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
  needsReviewConfirm = false, onMarkReviewed,
}: {
  invoice: Invoice; derivedStatus: string; onBack: () => void; onSave: (inv: Invoice) => void
  onOpenSupplier?: (supplierId: string) => void
  // Manager-only: EmployeeSupplierView omits this prop, hiding the button.
  onDelete?: (id: string) => void
  // Low-confidence review confirmation: shown only when the invoice still carries
  // the low-confidence flag. Clicking persists the reviewed marker (parent) so the
  // red border leaves the list.
  needsReviewConfirm?: boolean
  onMarkReviewed?: () => void | Promise<void>
}) {
  const { data: suppliersData } = useSuppliers()
  const [form, setForm] = useState<Invoice>({ ...invoice })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  // Credit-note conversion: confirmation gate, because flipping the sign moves
  // the supplier's balance by twice the invoice total.
  const [confirmCredit, setConfirmCredit] = useState(false)

  const isCredit = isCreditInvoice(form)

  // Flip charge ⇄ credit note. Sign + invoice_type are written together by
  // convertInvoice, so the row can never be negative while typed as a charge.
  // Saved immediately (not left pending in the form) so the balance and the
  // ledger reflect the correction right away.
  const convertToCredit = (credit: boolean) => {
    const next = convertInvoice(form, credit)
    setForm(next)
    setConfirmCredit(false)
    onSave(next)
  }

  // Mark this low-confidence invoice as human-reviewed. Update local form.status
  // too so a later "שמור" doesn't write back the stale status and un-review it.
  const markReviewed = async () => {
    setReviewing(true)
    setForm(f => ({ ...f, status: STATUS_REVIEWED }))
    try { await onMarkReviewed?.() } finally { setReviewing(false) }
  }

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

  // ── Side-by-side document pane ──────────────────────────────────────────────
  // The pane shows the document immediately, so resolve a viewable URL on mount
  // instead of on click. Same precedence as openDocument() (signed storage URL →
  // Drive link), but with a 1-hour signed URL: the pane stays mounted for as long
  // as the invoice is open, and a 120s URL would expire mid-review.
  // Keyed on the ORIGINAL invoice (not `form`) so editing fields doesn't re-fetch.
  const [docSrc, setDocSrc] = useState<{ url: string; direct: boolean } | null>(null)
  const [docState, setDocState] = useState<'loading' | 'ready' | 'none'>('loading')

  useEffect(() => {
    let cancelled = false
    const settle = (src: { url: string; direct: boolean } | null) => {
      if (cancelled) return
      setDocSrc(src)
      setDocState(src ? 'ready' : 'none')
    }
    ;(async () => {
      const path = (invoice.storage_url ?? '').trim()
      if (path) {
        if (/^https?:\/\//i.test(path)) return settle({ url: path, direct: true })
        const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
        if (!error && data?.signedUrl) return settle({ url: data.signedUrl, direct: true })
        console.error('[invoices] pane createSignedUrl failed:', error)
      }
      const drive = (invoice.driveFileLink ?? '').trim()
      if (drive) return settle({ url: drive, direct: false })
      settle(null)
    })()
    return () => { cancelled = true }
  }, [invoice.storage_url, invoice.driveFileLink])

  const isWide = useIsWide()

  // Category options from the managed pool (Settings → categories), with fallback
  // to the built-in list and the current value always selectable.
  const { data: cats } = useCategories()
  const managedCats = cats.map(c => c.name)
  const baseCats = managedCats.length ? managedCats : CATEGORIES
  const catOptions = form.category && !baseCats.includes(form.category) ? [form.category, ...baseCats] : baseCats

  // Editing an amount recomputes VAT (17%) and the total, then re-stamps the
  // row's EXISTING credit/charge sign via applyCreditSign. That re-stamp is what
  // makes typing a minus into a field a no-op: the sign of a row is owned solely
  // by the "סמן כזיכוי" action below, so an amount edit can never silently flip a
  // credit note back into a charge (or vice versa). applyCreditSign is idempotent,
  // so running it on every keystroke is safe.
  const set = (field: keyof Invoice) => (value: any) => {
    setForm(prev => {
      const next = { ...prev, [field]: value }

      // GROSS → net + VAT (works backwards from the total printed on the document).
      // VAT is the REMAINDER (gross − net), not a second rounding, so
      // net + VAT === gross to the agora and the total never drifts by 1₪.
      if (field === 'amount') {
        const gross = Math.abs(parseFloat(value) || 0)
        const net   = Math.round(gross / (1 + VAT_RATE))
        next.amountBeforeVat = net
        next.vat             = gross - net
        next.amount          = gross
        return { ...next, ...applyCreditSign(next, isCreditInvoice(prev)) }
      }

      // net → VAT → gross (the original direction).
      if (field === 'amountBeforeVat') {
        next.vat = Math.round((parseFloat(value) || 0) * VAT_RATE)
      }
      if (field === 'amountBeforeVat' || field === 'vat') {
        next.amount = (parseFloat(next.amountBeforeVat as any) || 0) + (parseFloat(next.vat as any) || 0)
        return { ...next, ...applyCreditSign(next, isCreditInvoice(prev)) }
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

  // Two-pane document view: the scan on the RIGHT, every field on the LEFT.
  // `dir="rtl"` already lays flex children right-to-left, so the document simply
  // comes first in source order. Below 1100px the two stack instead.
  const documentPane = (
    <div style={{
      background: '#F3F4F6', border: '1.5px solid #DEDFE5', borderRadius: '14px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      ...(isWide
        ? { flex: '1 1 46%', position: 'sticky' as const, top: '12px', height: 'calc(100vh - 150px)' }
        : { width: '100%', height: '46vh', marginBottom: '14px' }),
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: '#FAFAFC', borderBottom: '1px solid #E2E4E9', flexShrink: 0,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#6B7280' }}>מסמך מקור</span>
        {docSrc && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setDocPreview(docSrc)}
              title="הגדל למסך מלא"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px',
                borderRadius: '8px', border: '1px solid #DEDFE5', background: 'white',
                color: 'var(--brand-primary)', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit',
              }}
            >
              <Eye size={13} />
              הגדל
            </button>
            <a
              href={docSrc.url}
              target="_blank"
              rel="noopener noreferrer"
              title="פתח בכרטיסייה חדשה"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px',
                borderRadius: '8px', border: '1px solid #DEDFE5', background: 'white',
                color: 'var(--brand-primary)', fontSize: '12px', textDecoration: 'none',
              }}
            >
              <ExternalLink size={13} />
            </a>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', minHeight: 0 }}>
        {docState === 'loading' ? (
          <div style={{ margin: 'auto', fontSize: '13px', color: '#9CA3AF' }}>טוען מסמך…</div>
        ) : docState === 'none' ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#9CA3AF', padding: '20px' }}>
            <FileText size={34} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.5 }} />
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>אין מסמך מצורף</div>
            <div style={{ fontSize: '12px' }}>לחשבונית הזו לא נשמר קובץ מקור</div>
          </div>
        ) : (
          <DocumentBody
            url={docSrc!.url}
            previewSrc={docSrc!.direct ? docSrc!.url : undefined}
          />
        )}
      </div>
    </div>
  )

  return (
    <div dir="rtl" style={{ maxWidth: isWide ? '1480px' : '800px', margin: '0 auto' }}>

      {/* Low-confidence review banner — prominent, at the very top. Clears the
          red list border once the manager confirms the invoice was checked. */}
      {needsReviewConfirm && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            background: STATUS.red.bg, border: `1.5px solid ${STATUS.red.fg}`, borderRadius: '12px',
            padding: '12px 16px', marginBottom: '16px',
          }}
        >
          <span style={{ fontSize: '14px', fontWeight: 600, color: STATUS.red.fg }}>
            חשבונית זו סומנה בוודאות פענוח נמוכה — ייתכן שהתאריך או הסכום שגויים. בדקי ואשרי.
          </span>
          <Button variant="primary" onClick={markReviewed} disabled={reviewing} style={{ flexShrink: 0 }}>
            <CheckCircle size={16} />
            {reviewing ? 'שומר…' : 'אישור — נבדק'}
          </Button>
        </div>
      )}

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="primary" onClick={() => onSave(form)}>
            <Save size={16} />
            שמור
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmCredit(true)}
            title={isCredit
              ? 'החזרת המסמך לחשבונית חיוב — הסכומים יחזרו לחיוביים'
              : 'המסמך הוא למעשה זיכוי — הסכומים יהפכו לשליליים ויקזזו את יתרת הספק'}
          >
            <RotateCcw size={16} />
            {isCredit ? 'סמן כחשבונית חיוב' : 'סמן כזיכוי'}
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
            {/* Headline is the SUPPLIER's invoice number — that's what the owner
                matches against the paper document. The system id stays visible
                next to it, in a lighter weight, for support/lookup. */}
            <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 600, color: '#1F2937' }}>
              {form.invoiceNumber || form.id}
            </h2>
            {form.invoiceNumber && (
              <span style={{ fontSize: '13px', color: '#9CA3AF' }} title="מספר במערכת">
                {form.id}
              </span>
            )}
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

      {/* Two panes: document (right, first in RTL source order) + fields (left). */}
      <div style={{
        display: 'flex', gap: '16px', alignItems: 'flex-start',
        flexDirection: isWide ? 'row' : 'column',
      }}>

        {documentPane}

      {/* Groups */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '14px',
        ...(isWide ? { flex: '1 1 54%', minWidth: 0 } : { width: '100%' }),
      }}>

        {/* 1 – פרטי חשבונית */}
        <Group title="פרטי חשבונית">
          <Row2>
            {/* The supplier's OWN invoice number — the one printed on the document.
                Distinct from `id`, which is the system-generated key (INV-YYYY-NNN). */}
            <TInput label="מספר חשבונית של הספק" value={form.invoiceNumber ?? ''} onChange={set('invoiceNumber')} />
            <TInput label="תאריך חשבונית" value={form.invoiceDate} onChange={set('invoiceDate')} type="date" />
          </Row2>
          <Row2>
            {/* READ-ONLY: `id` is the row's primary key and the target of the save
                request (PUT /invoices/:id). Editing it would send the update to a
                row that doesn't exist. Correct the SUPPLIER's number above instead. */}
            <TInput label="מספר במערכת" value={form.id} readOnly />
            <div />
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
          {/* The total is EDITABLE and works in both directions: type the gross that
              appears on the document and net + VAT are derived from it; type either
              of those and the gross recomputes. */}
          <div style={{
            background: '#FAFAFC', border: '1.5px solid #F0D4DA', borderRadius: '12px',
            padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px',
          }}>
            <input
              type="number"
              value={String(form.amount || '')}
              onChange={e => set('amount')(e.target.value)}
              style={{
                fontSize: '24px', fontWeight: 600, color: 'var(--brand-primary)',
                background: 'white', border: '1.5px solid #F0D4DA', borderRadius: '10px',
                padding: '6px 12px', width: '190px', fontFamily: 'inherit', direction: 'ltr',
                textAlign: 'right',
              }}
            />
            <span style={{ fontSize: '14px', color: '#9CA3AF', textAlign: 'left' }}>
              סכום כולל<br />
              <span style={{ fontSize: '12px' }}>
                ניתן לעריכה — המערכת תחשב לפי מע״מ {Math.round(VAT_RATE * 100)}%
              </span>
            </span>
          </div>
          {Math.abs(total - (Number(form.amount) || 0)) > 0.5 && (
            <p style={{ margin: '6px 2px 0', fontSize: '12px', color: '#DC2626' }}>
              שים לב: סכום לפני מע״מ + מע״מ = {formatILS(total)}, ולא {formatILS(Number(form.amount) || 0)}
            </p>
          )}
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
      </div>

      {/* Delete confirmation — Drive file is removed too, hence the explicit warning.
          Deletes by the ORIGINAL invoice.id, never form.id — belt-and-braces now
          that the id field is read-only. */}
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

      {/* Credit-note conversion confirmation. Shows the concrete before → after
          total and the direction the supplier balance will move, because the
          balance shifts by twice the invoice amount. Reversible via the same
          button, so no destructive-action wording. */}
      {confirmCredit && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => setConfirmCredit(false)}
        >
          <div
            style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '440px', padding: '32px', textAlign: 'center' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: '44px', marginBottom: '12px' }}>🔁</div>
            <h3 style={{ margin: '0 0 10px', fontSize: '18px', fontWeight: 700, color: '#1F2937' }}>
              {isCredit ? 'החזרה לחשבונית חיוב' : 'סימון כחשבונית זיכוי'}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: '14px', color: '#6B7280', lineHeight: 1.6 }}>
              {isCredit
                ? 'המסמך יחזור להיות חשבונית חיוב רגילה, והסכומים יחזרו להיות חיוביים.'
                : 'המסמך יסומן כזיכוי. הסכומים יהפכו לשליליים, כך שהזיכוי יקזז את יתרת הספק במקום להגדיל אותה.'}
            </p>

            <div style={{
              background: '#FAFAFC', border: '1.5px solid #F0D4DA', borderRadius: '12px',
              padding: '14px 18px', marginBottom: '18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
            }}>
              <span style={{ fontSize: '18px', fontWeight: 600, color: '#9CA3AF', textDecoration: 'line-through' }}>
                {formatILS(total)}
              </span>
              <ChevronRight size={18} color="#9CA3AF" />
              <span style={{ fontSize: '22px', fontWeight: 700, color: 'var(--brand-primary)' }}>
                {formatILS(isCredit ? Math.abs(total) : -Math.abs(total))}
              </span>
            </div>

            <p style={{ margin: '0 0 24px', fontSize: '13px', color: '#6B7280' }}>
              יתרת הספק {form.supplier ? `"${form.supplier}" ` : ''}
              {isCredit ? 'תגדל' : 'תקטן'} ב־{formatILS(Math.abs(total) * 2)}.
            </p>

            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="primary" className="flex-1" onClick={() => convertToCredit(!isCredit)}>
                {isCredit ? 'כן, החזר לחיוב' : 'כן, סמן כזיכוי'}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setConfirmCredit(false)}>
                ביטול
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
  const { data: serverInvoices, loading, error, update: updateInvoice, updateStatus, remove: removeInvoice } = useInvoices()
  // Suppliers flagged "בהסדר תשלום" → their invoices get an informational tag (display-only).
  const { data: suppliersData } = useSuppliers()
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

  // Supplier ids flagged "בהסדר תשלום". Purely informational — drives a small tag
  // next to the invoice status; it does NOT change the accounting status or filters.
  const arrangementSupplierIds = useMemo(
    () => new Set(
      suppliersData
        .filter(s => (s as { paymentArrangement?: boolean }).paymentArrangement)
        .map(s => s.id),
    ),
    [suppliersData],
  )
  const isArrangement = (inv: Invoice) => arrangementSupplierIds.has(inv.supplierId)

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
        needsReviewConfirm={isLowConfidence(selected)}
        onMarkReviewed={async () => {
          try {
            await updateStatus(selected.id, STATUS_REVIEWED)
          } catch {
            // hook sets error state
          }
        }}
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
    // Newest INGESTED first: order by created_at (ingestion time), falling back
    // to email-received time then invoice date. All are ISO strings (full ISO
    // timestamp / YYYY-MM-DD), so a string compare sorts chronologically;
    // reverse it for descending (newest at the top). Note: this is row ORDER
    // only — the displayed date column still shows invoiceDate.
    .sort((a, b) => {
      const da = a.createdAt || a.emailReceivedAt || a.invoiceDate || ''
      const db = b.createdAt || b.emailReceivedAt || b.invoiceDate || ''
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
  // Exclude possible-duplicate invoices from the headline total so a flagged
  // duplicate can't double-count the amount. Credit notes (negative) still net in.
  const total = invoices
    .filter(i => !i.isDuplicate)
    .reduce((s, i) => s + (Number(i.amount) || 0), 0)

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
      <SummaryCards items={[
        { label: 'סה"כ סכום',        value: formatILS(total),                       Icon: Wallet,      tone: 'brand' },
        { label: STATUS_TRANSFERRED, value: String(counts[STATUS_TRANSFERRED] ?? 0), Icon: CheckCircle, tone: 'green' },
        { label: STATUS_REVIEW,      value: String(counts[STATUS_REVIEW] ?? 0),      Icon: Eye,         tone: 'orange' },
        { label: STATUS_WAITING,     value: String(counts[STATUS_WAITING] ?? 0),     Icon: Clock,       tone: 'yellow' },
      ]} />

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
              const lowConf   = isLowConfidence(inv)
              const flags = [
                inv.isDuplicate      && { label: 'כפילות',       bg: '#FEF3C7', color: '#92400E' },
                inv.hasError         && { label: 'שגיאה',         bg: '#FEE2E2', color: '#DC2626' },
                inv.sentToAccountant && { label: 'הועבר לרו״ח', bg: '#F0FDF4', color: '#166534' },
              ].filter(Boolean) as { label: string; bg: string; color: string }[]

              return (
                <div
                  key={inv.id}
                  className="grid items-center transition-colors cursor-pointer"
                  style={{
                    ...tableRow(index === 0),
                    display: 'grid',
                    gridTemplateColumns: COL,
                    minWidth: MIN_W,
                    // Low parse-confidence → full fixed-red border to flag for review.
                    ...(lowConf ? { border: `2px solid ${STATUS.red.fg}`, borderRadius: 8 } : {}),
                  }}
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

                  {/* Col 5: סטטוס. The accounting status is unchanged; a flagged
                      supplier adds an informational "בהסדר" tag beside it (never
                      replaces the status, never affects filters/counts). */}
                  <div className="flex justify-center items-center gap-1.5 flex-wrap">
                    <StatusBadge
                      status={INVOICE_STATUS_INTERNAL[invStatus] ?? invStatus}
                      style={{ fontWeight: 700, padding: '4px 10px' }}
                    />
                    {isArrangement(inv) && (
                      <span
                        title="ספק בהסדר תשלום (מידע בלבד — אינו משנה את סטטוס החשבונית)"
                        style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', background: STATUS.blue.bg, color: STATUS.blue.fg, whiteSpace: 'nowrap' }}
                      >
                        בהסדר
                      </span>
                    )}
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
