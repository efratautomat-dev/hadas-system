import { useState, useEffect } from 'react'
import { Camera, X, LogOut, Search, FileText, Truck, RotateCcw, ChevronRight } from 'lucide-react'
import { SearchableSelect } from '../SearchableSelect'
import CaptureDocument from '../CaptureDocument'
import OrdersRail from '../pipeline/OrdersRail'
import { useOrders } from '../../hooks/useOrders'
import { useSuppliers } from '../../hooks/useSuppliers'
import { tierAllows } from '../../lib/tiers'
import EmployeeSupplierView, { type EmployeeSection } from './EmployeeSupplierView'

// Time-based greeting WITHOUT a name (managers' header says "בוקר טוב הדס";
// employees get the neutral form per spec).
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'בוקר טוב'
  if (hour >= 12 && hour < 17) return 'צהריים טובים'
  if (hour >= 17 && hour < 21) return 'ערב טוב'
  return 'לילה טוב'
}

const ACCENT = 'var(--brand-primary)'
const ACCENT_BG = 'var(--brand-active-bg)'

interface Props {
  userEmail: string
  onLogout: () => void | Promise<void>
}

// The three sections an employee can drill into. Order matches the cards below.
const SECTION_CARDS: { key: EmployeeSection; label: string; Icon: typeof FileText }[] = [
  { key: 'invoices',   label: 'חשבוניות',     Icon: FileText },
  { key: 'deliveries', label: 'תעודות משלוח', Icon: Truck },
  { key: 'returns',    label: 'חזרות',        Icon: RotateCcw },
]

export default function EmployeeDashboard({ userEmail, onLogout }: Props) {
  const { data: suppliers } = useSuppliers()
  const { data: orders, markArrived } = useOrders()
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [activeSection, setActiveSection] = useState<EmployeeSection>('invoices')
  const [showCapture, setShowCapture] = useState(false)
  // The board only gets its own column when there is width to give it.
  const [isWide, setIsWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024,
  )
  useEffect(() => {
    const h = () => setIsWide(window.innerWidth >= 1024)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  // Arrived orders leave the board — it shows what is still on its way.
  const openOrders = orders.filter(o => o.status !== 'order_arrived')

  // Browser back/forward across employee sections (flat set, no stack).
  const go = (section: EmployeeSection) => { setActiveSection(section); history.pushState({ section }, '') }
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setActiveSection((e.state?.section as EmployeeSection) ?? 'invoices')
    window.addEventListener('popstate', onPop)
    history.replaceState({ section: 'invoices' }, '')
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId) ?? null

  return (
    <div className="min-h-screen" style={{ background: '#F8F8FA', direction: 'rtl' }}>
      {/* ── Header (accent band, brand colors) ── */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between"
        style={{
          height: '60px',
          padding: '0 16px',
          background: 'linear-gradient(90deg, var(--brand-primary-dark) 0%, var(--brand-primary) 100%)',
          boxShadow: '0 1px 10px rgba(140,23,51,0.25)',
        }}
      >
        {/* First child → RIGHT in RTL: greeting, no name */}
        <h2 className="font-semibold" style={{ fontSize: '17px', color: '#FFFFFF' }}>
          {getGreeting()}
        </h2>

        {/* Last child → LEFT in RTL: logout */}
        <button
          onClick={onLogout}
          className="flex items-center gap-2 rounded-xl font-medium transition-colors"
          style={{ height: '38px', padding: '0 14px', background: 'rgba(255,255,255,0.18)', color: '#FFFFFF', border: 'none', cursor: 'pointer', fontSize: '14px' }}
          title="התנתקות"
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.30)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.18)')}
        >
          <LogOut className="w-4 h-4" />
          יציאה
        </button>
      </header>

      {/* ── Content ──
          Two columns from 1024px up: the screen keeps its 1000px column on the
          RIGHT (first child in RTL) and the orders board takes the space that was
          empty to its LEFT. Below that width the board drops underneath rather
          than disappearing — on a phone there is no width to give it, and the
          same rule the supplier notes panel follows. */}
      <main
        style={{
          padding: '20px 16px', margin: '0 auto', maxWidth: '1420px',
          display: 'grid', gap: '20px', alignItems: 'start',
          // RTL: the FIRST track is the right-hand one. The screen keeps its own
          // column there; the board takes the narrow track on the left.
          gridTemplateColumns: isWide ? 'minmax(0, 1000px) minmax(0, 320px)' : '1fr',
        }}
      >
        {/* LEFT in RTL — declared last so the reading order stays screen-first. */}
        <div style={{ order: isWide ? 2 : 1 }}>
          <OrdersRail
            orders={openOrders}
            onArrived={id => markArrived(id, false)}
            onArrivedPartial={id => markArrived(id, true)}
          />
        </div>

        <div style={{ order: isWide ? 1 : 2, minWidth: 0 }}>
        {/* Prominent standalone capture button (below header, visual left in RTL) */}
        <div className="flex mb-5" style={{ justifyContent: 'flex-end' }}>
          <button
            onClick={() => setShowCapture(true)}
            className="flex items-center gap-2 rounded-2xl font-bold text-white transition-all"
            style={{ minHeight: '52px', padding: '0 28px', background: ACCENT, fontSize: '16px', boxShadow: '0 4px 14px rgba(169,29,58,0.30)' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary-dark)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = ACCENT)}
          >
            <Camera className="w-6 h-6" />
            צלמי מסמך
          </button>
        </div>

        {/* Supplier search */}
        <div className="bg-white rounded-2xl shadow-sm border p-4 mb-5" style={{ borderColor: '#EEEEF2' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: ACCENT_BG }}>
              <Search className="w-4 h-4" style={{ color: ACCENT }} />
            </div>
            <div className="text-right">
              <h1 className="font-bold text-gray-800" style={{ fontSize: '17px' }}>חיפוש ספק</h1>
              <p className="text-gray-400" style={{ fontSize: '13px' }}>בחרי ספק כדי לצפות בחשבוניות, תעודות משלוח, חזרות ופרטי קשר</p>
            </div>
          </div>
          <SearchableSelect
            value={selectedSupplierId}
            onChange={(v) => { setSelectedSupplierId(v); go('invoices') }}
            placeholder="— חיפוש לפי שם ספק או ח.פ —"
            allowClear
            options={suppliers.map(s => ({
              value: s.id,
              label: s.name,
              keywords: (s as { hp?: string }).hp,
            }))}
          />
        </div>

        {/* Section cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {/* Same tier rule as the manager nav — an employee on a basic-tier
              account has no deliveries or returns to open either. */}
          {SECTION_CARDS.filter(({ key }) => tierAllows(key)).map(({ key, label, Icon }) => {
            const active = !!selectedSupplier && activeSection === key
            const enabled = !!selectedSupplier
            return (
              <button
                key={key}
                disabled={!enabled}
                onClick={() => go(key)}
                className="bg-white rounded-2xl shadow-sm border flex flex-col items-center justify-center gap-2 transition-all"
                style={{
                  borderColor: active ? ACCENT : '#EEEEF2',
                  background: active ? ACCENT_BG : 'white',
                  padding: '18px 8px',
                  cursor: enabled ? 'pointer' : 'not-allowed',
                  opacity: enabled ? 1 : 0.55,
                }}
              >
                <Icon className="w-7 h-7" style={{ color: active ? ACCENT : '#9CA3AF' }} />
                <span className="font-bold" style={{ fontSize: '14px', color: active ? ACCENT : '#374151' }}>{label}</span>
              </button>
            )
          })}
        </div>

        {/* Scoped supplier view, or empty hint */}
        {selectedSupplier ? (
          <div className="space-y-4">
            <button
              onClick={() => { setSelectedSupplierId(''); go('invoices') }}
              className="flex items-center gap-1.5 font-medium transition-colors"
              style={{ background: 'white', border: '1.5px solid #DEDFE5', borderRadius: '12px', padding: '10px 16px', fontSize: '14px', color: '#6B7280', cursor: 'pointer' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FAFAFC')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
            >
              <ChevronRight className="w-4 h-4" />
              חזרה לחיפוש
            </button>
            <EmployeeSupplierView
              supplier={selectedSupplier}
              activeSection={activeSection}
            />
          </div>
        ) : (
          <div
            className="bg-white rounded-2xl border flex flex-col items-center justify-center text-center"
            style={{ borderColor: '#EEEEF2', padding: '48px 20px' }}
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: ACCENT_BG }}>
              <Search className="w-8 h-8" style={{ color: ACCENT }} />
            </div>
            <p className="font-semibold text-gray-700" style={{ fontSize: '16px' }}>בחרי ספק כדי להתחיל</p>
            <p className="text-gray-400 mt-1" style={{ fontSize: '14px' }}>כל המידע שיוצג שייך לספק שתבחרי בלבד</p>
          </div>
        )}
        </div>
      </main>

      {/* ── Capture overlay (reuses the existing CaptureDocument flow) ── */}
      {showCapture && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center"
          style={{ background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '24px 12px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCapture(false) }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full" style={{ maxWidth: '600px', direction: 'rtl' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
              <button
                onClick={() => setShowCapture(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                title="סגירה"
              >
                <X className="w-5 h-5" />
              </button>
              <span className="font-bold text-gray-700">צילום מסמך</span>
            </div>
            <div className="p-5">
              <CaptureDocument capturedBy={userEmail} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
