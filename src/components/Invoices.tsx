import { useState, useEffect, useMemo } from 'react'
import { FileText, Search, ChevronRight, ChevronDown, ExternalLink, Eye, Save, AlertTriangle, X, Trash2, Wallet, CheckCircle, Clock, RotateCcw, FolderOpen, StickyNote } from 'lucide-react'
import { type Invoice, type Alert, type PipelineStage } from '../data/mockData'
import { useInvoices } from '../hooks/useInvoices'
import { useDeliveryNotes } from '../hooks/useDeliveryNotes'
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
import { STATUS_TRANSFERRED, STATUS_REVIEW, STATUS_WAITING, deriveInvoiceStatus, INVOICE_STATUS_INTERNAL } from '../lib/invoiceStatus'
import { isCreditInvoice, applyCreditSign, convertInvoice } from '../lib/creditNote'
import { vatRateFor, vatPercentFor, completeAmounts, type EditedAmount } from '../lib/vat'
import { useDateField } from './ui/form'

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  'ספקים ביגוד', 'ספקים כיסויי ראש', 'ספקים בגדי ים', 'ספקים שונות',
  'הוצאות ניהול', 'הוצאות משרד', 'תשלומי מס הכנסה', 'משכורות', 'שונות',
]

const QUALITIES = ['גבוהה', 'בינונית', 'נמוכה']

// The three amount fields, mapped to the role each plays in the VAT split. Any
// field NOT listed here is an ordinary field and triggers no recalculation.
const AMOUNT_FIELDS = {
  amountBeforeVat: 'net',
  vat:             'vat',
  amount:          'gross',
} as const satisfies Record<string, EditedAmount>

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

// INVOICE_STATUS_INTERNAL moved to lib/invoiceStatus so every screen — not just
// this one — maps the derived status through the SAME table.


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

// Amounts are derived to the agora, so agorot are shown when there are any —
// but a whole-shekel total is not padded with a pointless "‎.00".
function formatILS(n: number | null | undefined) {
  const v = n ?? 0
  return '₪' + v.toLocaleString('he-IL', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

// ── Field primitives ────────────────────────────────────────────────────────

const BASE: React.CSSProperties = {
  border: '1.5px solid #DEDFE5',
  borderRadius: '10px',
  // Tightened from 9/13 + 15px. The detail screen stacks ~20 of these in one
  // column; every pixel of field padding is paid twenty times over in scrolling.
  padding: '7px 11px',
  fontSize: '14px',
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
    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '3px', textAlign: 'right' }}>
      {t}
    </span>
  )
}

function TInput({
  label, value, onChange, type = 'text', readOnly = false, step,
}: {
  label: string; value: string; onChange?: (v: string) => void; type?: string; readOnly?: boolean
  step?: string
}) {
  const f = useFocus()
  // Empty date fields show OUR day-first DD/MM/YYYY instead of the browser's
  // localised placeholder (Hebrew Chrome renders the month as מ"מ). See useDateField.
  const d = useDateField(value)
  const isDate = type === 'date'
  return (
    <div>
      <Lbl t={label} />
      <input
        {...(isDate ? d : {})}
        type={isDate ? d.type : type}
        step={step}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        readOnly={readOnly}
        onFocus={() => { if (isDate) d.onFocus(); f.onFocus() }}
        onBlur={() => { if (isDate) d.onBlur(); f.onBlur() }}
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
  // `options` is a union of two ARRAY types, which .map() cannot narrow on its
  // own — widen to an array of the union ELEMENT instead, which needs no `any`.
  const opts = (options as readonly (string | { value: string; label: string })[])
    .map(o => (typeof o === 'string' ? { value: o, label: o } : o))
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
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '9px', cursor: 'pointer', padding: '5px 0', userSelect: 'none' }}
      onClick={() => onChange(!checked)}
    >
      <span style={{ fontSize: '14px', color: '#374151' }}>{label}</span>
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
        rows={3}
        style={{ ...BASE, borderColor: f.on ? 'var(--brand-primary)' : '#DEDFE5', resize: 'vertical', lineHeight: 1.55 }}
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

/**
 * A collapsible section of the invoice form.
 *
 * Collapsible because the screen holds three groups and the third — where the
 * document came from and how it was classified — is read far less often than it
 * is scrolled past. `defaultOpen` decides the first visit; after that the choice
 * is REMEMBERED per group, so someone who does live in the metadata never has to
 * reopen it. Same localStorage pattern as the nav rail in Layout.tsx.
 *
 * Nothing is hidden that was not already there: collapsing is a display state,
 * and every field inside is still saved by the one `שמור` button above.
 */
function Group({ id, title, defaultOpen = true, children }: {
  id: string; title: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const key = `hadas.invoiceGroup.${id}`
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? defaultOpen : v === '1'
    } catch { return defaultOpen }
  })
  useEffect(() => {
    try { localStorage.setItem(key, open ? '1' : '0') } catch { /* private mode */ }
  }, [key, open])

  return (
    <div style={{ background: 'white', borderRadius: '14px', border: '1px solid #EEEEF2', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '9px 14px', borderBottom: open ? '1px solid #EEEEF2' : 'none',
          background: '#FAFAFC', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: '7px', textAlign: 'right',
        }}
      >
        <ChevronDown
          size={15}
          style={{ color: 'var(--brand-primary)', flexShrink: 0, transition: 'transform 0.18s', transform: open ? 'none' : 'rotate(90deg)' }}
        />
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--brand-primary)' }}>{title}</h3>
      </button>
      {open && (
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
      {children}
    </div>
  )
}

// ── Invoice Detail ──────────────────────────────────────────────────────────

// Return the invoice with all THREE amounts filled in — net, VAT and total are
// never left partially blank. `edited` names the field the user just typed (that
// one is authoritative); omit it to fill holes only, leaving whatever the
// document supplied untouched. The rate comes from the invoice's own date, and
// the row's existing credit/charge sign is re-stamped, so completing amounts can
// never flip a credit note into a charge. See ../lib/vat.ts.
function withAmounts(inv: Invoice, edited: EditedAmount | null = null): Invoice {
  // A credit note is negative in ALL three fields, but a partially-read one may
  // have the minus on a field other than the total — so any negative marks it.
  const credit = isCreditInvoice(inv)
    || (Number(inv.amountBeforeVat) || 0) < 0
    || (Number(inv.vat) || 0) < 0

  const { net, vat, gross } = completeAmounts(
    { net: inv.amountBeforeVat, vat: inv.vat, gross: inv.amount },
    { rate: vatRateFor(inv.invoiceDate), edited },
  )
  const next = { ...inv, amountBeforeVat: net, vat, amount: gross }
  return { ...next, ...applyCreditSign(next, credit) }
}

export function InvoiceDetail({
  invoice, derivedStatus, onBack, onSave, onSaveNotes, onOpenSupplier, onDelete,
  needsReviewConfirm = false, onMarkReviewed,
  pipelineStage, onOpenPipeline, onOpenPipelineView,
}: {
  invoice: Invoice; derivedStatus: string; onBack: () => void; onSave: (inv: Invoice) => void
  /** Save ONLY the note, without leaving the screen. `onSave` navigates away —
   *  correct for "שמור", wrong for jotting a line and carrying on reading. */
  onSaveNotes?: (id: string, notes: string) => Promise<void>
  onOpenSupplier?: (supplierId: string) => void
  // Manager-only: EmployeeSupplierView omits this prop, hiding the button.
  onDelete?: (id: string) => void
  // Low-confidence review confirmation: shown only when the invoice still carries
  // the low-confidence flag. Clicking persists the reviewed marker (parent) so the
  // red border leaves the list.
  needsReviewConfirm?: boolean
  onMarkReviewed?: () => void | Promise<void>
  /**
   * The pipeline this invoice belongs to, if any, and how to open one.
   *
   * The invoice was the only one of the three parts that could not start a chain,
   * so an invoice arriving before its goods simply sat here with nothing to do.
   * In the first months that is most of them.
   */
  pipelineStage?: PipelineStage | null
  onOpenPipeline?: () => Promise<void>
  onOpenPipelineView?: () => void
}) {
  const { data: suppliersData } = useSuppliers()
  // Opened rows are completed to all three amounts. The extractor returns 0 for
  // whatever it could not read off the document, so invoices routinely arrive
  // with only a total. completeAmounts fills ONLY the holes here — anything the
  // document did print is left exactly as it was read.
  const [form, setForm] = useState<Invoice>(() => withAmounts(invoice))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // The note saves on its own, staying put. Failure is REPORTED rather than
  // swallowed: the text is still in the box, and a silent failure would let the
  // owner walk away believing it was written down.
  const saveNote = async () => {
    if (!onSaveNotes) return
    setNoteState('saving')
    try {
      await onSaveNotes(invoice.id, form.notes ?? '')
      setNoteState('saved')
    } catch {
      setNoteState('error')
    }
  }
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

  // Editing ANY of the three amounts rewrites the other two, so the form is never
  // left with a blank among them — whichever number the document happens to print
  // is enough to fill the row. The rate comes from the invoice's OWN date (VAT
  // rose 17% → 18% on 1.1.2025), and the row's EXISTING sign is re-stamped from
  // `prev`: the sign is owned solely by the "סמן כזיכוי" action below, so typing a
  // minus into a field is a no-op and can never flip a credit note into a charge.
  // applyCreditSign is idempotent, so running it on every keystroke is safe.
  // Every caller is a field control: the text/number/date/select/link inputs hand
  // back a string, the checkboxes a boolean. Nothing else reaches this.
  const set = (field: keyof Invoice) => (value: string | boolean) => {
    setForm(prev => {
      const next = { ...prev, [field]: value }

      const edited = AMOUNT_FIELDS[field as keyof typeof AMOUNT_FIELDS]
      if (!edited) return next

      const { net, vat, gross } = completeAmounts(
        { net: next.amountBeforeVat, vat: next.vat, gross: next.amount },
        { rate: vatRateFor(next.invoiceDate), edited },
      )
      const filled = { ...next, amountBeforeVat: net, vat, amount: gross }
      return { ...filled, ...applyCreditSign(filled, isCreditInvoice(prev)) }
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
        // A true HALF of the screen for the scan, and taller: the owner reads the
        // document while typing, so this pane is the working surface.
        ? { flex: '1 1 50%', position: 'sticky' as const, top: '8px', height: 'calc(100vh - 96px)' }
        : { width: '100%', height: '60vh', marginBottom: '14px' }),
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
            {/* The month folder used to be an editable URL field down in the
                form. It is a place to GO, not a value to type, so it lives here
                beside the other two ways out of this pane. */}
            {form.monthFolderLink && (
              <a
                href={form.monthFolderLink}
                target="_blank"
                rel="noopener noreferrer"
                title="תיקיית החודש בדרייב"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px',
                  borderRadius: '8px', border: '1px solid #DEDFE5', background: 'white',
                  color: 'var(--brand-primary)', fontSize: '12px', textDecoration: 'none',
                }}
              >
                <FolderOpen size={13} />
                תיקיית החודש
              </a>
            )}
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

  // Near-full width on a wide screen: the old 1480px cap left a broad empty
  // margin on either side while the document pane stayed small.
  return (
    <div dir="rtl" style={{ maxWidth: isWide ? '100%' : '800px', margin: '0 auto' }}>

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
        display: 'flex', gap: '20px', alignItems: 'flex-start',
        flexDirection: isWide ? 'row' : 'column',
      }}>

        {documentPane}

      {/* Groups */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '14px',
        ...(isWide ? { flex: '1 1 50%', minWidth: 0 } : { width: '100%' }),
      }}>

        {/* 1 – פרטי חשבונית */}
        <Group id="details" title="פרטי חשבונית">
          <Row2>
            {/* The supplier's OWN invoice number — the one printed on the document.
                The system id (INV-YYYY-NNN) is NOT a field: it is already in the
                header beside this number, and it was read-only here anyway. */}
            <TInput label="מספר חשבונית של הספק" value={form.invoiceNumber ?? ''} onChange={set('invoiceNumber')} />
            <TInput label="תאריך חשבונית" value={form.invoiceDate} onChange={set('invoiceDate')} type="date" />
          </Row2>

          {/* Supplier assignment — the one control that moves an invoice from one
              supplier to another, which is how a misread vendor gets corrected.
              Full width, and named for what it DOES: "קישור לספק" read like a
              navigation link. handleSupplier writes supplierId AND the name
              together, so the two can never drift; the name beside it is
              therefore display-only. Editing that name by hand used to be
              possible and was the one way to produce an invoice that shows one
              supplier in the list and belongs to another in the ledger. */}
          <div>
            <PipelineRow
              stage={pipelineStage}
              onOpen={onOpenPipeline}
              onView={onOpenPipelineView}
            />
            <Lbl t="שיוך לספק" />
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
            <p style={{ margin: '3px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
              חיפוש לפי שם או ח.פ. · שינוי כאן מעביר את החשבונית לכרטסת של הספק הנבחר
            </p>
          </div>

          <Row2>
            <TSelect label="קטגוריה" value={form.category} onChange={set('category')} options={catOptions} />
            {/* The checkbox has no label line above it, so on its own it floats to
                the top of the row while the select sits under its label. Pin it to
                the bottom so the two read as one line. */}
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%' }}>
                <TCheckbox label="האם החזר חלקי" checked={form.isPartialReturn} onChange={set('isPartialReturn')} />
              </div>
            </div>
          </Row2>
          <TTextarea label="פירוט שורות" value={form.lineDetails} onChange={set('lineDetails')} />
        </Group>

        {/* 2 – סכומים */}
        <Group id="amounts" title="סכומים">
          <Row2>
            <TInput label='סכום לפני מע"מ (₪)' value={String(form.amountBeforeVat || '')} onChange={set('amountBeforeVat')} type="number" step="0.01" />
            <TInput label='מע"מ (₪)' value={String(form.vat || '')} onChange={set('vat')} type="number" step="0.01" />
          </Row2>
          {/* The total is EDITABLE and works in both directions: type the gross that
              appears on the document and net + VAT are derived from it; type either
              of those and the gross recomputes. Deliberately NOT tightened with the
              rest of the form — it is the figure the whole screen is about. */}
          <div style={{
            background: '#FAFAFC', border: '1.5px solid #F0D4DA', borderRadius: '12px',
            padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px',
          }}>
            <input
              type="number"
              step="0.01"
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
                ניתן לעריכה — המערכת תחשב לפי מע״מ {vatPercentFor(form.invoiceDate)}%
              </span>
            </span>
          </div>
          {/* Amounts are derived to the agora, so anything above half an agora is a
              real inconsistency in the document — not a rounding artefact. */}
          {Math.abs(total - (Number(form.amount) || 0)) > 0.005 && (
            <p style={{ margin: '6px 2px 0', fontSize: '12px', color: '#DC2626' }}>
              שים לב: סכום לפני מע״מ + מע״מ = {formatILS(total)}, ולא {formatILS(Number(form.amount) || 0)}
            </p>
          )}
        </Group>

        {/* 3 – מקור וסטטוס.
            Four small groups folded into one: who sent it, which email it came
            from, and how the ingest classified it are all the same question —
            where did this row come from — and none of it is read on a normal
            visit. Closed by default for that reason; the choice is remembered.

            Gone from here, and why:
            • "צפייה במסמך" — the document pane's "הגדל" opens the same modal.
            • "קישור לקובץ בדרייב" — the pane already opens it in a new tab, and
              nobody hand-edits a Drive URL that ingest wrote.
            • "קישור לתיקיית החודש" — now a button in the pane header.
            • "מזהה מייל" / "תאריך העלאה" — no DB column at all; useInvoices
              fills them with a constant '', so they were empty boxes on every
              invoice, always. */}
        <Group id="source" title="מקור וסטטוס" defaultOpen={false}>
          <Row2>
            <TInput label="שם השולח" value={form.senderName} onChange={set('senderName')} />
            <TInput label="כתובת מייל שולח" value={form.senderEmail} onChange={set('senderEmail')} type="email" />
          </Row2>
          <TInput label="נושא המייל" value={form.emailSubject ?? ''} readOnly />
          <Row2>
            <TInput label="תאריך ושעת קבלת מייל" value={form.emailReceivedAt} onChange={set('emailReceivedAt')} type="datetime-local" />
            <div>
              {/* Status is derived (transferred → under review → waiting), not
                  manually editable — shown read-only as a badge. */}
              <Lbl t="סטטוס טיפול" />
              <StatusBadge status={internalStatus} style={{ fontSize: '13px', fontWeight: 700, padding: '7px 14px', borderRadius: '10px' }} />
            </div>
          </Row2>
          <Row2>
            <TSelect label="איכות פענוח" value={form.decodeQuality} onChange={set('decodeQuality')} options={QUALITIES} />
            <div />
          </Row2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
            <TCheckbox label="כפילות" checked={form.isDuplicate} onChange={set('isDuplicate')} />
            <TCheckbox label="שגיאה" checked={form.hasError} onChange={set('hasError')} />
            <TCheckbox label='הועבר לרו״ח' checked={form.sentToAccountant} onChange={set('sentToAccountant')} />
          </div>
          <TLink label="קישור למייל המקורי" value={form.originalEmailLink} onChange={set('originalEmailLink')} />
          {form.hasError && (
            <TLink label="קישור לשגיאה ב-N8N" value={form.n8nErrorLink} onChange={set('n8nErrorLink')} />
          )}
        </Group>

        {/* 4 – הערות.
            At the BOTTOM, not the top, and that is the send buttons' doing: the
            owner asked for "exactly what statement reconciliation has", and a
            send-by-mail button does not belong beside the invoice number. Same
            block as StatementReconciliation's — textarea, save, two send buttons
            that are not wired yet, and a status line that says so. */}
        <div style={{ background: 'white', borderRadius: '14px', border: '1px solid #EEEEF2', padding: '14px' }}>
          <div className="flex items-center gap-2" style={{ marginBottom: '7px' }}>
            <StickyNote size={15} style={{ color: 'var(--brand-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--brand-primary)' }}>הערות לחשבונית</h3>
            <span style={{ marginInlineStart: 'auto', fontSize: '11.5px', color: '#9CA3AF' }}>
              מופיעה גם בהערות הספק
            </span>
          </div>
          <textarea
            value={form.notes ?? ''}
            onChange={e => { setForm(f => ({ ...f, notes: e.target.value })); setNoteState('idle') }}
            placeholder="מה שצריך לזכור על החשבונית הזו…"
            style={{ ...BASE, minHeight: '58px', resize: 'vertical', lineHeight: 1.55, fontFamily: 'inherit' }}
          />
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: '8px' }}>
            <button
              type="button"
              onClick={saveNote}
              disabled={noteState === 'saving'}
              className="rounded-xl font-bold"
              style={{ background: 'var(--brand-primary)', color: 'white', border: 'none', padding: '7px 14px', fontSize: '13px', cursor: 'pointer', opacity: noteState === 'saving' ? 0.6 : 1, fontFamily: 'inherit' }}
            >שמירת הערה</button>
            <button
              type="button"
              disabled
              className="rounded-xl font-bold"
              style={{ background: 'white', color: '#9CA3AF', border: '1px solid #E2E4E9', padding: '7px 14px', fontSize: '13px', cursor: 'not-allowed', fontFamily: 'inherit' }}
            >שליחה במייל</button>
            <button
              type="button"
              disabled
              className="rounded-xl font-bold"
              style={{ background: 'white', color: '#9CA3AF', border: '1px solid #E2E4E9', padding: '7px 14px', fontSize: '13px', cursor: 'not-allowed', fontFamily: 'inherit' }}
            >שליחה בוואטסאפ</button>
            <span style={{ marginInlineStart: 'auto', fontSize: '11.5px', color: noteState === 'error' ? '#DC2626' : '#9CA3AF' }}>
              {noteState === 'saving' ? 'שומר…'
                : noteState === 'saved' ? 'ההערה נשמרה'
                : noteState === 'error' ? 'ההערה לא נשמרה — נסי שוב'
                : 'השליחה תופעל בהמשך'}
            </span>
          </div>
        </div>

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
  const { data: serverInvoices, loading, error, update: updateInvoice, updateStatus, remove: removeInvoice, openPipeline } = useInvoices()
  // Read-only: which pipeline (if any) this invoice already belongs to.
  const { data: pipelineNotes } = useDeliveryNotes()
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
        pipelineStage={pipelineNotes.find(n => n.linkedInvoiceId === selected.id)?.stage ?? null}
        onOpenPipeline={async () => { await openPipeline(selected.id) }}
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
        // Notes save in place — no closeInvoice(), and the error is rethrown so
        // the note box can show that it did not save.
        onSaveNotes={async (id, notes) => { await updateInvoice(id, { notes }) }}
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


// ── Where this invoice stands in the goods chain ─────────────────────────────
//
// Three parts document one purchase: the order, the delivery that says it came,
// and the invoice that says what to pay. Each can start the chain. The invoice was
// the one that could not — so an invoice that arrived before its goods had no
// pipeline and, from this screen, no action at all.
//
// The button says "ממתינה לסחורה" rather than "פתיחת פייפליין" because that is
// what the person is asserting: the goods have not turned up yet. The mechanism is
// ours to name; the state is hers.
function PipelineRow({ stage, onOpen, onView }: {
  stage?: PipelineStage | null
  onOpen?: () => Promise<void>
  onView?: () => void
}) {
  const [busy, setBusy] = useState(false)
  if (!onOpen && !stage) return null

  return (
    <div style={{ gridColumn: '1 / -1', margin: '0 0 14px' }}>
      <Lbl t="סחורה" />
      {stage ? (
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={stage} />
          {onView && (
            <button
              onClick={onView}
              style={{ background: 'transparent', border: 'none', color: 'var(--brand-primary)', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >פתיחת הפייפליין</button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: '13px', color: '#6B6E73' }}>
            לא מקושרת לסחורה.
          </span>
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onOpen?.() } finally { setBusy(false) } }}
            className="font-semibold"
            style={{
              background: 'white', color: 'var(--brand-primary)',
              border: '1px solid var(--brand-primary)', padding: '6px 12px',
              fontSize: '12.5px', cursor: busy ? 'wait' : 'pointer',
            }}
          >{busy ? 'פותח…' : 'ממתינה לסחורה'}</button>
        </div>
      )}
    </div>
  )
}
