import { useState, useLayoutEffect } from 'react'
import {
  Truck, Copy, Scale, Check, Eye, Trash2, Bell, UserPlus,
  HelpCircle, FileX, Paperclip, Unlink, AlertTriangle, Clock,
  FileWarning, Receipt, AlertCircle, Tag, Mail, X,
} from 'lucide-react'
import type { Alert, AlertStatus } from '../data/mockData'
import { openStoredFile } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { StatusBadge as SharedStatusBadge } from './StatusBadge'
import { SummaryCards } from './ui/SummaryCards'

// Color is keyed to the alert TYPE, grouped into four severity-like buckets.
// (severity is "info" on every live row, so it can't drive color.) The bucket is
// the SINGLE SOURCE OF TRUTH: it drives both the badge palette AND the top-of-page
// type filter, so the per-bucket type lists are never written twice.
type Bucket = 'urgent' | 'action' | 'check' | 'info'

type AlertTypeConf = {
  label: string
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  bg: string
  color: string
  bucket?: Bucket
}

const BUCKET_PALETTE: Record<Bucket, { bg: string; color: string }> = {
  urgent: { bg: '#FEE2E2', color: '#B91C1C' }, // red    — broken, needs manual handling
  action: { bg: '#FFEDD5', color: '#C2410C' }, // orange — a human action is required
  check:  { bg: '#FEF9C3', color: '#B45309' }, // yellow — worth a look / verify
  info:   { bg: '#F3F4F6', color: '#6B7280' }, // gray   — informational
}

// Filter-chip labels per bucket (the leading dot mirrors the badge palette).
const BUCKET_LABEL: Record<Bucket, string> = {
  urgent: '🔴 דחוף',
  action: '🟠 פעולה',
  check:  '🟡 לבדוק',
  info:   '⚪ מידע',
}

// Order of the type-filter chips (left→right after "הכל").
const TYPE_BUCKETS: Bucket[] = ['urgent', 'action', 'check', 'info']

// Build a config entry whose palette is DERIVED from its bucket, so a type's
// color and its filter membership can never drift apart.
const b = (label: string, Icon: AlertTypeConf['Icon'], bucket: Bucket): AlertTypeConf =>
  ({ label, Icon, bucket, ...BUCKET_PALETTE[bucket] })

// Single source of truth for badge label / icon / colors per alert type.
// Keys cover every type the backend emits (grep `alerts.insert({type:` in
// supabase/functions) plus the legacy mock-data types. Exported so the
// Dashboard's "Recent Alerts" card uses the same config.
const ALERT_TYPE_CONFIG: Record<string, AlertTypeConf> = {
  // ── Urgent (red): broken ingest / duplicates ──
  invoice_ingest_failed:       b('פענוח נכשל — טיפול ידני', FileWarning,   'urgent'),
  invoice_duplicate:           b('כפילות',                  Copy,          'urgent'),
  duplicate_invoice:           b('כפילות',                  Copy,          'urgent'), // legacy alias
  return_amount_mismatch:      b('פער בהחזר',               AlertCircle,   'urgent'),

  // ── Action (orange): a human action is required ──
  supplier_incomplete:         b('ספק – חסר פרטים',         UserPlus,      'action'),
  supplier_details_review:     b('ספק – לבדיקת פרטים',      UserPlus,      'action'),
  unmatched_credit_note:       b('זיכוי ללא חזרה',          Receipt,       'action'),
  statement_save_failed:       b('שמירת כרטסת נכשלה',       Scale,         'action'),

  // ── Check (yellow): worth a look / verify ──
  invoice_low_confidence:      b('וודאות נמוכה',            AlertTriangle, 'check'),
  document_misclassified:      b('מסמך לא חשבונית',         FileX,         'check'),
  invoice_no_attachment:       b('ללא קובץ',                Paperclip,     'check'),
  invoice_no_valid_attachment: b('ללא קובץ תקין',           FileX,         'check'),
  invoice_link_failed:         b('הורדה נכשלה',             Unlink,        'check'),

  // ── Info (gray): informational ──
  invoice_old_date:            b('תאריך מוקדם',             Clock,         'info'),

  // ── Legacy / mock-only types (kept so demo + mock data still render; no
  //     bucket → intentionally absent from the bucket type filter) ──
  delivery_note:               { label: 'תעודת משלוח',     Icon: Truck,         bg: '#DBEAFE', color: '#1E40AF' },
  statement_mismatch:          { label: 'אי-התאמת כרטסת', Icon: Scale,         bg: '#FEE2E2', color: '#DC2626' },
  invoice_unclassified:        { label: 'לא סווג',         Icon: HelpCircle,    bg: '#F3F4F6', color: '#4B5563' },
  extraction_failed:           { label: 'פענוח נכשל',      Icon: FileWarning,   bg: '#FEE2E2', color: '#B91C1C' },
}

// Resolve config for any alert type. Unknown types get a neutral gray badge
// showing the raw type string — visible enough to flag that the mapping needs
// updating, without blowing up the UI or masquerading as a duplicate.
export function getAlertTypeConf(type: string): AlertTypeConf {
  return ALERT_TYPE_CONFIG[type] ?? {
    label: type || 'לא ידוע',
    Icon: Tag,
    bg: '#F3F4F6',
    color: '#6B7280',
  }
}

const STATUS_CONFIG: Record<AlertStatus, {
  label: string
  bg: string
  color: string
  indicator: string
}> = {
  new:      { label: 'חדש',  bg: '#FEE2E2', color: '#DC2626', indicator: '#EF4444' },
  read:     { label: 'נקרא', bg: '#F3F4F6', color: '#6B7280', indicator: '#D1D5DB' },
  resolved: { label: 'טופל', bg: '#DCFCE7', color: '#166534', indicator: '#22C55E' },
}

// Map the alert status vocabulary onto the unified taxonomy (spec/06-RULES.md §1):
// new → new, read → in_progress, resolved → done. (STATUS_CONFIG above still drives
// the per-status row indicator color.)
const ALERT_STATUS_INTERNAL: Record<AlertStatus, string> = {
  new:      'new',
  read:     'in_progress',
  resolved: 'done',
}

// Status-filter chip labels — the unified taxonomy (spec/06-RULES.md §1):
// new=חדש, read→in_progress=בטיפול, resolved→done=טופל. (Selecting טופל is the
// only way to surface resolved alerts, which are hidden from the default view.)
const STATUS_LABELS: Record<AlertStatus, string> = {
  new:      'חדש',
  read:     'בטיפול',
  resolved: 'טופל',
}

interface AlertCardProps {
  alert: Alert
  onMarkRead: (id: string) => void
  onMarkResolved: (id: string) => void
  onDelete: (id: string) => void
  onClick?: () => void
}

function AlertCard({ alert, onMarkRead, onMarkResolved, onDelete, onClick }: AlertCardProps) {
  // Per-type config; unknown types fall back to a neutral badge showing the raw type
  // (never the duplicate label) so misclassification can't masquerade as a duplicate.
  const typeConf   = getAlertTypeConf(alert.type)
  const statusConf = STATUS_CONFIG[alert.status] ?? STATUS_CONFIG.new
  const TypeIcon   = typeConf.Icon
  // When the alert carries a link to the original Gmail thread, expose a direct
  // "פתח מייל מקורי" action (used by link-failed / missing-attachment / etc.).
  const messageLink = (alert.payload as Record<string, unknown> | undefined)?.messageLink as string | undefined
  const isResolved = alert.status === 'resolved'
  const clickable  = !!onClick

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      } : undefined}
      className={`bg-white rounded-2xl shadow-sm border overflow-hidden transition-all ${clickable ? 'hover:shadow-md' : ''}`}
      style={{
        borderColor: '#E2E4E9',
        borderRight: `4px solid ${statusConf.indicator}`,
        opacity: isResolved ? 0.72 : 1,
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <div className="p-4" style={{ direction: 'rtl' }}>
        {/* Header — 6-column grid keeps the supplier in a dedicated slot
            (160px). Position is consistent across cards; empty supplier leaves
            the column blank without shifting the other columns. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto minmax(0, 1fr) 160px auto auto',
            alignItems: 'center',
            columnGap: '10px',
            marginBottom: '10px',
          }}
        >
          {/* Col 1 (rightmost in RTL): type icon */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: typeConf.bg }}
          >
            <TypeIcon className="w-4 h-4" style={{ color: typeConf.color }} />
          </div>
          {/* Col 2: type label */}
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
            style={{ background: typeConf.bg, color: typeConf.color }}
          >
            {typeConf.label}
          </span>
          {/* Col 3: spacer (1fr) — pushes the next columns left */}
          <div />
          {/* Col 4: supplier — dedicated 160px slot, right-aligned, stays empty when missing */}
          <span className="text-sm font-semibold text-gray-700 text-right truncate">
            {alert.supplier ?? ''}
          </span>
          {/* Col 5: date */}
          <span className="text-xs text-gray-400 whitespace-nowrap">{alert.date}</span>
          {/* Col 6 (leftmost in RTL): status */}
          <SharedStatusBadge status={ALERT_STATUS_INTERNAL[alert.status] ?? alert.status} />
        </div>

        {/* Description */}
        <p className="text-sm text-gray-600 leading-relaxed text-right mb-3">
          {alert.description}
        </p>

        {/* Actions — stop click bubbling so action buttons don't trigger row navigation.
            The email button shows whenever a messageLink exists (even for resolved
            alerts); mark/resolve/delete only while the alert is still active. */}
        {(!isResolved || messageLink) && (
          <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {messageLink && (
              <button
                onClick={() => window.open(messageLink, '_blank', 'noopener,noreferrer')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#EFF6FF', color: '#1D4ED8' }}
              >
                <Mail className="w-3 h-3" />
                פתח מייל מקורי
              </button>
            )}
            {!isResolved && alert.status === 'new' && (
              <button
                onClick={() => onMarkRead(alert.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#F3F4F6', color: '#374151' }}
              >
                <Eye className="w-3 h-3" />
                סמן כנקרא
              </button>
            )}
            {!isResolved && (
              <button
                onClick={() => onMarkResolved(alert.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#DCFCE7', color: '#166534' }}
              >
                <Check className="w-3 h-3" />
                סמן כטופל
              </button>
            )}
            {!isResolved && (
              <button
                onClick={() => onDelete(alert.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#FEE2E2', color: '#DC2626' }}
              >
                <Trash2 className="w-3 h-3" />
                מחק
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type TypeFilter   = 'all' | Bucket
type StatusFilter = 'all' | AlertStatus

interface AlertsProps {
  alerts: Alert[]
  onMarkRead: (id: string) => void
  onMarkResolved: (id: string) => void
  onDelete: (id: string) => void
  onCreateSupplierFromAlert?: (alert: Alert) => void
  onOpenInvoice?:                  (invoiceId: string)    => void
  onOpenInvoiceDuplicate?:         (invoiceId: string)    => void
  onOpenInvoiceByGmailMessageId?:  (gmailMessageId: string, onNotFound?: () => void) => void
  onOpenSupplier?:                 (supplierId: string)   => void
  onOpenSupplierByName?:           (supplierName: string) => void
  onOpenReturn?:                   (returnId: string)     => void
  onOpenStatement?:                (statementId: string)  => void
  onPageChange?:                   (page: string)         => void
  // Scroll restoration: parent remembers the list position across navigation.
  // onScrollSave is called right before we navigate away (alert click);
  // savedScrollY is reapplied when this page re-mounts.
  savedScrollY?:                   number
  onScrollSave?:                   (y: number)            => void
}

// Route a clicked alert to the most useful single-entity destination for its type.
// Backend writes a wider set of type strings (invoice_duplicate, invoice_low_confidence,
// unmatched_credit_note, return_amount_mismatch …) than the frontend union — match on
// the raw string and fall through to a page-level destination only when an ID isn't available.
// Exported so the Dashboard's "Recent Alerts" card shares the exact same routing.
export function resolveAlertDestination(
  alert: Alert,
  handlers: {
    onOpenInvoice?:                 (id: string)   => void
    onOpenInvoiceDuplicate?:        (id: string)   => void
    onOpenInvoiceByGmailMessageId?: (msgId: string) => void
    onOpenSupplier?:                (id: string)   => void
    onOpenSupplierByName?:          (name: string) => void
    onOpenReturn?:                  (id: string)   => void
    onOpenStatement?:               (id: string)   => void
    onPageChange?:                  (page: string) => void
    onCreateSupplierFromAlert?:     (alert: Alert) => void
  },
): void {
  const t = alert.type as string
  const p = (alert.payload ?? {}) as Record<string, unknown>
  const invoiceId      = (p.existingInvoiceId as string | undefined) ?? (p.invoiceId as string | undefined) ?? alert.relatedId
  const gmailMessageId = p.gmailMessageId as string | undefined
  const messageLink    = p.messageLink    as string | undefined
  const supplierId     = p.supplierId     as string | undefined
  const returnId       = p.returnId       as string | undefined
  const statementId    = p.statementId    as string | undefined
  const storagePath    = p.storagePath    as string | undefined

  // Duplicate invoice → open the side-by-side review popup, not the detail view
  if (t === 'duplicate_invoice' || t === 'invoice_duplicate') {
    if (invoiceId && handlers.onOpenInvoiceDuplicate) { handlers.onOpenInvoiceDuplicate(invoiceId); return }
    handlers.onPageChange?.('invoices-duplicates')
    return
  }

  // Misclassified document (07-ALERTS #8) → re-classify in an in-page popup that shows
  // the document image + a type picker (handled by the Alerts onClick). This path is
  // only reached from the Dashboard card, so send the user to the alerts queue.
  if (t === 'document_misclassified') {
    handlers.onPageChange?.('alerts')
    return
  }

  // Open the INVOICE detail so the owner can compare the source document against the
  // parsed data. Prefer a payload invoiceId, then resolve by gmail_message_id (the
  // invoice row can be written after the alert), else fall back to the invoices list.
  //   • invoice_low_confidence → verify AI extraction         (07-ALERTS #7)
  //   • invoice_ingest_failed  → manual handling / re-queue   (07-ALERTS #1)
  //   • invoice_link_failed    → file IS in Drive; assign a supplier + complete details
  //   • invoice_old_date       → confirm the date             (07-ALERTS #11)
  if (
    t === 'invoice_low_confidence' || t === 'invoice_ingest_failed' ||
    t === 'invoice_link_failed'    || t === 'invoice_old_date'      ||
    t === 'needs_review'           || t === 'invoice_unclassified'  ||
    t === 'extraction_failed'
  ) {
    if (invoiceId       && handlers.onOpenInvoice)                { handlers.onOpenInvoice(invoiceId);                 return }
    if (gmailMessageId  && handlers.onOpenInvoiceByGmailMessageId){ handlers.onOpenInvoiceByGmailMessageId(gmailMessageId); return }
    handlers.onPageChange?.('invoices')
    return
  }

  // Genuinely no file/invoice yet (missing or invalid attachment) → open the source
  // email so the user can attach a valid file manually (07-ALERTS #9, #10).
  if (t === 'invoice_no_attachment' || t === 'invoice_no_valid_attachment') {
    if (messageLink) { window.open(messageLink, '_blank', 'noopener,noreferrer'); return }
    handlers.onPageChange?.('alerts')
    return
  }

  // Supplier needs attention (missing details / pending review) → open that
  // supplier's page so the details can be completed/verified.
  if (t === 'supplier_incomplete' || t === 'supplier_details_review') {
    if (supplierId && handlers.onOpenSupplier) { handlers.onOpenSupplier(supplierId); return }
    handlers.onPageChange?.('suppliers')
    return
  }

  // Unmatched credit note (זיכוי ללא חזרה, 07-ALERTS #5) → open the RETURN for manual
  // review / matching, NOT the supplier page.
  if (t === 'unmatched_credit_note') {
    if (returnId && handlers.onOpenReturn) { handlers.onOpenReturn(returnId); return }
    handlers.onPageChange?.('returns')
    return
  }

  // Return amount mismatch → open THAT return to reconcile the amount.
  if (t === 'return_amount_mismatch') {
    if (returnId && handlers.onOpenReturn) { handlers.onOpenReturn(returnId); return }
    handlers.onPageChange?.('returns')
    return
  }

  // Statement save failed / mismatch → open the SPECIFIC statement's detail (by
  // statementId) rather than the reconciliation list. Falls back to the stored
  // file, then the reconciliation screen, if no id is available.
  if (t === 'statement_save_failed' || t === 'statement_mismatch') {
    if (statementId && handlers.onOpenStatement) { handlers.onOpenStatement(statementId); return }
    if (storagePath) { openStoredFile(storagePath); return }
    handlers.onPageChange?.('reconciliation')
    return
  }

  if (t === 'delivery_note')      { handlers.onPageChange?.('deliveries');     return }
  // Unknown type — leave the user on the alerts page (no-op).
}

export default function Alerts({
  alerts, onMarkRead, onMarkResolved, onDelete,
  onOpenInvoice, onOpenInvoiceDuplicate, onOpenInvoiceByGmailMessageId,
  onOpenSupplier, onOpenSupplierByName, onOpenReturn, onOpenStatement, onPageChange,
  savedScrollY, onScrollSave,
}: AlertsProps) {
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  // document_misclassified opens an in-page re-classify popup (not a page nav).
  const [reclassifyAlert, setReclassifyAlert] = useState<Alert | null>(null)

  // Restore the remembered scroll position after the list has rendered. Using
  // useLayoutEffect (pre-paint) avoids a visible jump from 0 to the saved spot.
  useLayoutEffect(() => {
    if (savedScrollY) window.scrollTo(0, savedScrollY)
    // Restore only on mount; deps intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const newCount      = alerts.filter(a => a.status === 'new').length
  const readCount     = alerts.filter(a => a.status === 'read').length
  const resolvedCount = alerts.filter(a => a.status === 'resolved').length

  // Resolved alerts drop out of the main view: the default ("all") status filter
  // shows only unresolved alerts, and resolved ones surface only when the "טופל"
  // status filter is explicitly selected.
  const filtered = alerts.filter(a => {
    if (typeFilter !== 'all' && getAlertTypeConf(a.type).bucket !== typeFilter) return false
    if (statusFilter === 'all') {
      if (a.status === 'resolved') return false
    } else if (a.status !== statusFilter) {
      return false
    }
    return true
  })

  // Denominator for the "showing X of Y" line — the count in the current status
  // scope (unresolved by default), so it never includes hidden resolved alerts.
  const visibleTotal = alerts.filter(a =>
    statusFilter === 'all' ? a.status !== 'resolved' : a.status === statusFilter,
  ).length

  const filterBtn = (
    active: boolean,
    label: string,
    onClick: () => void,
    activeColor = 'var(--brand-primary-dark)',
  ) => (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-xl text-sm font-semibold transition-all"
      style={{
        background: active ? activeColor : 'white',
        color: active ? 'white' : '#6B7280',
        border: `1.5px solid ${active ? activeColor : '#E2E4E9'}`,
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <p className="text-gray-500 text-sm mt-0.5">
          מעקב אחר חריגים והתראות הדורשים טיפול
        </p>
      </div>

      {/* Summary stat cards */}
      <SummaryCards items={[
        { label: 'חדש',    value: newCount,      Icon: Bell, tone: 'blue' },
        { label: 'בטיפול', value: readCount,     Icon: Eye,  tone: 'neutral' },
        { label: 'טופל',   value: resolvedCount, Icon: Check, tone: 'green' },
      ]} />

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border space-y-3" style={{ borderColor: '#E2E4E9' }}>
        {/* Type filter (by severity bucket) */}
        <div className="flex items-center gap-2 flex-wrap" style={{ direction: 'rtl' }}>
          <span className="text-xs font-semibold text-gray-400 ml-1">סוג:</span>
          {filterBtn(typeFilter === 'all', 'הכל', () => setTypeFilter('all'))}
          {TYPE_BUCKETS.map(t =>
            filterBtn(typeFilter === t, BUCKET_LABEL[t], () => setTypeFilter(t))
          )}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 flex-wrap" style={{ direction: 'rtl' }}>
          <span className="text-xs font-semibold text-gray-400 ml-1">סטטוס:</span>
          {filterBtn(statusFilter === 'all', 'הכל', () => setStatusFilter('all'))}
          {(Object.keys(STATUS_LABELS) as AlertStatus[]).map(s =>
            filterBtn(
              statusFilter === s,
              STATUS_LABELS[s],
              () => setStatusFilter(s),
              STATUS_CONFIG[s].indicator,
            )
          )}
        </div>
      </div>

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-2xl bg-white border shadow-sm"
          style={{ borderColor: '#E2E4E9', minHeight: '220px' }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: '#F3F4F6' }}
          >
            <Bell className="w-6 h-6 text-gray-300" />
          </div>
          <p className="font-bold text-gray-500 text-sm">אין התראות תואמות לסינון הנבחר</p>
          <p className="text-xs text-gray-400 mt-1">שנה את הסינון כדי לראות התראות נוספות</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 text-right font-medium">
            מציג {filtered.length} מתוך {visibleTotal} התראות
          </p>
          {filtered.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onMarkRead={onMarkRead}
              onMarkResolved={onMarkResolved}
              onDelete={onDelete}
              onClick={() => {
                // Opening an alert auto-marks it read (persisted as status='read').
                if (alert.status === 'new') onMarkRead(alert.id)
                // Misclassified documents open an in-page re-classify popup instead
                // of navigating away (spec 07-ALERTS #8).
                if ((alert.type as string) === 'document_misclassified') { setReclassifyAlert(alert); return }
                // Remember where we are so we can return here after the alert
                // is handled (e.g. resolving a duplicate in the popup).
                onScrollSave?.(window.scrollY)
                resolveAlertDestination(alert, {
                  onOpenInvoice,
                  onOpenInvoiceDuplicate,
                  onOpenInvoiceByGmailMessageId,
                  onOpenSupplier,
                  onOpenSupplierByName,
                  onOpenReturn,
                  onOpenStatement,
                  onPageChange,
                })
              }}
            />
          ))}
        </div>
      )}

      {reclassifyAlert && (
        <ReclassifyModal
          alert={reclassifyAlert}
          onClose={() => setReclassifyAlert(null)}
          onConfirm={async (docType) => {
            const a = reclassifyAlert
            const p = (a.payload ?? {}) as Record<string, unknown>
            setReclassifyAlert(null)
            // Re-file the document into the correct table via hadas-api. When the
            // function is unavailable (e.g. not deployed in dev) this throws — we
            // still resolve the alert so it leaves the queue; the record move lights
            // up once hadas-api is deployed. (createAlert path resolves via anon RLS.)
            try {
              await api.post('/documents/reclassify', {
                alertId: a.id,
                docType,
                typedSupplierName: p.typedSupplierName,
                documentUrl:       p.documentUrl,
                storagePath:       p.storagePath,
                messageLink:       p.messageLink,
                gmailMessageId:    p.gmailMessageId,
              })
            } catch (e) {
              console.warn('[reclassify] hadas-api unavailable; resolving alert only:', e)
            }
            onMarkResolved(a.id)
          }}
        />
      )}
    </div>
  )
}

// ── Re-classify popup (document_misclassified) ──────────────────────────────
// Shows the source document alongside a document-type picker so the owner can
// correct the AI's classification (spec 07-ALERTS #8: "open the document to
// re-classify"). The image comes from payload.documentUrl (direct URL) or a
// signed URL minted from payload.storagePath (private "documents" bucket).
const DOC_TYPES = ['חשבונית', 'זיכוי', 'תעודת משלוח', 'כרטסת', 'אחר'] as const

function ReclassifyModal({
  alert, onClose, onConfirm,
}: {
  alert: Alert
  onClose: () => void
  onConfirm: (docType: string) => void
}) {
  const p = (alert.payload ?? {}) as Record<string, unknown>
  const directUrl  = p.documentUrl as string | undefined
  const storagePath = p.storagePath as string | undefined
  const [docUrl, setDocUrl]   = useState<string | null>(directUrl ?? null)
  const [choice, setChoice]   = useState<string>('')

  useLayoutEffect(() => {
    if (docUrl || !storagePath) return
    let alive = true
    supabase.storage.from('documents').createSignedUrl(storagePath, 120).then(({ data }) => {
      if (alive && data?.signedUrl) setDocUrl(data.signedUrl)
    })
    return () => { alive = false }
  // storagePath is stable for the lifetime of this modal
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #EEEEF2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X className="w-5 h-5" />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 600, color: '#1F2937', margin: 0 }}>סיווג מחדש של המסמך</h2>
            <FileX className="w-5 h-5" style={{ color: '#B45309' }} />
          </div>
        </div>

        {/* Document image */}
        <div style={{ padding: '16px 22px 8px' }}>
          {docUrl ? (
            <iframe
              src={docUrl}
              title="מסמך מקור"
              style={{ width: '100%', height: '340px', border: '1px solid #E2E4E9', borderRadius: '12px', background: '#F9FAFB' }}
            />
          ) : (
            <div style={{ height: '340px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E2E4E9', borderRadius: '12px', background: '#F9FAFB', color: '#9CA3AF', fontSize: '13px' }}>
              אין תצוגת מסמך זמינה
            </div>
          )}
        </div>

        {/* Type picker */}
        <div style={{ padding: '8px 22px 22px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#374151', textAlign: 'right', margin: '0 0 10px' }}>בחר את סוג המסמך הנכון:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {DOC_TYPES.map(dt => (
              <button
                key={dt}
                onClick={() => setChoice(dt)}
                style={{
                  padding: '8px 14px', borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  background: choice === dt ? 'var(--brand-primary-dark)' : 'white',
                  color:      choice === dt ? 'white'   : '#6B7280',
                  border: `1.5px solid ${choice === dt ? 'var(--brand-primary-dark)' : '#E2E4E9'}`,
                }}
              >
                {dt}
              </button>
            ))}
          </div>
          <button
            onClick={() => choice && onConfirm(choice)}
            disabled={!choice}
            style={{
              width: '100%', height: '46px', borderRadius: '12px', border: 'none', fontWeight: 700, fontSize: '15px', fontFamily: 'inherit',
              cursor: choice ? 'pointer' : 'not-allowed',
              background: choice ? 'var(--brand-primary)' : '#F3F4F6',
              color:      choice ? 'white'   : '#9CA3AF',
            }}
          >
            שמור סיווג
          </button>
        </div>
      </div>
    </div>
  )
}
