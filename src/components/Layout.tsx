import { useState, useEffect } from 'react'
import { Bell, Search } from 'lucide-react'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import Suppliers from './Suppliers'
import Invoices from './Invoices'
import Payments from '../pages/Payments'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'בוקר טוב הדס'
  if (hour >= 12 && hour < 17) return 'צהריים טובים הדס'
  if (hour >= 17 && hour < 21) return 'ערב טוב הדס'
  return 'לילה טוב הדס'
}

function useIsTablet() {
  const [v, setV] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth <= 1024
  )
  useEffect(() => {
    const h = () => setV(window.innerWidth >= 768 && window.innerWidth <= 1024)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

interface LayoutProps {
  userEmail: string
  onLogout: () => void
}

const pageLabels: Record<string, string> = {
  dashboard: 'דשבורד',
  suppliers: 'ספקים',
  invoices: 'חשבוניות',
  payments: 'תשלומים',
  deliveries: 'תעודות משלוח',
  returns: 'חזרות',
  reconciliation: 'התאמת כרטסות',
}

function ComingSoon({ page }: { page: string }) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: '60vh' }}>
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5 text-4xl shadow-sm"
        style={{ background: '#FFF0EF' }}
      >
        🚧
      </div>
      <h2 className="text-xl font-bold text-gray-700 mb-2">
        {pageLabels[page]} · בפיתוח
      </h2>
      <p className="text-gray-400 text-sm">מסך זה יהיה זמין בקרוב</p>
    </div>
  )
}

export default function Layout({ userEmail, onLogout }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [activePage, setActivePage] = useState('dashboard')
  const isTablet = useIsTablet()

  const sidebarWidth = isTablet ? 200 : isCollapsed ? 72 : 256

  const renderPage = () => {
    if (activePage === 'dashboard') return <Dashboard />
    if (activePage === 'suppliers') return <Suppliers />
    if (activePage === 'invoices') return <Invoices />
    if (activePage === 'payments') return <Payments />
    return <ComingSoon page={activePage} />
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FFF8F7', direction: 'rtl' }}>
      <Sidebar
        isCollapsed={isCollapsed}
        onToggle={() => setIsCollapsed(!isCollapsed)}
        activePage={activePage}
        onPageChange={setActivePage}
        onLogout={onLogout}
        userEmail={userEmail}
      />

      {/* Main content */}
      <div
        className="flex flex-col min-h-screen transition-all duration-300"
        style={{ marginRight: `${sidebarWidth}px` }}
      >
        {/* Top bar */}
        <header
          className="bg-white border-b sticky top-0 z-40 flex items-center justify-between"
          style={{
            borderColor: '#F0E8E7',
            height: '68px',
            paddingLeft: isTablet ? '16px' : '24px',
            paddingRight: isTablet ? '16px' : '24px',
          }}
        >
          {/* Left: search */}
          <div className="flex items-center">
            <button
              className="flex items-center gap-2 rounded-xl text-gray-400 border transition-all"
              style={{
                borderColor: '#F0E8E7',
                minHeight: '44px',
                padding: '0 14px',
                fontSize: isTablet ? '16px' : '14px',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#E8645A')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#F0E8E7')}
            >
              <span className="hidden sm:inline">חיפוש...</span>
              <Search className="w-4 h-4 flex-shrink-0" />
            </button>
          </div>

          {/* Right: page title + user */}
          <div className="flex items-center gap-4">
            <h2
              className="font-bold text-gray-700 hidden sm:block"
              style={{ fontSize: isTablet ? '18px' : '16px' }}
            >
              {activePage === 'dashboard' ? getGreeting() : pageLabels[activePage]}
            </h2>

            <div className="flex items-center gap-2">
              {/* Notification bell */}
              <button
                className="relative rounded-xl flex items-center justify-center text-gray-400 transition-colors flex-shrink-0"
                style={{
                  background: '#FFF0EF',
                  width: isTablet ? '44px' : '36px',
                  height: isTablet ? '44px' : '36px',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#E8645A')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
              >
                <Bell className="w-5 h-5" />
                <span
                  className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                  style={{ background: '#E8A020' }}
                />
              </button>

              {/* Avatar */}
              <div
                className="rounded-xl flex items-center justify-center text-white font-bold cursor-pointer select-none flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #8B1A3A, #E8645A)',
                  width: isTablet ? '44px' : '36px',
                  height: isTablet ? '44px' : '36px',
                  fontSize: isTablet ? '16px' : '14px',
                }}
                title={userEmail}
              >
                {userEmail.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main
          className="flex-1"
          style={{ padding: isTablet ? '16px' : '24px' }}
        >
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
