import { Users, FileText, TrendingUp, AlertCircle, Package, AlertTriangle, Bell, Truck, Copy, Scale } from 'lucide-react'
import { useInvoices } from '../hooks/useInvoices'
import { useDeliveryNotes } from '../hooks/useDeliveryNotes'
import { usePayments } from '../hooks/usePayments'
import { useSuppliers } from '../hooks/useSuppliers'
import { useReturns } from '../hooks/useReturns'
import { useStatements } from '../hooks/useStatements'
import type { Alert, AlertType } from '../data/mockData'

const ALERT_TYPE_CONFIG: Record<AlertType, {
  label: string
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  bg: string
  color: string
}> = {
  duplicate_invoice:  { label: 'כפילות',     Icon: Copy,  bg: '#FEF3C7', color: '#D97706' },
  delivery_note:      { label: 'תעודה',      Icon: Truck, bg: '#DBEAFE', color: '#1E40AF' },
  statement_mismatch: { label: 'אי-התאמה',  Icon: Scale, bg: '#FEE2E2', color: '#DC2626' },
  supplier_not_found: { label: 'ספק לא זוהה', Icon: Bell,  bg: '#F5F3FF', color: '#7C3AED' },
}

const ALERT_STATUS: Record<string, { bg: string; color: string; label: string }> = {
  new:      { bg: '#FEE2E2', color: '#DC2626', label: 'חדש'  },
  read:     { bg: '#F3F4F6', color: '#6B7280', label: 'נקרא' },
  resolved: { bg: '#DCFCE7', color: '#166534', label: 'טופל' },
}

const statusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: '#FEF9C3', color: '#A16207' },
  'שולם':   { bg: '#DCFCE7', color: '#166534' },
  'הושלם':  { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#DBEAFE', color: '#1E40AF' },
  'שגיאה':  { bg: '#FEE2E2', color: '#DC2626' },
  'נתקבל':  { bg: '#DCFCE7', color: '#166534' },
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
}

function StatCard({ title, value, sub, icon, iconBg, iconColor, subColor, loading }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border flex flex-col gap-3" style={{ borderColor: '#EEEEF2' }}>
      <div className="flex items-start justify-between">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: iconBg, color: iconColor }}
        >
          {loading
            ? <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: iconColor }} />
            : icon}
        </div>
        <p className="text-sm font-medium text-gray-500 text-right">{title}</p>
      </div>
      <div className="text-right">
        <p className="text-3xl leading-tight" style={{ fontWeight: 500, color: '#1A1A2E' }}>{value}</p>
        <p className="text-xs font-medium mt-1" style={{ color: subColor }}>{sub}</p>
      </div>
    </div>
  )
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'בוקר טוב הדס'
  if (hour >= 12 && hour < 17) return 'צהריים טובים הדס'
  if (hour >= 17 && hour < 21) return 'ערב טוב הדס'
  return 'לילה טוב הדס'
}

interface DashboardProps {
  onPageChange?: (page: string) => void
  alerts?: Alert[]
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#D32F4A' }} />
    </div>
  )
}

export default function Dashboard({ onPageChange, alerts = [] }: DashboardProps) {
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
  const pendingInvoices   = invoices.filter(i => i.status === 'ממתין').length
  const monthlyPayments   = payments.filter(p => p.status === 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const openReturns       = returns.filter(r => r.status === 'בטיפול').length

  const statsLoading = supLoading || invLoading || payLoading || retLoading

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>{getGreeting()}</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          סקירה כללית של פעילות הספקים · {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Duplicate invoice alert */}
      {!invLoading && dupInvoiceCount > 0 && (
        <div
          className="rounded-2xl p-4 shadow-sm border flex items-center justify-between cursor-pointer transition-opacity hover:opacity-90"
          style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}
          onClick={() => onPageChange?.('invoices-duplicates')}
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
                נמצאו {dupInvoiceCount} חשבוניות עם מספר כפול אפשרי
              </p>
              <p className="text-xs text-gray-500 mt-0.5">יש לבדוק ולאשר לפני סגירת חודש</p>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#FEF3C7', color: '#D97706' }}>
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Mismatch alert */}
      {!stmtLoading && mismatchCount > 0 && (
        <div
          className="rounded-2xl p-4 shadow-sm border flex items-center justify-between cursor-pointer transition-opacity hover:opacity-90"
          style={{ borderColor: '#FECDD3', background: '#FFF1F2' }}
          onClick={() => onPageChange?.('reconciliation')}
        >
          <button
            className="px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0"
            style={{ background: '#BE123C' }}
          >
            לפירוט ←
          </button>
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="font-bold text-sm" style={{ color: '#BE123C' }}>
                {mismatchCount} אי-התאמות בכרטסות ספקים
              </p>
              <p className="text-xs text-gray-500 mt-0.5">יש לבדוק ולפתור לפני סגירת חודש</p>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="ספקים פעילים" value={statsLoading ? '...' : String(activeSuppliers)} sub="+3 החודש"
          icon={<Users className="w-5 h-5" />} iconBg="#FDF2F4" iconColor="#D32F4A" subColor="#D32F4A" loading={statsLoading} />
        <StatCard title="חשבוניות ממתינות" value={statsLoading ? '...' : String(pendingInvoices)} sub="4 דחופות לטיפול"
          icon={<FileText className="w-5 h-5" />} iconBg="#FEF6E4" iconColor="#F2C94C" subColor="#D97706" loading={statsLoading} />
        <StatCard title="תשלומים החודש" value={statsLoading ? '...' : formatILS(monthlyPayments)} sub="+12% מחודש קודם"
          icon={<TrendingUp className="w-5 h-5" />} iconBg="#F0FDF4" iconColor="#22C55E" subColor="#22C55E" loading={statsLoading} />
        <StatCard title="חזרות פתוחות" value={statsLoading ? '...' : String(openReturns)} sub="דורש טיפול דחוף"
          icon={<AlertCircle className="w-5 h-5" />} iconBg="#FEF2F2" iconColor="#EF4444" subColor="#EF4444" loading={statsLoading} />
      </div>

      {/* Recent Alerts card */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#EEEEF2' }}>
            <button
              onClick={() => onPageChange?.('alerts')}
              className="text-sm font-semibold transition-colors"
              style={{ color: '#D32F4A' }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#A8213B')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#D32F4A')}
            >
              לכל ההתראות ←
            </button>
            <div className="flex items-center gap-2">
              {alerts.filter(a => a.status === 'new').length > 0 && (
                <span
                  className="flex items-center justify-center text-white font-bold"
                  style={{
                    minWidth: '20px', height: '20px', borderRadius: '10px',
                    background: '#DC2626', fontSize: '11px', padding: '0 5px',
                  }}
                >
                  {alerts.filter(a => a.status === 'new').length}
                </span>
              )}
              <h2 className="font-semibold text-gray-800 text-base">התראות אחרונות</h2>
              <Bell className="w-4 h-4 text-gray-400" />
            </div>
          </div>
          <div className="divide-y" style={{ borderColor: '#F3F4F6' }}>
            {alerts.slice(0, 5).map((alert) => {
              // Fallbacks guard against alert rows whose type/status are not
              // among the known keys (e.g. data from a newer backend) — an
              // unguarded lookup here would crash the whole dashboard.
              const typeConf   = ALERT_TYPE_CONFIG[alert.type] ?? ALERT_TYPE_CONFIG.duplicate_invoice
              const statusConf = ALERT_STATUS[alert.status]    ?? ALERT_STATUS.new
              const TypeIcon   = typeConf.Icon
              return (
                <div
                  key={alert.id}
                  className="px-6 py-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors"
                  style={{ opacity: alert.status === 'resolved' ? 0.65 : 1 }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  onClick={() => onPageChange?.('alerts')}
                >
                  {/* Left: status badge + date */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400">{alert.date}</span>
                    <span
                      className="px-2 py-0.5 rounded-md text-xs font-bold"
                      style={{ background: statusConf.bg, color: statusConf.color }}
                    >
                      {statusConf.label}
                    </span>
                  </div>

                  {/* Right: type icon + description */}
                  <div className="flex items-center gap-2.5 text-right overflow-hidden">
                    <div className="text-right overflow-hidden">
                      {alert.supplier && (
                        <p className="text-sm font-semibold text-gray-700 truncate">{alert.supplier}</p>
                      )}
                      <p className="text-xs text-gray-500 truncate">{alert.description}</p>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-md text-xs font-bold whitespace-nowrap flex-shrink-0"
                      style={{ background: typeConf.bg, color: typeConf.color }}
                    >
                      {typeConf.label}
                    </span>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: typeConf.bg }}
                    >
                      <TypeIcon className="w-4 h-4" style={{ color: typeConf.color }} />
                    </div>
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
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#EEEEF2' }}>
            <button
              className="text-sm font-semibold transition-colors"
              style={{ color: '#D32F4A' }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#A8213B')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#D32F4A')}
            >
              הצג הכל ←
            </button>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-gray-800 text-base">חשבוניות אחרונות</h2>
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
          </div>
          {invLoading ? <Spinner /> : (
            <div className="divide-y">
              {invoices.map((inv) => {
                const st = statusStyle[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
                return (
                  <div
                    key={inv.id}
                    className="px-6 py-4 flex items-center justify-between cursor-pointer transition-colors"
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FDF5F6')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  >
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 rounded-lg text-xs font-bold" style={{ backgroundColor: st.bg, color: st.color }}>
                        {inv.status}
                      </span>
                      <span className="font-bold text-gray-800">{formatILS(inv.amount)}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-800 text-sm">{inv.supplier}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{inv.id} · {inv.date}</p>
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
            <div className="px-5 py-4 border-b" style={{ borderColor: '#EEEEF2' }}>
              <div className="flex items-center justify-end gap-2">
                <h2 className="font-semibold text-gray-800 text-sm">תשלומים קרובים</h2>
                <TrendingUp className="w-4 h-4 text-gray-400" />
              </div>
            </div>
            {payLoading ? <Spinner /> : (
              <div className="divide-y">
                {payments.filter(p => p.status === 'pending').map((pay) => (
                  <div key={pay.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-gray-800">{formatILS(pay.amount)}</span>
                      <span className="text-sm font-semibold text-gray-700">{pay.supplier}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{pay.type}</span>
                      <span className="text-xs text-gray-400">פירעון: {fmtDate(pay.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Deliveries */}
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: '#EEEEF2' }}>
              <div className="flex items-center justify-between">
                {!dnLoading && pendingDeliveryCount > 0 && (
                  <button
                    onClick={() => onPageChange?.('deliveries')}
                    className="flex items-center gap-1.5 rounded-lg font-semibold transition-all"
                    style={{ fontSize: '12px', padding: '4px 10px', background: '#FEF9C3', color: '#A16207' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#FDE68A')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#FEF9C3')}
                  >
                    <AlertTriangle className="w-3 h-3" />
                    {pendingDeliveryCount} ממתינות לשיוך ←
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-800 text-sm">תעודות משלוח</h2>
                  <Package className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            </div>
            {dnLoading ? <Spinner /> : (
              <div className="divide-y">
                {deliveryNotes.slice(0, 5).map((dn) => {
                  const st = statusStyle[dn.status === 'pending' ? 'ממתין' : 'הושלם'] ?? { bg: '#F3F4F6', color: '#6B7280' }
                  const label = dn.status === 'pending' ? 'ממתינה' : 'בארכיון'
                  return (
                    <div key={dn.id} className="px-5 py-3.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs px-2 py-0.5 rounded-md font-bold" style={{ backgroundColor: st.bg, color: st.color }}>
                          {label}
                        </span>
                        <span className="text-sm font-semibold text-gray-700">{dn.supplierName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{formatILS(dn.amount)} · {dn.id}</span>
                        <span className="text-xs text-gray-400">{dn.date}</span>
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
