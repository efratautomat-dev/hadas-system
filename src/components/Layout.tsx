import { useState, useEffect, useRef } from 'react'
import { Bell, Search, Menu, ArrowRight } from 'lucide-react'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import Suppliers from './Suppliers'
import Invoices, { type DuplicateResolution } from './Invoices'
import Payments from '../pages/Payments'
import SupplierLedger from './SupplierLedger'
import DeliveryNotes from './DeliveryNotes'
import StatementReconciliation from './StatementReconciliation'
import Returns from './Returns'
import CaptureDocument from './CaptureDocument'
import Alerts from './Alerts'
import Settings from '../pages/Settings'
import SystemLogs from '../pages/SystemLogs'
import type { Alert } from '../data/mockData'
import { useAlerts } from '../hooks/useAlerts'
import { AppLogoProvider } from '../hooks/useAppLogo'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'

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
  capture:               'צילום מסמך',
  alerts:                'התראות',
  suppliers:             'ספקים',
  ledger:                'כרטסת ספק',
  invoices:              'חשבוניות',
  'invoices-duplicates': 'חשבוניות',
  payments:              'תשלומים',
  deliveries:            'תעודות משלוח',
  returns:               'חזרות',
  reconciliation:        'התאמת כרטסות',
  'system-logs':         'לוגי מערכת',
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
  supplierViewName?: string
  invoiceSelectedId?: string
  invoiceDuplicateId?: string
  paymentsSupplierFilter?: string
  returnsEditId?: string
  statementViewId?: string
}

interface AlertPrefillState {
  alertId:      string
  supplierName: string
  payload:      Record<string, unknown>
}

export default function Layout({ userEmail, onLogout }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { data: alerts, markRead, markResolved, remove: removeAlert } = useAlerts()
  const [alertForSupplier, setAlertForSupplier] = useState<AlertPrefillState | null>(null)
  // Single source of truth for navigation — index 0 is always the origin (dashboard)
  const [navStack, setNavStack] = useState<NavEntry[]>([{ page: 'dashboard' }])
  // Remembered window scroll for the alerts list. Saved when the user clicks an
  // alert (before we navigate away) and restored when the Alerts page re-mounts,
  // so resolving a duplicate and returning lands them where they left off.
  const alertsScrollY = useRef(0)

  const currentNav       = navStack[navStack.length - 1]
  const activePage       = currentNav.page
  const ledgerSupplierId = currentNav.ledgerSupplierId
  const canGoBack        = navStack.length > 1
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()

  const newAlertsCount = alerts.filter(a => a.status === 'new').length

  const handleMarkRead     = (id: string) => markRead(id)
  const handleMarkResolved = (id: string) => markResolved(id)
  const handleDeleteAlert  = (id: string) => removeAlert(id)

  // Called by Invoices once a duplicate pair has been resolved (deleted /
  // approved). Super-rule "deleted duplicate → resolve both": every alert that
  // points at the pair — the one the user clicked AND any twin referencing the
  // same pair — is marked RESOLVED (not deleted, so it stays auditable and drops
  // off the active queue). Then, if we came from a duplicate alert, go back.
  const handleDuplicateResolved = (info: DuplicateResolution) => {
    for (const a of alerts) {
      const t = a.type as string
      if (t !== 'duplicate_invoice' && t !== 'invoice_duplicate') continue
      const p = (a.payload ?? {}) as Record<string, unknown>
      const refId = (p.existingInvoiceId as string | undefined) ?? (p.invoiceId as string | undefined)
      const matchesId   = !!refId && info.ids.includes(refId)
      const matchesPair = !!info.invoiceNumber &&
        p.invoiceNumber === info.invoiceNumber && p.supplierId === info.supplierId
      if (matchesId || matchesPair) markResolved(a.id)
    }
    if (info.fromAlert) goBack()
  }

  const handleCreateSupplierFromAlert = (alert: Alert) => {
    setAlertForSupplier({
      alertId:      alert.id,
      supplierName: (alert.payload?.typedSupplierName as string) ?? '',
      payload:      alert.payload ?? {},
    })
    handlePageChange('suppliers')
  }

  // invoice_low_confidence / invoice_old_date alerts are written BEFORE the
  // invoice row is inserted, so their payload only carries gmailMessageId.
  // Resolve to the saved invoice on demand and navigate to its detail page;
  // if not found, fall back to the invoices list.
  const handleOpenInvoiceByGmailMessageId = async (msgId: string) => {
    const { data, error } = await supabase
      .from('invoices')
      .select('id')
      .eq('gmail_message_id', msgId)
      .limit(1)
    if (error) {
      console.error('[alert→invoice] supabase error — falling back to list:', error)
      handlePageChange('invoices')
      return
    }
    const id = data?.[0]?.id as string | undefined
    if (id) {
      setNavStack(prev => [...prev, { page: 'invoices', invoiceSelectedId: id }])
    } else {
      handlePageChange('invoices')
    }
  }

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
    if (activePage === 'dashboard')      return (
      <Dashboard
        onPageChange={handlePageChange}
        alerts={alerts}
        onMarkRead={handleMarkRead}
        onOpenInvoice={(id)                => setNavStack(prev => [...prev, { page: 'invoices',  invoiceSelectedId:  id   }])}
        onOpenInvoiceDuplicate={(id)       => setNavStack(prev => [...prev, { page: 'invoices',  invoiceDuplicateId: id   }])}
        onOpenInvoiceByGmailMessageId={handleOpenInvoiceByGmailMessageId}
        onOpenSupplier={(id)               => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewId:     id   }])}
        onOpenSupplierByName={(name)       => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewName:   name }])}
        onOpenReturn={(id)                 => setNavStack(prev => [...prev, { page: 'returns',   returnsEditId:      id   }])}
        onCreateSupplierFromAlert={handleCreateSupplierFromAlert}
      />
    )
    if (activePage === 'alerts')         return (
      <Alerts
        alerts={alerts}
        onMarkRead={handleMarkRead}
        onMarkResolved={handleMarkResolved}
        onDelete={handleDeleteAlert}
        onCreateSupplierFromAlert={handleCreateSupplierFromAlert}
        onOpenInvoice={(id)                => setNavStack(prev => [...prev, { page: 'invoices',  invoiceSelectedId:  id   }])}
        onOpenInvoiceDuplicate={(id)       => setNavStack(prev => [...prev, { page: 'invoices',  invoiceDuplicateId: id   }])}
        onOpenInvoiceByGmailMessageId={handleOpenInvoiceByGmailMessageId}
        onOpenSupplier={(id)               => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewId:     id   }])}
        onOpenSupplierByName={(name)       => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewName:   name }])}
        onOpenReturn={(id)                 => setNavStack(prev => [...prev, { page: 'returns',   returnsEditId:      id   }])}
        onOpenStatement={(id)              => setNavStack(prev => [...prev, { page: 'reconciliation', statementViewId: id }])}
        onPageChange={handlePageChange}
        savedScrollY={alertsScrollY.current}
        onScrollSave={(y) => { alertsScrollY.current = y }}
      />
    )
    if (activePage === 'suppliers')      return (
      <Suppliers
        onViewLedger={(id) => setNavStack(prev => [...prev, { page: 'ledger', ledgerSupplierId: id }])}
        onViewPayments={(name) => setNavStack(prev => [...prev, { page: 'payments', paymentsSupplierFilter: name }])}
        controlledViewId={currentNav.supplierViewId ?? null}
        controlledViewName={currentNav.supplierViewName ?? null}
        onOpenDetail={(id) => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewId: id }])}
        onCloseDetail={goBack}
        onOpenInvoice={(id) => setNavStack(prev => [...prev, { page: 'invoices', invoiceSelectedId: id }])}
        prefillForAlert={alertForSupplier}
        onAlertSupplierCreated={async (supplierId, alertId, _payload) => {
          try {
            await api.post('/payments/from-alert', { alertId, supplierId })
          } catch (e) {
            console.error('from-alert failed:', e)
          }
          setAlertForSupplier(null)
          markResolved(alertId)
        }}
        onCancelAlertPrefill={() => setAlertForSupplier(null)}
      />
    )
    if (activePage === 'ledger')         return <SupplierLedger initialSupplierId={ledgerSupplierId} />
    if (activePage === 'invoices') return (
      <Invoices
        key="invoices"
        alerts={alerts}
        controlledSelectedId={currentNav.invoiceSelectedId ?? null}
        initialDuplicateInvoiceId={currentNav.invoiceDuplicateId ?? null}
        onOpenInvoice={(id) => setNavStack(prev => [...prev, { page: 'invoices', invoiceSelectedId: id }])}
        onCloseInvoice={goBack}
        onOpenSupplier={(id) => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewId: id }])}
        onDuplicateResolved={handleDuplicateResolved}
        onDuplicateDismissed={goBack}
      />
    )
    if (activePage === 'invoices-duplicates') return (
      <Invoices
        key="invoices-dup"
        initialFilter="כפילויות"
        alerts={alerts}
        controlledSelectedId={currentNav.invoiceSelectedId ?? null}
        onOpenInvoice={(id) => setNavStack(prev => [...prev, { page: 'invoices-duplicates', invoiceSelectedId: id }])}
        onCloseInvoice={goBack}
        onOpenSupplier={(id) => setNavStack(prev => [...prev, { page: 'suppliers', supplierViewId: id }])}
        onDuplicateResolved={handleDuplicateResolved}
        onDuplicateDismissed={goBack}
      />
    )
    if (activePage === 'payments')       return <Payments initialSupplier={currentNav.paymentsSupplierFilter} />
    if (activePage === 'deliveries')     return <DeliveryNotes />
    if (activePage === 'reconciliation') return <StatementReconciliation initialStatementId={currentNav.statementViewId ?? null} />
    if (activePage === 'returns')        return <Returns initialEditId={currentNav.returnsEditId} />
    if (activePage === 'capture')        return <CaptureDocument capturedBy={userEmail} />
    if (activePage === 'system-logs')    return <SystemLogs />
    if (activePage === 'settings')       return <Settings />
    return <ComingSoon page={activePage} />
  }

  return (
    <AppLogoProvider>
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
                style={{ width: '40px', height: '40px', background: '#FDF2F4', color: '#A91D3A', border: 'none', cursor: 'pointer' }}
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <button
              className="flex items-center gap-2 rounded-xl text-gray-400 border transition-all"
              style={{ borderColor: '#EEEEF2', minHeight: '40px', padding: '0 12px', fontSize: '14px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#A91D3A')}
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
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#A91D3A')}
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
              style={{ background: '#A91D3A', width: '36px', height: '36px', fontSize: '14px' }}
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
                  color: '#A91D3A',
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
    </AppLogoProvider>
  )
}
