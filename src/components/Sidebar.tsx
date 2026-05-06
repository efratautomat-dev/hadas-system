import { useState, useEffect } from 'react'
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  Truck,
  RotateCcw,
  BookOpen,
  LogOut,
  ChevronLeft,
} from 'lucide-react'

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

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
  activePage: string
  onPageChange: (page: string) => void
  onLogout: () => void
  userEmail: string
}

const navItems = [
  { id: 'dashboard', label: 'דשבורד', Icon: LayoutDashboard },
  { id: 'suppliers', label: 'ספקים', Icon: Users },
  { id: 'invoices', label: 'חשבוניות', Icon: FileText },
  { id: 'payments', label: 'תשלומים', Icon: CreditCard },
  { id: 'deliveries', label: 'תעודות משלוח', Icon: Truck },
  { id: 'returns', label: 'חזרות', Icon: RotateCcw },
  { id: 'reconciliation', label: 'התאמת כרטסות', Icon: BookOpen },
]

export default function Sidebar({
  isCollapsed,
  onToggle,
  activePage,
  onPageChange,
  onLogout,
  userEmail,
}: SidebarProps) {
  const isTablet = useIsTablet()
  const collapsed = isTablet ? false : isCollapsed
  const initials = userEmail ? userEmail.charAt(0).toUpperCase() : 'מ'

  return (
    <aside
      className="flex flex-col h-screen fixed right-0 top-0 z-50 transition-all duration-300 shadow-xl"
      style={{
        width: isTablet ? '200px' : collapsed ? '72px' : '256px',
        background: 'linear-gradient(180deg, #8B1A3A 0%, #6B1228 100%)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center px-4 border-b"
        style={{
          borderColor: 'rgba(255,255,255,0.1)',
          height: '68px',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <img src="/logo.png" alt="הדס לוגו" className="w-7 h-7 object-contain" />
            </div>
            <div>
              <h1 className="text-white font-black text-lg leading-tight tracking-wide">
                הדס
              </h1>
              <p className="text-xs leading-none" style={{ color: 'rgba(255,255,255,0.5)' }}>
                ניהול ספקים
              </p>
            </div>
          </div>
        )}

        {collapsed && (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <img src="/logo.png" alt="הדס לוגו" className="w-7 h-7 object-contain" />
          </div>
        )}

        {/* Collapse toggle — desktop only */}
        {!collapsed && !isTablet && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg transition-all"
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
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Expand toggle when collapsed — desktop only */}
      {collapsed && !isTablet && (
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
                color: isActive ? 'white' : 'rgba(255,255,255,0.65)',
                background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                borderLeft: isActive ? '3px solid #E8A020' : '3px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'white'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.65)'
                }
              }}
            >
              {!collapsed && (
                <span
                  style={{
                    fontWeight: isActive ? 600 : 400,
                    fontSize: isTablet ? '16px' : '14px',
                  }}
                >
                  {label}
                </span>
              )}
              <Icon className="w-5 h-5 flex-shrink-0" />
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-2 mb-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
              style={{ background: '#E8A020', fontSize: '14px' }}
            >
              {initials}
            </div>
            <div className="overflow-hidden">
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>מחוברת</p>
              <p
                className="font-medium truncate"
                style={{ color: 'rgba(255,255,255,0.85)', fontSize: '14px' }}
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
            color: 'rgba(255,255,255,0.5)',
            minHeight: isTablet ? '44px' : '40px',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'white'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)'
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
