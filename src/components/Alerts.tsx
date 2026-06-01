import { useState, useLayoutEffect } from 'react'
import {
  Truck, Copy, Scale, Check, Eye, Trash2, Bell, UserPlus,
  HelpCircle, FileX, Paperclip, Unlink, AlertTriangle, Clock,
  FileWarning, Receipt, AlertCircle, Tag,
} from 'lucide-react'
import type { Alert, AlertType, AlertStatus } from '../data/mockData'

type AlertTypeConf = {
  label: string
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  bg: string
  color: string
}

// Single source of truth for badge label / icon / colors per alert type.
// Keys cover every type the backend emits (grep `alerts.insert({type:` in
// supabase/functions) plus the legacy mock-data types. Each type gets a
// visually distinct palette so the list doesn't read as a wall of yellow.
// Exported so the Dashboard's "Recent Alerts" card uses the same config.
export const ALERT_TYPE_CONFIG: Record<string, AlertTypeConf> = {
  // Duplicates — both the backend name and the legacy mock alias map to the same look
  invoice_duplicate:           { label: 'כפילות',         Icon: Copy,          bg: '#FEF3C7', color: '#D97706' },
  duplicate_invoice:           { label: 'כפילות',         Icon: Copy,          bg: '#FEF3C7', color: '#D97706' },

  // Delivery / statement
  delivery_note:               { label: 'תעודת משלוח',     Icon: Truck,         bg: '#DBEAFE', color: '#1E40AF' },
  statement_mismatch:          { label: 'אי-התאמת כרטסת', Icon: Scale,         bg: '#FEE2E2', color: '#DC2626' },

  // Supplier
  supplier_not_found:          { label: 'ספק לא זוהה',     Icon: UserPlus,      bg: '#F5F3FF', color: '#7C3AED' },

  // Invoice ingestion problems
  invoice_unclassified:        { label: 'לא סווג',         Icon: HelpCircle,    bg: '#F3F4F6', color: '#4B5563' },
  invoice_no_valid_attachment: { label: 'ללא קובץ תקין',   Icon: FileX,         bg: '#FFEDD5', color: '#C2410C' },
  invoice_no_attachment:       { label: 'ללא קובץ',        Icon: Paperclip,     bg: '#FFEDD5', color: '#C2410C' },
  invoice_link_failed:         { label: 'הורדה נכשלה',     Icon: Unlink,        bg: '#FFE4E6', color: '#BE123C' },
  invoice_low_confidence:      { label: 'וודאות נמוכה',    Icon: AlertTriangle, bg: '#FEF9C3', color: '#B45309' },
  invoice_old_date:            { label: 'תאריך מוקדם',     Icon: Clock,         bg: '#CCFBF1', color: '#0F766E' },
  extraction_failed:           { label: 'פענוח נכשל',      Icon: FileWarning,   bg: '#FEE2E2', color: '#B91C1C' },

  // Credit notes / returns
  unmatched_credit_note:       { label: 'זיכוי ללא חזרה',  Icon: Receipt,       bg: '#E0E7FF', color: '#4338CA' },
  return_amount_mismatch:      { label: 'פער בהחזר',       Icon: AlertCircle,   bg: '#FCE7F3', color: '#BE185D' },

  // Misclassification — extractor refused to treat the document as an invoice.
  // Informational (system handled it correctly), so amber rather than red.
  document_misclassified:      { label: 'מסמך לא חשבונית', Icon: FileX,         bg: '#FFF7ED', color: '#9A3412' },
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

// Type-filter chips on top of the page — limited to the small legacy set
// since adding every backend type would push the filter row past one line.
const TYPE_LABELS: Record<AlertType, string> = {
  duplicate_invoice:  'כפילות',
  delivery_note:      'תעודת משלוח',
  statement_mismatch: 'אי-התאמת כרטסת',
  supplier_not_found: 'ספק לא זוהה',
}

const STATUS_LABELS: Record<AlertStatus, string> = {
  new:      'חדש',
  read:     'נקרא',
  resolved: 'טופל',
}

interface AlertCardProps {
  alert: Alert
  onMarkRead: (id: string) => void
  onMarkResolved: (id: string) => void
  onDelete: (id: string) => void
  onCreateSupplierFromAlert?: (alert: Alert) => void
  onClick?: () => void
}

function AlertCard({ alert, onMarkRead, onMarkResolved, onDelete, onCreateSupplierFromAlert, onClick }: AlertCardProps) {
  // Per-type config; unknown types fall back to a neutral badge showing the raw type
  // (never the duplicate label) so misclassification can't masquerade as a duplicate.
  const typeConf   = getAlertTypeConf(alert.type)
  const statusConf = STATUS_CONFIG[alert.status] ?? STATUS_CONFIG.new
  const TypeIcon   = typeConf.Icon
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
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
            style={{ background: statusConf.bg, color: statusConf.color }}
          >
            {statusConf.label}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-600 leading-relaxed text-right mb-3">
          {alert.description}
        </p>

        {/* Actions — stop click bubbling so action buttons don't trigger row navigation */}
        {!isResolved && (
          <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {alert.type === 'supplier_not_found' && onCreateSupplierFromAlert && (
              <button
                onClick={() => onCreateSupplierFromAlert(alert)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#F5F3FF', color: '#7C3AED' }}
              >
                <UserPlus className="w-3 h-3" />
                צור ספק
              </button>
            )}
            {alert.status === 'new' && (
              <button
                onClick={() => onMarkRead(alert.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#F3F4F6', color: '#374151' }}
              >
                <Eye className="w-3 h-3" />
                סמן כנקרא
              </button>
            )}
            <button
              onClick={() => onMarkResolved(alert.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: '#DCFCE7', color: '#166534' }}
            >
              <Check className="w-3 h-3" />
              סמן כטופל
            </button>
            <button
              onClick={() => onDelete(alert.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: '#FEE2E2', color: '#DC2626' }}
            >
              <Trash2 className="w-3 h-3" />
              מחק
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

type TypeFilter   = 'all' | AlertType
type StatusFilter = 'all' | AlertStatus

interface AlertsProps {
  alerts: Alert[]
  onMarkRead: (id: string) => void
  onMarkResolved: (id: string) => void
  onDelete: (id: string) => void
  onCreateSupplierFromAlert?: (alert: Alert) => void
  onOpenInvoice?:                  (invoiceId: string)    => void
  onOpenInvoiceDuplicate?:         (invoiceId: string)    => void
  onOpenInvoiceByGmailMessageId?:  (gmailMessageId: string) => void
  onOpenSupplier?:                 (supplierId: string)   => void
  onOpenSupplierByName?:           (supplierName: string) => void
  onOpenReturn?:                   (returnId: string)     => void
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
  const supplierName   = p.supplierName   as string | undefined
  const returnId       = p.returnId       as string | undefined

  // Duplicate invoice → open the side-by-side review popup, not the detail view
  if (t === 'duplicate_invoice' || t === 'invoice_duplicate') {
    if (invoiceId && handlers.onOpenInvoiceDuplicate) { handlers.onOpenInvoiceDuplicate(invoiceId); return }
    handlers.onPageChange?.('invoices-duplicates')
    return
  }

  // Link-download failures: the invoice was never saved, so route the user to the original
  // Gmail thread (payload.messageLink) where the attachment can be re-downloaded manually.
  if (t === 'invoice_link_failed') {
    if (messageLink) { window.open(messageLink, '_blank', 'noopener,noreferrer'); return }
    handlers.onPageChange?.('alerts')
    return
  }

  // Misclassified document — the extractor refused to ingest it as an invoice.
  // Open the original email so the user can decide what to do with it.
  if (t === 'document_misclassified') {
    if (messageLink) { window.open(messageLink, '_blank', 'noopener,noreferrer'); return }
    handlers.onPageChange?.('alerts')
    return
  }

  // Needs-review flavor → open the specific invoice's detail page. The backend writes the
  // invoice AFTER these alerts but with the same gmail_message_id, so prefer a payload
  // invoiceId, then resolve by gmailMessageId, then fall back to the invoices list.
  if (
    t === 'needs_review'          || t === 'invoice_low_confidence' ||
    t === 'invoice_unclassified'  || t === 'invoice_old_date'       ||
    t === 'extraction_failed'
  ) {
    if (invoiceId       && handlers.onOpenInvoice)                { handlers.onOpenInvoice(invoiceId);                 return }
    if (gmailMessageId  && handlers.onOpenInvoiceByGmailMessageId){ handlers.onOpenInvoiceByGmailMessageId(gmailMessageId); return }
    handlers.onPageChange?.('invoices')
    return
  }

  // Attachment-missing failures: also no invoice in DB. Send the user to the source email.
  if (t === 'invoice_no_attachment' || t === 'invoice_no_valid_attachment') {
    if (messageLink) { window.open(messageLink, '_blank', 'noopener,noreferrer'); return }
    handlers.onPageChange?.('alerts')
    return
  }

  // Supplier-not-found → existing create-supplier-from-alert flow (prefills the new-supplier form)
  if (t === 'supplier_not_found' && handlers.onCreateSupplierFromAlert) {
    handlers.onCreateSupplierFromAlert(alert)
    return
  }

  // Unmatched credit note → open THAT supplier's detail page (by ID if we have one, else by name)
  if (t === 'unmatched_credit_note') {
    if (supplierId   && handlers.onOpenSupplier)        { handlers.onOpenSupplier(supplierId);        return }
    if (supplierName && handlers.onOpenSupplierByName)  { handlers.onOpenSupplierByName(supplierName); return }
    handlers.onPageChange?.('suppliers')
    return
  }

  // Return amount mismatch → open THAT return's edit modal directly
  if (t === 'return_amount_mismatch') {
    if (returnId && handlers.onOpenReturn) { handlers.onOpenReturn(returnId); return }
    handlers.onPageChange?.('returns')
    return
  }

  if (t === 'delivery_note')      { handlers.onPageChange?.('deliveries');     return }
  if (t === 'statement_mismatch') { handlers.onPageChange?.('reconciliation'); return }
  // Unknown type — leave the user on the alerts page (no-op).
}

export default function Alerts({
  alerts, onMarkRead, onMarkResolved, onDelete, onCreateSupplierFromAlert,
  onOpenInvoice, onOpenInvoiceDuplicate, onOpenInvoiceByGmailMessageId,
  onOpenSupplier, onOpenSupplierByName, onOpenReturn, onPageChange,
  savedScrollY, onScrollSave,
}: AlertsProps) {
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

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

  const filtered = alerts.filter(a => {
    if (typeFilter   !== 'all' && a.type   !== typeFilter)   return false
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    return true
  })

  const filterBtn = (
    active: boolean,
    label: string,
    onClick: () => void,
    activeColor = '#8B1A3A',
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
        <h1 className="text-2xl font-black text-gray-800">התראות מערכת</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          מעקב אחר חריגים והתראות הדורשים טיפול
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { value: newCount,      label: 'חדשות',  bg: '#FEE2E2', color: '#DC2626', iconBg: '#FCA5A5' },
          { value: readCount,     label: 'נקראו',  bg: '#F3F4F6', color: '#6B7280', iconBg: '#D1D5DB' },
          { value: resolvedCount, label: 'טופלו',  bg: '#DCFCE7', color: '#166534', iconBg: '#86EFAC' },
        ].map(({ value, label, bg, color, iconBg }) => (
          <div
            key={label}
            className="bg-white rounded-2xl p-4 shadow-sm border flex items-center gap-3"
            style={{ borderColor: '#E2E4E9' }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: bg }}
            >
              <Bell className="w-4 h-4" style={{ color: iconBg }} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-black" style={{ color }}>{value}</p>
              <p className="text-xs text-gray-500 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border space-y-3" style={{ borderColor: '#E2E4E9' }}>
        {/* Type filter */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="text-xs font-semibold text-gray-400 ml-1">סוג:</span>
          {filterBtn(typeFilter === 'all', 'הכל', () => setTypeFilter('all'))}
          {(Object.keys(TYPE_LABELS) as AlertType[]).map(t =>
            filterBtn(typeFilter === t, TYPE_LABELS[t], () => setTypeFilter(t))
          )}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
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
            מציג {filtered.length} מתוך {alerts.length} התראות
          </p>
          {filtered.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onMarkRead={onMarkRead}
              onMarkResolved={onMarkResolved}
              onDelete={onDelete}
              onCreateSupplierFromAlert={onCreateSupplierFromAlert}
              onClick={() => {
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
                  onPageChange,
                  onCreateSupplierFromAlert,
                })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
