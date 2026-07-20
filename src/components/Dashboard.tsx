import { Users, FileText, TrendingUp, AlertCircle, Package, AlertTriangle, Bell, Camera } from 'lucide-react'
import { useInvoices } from '../hooks/useInvoices'
import { useDeliveryNotes } from '../hooks/useDeliveryNotes'
import { usePayments } from '../hooks/usePayments'
import { useSuppliers } from '../hooks/useSuppliers'
import { useReturns } from '../hooks/useReturns'
import { useStatements } from '../hooks/useStatements'
import { resolveAlertDestination, getAlertTypeConf } from './Alerts'
import type { Alert } from '../data/mockData'
import { brand } from '../brand.config'
import { STATUS } from '../theme/status'
import { deriveInvoiceStatus, STATUS_WAITING } from '../lib/invoiceStatus'

const ALERT_STATUS: Record<string, { bg: string; color: string; label: string }> = {
  new:      { bg: STATUS.blue.bg, color: STATUS.blue.fg, label: 'חדש'  },   // fixed: new = blue
  read:     { bg: STATUS.gray.bg, color: STATUS.gray.fg, label: 'נקרא' },
  resolved: { bg: STATUS.green.bg, color: STATUS.green.fg, label: 'טופל' },
}

// Invoice/delivery status → FIXED functional tokens (src/theme/status.ts):
// ממתין=yellow(check), שולם/הושלם/נתקבל=green(done), בטיפול=orange(in_progress),
// שגיאה=red. בדרך (in-transit) has no status token → its own violet.
const statusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: STATUS.yellow.bg, color: STATUS.yellow.fg },
  'שולם':   { bg: STATUS.green.bg,  color: STATUS.green.fg },
  'הושלם':  { bg: STATUS.green.bg,  color: STATUS.green.fg },
  'בטיפול': { bg: STATUS.orange.bg, color: STATUS.orange.fg },
  'שגיאה':  { bg: STATUS.red.bg,    color: STATUS.red.fg },
  'נתקבל':  { bg: STATUS.green.bg,  color: STATUS.green.fg },
  'בדרך':   { bg: '#EDE9FE', color: '#5B21B6' },
}

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  if (iso.includes('/')) return iso
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

interface StatCardProps {
  title: string
  value: string
  sub: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  subColor: string
  loading?: boolean
  onClick?: () => void
}

// Soft shadow shared with the supplier cards / unified tables.
const CARD_SHADOW = '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)'

const CARD_SHADOW_LIFT = '0 2px 6px rgba(16,17,21,.06), 0 12px 28px rgba(16,17,21,.10)'

function StatCard({ title, value, sub, icon, iconBg, iconColor, subColor, loading, onClick }: StatCardProps) {
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } } : undefined}
      className={`bg-white flex flex-col gap-4 transition-all ${clickable ? 'active:scale-[0.99]' : ''}`}
      style={{ border: '1px solid #EEEEF2', borderRadius: '16px', boxShadow: CARD_SHADOW, padding: '20px', cursor: clickable ? 'pointer' : 'default' }}
      onMouseEnter={clickable ? (e) => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = CARD_SHADOW_LIFT; el.style.borderColor = '#E4E5EA' } : undefined}
      onMouseLeave={clickable ? (e) => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = CARD_SHADOW; el.style.borderColor = '#EEEEF2' } : undefined}
    >
      <div className="flex items-start justify-between">
        <div
          className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ width: '44px', height: '44px', backgroundColor: iconBg, color: iconColor }}
        >
          {loading
            ? <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: iconColor }} />
            : icon}
        </div>
        <p className="text-right" style={{ fontSize: '13px', fontWeight: 500, color: '#6B7280' }}>{title}</p>
      </div>
      <div className="text-right">
        <p style={{ fontSize: '30px', fontWeight: 700, color: '#12131A', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</p>
        <p style={{ fontSize: '12px', fontWeight: 500, marginTop: '4px', color: subColor }}>{sub}</p>
      </div>
    </div>
  )
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return `בוקר טוב ${brand.appName}`
  if (hour >= 12 && hour < 17) return `צהריים טובים ${brand.appName}`
  if (hour >= 17 && hour < 21) return `ערב טוב ${brand.appName}`
  return `לילה טוב ${brand.appName}`
}

interface DashboardProps {
  onPageChange?:                  (page: string) => void
  onOpenInvoice?:                 (invoiceId: string) => void
  onOpenInvoiceDuplicate?:        (invoiceId: string) => void
  onOpenInvoiceByGmailMessageId?: (gmailMessageId: string) => void
  onOpenSupplier?:                (supplierId: string) => void
  onOpenSupplierByName?:          (supplierName: string) => void
  onOpenReturn?:                  (returnId: string) => void
  onCreateSupplierFromAlert?:     (alert: Alert) => void
  onMarkRead?:                    (id: string) => void
  alerts?:                        Alert[]
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }} />
    </div>
  )
}

export default function Dashboard({
  onPageChange, onOpenInvoice, onOpenInvoiceDuplicate, onOpenInvoiceByGmailMessageId,
  onOpenSupplier, onOpenSupplierByName, onOpenReturn, onCreateSupplierFromAlert,
  onMarkRead, alerts = [],
}: DashboardProps) {
  // Use the shared mapper so this card routes identically to the full Alerts page.
  // Opening an alert auto-marks it read, consistent with the Alerts page.
  const handleAlertClick = (alert: Alert) => {
    if (alert.status === 'new') onMarkRead?.(alert.id)
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
  }

  const { data: invoices, loading: invLoading }             = useInvoices()
  const { data: deliveryNotes, loading: dnLoading }         = useDeliveryNotes()
  const { data: payments, loading: payLoading }             = usePayments()
  const { data: suppliers, loading: supLoading }            = useSuppliers()
  const { data: returns, loading: retLoading }              = useReturns()
  const { data: statements, loading: stmtLoading }          = useStatements()

  const dupInvoiceCount   = invoices.filter(i => i.duplicateFlag === 'כפילות אפשרית').length
  const mismatchCount     = statements.filter(s => s.status === 'mismatch').length
  const pendingDeliveryCount = deliveryNotes.filter(d => d.status === 'pending').length

  const activeSuppliers   = suppliers.filter(s => s.status === 'פעיל').length
  // Use the SAME derived status the Invoices screen shows (transferred → review →
  // waiting), not the stored `status` column, so the two screens can't disagree.
  const pendingInvoices   = invoices.filter(i => deriveInvoiceStatus(i, alerts) === STATUS_WAITING).length
  // Current calendar month only (by payment_date), matching the card's "החודש" label.
  const now               = new Date()
  const thisMonth         = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthlyPayments   = payments
    .filter(p => p.status === 'paid' && (p.date ?? '').slice(0, 7) === thisMonth)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const openReturns       = returns.filter(r => r.status === 'בטיפול').length

  // Match the Alerts page: exclude resolved alerts from the dashboard's recent
  // list and its card gate. (The "new" badge below stays as-is — already correct.)
  const open = alerts.filter(a => a.status !== 'resolved')

  const statsLoading = supLoading || invLoading || payLoading || retLoading

  return (
    <div className="space-y-6">
      {/* Greeting (right in RTL) + prominent capture shortcut (left in RTL).
          Opens the same CaptureDocument screen the sidebar links to. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>{getGreeting()}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            סקירה כללית של פעילות הספקים · {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={() => onPageChange?.('capture')}
          className="flex items-center gap-2 rounded-2xl font-bold text-white transition-all flex-shrink-0"
          style={{ minHeight: '52px', padding: '0 28px', background: 'var(--brand-primary)', fontSize: '16px', boxShadow: '0 4px 14px rgba(169,29,58,0.30)' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary-dark)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary)')}
        >
          <Camera className="w-6 h-6" />
          צלמי מסמך
        </button>
      </div>

      {/* Duplicate invoice alert */}
      {!invLoading && dupInvoiceCount > 0 && (
        <div
          className="rounded-2xl border cursor-pointer transition-all"
          style={{ borderColor: '#FCE9A8', background: '#FEFCEF', boxShadow: CARD_SHADOW, position: 'relative', overflow: 'hidden', direction: 'rtl' }}
          onClick={() => onPageChange?.('invoices-duplicates')}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = CARD_SHADOW_LIFT)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = CARD_SHADOW)}
        >
          <span aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '4px', background: STATUS.yellow.fg }} />
          <div className="flex items-center justify-between gap-3" style={{ padding: '16px 20px 16px 16px' }}>
            {/* content — RIGHT (RTL start) */}
            <div className="flex items-center gap-3 text-right min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: STATUS.yellow.bg, color: STATUS.yellow.fg }}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm" style={{ color: '#92400E' }}>
                  נמצאו {dupInvoiceCount} חשבוניות עם מספר כפול אפשרי
                </p>
                <p className="text-xs text-gray-500 mt-0.5">יש לבדוק ולאשר לפני סגירת חודש</p>
              </div>
            </div>
            {/* CTA — LEFT (RTL end) */}
            <button
              className="px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0"
              style={{ background: STATUS.yellow.fg }}
            >
              לבדיקה ←
            </button>
          </div>
        </div>
      )}

      {/* Mismatch alert */}
      {!stmtLoading && mismatchCount > 0 && (
        <div
          className="rounded-2xl border cursor-pointer transition-all"
          style={{ borderColor: '#F3D3D3', background: '#FEF7F7', boxShadow: CARD_SHADOW, position: 'relative', overflow: 'hidden', direction: 'rtl' }}
          onClick={() => onPageChange?.('reconciliation')}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = CARD_SHADOW_LIFT)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = CARD_SHADOW)}
        >
          <span aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '4px', background: STATUS.red.fg }} />
          <div className="flex items-center justify-between gap-3" style={{ padding: '16px 20px 16px 16px' }}>
            {/* content — RIGHT (RTL start) */}
            <div className="flex items-center gap-3 text-right min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: STATUS.red.bg, color: STATUS.red.fg }}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm" style={{ color: '#B42318' }}>
                  {mismatchCount} אי-התאמות בכרטסות ספקים
                </p>
                <p className="text-xs text-gray-500 mt-0.5">יש לבדוק ולפתור לפני סגירת חודש</p>
              </div>
            </div>
            {/* CTA — LEFT (RTL end) */}
            <button
              className="px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0"
              style={{ background: STATUS.red.fg }}
            >
              לפירוט ←
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="ספקים פעילים" value={statsLoading ? '...' : String(activeSuppliers)} sub="+3 החודש"
          icon={<Users className="w-5 h-5" />} iconBg="var(--brand-active-bg)" iconColor="var(--brand-primary)" subColor="var(--brand-primary)" loading={statsLoading}
          onClick={() => onPageChange?.('suppliers')} />
        <StatCard title="חשבוניות ממתינות" value={statsLoading ? '...' : String(pendingInvoices)} sub="4 דחופות לטיפול"
          icon={<FileText className="w-5 h-5" />} iconBg={STATUS.yellow.bg} iconColor={STATUS.yellow.fg} subColor={STATUS.yellow.fg} loading={statsLoading}
          onClick={() => onPageChange?.('invoices')} />
        <StatCard title="תשלומים החודש" value={statsLoading ? '...' : formatILS(monthlyPayments)} sub="+12% מחודש קודם"
          icon={<TrendingUp className="w-5 h-5" />} iconBg={STATUS.green.bg} iconColor={STATUS.green.fg} subColor={STATUS.green.fg} loading={statsLoading}
          onClick={() => onPageChange?.('payments')} />
        <StatCard title="חזרות פתוחות" value={statsLoading ? '...' : String(openReturns)} sub="דורש טיפול דחוף"
          icon={<AlertCircle className="w-5 h-5" />} iconBg={STATUS.red.bg} iconColor={STATUS.red.fg} subColor={STATUS.red.fg} loading={statsLoading}
          onClick={() => onPageChange?.('returns')} />
      </div>

      {/* Recent Alerts card */}
      {open.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
          {/* Header — title + bell icon on the RIGHT (first in RTL),
              "לכל ההתראות ←" link on the LEFT (last in RTL) */}
          <div
            className="px-6 py-4 flex items-center justify-between border-b"
            style={{ borderColor: '#EEEEF2', direction: 'rtl' }}
          >
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-gray-400" />
              <h2 className="font-semibold text-gray-800 text-base">התראות אחרונות</h2>
              {alerts.filter(a => a.status === 'new').length > 0 && (
                <span
                  className="flex items-center justify-center text-white font-bold"
                  style={{
                    minWidth: '20px', height: '20px', borderRadius: '10px',
                    background: STATUS.blue.fg, fontSize: '11px', padding: '0 5px',   // new = blue
                  }}
                >
                  {alerts.filter(a => a.status === 'new').length}
                </span>
              )}
            </div>
            <button
              onClick={() => onPageChange?.('alerts')}
              className="text-sm font-semibold transition-colors"
              style={{ color: 'var(--brand-primary)' }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary-dark)')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary)')}
            >
              לכל ההתראות ←
            </button>
          </div>
          <div className="divide-y" style={{ borderColor: '#F3F4F6' }}>
            {open.slice(0, 5).map((alert) => {
              // Fallbacks guard against alert rows whose type/status are not
              // among the known keys (e.g. data from a newer backend) — an
              // unguarded lookup here would crash the whole dashboard.
              const typeConf   = getAlertTypeConf(alert.type)
              const statusConf = ALERT_STATUS[alert.status]    ?? ALERT_STATUS.new
              return (
                <div
                  key={alert.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr) 150px 170px',
                    alignItems: 'center',
                    columnGap: '16px',
                    padding: '12px 24px',
                    direction: 'rtl',
                    opacity: alert.status === 'resolved' ? 0.65 : 1,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  onClick={() => handleAlertClick(alert)}
                >
                  {/* Col 1 (RIGHTMOST): type badge — sized to content, truncates so a
                      long label (e.g. "פענוח נכשל — טיפול ידני") can never spill into
                      the description column. */}
                  <div style={{ display: 'flex', justifyContent: 'flex-start', minWidth: 0, overflow: 'hidden' }}>
                    <span
                      className="px-2.5 py-1 rounded-md text-xs font-bold truncate"
                      style={{ background: typeConf.bg, color: typeConf.color, minWidth: 0, maxWidth: '100%' }}
                    >
                      {typeConf.label}
                    </span>
                  </div>

                  {/* Col 2: description text, right-aligned, truncates */}
                  <p
                    className="text-xs text-gray-500 truncate"
                    style={{ textAlign: 'right', minWidth: 0, margin: 0 }}
                  >
                    {alert.description}
                  </p>

                  {/* Col 3: supplier name (bold), right-aligned in its column */}
                  <span
                    className="text-sm font-semibold text-gray-700 truncate"
                    style={{ textAlign: 'right', minWidth: 0 }}
                  >
                    {alert.supplier ?? ''}
                  </span>

                  {/* Col 4 (LEFTMOST): date + status badge.
                      space-between puts date at the right edge of the col,
                      status badge at the left edge (= leftmost of the row). */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span className="text-xs text-gray-400 whitespace-nowrap">{alert.date}</span>
                    <span
                      className="px-2 py-0.5 rounded-md text-xs font-bold whitespace-nowrap flex-shrink-0"
                      style={{ background: statusConf.bg, color: statusConf.color }}
                    >
                      {statusConf.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Lists grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices - 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
          {/* Header: title (with icon) pinned right, "הצג הכל" on the left */}
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#EEEEF2', direction: 'rtl' }}>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" />
              <h2 className="font-semibold text-gray-800 text-base">חשבוניות אחרונות</h2>
            </div>
            <button
              onClick={() => onPageChange?.('invoices')}
              className="text-sm font-semibold transition-colors"
              style={{ color: 'var(--brand-primary)' }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary-dark)')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary)')}
            >
              הצג הכל ←
            </button>
          </div>
          {invLoading ? <Spinner /> : (
            <div className="divide-y">
              {[...invoices]
                .sort((a, b) => {
                  // Newest-received first by system received date (received_at).
                  const da = a.emailReceivedAt || ''
                  const db = b.emailReceivedAt || ''
                  return da === db ? 0 : da < db ? 1 : -1
                })
                .slice(0, 10)
                .map((inv) => {
                const st = statusStyle[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
                return (
                  <div
                    key={inv.id}
                    className="px-6 py-4 flex items-center justify-between gap-3 cursor-pointer transition-colors"
                    style={{ direction: 'rtl' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FDF5F6')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                    onClick={() => onOpenInvoice ? onOpenInvoice(inv.id) : onPageChange?.('invoices')}
                  >
                    {/* RIGHT: supplier + id/date — truncates so long names don't overflow */}
                    <div className="text-right min-w-0 flex-1 overflow-hidden">
                      <p className="font-semibold text-gray-800 text-sm truncate">{inv.supplier}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{inv.id} · {inv.date}</p>
                    </div>
                    {/* LEFT: amount + status */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="font-bold text-gray-800 whitespace-nowrap">{formatILS(inv.amount)}</span>
                      <span className="px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap" style={{ backgroundColor: st.bg, color: st.color }}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Upcoming Payments */}
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#EEEEF2', direction: 'rtl' }}>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-gray-400" />
                <h2 className="font-semibold text-gray-800 text-sm">תשלומים קרובים</h2>
              </div>
              <button
                onClick={() => onPageChange?.('payments')}
                className="text-sm font-semibold transition-colors"
                style={{ color: 'var(--brand-primary)' }}
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary-dark)')}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary)')}
              >
                הצג הכל ←
              </button>
            </div>
            {payLoading ? <Spinner /> : (
              <div className="divide-y">
                {payments
                  .filter(p => {
                    // Pending payments whose value date is within [today, today+30d]
                    // at day granularity. Hides past, >30d-ahead, and null value dates.
                    if (p.status !== 'pending' || !p.valueDate) return false
                    const today = new Date(); today.setHours(0, 0, 0, 0)
                    const vd = new Date(p.valueDate); vd.setHours(0, 0, 0, 0)
                    const days = Math.round((vd.getTime() - today.getTime()) / 86_400_000)
                    return days >= 0 && days <= 30
                  })
                  .sort((a, b) => {
                    // Safeguard mirroring usePayments order: asc by valueDate, nulls last.
                    if (!a.valueDate && !b.valueDate) return 0
                    if (!a.valueDate) return 1
                    if (!b.valueDate) return -1
                    return a.valueDate < b.valueDate ? -1 : a.valueDate > b.valueDate ? 1 : 0
                  })
                  .map((pay) => (
                  <div
                    key={pay.id}
                    className="px-5 py-3.5 cursor-pointer transition-colors"
                    style={{ direction: 'rtl' }}
                    onClick={() => onPageChange?.('payments')}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FDF5F6')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  >
                    {/* Top row: amount on the right (RTL — first in document
                        order), supplier on the left. Amounts line up at the
                        right edge across rows. */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-800 whitespace-nowrap flex-shrink-0">{formatILS(pay.amount)}</span>
                      <span className="text-sm font-semibold text-gray-700 truncate min-w-0">{pay.supplier}</span>
                    </div>
                    {/* Bottom row: date on the right (aligns under amount),
                        type on the left (aligns under supplier). */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400 whitespace-nowrap">תאריך ערך: {pay.valueDate ? fmtDate(pay.valueDate) : '—'}</span>
                      <span className="text-xs text-gray-400 truncate min-w-0">{pay.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Deliveries */}
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: '#EEEEF2', direction: 'rtl' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Package className="w-4 h-4 text-gray-400" />
                  <h2 className="font-semibold text-gray-800 text-sm">תעודות משלוח</h2>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!dnLoading && pendingDeliveryCount > 0 && (
                    <button
                      onClick={() => onPageChange?.('deliveries')}
                      className="flex items-center gap-1.5 rounded-lg font-semibold transition-all"
                      style={{ fontSize: '12px', padding: '4px 10px', background: '#FEF9C3', color: '#A16207' }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#FDE68A')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#FEF9C3')}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      {pendingDeliveryCount} ←
                    </button>
                  )}
                  <button
                    onClick={() => onPageChange?.('deliveries')}
                    className="text-sm font-semibold transition-colors whitespace-nowrap"
                    style={{ color: 'var(--brand-primary)' }}
                    onMouseEnter={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary-dark)')}
                    onMouseLeave={(e) => ((e.target as HTMLElement).style.color = 'var(--brand-primary)')}
                  >
                    הצג הכל ←
                  </button>
                </div>
              </div>
            </div>
            {dnLoading ? <Spinner /> : (
              <div className="divide-y">
                {[...deliveryNotes]
                  .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || ''))  // newest first
                  .slice(0, 5)
                  .map((dn) => {
                  const st = statusStyle[dn.status === 'pending' ? 'ממתין' : 'הושלם'] ?? { bg: '#F3F4F6', color: '#6B7280' }
                  const label = dn.status === 'pending' ? 'ממתינה' : 'בארכיון'
                  return (
                    <div
                      key={dn.id}
                      className="px-5 py-3.5 cursor-pointer transition-colors"
                      style={{ direction: 'rtl' }}
                      onClick={() => onPageChange?.('deliveries')}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FDF5F6')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold text-gray-700 truncate min-w-0">{dn.supplierName}</span>
                        <span className="text-xs px-2 py-0.5 rounded-md font-bold whitespace-nowrap flex-shrink-0" style={{ backgroundColor: st.bg, color: st.color }}>
                          {label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-gray-400 truncate min-w-0">{formatILS(dn.amount)} · {dn.id}</span>
                        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{dn.date}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
