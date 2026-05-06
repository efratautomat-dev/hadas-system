import { Users, FileText, TrendingUp, AlertCircle, Package } from 'lucide-react'
import { mockStats, mockInvoices, mockPayments, mockDeliveries } from '../data/mockData'

const statusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: '#FEF9C3', color: '#A16207' },
  'שולם':   { bg: '#DCFCE7', color: '#166534' },
  'הושלם':  { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#DBEAFE', color: '#1E40AF' },
  'שגיאה':  { bg: '#FEE2E2', color: '#DC2626' },
  'נתקבל':  { bg: '#DCFCE7', color: '#166534' },
  'בדרך':   { bg: '#EDE9FE', color: '#5B21B6' },
}

function formatILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

interface StatCardProps {
  title: string
  value: string
  sub: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  subColor: string
}

function StatCard({ title, value, sub, icon, iconBg, iconColor, subColor }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border flex flex-col gap-3" style={{ borderColor: '#F0E8E7' }}>
      <div className="flex items-start justify-between">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: iconBg, color: iconColor }}
        >
          {icon}
        </div>
        <p className="text-sm font-medium text-gray-500 text-right">{title}</p>
      </div>
      <div className="text-right">
        <p className="text-3xl font-black text-gray-800 leading-tight">{value}</p>
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

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-800">{getGreeting()}</h1>
        <p className="text-gray-500 text-sm mt-0.5">סקירה כללית של פעילות הספקים · {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="ספקים פעילים"
          value={String(mockStats.activeSuppliers)}
          sub="+3 החודש"
          icon={<Users className="w-5 h-5" />}
          iconBg="#FFF0EF"
          iconColor="#E8645A"
          subColor="#E8645A"
        />
        <StatCard
          title="חשבוניות ממתינות"
          value={String(mockStats.pendingInvoices)}
          sub="4 דחופות לטיפול"
          icon={<FileText className="w-5 h-5" />}
          iconBg="#FFF8EC"
          iconColor="#E8A020"
          subColor="#E8A020"
        />
        <StatCard
          title="תשלומים החודש"
          value={formatILS(mockStats.monthlyPayments)}
          sub="+12% מחודש קודם"
          icon={<TrendingUp className="w-5 h-5" />}
          iconBg="#F0FDF4"
          iconColor="#22C55E"
          subColor="#22C55E"
        />
        <StatCard
          title="חזרות פתוחות"
          value={String(mockStats.openReturns)}
          sub="דורש טיפול דחוף"
          icon={<AlertCircle className="w-5 h-5" />}
          iconBg="#FEF2F2"
          iconColor="#EF4444"
          subColor="#EF4444"
        />
      </div>

      {/* Lists grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices - 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#F0E8E7' }}>
          <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#F5EEEE' }}>
            <button
              className="text-sm font-semibold transition-colors"
              style={{ color: '#E8645A' }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#8B1A3A')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#E8645A')}
            >
              הצג הכל ←
            </button>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-800 text-base">חשבוניות אחרונות</h2>
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
          </div>

          <div className="divide-y" style={{}}>
            {mockInvoices.map((inv) => {
              const st = statusStyle[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
              return (
                <div
                  key={inv.id}
                  className="px-6 py-4 flex items-center justify-between cursor-pointer transition-colors"
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FFF8F7')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  {/* Left side */}
                  <div className="flex items-center gap-3">
                    <span
                      className="px-3 py-1 rounded-lg text-xs font-semibold"
                      style={{ backgroundColor: st.bg, color: st.color }}
                    >
                      {inv.status}
                    </span>
                    <span className="font-bold text-gray-800">{formatILS(inv.amount)}</span>
                  </div>

                  {/* Right side */}
                  <div className="text-right">
                    <p className="font-semibold text-gray-800 text-sm">{inv.supplier}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{inv.id} · {inv.date}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Upcoming Payments */}
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#F0E8E7' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: '#F5EEEE' }}>
              <div className="flex items-center justify-end gap-2">
                <h2 className="font-bold text-gray-800 text-sm">תשלומים קרובים</h2>
                <TrendingUp className="w-4 h-4 text-gray-400" />
              </div>
            </div>
            <div className="divide-y" style={{}}>
              {mockPayments.map((pay) => (
                <div key={pay.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-black text-gray-800">{formatILS(pay.amount)}</span>
                    <span className="text-sm font-semibold text-gray-700">{pay.supplier}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">{pay.method}</span>
                    <span className="text-xs text-gray-400">פירעון: {pay.dueDate}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Deliveries */}
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#F0E8E7' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: '#F5EEEE' }}>
              <div className="flex items-center justify-end gap-2">
                <h2 className="font-bold text-gray-800 text-sm">תעודות משלוח</h2>
                <Package className="w-4 h-4 text-gray-400" />
              </div>
            </div>
            <div className="divide-y" style={{}}>
              {mockDeliveries.map((del) => {
                const st = statusStyle[del.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
                return (
                  <div key={del.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-xs px-2 py-0.5 rounded-md font-semibold"
                        style={{ backgroundColor: st.bg, color: st.color }}
                      >
                        {del.status}
                      </span>
                      <span className="text-sm font-semibold text-gray-700">{del.supplier}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{del.items} פריטים · {del.id}</span>
                      <span className="text-xs text-gray-400">{del.date}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
