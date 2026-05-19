import { useState, useEffect } from 'react'
import { useAppLogo } from '../hooks/useAppLogo'
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  Truck,
  RotateCcw,
  BookOpen,
  Receipt,
  LogOut,
  ChevronLeft,
  Settings,
  Bell,
  ScrollText,
} from 'lucide-react'

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

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
  activePage: string
  onPageChange: (page: string) => void
  onLogout: () => void
  userEmail: string
  mobileStyle?: React.CSSProperties
  newAlertsCount?: number
}

const navItems = [
  { id: 'dashboard', label: 'דשבורד', Icon: LayoutDashboard },
  { id: 'alerts',    label: 'התראות',  Icon: Bell },
  { id: 'suppliers', label: 'ספקים', Icon: Users },
  { id: 'ledger',    label: 'כרטסת ספק', Icon: Receipt },
  { id: 'invoices',  label: 'חשבוניות', Icon: FileText },
  { id: 'payments', label: 'תשלומים', Icon: CreditCard },
  { id: 'deliveries', label: 'תעודות משלוח', Icon: Truck },
  { id: 'returns', label: 'חזרות', Icon: RotateCcw },
  { id: 'reconciliation', label: 'התאמת כרטסות', Icon: BookOpen },
  { id: 'system-logs',    label: 'לוגי מערכת',    Icon: ScrollText },
  { id: 'settings',       label: 'הגדרות',        Icon: Settings },
]

export default function Sidebar({
  isCollapsed,
  onToggle,
  activePage,
  onPageChange,
  onLogout,
  userEmail,
  mobileStyle,
  newAlertsCount = 0,
}: SidebarProps) {
  const isTablet = useIsTablet()
  const collapsed = isCollapsed
  const initials = userEmail ? userEmail.charAt(0).toUpperCase() : 'מ'
  const { logoUrl } = useAppLogo()

  return (
    <aside
      className="flex flex-col h-screen fixed right-0 top-0 z-50"
      style={{
        width: collapsed ? '72px' : isTablet ? '200px' : '256px',
        background: '#FFFFFF',
        boxShadow: '-1px 0 0 #EEEEF2',
        transition: 'transform 0.3s ease, width 0.3s',
        ...mobileStyle,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center px-4 border-b"
        style={{
          borderColor: '#EEEEF2',
          height: '68px',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: '#FDF2F4' }}
            >
              <img src={logoUrl} alt="הדס לוגו" className="w-7 h-7 object-contain" />
            </div>
            <div>
              <h1 className="text-lg leading-tight" style={{ color: '#1A1A2E', fontWeight: 600 }}>
                הדס
              </h1>
              <p className="text-xs leading-none" style={{ color: '#9CA3AF' }}>
                ניהול ספקים
              </p>
            </div>
          </div>
        )}

        {collapsed && (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: '#FDF2F4' }}
          >
            <img src={logoUrl} alt="הדס לוגו" className="w-7 h-7 object-contain" />
          </div>
        )}

        {/* Collapse toggle */}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: '#9CA3AF' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#F5F5F8'
              ;(e.currentTarget as HTMLButtonElement).style.color = '#6B7280'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLButtonElement).style.color = '#9CA3AF'
            }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Expand toggle when collapsed */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="mx-auto mt-2 p-1.5 rounded-lg transition-all"
          style={{ color: 'rgba(255,255,255,0.5)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'white'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)'
          }}
        >
          <ChevronLeft className="w-4 h-4 rotate-180" />
        </button>
      )}

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {navItems.map(({ id, label, Icon }) => {
          const isActive = activePage === id
          return (
            <button
              key={id}
              onClick={() => onPageChange(id)}
              className="w-full flex items-center transition-all relative"
              style={{
                padding: collapsed ? '12px 0' : '11px 16px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? '0' : '10px',
                minHeight: isTablet ? '44px' : undefined,
                color: isActive ? '#D32F4A' : '#6B7280',
                background: isActive ? '#FDF2F4' : 'transparent',
                borderRight: isActive ? '3px solid #D32F4A' : '3px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = '#F5F5F8'
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#1A1A2E'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#6B7280'
                }
              }}
            >
              {!collapsed && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    style={{
                      fontWeight: isActive ? 600 : 400,
                      fontSize: isTablet ? '16px' : '14px',
                    }}
                  >
                    {label}
                  </span>
                  {id === 'alerts' && newAlertsCount > 0 && (
                    <span
                      style={{
                        minWidth: '20px',
                        height: '20px',
                        borderRadius: '10px',
                        background: '#DC2626',
                        color: 'white',
                        fontSize: '11px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 5px',
                      }}
                    >
                      {newAlertsCount}
                    </span>
                  )}
                </div>
              )}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Icon className="w-5 h-5" />
                {collapsed && id === 'alerts' && newAlertsCount > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-5px',
                      left: '-5px',
                      minWidth: '16px',
                      height: '16px',
                      borderRadius: '8px',
                      background: '#DC2626',
                      color: 'white',
                      fontSize: '10px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 3px',
                    }}
                  >
                    {newAlertsCount}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-3" style={{ borderColor: '#EEEEF2' }}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-2 mb-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-medium text-white flex-shrink-0"
              style={{ background: '#D32F4A', fontSize: '14px' }}
            >
              {initials}
            </div>
            <div className="overflow-hidden">
              <p style={{ color: '#9CA3AF', fontSize: '12px' }}>מחוברת</p>
              <p
                className="font-medium truncate"
                style={{ color: '#1A1A2E', fontSize: '14px' }}
              >
                {userEmail}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={onLogout}
          className="w-full flex items-center rounded-xl transition-all px-2"
          style={{
            gap: collapsed ? '0' : '8px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: '#9CA3AF',
            minHeight: isTablet ? '44px' : '40px',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#F5F5F8'
            ;(e.currentTarget as HTMLButtonElement).style.color = '#6B7280'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLButtonElement).style.color = '#9CA3AF'
          }}
        >
          {!collapsed && (
            <span style={{ fontSize: isTablet ? '16px' : '14px' }}>התנתקות</span>
          )}
          <LogOut className="w-4 h-4 flex-shrink-0" />
        </button>
      </div>
    </aside>
  )
}
