import { useState, useEffect } from 'react'
import { Bell, Search, Menu, ArrowRight } from 'lucide-react'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import Suppliers from './Suppliers'
import Invoices from './Invoices'
import Payments from '../pages/Payments'
import SupplierLedger from './SupplierLedger'
import DeliveryNotes from './DeliveryNotes'
import StatementReconciliation from './StatementReconciliation'
import Returns from './Returns'
import Alerts from './Alerts'
import Settings from '../pages/Settings'
import { mockAlerts } from '../data/mockData'
import type { Alert } from '../data/mockData'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'בוקר טוב הדס'
  if (hour >= 12 && hour < 17) return 'צהריים טובים הדס'
  if (hour >= 17 && hour < 21) return 'ערב טוב הדס'
  return 'לילה טוב הדס'
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
  const [v, setV] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 640 && window.innerWidth <= 1024
  )
  useEffect(() => {
    const h = () => setV(window.innerWidth >= 640 && window.innerWidth <= 1024)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

interface LayoutProps {
  userEmail: string
  onLogout: () => void | Promise<void>
}

const pageLabels: Record<string, string> = {
  dashboard:             'דשבורד',
  alerts:                'התראות',
  suppliers:             'ספקים',
  ledger:                'כרטסת ספק',
  invoices:              'חשבוניות',
  'invoices-duplicates': 'חשבוניות',
  payments:              'תשלומים',
  deliveries:            'תעודות משלוח',
  returns:               'חזרות',
  reconciliation:        'התאמת כרטסות',
  settings:              'הגדרות',
}

function ComingSoon({ page }: { page: string }) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: '60vh' }}>
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5 text-4xl shadow-sm" style={{ background: '#FDF2F4' }}>
        🚧
      </div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">{pageLabels[page]} · בפיתוח</h2>
      <p className="text-gray-400 text-sm">מסך זה יהיה זמין בקרוב</p>
    </div>
  )
}

interface NavEntry {
  page: string
  ledgerSupplierId?: string
  supplierViewId?: string
  invoiceSelectedId?: string
}

export default function Layout({ userEmail, onLogout }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts)
  // Single source of truth for navigation — index 0 is always the origin (dashboard)
  const [navStack, setNavStack] = useState<NavEntry[]>([{ page: 'dashboard' }])

  const currentNav      = navStack[navStack.length - 1]
  const activePage      = currentNav.page
  const ledgerSupplierId = currentNav.ledgerSupplierId
  const canGoBack       = navStack.length > 1
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()

  const newAlertsCount = alerts.filter(a => a.status === 'new').length

  const handleMarkRead = (id: string) =>
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'read' as const } : a))

  const handleMarkResolved = (id: string) =>
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved' as const } : a))

  const handleDeleteAlert = (id: string) =>
    setAlerts(prev => prev.filter(a => a.id !== id))

  const sidebarWidth = isMobile ? 0 : isCollapsed ? 72 : isTablet ? 200 : 256
  const pad = isMobile ? '12px' : isTablet ? '20px' : '32px'

  const handlePageChange = (page: string) => {
    setNavStack(prev => {
      if (prev[prev.length - 1]?.page === page) return prev  // no-op if already here
      return [...prev, { page }]
    })
    setMobileMenuOpen(false)
  }

  const goBack = () => {
    setNavStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev)
    setMobileMenuOpen(false)
  }

  const renderPage = () => {
    if (activePage === 'dashboard')      return <Dashboard onPageChange={handlePageChange} alerts={alerts} />
    if (activePage === 'alerts')         return <Alerts alerts={alerts} onMarkRead={handleMarkRead} onMarkResolved={handleMarkResolved} onDelete={handleDeleteAlert} />
    if (activePage === 'suppliers')      return (
      <Suppliers
        onViewLedger={(id) => setNavStack(prev => [...prev, { page: 'ledger', ledgerSupplierId: id }])}
        controlledViewId={currentNav.supplierViewId ?? null}
        onOpenDetail={(id) => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewId: id }])}
        onCloseDetail={goBack}
      />
    )
    if (activePage === 'ledger')         return <SupplierLedger initialSupplierId={ledgerSupplierId} />
    if (activePage === 'invoices') return (
      <Invoices
        key="invoices"
        controlledSelectedId={currentNav.invoiceSelectedId ?? null}
        onOpenInvoice={(id) => setNavStack(prev => [...prev, { page: 'invoices', invoiceSelectedId: id }])}
        onCloseInvoice={goBack}
      />
    )
    if (activePage === 'invoices-duplicates') return (
      <Invoices
        key="invoices-dup"
        initialFilter="כפילויות"
        controlledSelectedId={currentNav.invoiceSelectedId ?? null}
        onOpenInvoice={(id) => setNavStack(prev => [...prev, { page: 'invoices-duplicates', invoiceSelectedId: id }])}
        onCloseInvoice={goBack}
      />
    )
    if (activePage === 'payments')       return <Payments />
    if (activePage === 'deliveries')     return <DeliveryNotes />
    if (activePage === 'reconciliation') return <StatementReconciliation />
    if (activePage === 'returns')        return <Returns />
    if (activePage === 'settings')       return <Settings />
    return <ComingSoon page={activePage} />
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8F8FA', direction: 'rtl' }}>

      {/* Mobile overlay */}
      {isMobile && mobileMenuOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 49 }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <Sidebar
        isCollapsed={isCollapsed}
        onToggle={() => setIsCollapsed(!isCollapsed)}
        activePage={activePage === 'invoices-duplicates' ? 'invoices' : activePage}
        onPageChange={handlePageChange}
        onLogout={onLogout}
        userEmail={userEmail}
        newAlertsCount={newAlertsCount}
        mobileStyle={isMobile ? {
          transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(110%)',
          transition: 'transform 0.3s ease',
        } : undefined}
      />

      {/* Main content */}
      <div
        className="flex flex-col min-h-screen"
        style={{
          marginRight: `${sidebarWidth}px`,
          transition: isMobile ? 'none' : 'margin-right 0.3s',
        }}
      >
        {/* Top bar */}
        <header
          className="bg-white border-b sticky top-0 z-40 flex items-center justify-between"
          style={{ borderColor: '#EEEEF2', height: '64px', paddingLeft: pad, paddingRight: pad }}
        >
          {/* Left: hamburger (mobile) + search */}
          <div className="flex items-center gap-2">
            {isMobile && (
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="flex items-center justify-center rounded-xl flex-shrink-0"
                style={{ width: '40px', height: '40px', background: '#FDF2F4', color: '#D32F4A', border: 'none', cursor: 'pointer' }}
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <button
              className="flex items-center gap-2 rounded-xl text-gray-400 border transition-all"
              style={{ borderColor: '#EEEEF2', minHeight: '40px', padding: '0 12px', fontSize: '14px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#D32F4A')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#EEEEF2')}
            >
              {!isMobile && <span>חיפוש...</span>}
              <Search className="w-4 h-4 flex-shrink-0" />
            </button>
          </div>

          {/* Right: title + bell + avatar */}
          <div className="flex items-center gap-3">
            {!isMobile && (
              <h2 className="font-medium" style={{ fontSize: isTablet ? '17px' : '16px', color: '#1A1A2E' }}>
                {activePage === 'dashboard' ? getGreeting() : pageLabels[activePage]}
              </h2>
            )}
            {isMobile && (
              <h2 className="font-medium" style={{ fontSize: '15px', color: '#1A1A2E' }}>
                {activePage === 'dashboard' ? 'הדס' : pageLabels[activePage]}
              </h2>
            )}

            <button
              onClick={() => handlePageChange('alerts')}
              className="relative rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
              style={{ background: '#FDF2F4', color: '#9CA3AF', width: '36px', height: '36px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#D32F4A')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
            >
              <Bell className="w-5 h-5" />
              {newAlertsCount > 0 && (
                <span
                  className="absolute flex items-center justify-center text-white font-medium"
                  style={{
                    top: '-4px',
                    right: '-4px',
                    minWidth: '16px',
                    height: '16px',
                    borderRadius: '8px',
                    background: '#DC2626',
                    fontSize: '10px',
                    padding: '0 3px',
                  }}
                >
                  {newAlertsCount}
                </span>
              )}
            </button>

            <div
              className="rounded-xl flex items-center justify-center text-white font-medium cursor-pointer select-none flex-shrink-0"
              style={{ background: '#D32F4A', width: '36px', height: '36px', fontSize: '14px' }}
              title={userEmail}
            >
              {userEmail.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1" style={{ padding: pad }}>
          {canGoBack && (
            <div style={{ marginBottom: '12px' }}>
              <button
                onClick={goBack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'white',
                  border: '1px solid #EEEEF2',
                  color: '#D32F4A',
                  cursor: 'pointer',
                  boxShadow: 'none',
                  transition: 'box-shadow 0.15s',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none'
                }}
                title="חזור"
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
