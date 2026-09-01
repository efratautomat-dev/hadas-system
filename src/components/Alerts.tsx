import { useState, useLayoutEffect } from 'react'
import {
  Truck, Copy, Scale, Check, Eye, Trash2, Bell, UserPlus,
  HelpCircle, FileX, Paperclip, Unlink, AlertTriangle, Clock,
  FileWarning, Receipt, AlertCircle, Tag, Mail, X, ShieldCheck, AlertOctagon, Coins,
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
  // Raised for real by the statement reconciliation on ingest — no longer a
  // mock-only type, so it gets a bucket and appears in the type filter.
  statement_mismatch:          b('אי-התאמת כרטסת',          Scale,         'urgent'),
  // The כרטסת twin of invoice_ingest_failed: extraction returned nothing usable,
  // so the row was saved with no supplier and no balance and is inert until a
  // human reads the document and fills both in. Broken ingest → urgent, not a
  // routine state.
  statement_extract_failed:    b('פענוח כרטסת נכשל — טיפול ידני', FileWarning, 'urgent'),
  // Parked after MAX_INGEST_ATTEMPTS — the per-document-type siblings of
  // invoice_ingest_failed. Until now that ONE type served every document, so a
  // תעודת משלוח whose extraction kept failing was announced to the owner as a failed
  // INVOICE — the same defect spec/09-IDEAS.md §10 records for כרטסת. The email is
  // parked behind the "פענוח נכשל" Gmail label and re-queues when the label is removed.
  //
  // NOT the same as statement_extract_failed above: there the row WAS saved and sits
  // inert awaiting a human; here nothing was saved and the email is out of the queue.
  delivery_note_ingest_failed: b('פענוח תעודת משלוח נכשל — טיפול ידני', Truck,    'urgent'),
  statement_ingest_failed:     b('פענוח כרטסת נכשל — טיפול ידני',       Scale,    'urgent'),
  return_ingest_failed:        b('פענוח זיכוי/חזרה נכשל — טיפול ידני',  Receipt,  'urgent'),

  // ── Action (orange): a human action is required ──
  supplier_incomplete:         b('ספק – חסר פרטים',         UserPlus,      'action'),
  supplier_details_review:     b('ספק – לבדיקת פרטים',      UserPlus,      'action'),
  unmatched_credit_note:       b('זיכוי ללא חזרה',          Receipt,       'action'),
  statement_save_failed:       b('שמירת כרטסת נכשלה',       Scale,         'action'),
  // The approval gate. ACTION, not urgent: nothing is broken and nothing was
  // lost — the invoice is filed and counted. What is outstanding is a decision.
  invoice_approval_required:   b('חשבונית גדולה — נדרש אישור', ShieldCheck, 'action'),
  // A figure the extractor read off the document could not be a price, so it was
  // dropped and the document filed without it. ACTION rather than urgent for the
  // same reason as the gate: nothing was lost, a number is missing. The invoice
  // one comes FIRST in the pair because an invoice without its amount moves no
  // balance — the supplier is owed money the ledger does not show.
  invoice_amount_unreadable:      b('סכום לא נקרא בחשבונית', Coins, 'action'),
  delivery_note_amount_unreadable: b('סכום לא נקרא בתעודה',  Coins, 'action'),

  // ── Check (yellow): worth a look / verify ──
  invoice_low_confidence:      b('וודאות נמוכה',            AlertTriangle, 'check'),
  document_misclassified:      b('מסמך לא חשבונית',         FileX,         'check'),
  invoice_no_attachment:       b('ללא קובץ',                Paperclip,     'check'),
  invoice_no_valid_attachment: b('ללא קובץ תקין',           FileX,         'check'),
  invoice_link_failed:         b('הורדה נכשלה',             Unlink,        'check'),
  // Same "no usable document" case as the three above, but for the non-invoice
  // types. They exist because subject classification now runs BEFORE the
  // no-file guard — previously a כרטסת whose file could not be fetched was
  // reported as a failed INVOICE and never reached vendor_statements at all
  // (spec/09-IDEAS.md §10). The specific reason (filtered / link_failed /
  // no_attachment) rides in the message and payload, not in the type.
  statement_no_file:           b('כרטסת ללא קובץ',          Scale,         'check'),
  delivery_note_no_file:       b('תעודת משלוח ללא קובץ',    Truck,         'check'),
  return_no_file:              b('זיכוי/חזרה ללא קובץ',     Receipt,       'check'),

  // ── Info (gray): informational ──
  invoice_old_date:            b('תאריך מוקדם',             Clock,         'info'),

  // ── Legacy / mock-only types (kept so demo + mock data still render; no
  //     bucket → intentionally absent from the bucket type filter) ──
  delivery_note:               { label: 'תעודת משלוח',     Icon: Truck,         bg: '#DBEAFE', color: '#1E40AF' },
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

  // The approval gate is decided in a popup on the alerts screen — approving or
  // rejecting needs the document and the figures side by side, and rejection
  // DELETES the invoice, so it must not be one stray click away in a list.
  if (t === 'invoice_approval_required') {
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
  // The three non-invoice variants are the same situation for a כרטסת / delivery
  // note / credit note: nothing was saved anywhere, so the email IS the only
  // place to act. There is no row to open.
  // The parked-extraction variants land here for the same reason: extraction failed
  // MAX_INGEST_ATTEMPTS times, nothing was written to any table, and the email is out
  // of the ingest queue behind the "פענוח נכשל" label. There is no row to open — the
  // email is where the document is and where the label is removed to re-queue it.
  if (
    t === 'invoice_no_attachment'  || t === 'invoice_no_valid_attachment' ||
    t === 'statement_no_file'      || t === 'delivery_note_no_file'       ||
    t === 'return_no_file'         || t === 'delivery_note_ingest_failed' ||
    t === 'statement_ingest_failed'|| t === 'return_ingest_failed'
  ) {
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

  // Statement save failed / mismatch / failed extraction → open the SPECIFIC
  // statement's detail (by statementId) rather than the reconciliation list.
  // Falls back to the stored file, then the reconciliation screen, if no id is
  // available.
  //
  // statement_extract_failed deliberately does NOT follow the `*_no_file` route
  // (open the source email). Those types have nothing saved anywhere, so the
  // email is the only place to act; here the row and the FILE both exist — only
  // the reading of it failed. The statement detail is the one screen that shows
  // the arrived document next to the two controls that repair it (assign
  // supplier, enter the vendor balance), so it is where the human finishes the
  // job. The card's own "פתח מייל מקורי" button still covers the email whenever
  // payload.messageLink is present.
  if (
    t === 'statement_save_failed' || t === 'statement_mismatch' ||
    t === 'statement_extract_failed'
  ) {
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
  const [approvalAlert, setApprovalAlert]     = useState<Alert | null>(null)

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
      // The chips are rendered from .map(), so each needs its own key — the label
      // is unique within both filter rows.
      key={label}
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
                // Same reasoning: the approval decision happens here, over the
                // document, not after navigating away from it.
                if ((alert.type as string) === 'invoice_approval_required') { setApprovalAlert(alert); return }
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

      {approvalAlert && (
        <ApprovalModal
          alert={approvalAlert}
          onClose={() => setApprovalAlert(null)}
          onDecide={async (decision) => {
            const a  = approvalAlert
            const p  = (a.payload ?? {}) as Record<string, unknown>
            const id = (p.invoiceId as string | undefined) ?? a.relatedId
            setApprovalAlert(null)
            if (!id) {
              console.error('[approval] alert carries no invoiceId — resolving alert only')
              onMarkResolved(a.id)
              return
            }
            try {
              if (decision === 'approve') {
                await api.put(`/invoices/${id}/approve`, {})
              } else {
                // Rejection deletes the invoice AND its Drive copy, its Storage
                // copy and its sibling alerts — hadas-api's deleteInvoice owns
                // all of it. The Drive file goes to the TRASH, not to nothing,
                // which is the only reason a mistake here is survivable.
                await api.delete(`/invoices/${id}`)
              }
            } catch (e) {
              // Do NOT resolve the alert on a failure: leaving it in the queue is
              // how the owner finds out the decision did not take.
              console.error('[approval] decision failed — alert left open:', e)
              window.alert('הפעולה נכשלה. ההתראה נשארה פתוחה — אפשר לנסות שוב.')
              return
            }
            onMarkResolved(a.id)
          }}
        />
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

// ── Approval popup (invoice_approval_required) ──────────────────────────────
// An invoice whose PRE-VAT amount passed the threshold in Settings. It is
// already filed and already counted in the supplier's balance — what is missing
// is the owner's decision.
//
// The document and the figures sit side by side because the decision needs both:
// the amounts as extracted, and the page they were read off. Rejection is behind
// a SECOND confirmation and is spelled out in full, because it deletes the
// invoice, the Drive copy and the Storage copy — invoices this size are usually
// mistakes, but "usually" is not a reason to make destruction one click.
function ApprovalModal({
  alert, onClose, onDecide,
}: {
  alert: Alert
  onClose: () => void
  onDecide: (decision: 'approve' | 'reject') => void
}) {
  const p = (alert.payload ?? {}) as Record<string, unknown>
  const driveLink   = p.driveFileLink as string | undefined
  const storagePath = p.storageUrl    as string | undefined
  const mailLink    = p.messageLink   as string | undefined
  const [docUrl, setDocUrl]       = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy]           = useState(false)

  useLayoutEffect(() => {
    if (!storagePath) return
    let alive = true
    supabase.storage.from('documents').createSignedUrl(storagePath, 120).then(({ data }) => {
      if (alive && data?.signedUrl) setDocUrl(data.signedUrl)
    })
    return () => { alive = false }
  // storagePath is stable for the lifetime of this modal
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ils = (v: unknown): string => {
    const n = Number(v ?? NaN)
    if (!Number.isFinite(n)) return '—'
    return '\u20AA' + Math.round(Math.abs(n)).toLocaleString('he-IL') + (n < 0 ? '-' : '')
  }

  const rows: [string, string][] = [
    ['ספק',            String(p.supplierName ?? '') || '—'],
    ['מספר חשבונית',   String(p.invoiceNumber ?? '') || '—'],
    ['תאריך',          String(p.invoiceDate ?? '') || '—'],
    ['סכום לפני מע״מ', ils(p.amountBeforeVat)],
    ['מע״מ',           ils(p.vatAmount)],
    ['סה״כ',           ils(p.totalAmount)],
    ['קטגוריה',        String(p.category ?? '') || '—'],
  ]

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '720px', maxHeight: '92vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #EEEEF2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X className="w-5 h-5" />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 600, color: '#1F2937', margin: 0 }}>חשבונית גדולה — נדרש אישור</h2>
            <ShieldCheck className="w-5 h-5" style={{ color: '#C2410C' }} />
          </div>
        </div>

        <div style={{ padding: '16px 22px 0' }}>
          <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 12px', lineHeight: 1.6 }}>
            הסכום לפני מע״מ עבר את סף האישור{p.threshold != null ? ` (${ils(p.threshold)})` : ''}.
            החשבונית כבר נשמרה ונספרת ביתרת הספק — נותרה ההכרעה.
          </p>
        </div>

        {/* Figures + document, side by side */}
        <div style={{ padding: '0 22px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: '7px 0', color: '#6B7280', whiteSpace: 'nowrap' }}>{k}</td>
                    <td style={{ padding: '7px 0', fontWeight: 600, color: '#1F2125', textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(driveLink || mailLink) && (
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
                {driveLink && (
                  <a href={driveLink} target="_blank" rel="noreferrer" style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--brand-primary)' }}>
                    פתיחה ב-Drive ↗
                  </a>
                )}
                {mailLink && (
                  <a href={mailLink} target="_blank" rel="noreferrer" style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--brand-primary)' }}>
                    פתיחת המייל ↗
                  </a>
                )}
              </div>
            )}
          </div>

          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            {docUrl ? (
              <iframe
                src={docUrl}
                title="מסמך מקור"
                style={{ width: '100%', height: '300px', border: '1px solid #E2E4E9', borderRadius: '12px', background: '#F9FAFB' }}
              />
            ) : (
              <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E2E4E9', borderRadius: '12px', background: '#F9FAFB', color: '#9CA3AF', fontSize: '13px', textAlign: 'center', padding: '12px' }}>
                {storagePath ? 'טוען את המסמך…' : 'אין תצוגת מסמך — אפשר לפתוח ב-Drive'}
              </div>
            )}
          </div>
        </div>

        {/* Decision */}
        <div style={{ padding: '18px 22px 22px' }}>
          {!confirming ? (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={() => { setBusy(true); onDecide('approve') }}
                disabled={busy}
                style={{
                  flex: '1 1 200px', height: '46px', borderRadius: '12px', border: 'none', fontWeight: 700,
                  fontSize: '15px', fontFamily: 'inherit', cursor: busy ? 'wait' : 'pointer',
                  background: 'var(--brand-primary)', color: 'white', opacity: busy ? 0.6 : 1,
                }}
              >אישור החשבונית</button>
              <button
                onClick={() => setConfirming(true)}
                disabled={busy}
                style={{
                  flex: '1 1 200px', height: '46px', borderRadius: '12px', fontWeight: 700,
                  fontSize: '15px', fontFamily: 'inherit', cursor: 'pointer',
                  background: 'white', color: '#B91C1C', border: '1.5px solid #FCA5A5',
                }}
              >דחייה ומחיקה</button>
            </div>
          ) : (
            <div style={{ border: '1.5px solid #FCA5A5', background: '#FEF2F2', borderRadius: '14px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '10px' }}>
                <AlertOctagon className="w-5 h-5" style={{ color: '#B91C1C', flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#B91C1C' }}>למחוק את החשבונית?</p>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#7F1D1D', lineHeight: 1.6 }}>
                    השורה תימחק מהמערכת, היתרה של {String(p.supplierName ?? 'הספק')} תרד ב-{ils(p.totalAmount)},
                    והקובץ יעבור ל<b>אשפת ה-Drive</b> (משם אפשר לשחזר). גם התראות אחרות מאותו מייל ייסגרו.
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setBusy(true); onDecide('reject') }}
                  disabled={busy}
                  style={{
                    flex: '1 1 180px', height: '44px', borderRadius: '12px', border: 'none', fontWeight: 700,
                    fontSize: '14.5px', fontFamily: 'inherit', cursor: busy ? 'wait' : 'pointer',
                    background: '#B91C1C', color: 'white', opacity: busy ? 0.6 : 1,
                  }}
                >כן, למחוק</button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  style={{
                    flex: '1 1 120px', height: '44px', borderRadius: '12px', fontWeight: 700,
                    fontSize: '14.5px', fontFamily: 'inherit', cursor: 'pointer',
                    background: 'white', color: '#6B7280', border: '1.5px solid #E2E4E9',
                  }}
                >ביטול</button>
              </div>
            </div>
          )}
        </div>
      </div>
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
