import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, Clock, Search as SearchIcon, X, ArrowLeftRight, Eye } from 'lucide-react'
import { useStatements } from '../hooks/useStatements'
import type { VendorStatementStatus } from '../hooks/useStatements'

interface VendorStatement {
  id: string
  supplier_id: string
  supplier_name: string
  month: string
  our_balance: number
  vendor_balance: number | null
  diff: number
  status: VendorStatementStatus
  uploaded_at: string
}

interface LedgerRow {
  date: string
  description: string
  amount: number
  type: 'חשבונית' | 'תשלום' | 'זיכוי'
  matched: boolean
}

interface StmtDetail {
  our_rows: LedgerRow[]
  vendor_rows: LedgerRow[]
}

const statusConfig: Record<VendorStatementStatus, {
  label: string
  bg: string
  color: string
  Icon: React.ElementType
}> = {
  matched:       { label: 'תואם',      bg: '#DCFCE7', color: '#166534', Icon: CheckCircle2 },
  mismatch:      { label: 'אי-התאמה', bg: '#FEE2E2', color: '#DC2626', Icon: AlertTriangle },
  pending:       { label: 'ממתין',     bg: '#FEF9C3', color: '#A16207', Icon: Clock },
  investigating: { label: 'בבדיקה',   bg: '#DBEAFE', color: '#1E40AF', Icon: SearchIcon },
}


const stmtDetails: Record<string, StmtDetail> = {
  'VS-002': {
    our_rows: [
      { date: '28/03/2026', description: 'חשבונית INV-010 - ביגוד חורף', amount: 7600,  type: 'חשבונית', matched: true  },
      { date: '01/05/2026', description: 'חשבונית INV-001 - ביגוד קיץ',  amount: 8300,  type: 'חשבונית', matched: true  },
      { date: '28/04/2026', description: 'תשלום - שיק 8812',             amount: -3400, type: 'תשלום',   matched: true  },
    ],
    vendor_rows: [
      { date: '28/03/2026', description: 'חשבונית INV-010 - ביגוד חורף', amount: 7600,  type: 'חשבונית', matched: true  },
      { date: '01/05/2026', description: 'חשבונית INV-001 - ביגוד קיץ',  amount: 8300,  type: 'חשבונית', matched: true  },
      { date: '15/04/2026', description: 'חשבונית 5521 - תוספת ריבית',  amount: 1500,  type: 'חשבונית', matched: false },
      { date: '28/04/2026', description: 'תשלום - שיק 8812',             amount: -3400, type: 'תשלום',   matched: true  },
    ],
  },
}

function formatILS(n: number) {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return sign + '₪' + abs.toLocaleString('he-IL')
}

function StatusBadge({ status }: { status: VendorStatementStatus }) {
  const cfg = statusConfig[status]
  const { Icon } = cfg
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      {cfg.label}
    </span>
  )
}

function TypeBadge({ type }: { type: LedgerRow['type'] }) {
  const map: Record<string, { bg: string; color: string }> = {
    'חשבונית': { bg: '#DBEAFE', color: '#1E40AF' },
    'תשלום':   { bg: '#DCFCE7', color: '#166534' },
    'זיכוי':   { bg: '#F3E8FF', color: '#7C3AED' },
  }
  const s = map[type] ?? { bg: '#F3F4F6', color: '#6B7280' }
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-bold" style={{ backgroundColor: s.bg, color: s.color }}>
      {type}
    </span>
  )
}

interface DetailModalProps {
  stmt: VendorStatement
  onClose: () => void
  onStatusChange: (id: string, status: VendorStatementStatus) => void
  onBalanceUpdate: (id: string, balance: number) => void
}

function DetailModal({ stmt, onClose, onStatusChange, onBalanceUpdate }: DetailModalProps) {
  const [manualBalance, setManualBalance] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const detail = stmtDetails[stmt.id]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
        style={{ maxWidth: '900px', maxHeight: '90vh', margin: '16px', direction: 'rtl' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: '#E2E4E9' }}>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <StatusBadge status={stmt.status} />
            <h2 className="text-lg font-bold text-gray-800">
              התאמת כרטסת — {stmt.supplier_name} · {stmt.month}
            </h2>
            <ArrowLeftRight className="w-5 h-5 text-gray-400" />
          </div>
        </div>

        {/* Diff summary bar */}
        {stmt.status === 'mismatch' && (
          <div
            className="px-6 py-3 flex items-center justify-between text-sm font-semibold"
            style={{ background: '#FEF2F2', borderBottom: '1px solid #FECDD3' }}
          >
            <div className="flex items-center gap-6">
              <span style={{ color: '#DC2626' }}>הפרש: {formatILS(stmt.diff)}</span>
              <span className="text-gray-500">
                יתרת ספק: {stmt.vendor_balance != null ? formatILS(stmt.vendor_balance) : '—'}
              </span>
              <span className="text-gray-500">יתרה שלנו: {formatILS(stmt.our_balance)}</span>
            </div>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
        )}

        {/* Side-by-side ledger */}
        <div className="overflow-y-auto" style={{ maxHeight: '50vh' }}>
          {detail ? (
            <div className="grid grid-cols-2" style={{ minWidth: '600px' }}>
              <div
                className="px-4 py-2.5 text-sm font-bold text-right border-b border-l"
                style={{ borderColor: '#E2E4E9', background: '#F8F9FA' }}
              >
                כרטסת שלנו
              </div>
              <div
                className="px-4 py-2.5 text-sm font-bold text-right border-b"
                style={{ borderColor: '#E2E4E9', background: '#F8F9FA' }}
              >
                דף חשבון ספק
              </div>

              {/* Our rows */}
              <div className="border-l" style={{ borderColor: '#E2E4E9' }}>
                {detail.our_rows.map((row, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 border-b text-right"
                    style={{ borderColor: '#E2E4E9', background: 'white' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-bold ${row.amount < 0 ? 'text-green-600' : 'text-gray-800'}`}>
                        {formatILS(row.amount)}
                      </span>
                      <TypeBadge type={row.type} />
                    </div>
                    <p className="text-xs text-gray-600 mb-0.5">{row.description}</p>
                    <p className="text-xs text-gray-400">{row.date}</p>
                  </div>
                ))}
              </div>

              {/* Vendor rows */}
              <div>
                {detail.vendor_rows.map((row, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 border-b text-right"
                    style={{ borderColor: '#E2E4E9', background: row.matched ? 'white' : '#FEF2F2' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {!row.matched && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                        <span
                          className={`text-sm font-bold ${
                            row.amount < 0 ? 'text-green-600' : row.matched ? 'text-gray-800' : 'text-red-600'
                          }`}
                        >
                          {formatILS(row.amount)}
                        </span>
                      </div>
                      <TypeBadge type={row.type} />
                    </div>
                    <p className={`text-xs mb-0.5 ${row.matched ? 'text-gray-600' : 'text-red-500 font-semibold'}`}>
                      {row.description}
                    </p>
                    <p className="text-xs text-gray-400">{row.date}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
              אין פירוט זמין לכרטסת זו
            </div>
          )}
        </div>

        {/* Action bar */}
        <div
          className="px-6 py-4 border-t flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: '#E2E4E9' }}
        >
          {/* Manual balance */}
          <div className="flex items-center gap-2">
            {showManualInput ? (
              <>
                <button
                  className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors"
                  style={{ background: '#7C3AED' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#6D28D9')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
                  onClick={() => {
                    const val = parseFloat(manualBalance)
                    if (!isNaN(val)) {
                      onBalanceUpdate(stmt.id, val)
                      setShowManualInput(false)
                      setManualBalance('')
                    }
                  }}
                >
                  שמור
                </button>
                <input
                  type="number"
                  value={manualBalance}
                  onChange={(e) => setManualBalance(e.target.value)}
                  placeholder="יתרה חדשה..."
                  dir="ltr"
                  className="border-2 rounded-xl px-3 py-2 text-sm w-36"
                  style={{ borderColor: '#7C3AED' }}
                  autoFocus
                />
                <span className="text-sm text-gray-500">עדכן יתרה ידנית:</span>
              </>
            ) : (
              <button
                className="px-4 py-2 rounded-xl text-sm font-bold border-2 transition-colors"
                style={{ borderColor: '#E2E4E9', color: '#6B7280' }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.borderColor = '#7C3AED'
                  ;(e.currentTarget as HTMLElement).style.color = '#7C3AED'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.borderColor = '#E2E4E9'
                  ;(e.currentTarget as HTMLElement).style.color = '#6B7280'
                }}
                onClick={() => setShowManualInput(true)}
              >
                עדכן יתרה ידנית
              </button>
            )}
          </div>

          {/* Status change + close */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-bold border-2 text-gray-500 transition-colors"
              style={{ borderColor: '#E2E4E9' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
            >
              סגור
            </button>
            {stmt.status === 'mismatch' && (
              <button
                className="px-4 py-2 rounded-xl text-sm font-bold transition-colors"
                style={{ background: '#DBEAFE', color: '#1E40AF' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#BFDBFE')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#DBEAFE')}
                onClick={() => {
                  onStatusChange(stmt.id, 'investigating')
                  onClose()
                }}
              >
                סמן כ״בבדיקה״
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
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

export default function StatementReconciliation() {
  const { data: serverStatements, loading, error, resolve: resolveStatement } = useStatements()
  const [statements, setStatements] = useState<VendorStatement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<VendorStatementStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const isMobile = useIsMobile()
  const gridCOL = isMobile
    ? '1.5fr 1.2fr 1fr 0.7fr'
    : '0.8fr 1.5fr 0.9fr 1.2fr 1.2fr 1fr 1.1fr 0.9fr'
  const gridMin = isMobile ? '320px' : '720px'

  useEffect(() => {
    setStatements(serverStatements as VendorStatement[])
  }, [serverStatements])

  const counts = {
    matched:       statements.filter((s) => s.status === 'matched').length,
    mismatch:      statements.filter((s) => s.status === 'mismatch').length,
    pending:       statements.filter((s) => s.status === 'pending').length,
    investigating: statements.filter((s) => s.status === 'investigating').length,
  }

  const filtered = statements.filter((s) => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (search && !s.supplier_name.includes(search)) return false
    return true
  })

  const selectedStmt = selectedId ? statements.find((s) => s.id === selectedId) ?? null : null

  function handleStatusChange(id: string, status: VendorStatementStatus) {
    setStatements((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)))
    resolveStatement(id, { status }).catch(() => {})
  }

  function handleBalanceUpdate(id: string, balance: number) {
    setStatements((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        const newDiff = s.vendor_balance != null ? Math.abs(s.vendor_balance - balance) : 0
        const newStatus: VendorStatementStatus =
          s.vendor_balance != null && Math.abs(s.vendor_balance - balance) < 1 ? 'matched' : s.status
        resolveStatement(id, { ourBalance: balance, diff: newDiff, status: newStatus }).catch(() => {})
        return { ...s, our_balance: balance, diff: newDiff, status: newStatus }
      })
    )
  }

  const statCards: {
    key: VendorStatementStatus
    label: string
    iconBg: string
    iconColor: string
    Icon: React.ElementType
  }[] = [
    { key: 'matched',       label: 'תואמות',   iconBg: '#DCFCE7', iconColor: '#166534', Icon: CheckCircle2 },
    { key: 'mismatch',      label: 'אי-התאמה', iconBg: '#FEE2E2', iconColor: '#DC2626', Icon: AlertTriangle },
    { key: 'pending',       label: 'ממתינות',  iconBg: '#FEF9C3', iconColor: '#A16207', Icon: Clock },
    { key: 'investigating', label: 'בבדיקה',   iconBg: '#DBEAFE', iconColor: '#1E40AF', Icon: SearchIcon },
  ]

  if (loading && statements.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#E8645A' }} />
      </div>
    )
  }

  return (
    <div className="space-y-6" dir="rtl">
      {error && (
        <div className="rounded-xl p-3 text-sm text-right" style={{ background: '#FEF9C3', color: '#92400E' }}>
          לא ניתן לטעון נתונים מהשרת — מוצגים נתוני ברירת מחדל
        </div>
      )}
      <div>
        <h1 className="text-2xl font-black text-gray-800">התאמת כרטסות ספקים</h1>
        <p className="text-gray-500 text-sm mt-0.5">השוואת יתרות מול דפי חשבון ספקים</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ key, label, iconBg, iconColor, Icon }) => (
          <div
            key={key}
            className="bg-white rounded-2xl p-5 shadow-sm border cursor-pointer transition-all"
            style={{ borderColor: filterStatus === key ? iconColor : '#E2E4E9' }}
            onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
          >
            <div className="flex items-start justify-between">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: iconBg, color: iconColor }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-gray-500">{label}</p>
            </div>
            <div className="mt-3 text-right">
              <p className="text-3xl font-black text-gray-800">{counts[key]}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div
        className="bg-white rounded-2xl shadow-sm border p-4 flex items-center gap-3"
        style={{ borderColor: '#E2E4E9' }}
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש ספק..."
            dir="rtl"
            className="w-full px-4 py-2.5 rounded-xl border-2 text-sm text-gray-800 placeholder:text-gray-400"
            style={{ borderColor: '#E2E4E9' }}
          />
          <SearchIcon className="absolute top-1/2 -translate-y-1/2 left-3 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        {filterStatus !== 'all' && (
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border-2 transition-colors"
            style={{ borderColor: '#E2E4E9', color: '#6B7280' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#7C3AED')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#E2E4E9')}
            onClick={() => setFilterStatus('all')}
          >
            <X className="w-3.5 h-3.5" />
            נקה סינון
          </button>
        )}
      </div>

      {/* Main table */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#E2E4E9' }}>
          <span className="text-sm text-gray-500">{filtered.length} רשומות</span>
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-gray-800">רשימת כרטסות</h2>
            <ArrowLeftRight className="w-4 h-4 text-gray-400" />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {/* Header */}
          <div
            className="grid text-xs font-bold text-gray-500 px-4 py-3 border-b"
            style={{
              borderColor: '#E2E4E9',
              background: '#F8F9FA',
              gridTemplateColumns: gridCOL,
              minWidth: gridMin,
              textAlign: 'right',
            }}
          >
            {!isMobile && <span>מזהה</span>}
            <span>ספק</span>
            {!isMobile && <span>חודש</span>}
            {!isMobile && <span>יתרה שלנו</span>}
            {!isMobile && <span>יתרת ספק</span>}
            <span>הפרש</span>
            <span>סטטוס</span>
            <span>פעולות</span>
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">לא נמצאו רשומות</div>
          ) : (
            filtered.map((stmt) => (
              <div
                key={stmt.id}
                className="grid items-center border-b transition-colors"
                style={{
                  borderColor: '#E2E4E9',
                  gridTemplateColumns: gridCOL,
                  minWidth: gridMin,
                  textAlign: 'right',
                  minHeight: '56px',
                  padding: '12px 16px',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F8F9FA')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                {!isMobile && <span className="text-xs text-gray-400 font-mono">{stmt.id}</span>}
                <span className="text-sm font-semibold text-gray-800">{stmt.supplier_name}</span>
                {!isMobile && <span className="text-sm text-gray-600">{stmt.month}</span>}
                {!isMobile && <span className="text-sm font-semibold text-gray-800">{formatILS(stmt.our_balance)}</span>}
                {!isMobile && (
                  <span className="text-sm font-semibold text-gray-800">
                    {stmt.vendor_balance != null ? formatILS(stmt.vendor_balance) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </span>
                )}
                <span
                  className="text-sm font-bold"
                  style={{
                    color: stmt.diff > 0 ? '#DC2626' : stmt.diff < 0 ? '#1E40AF' : '#166534',
                  }}
                >
                  {stmt.diff !== 0 ? formatILS(stmt.diff) : '—'}
                </span>
                <StatusBadge status={stmt.status} />
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                  style={{ background: '#F3E8FF', color: '#7C3AED' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#EDE9FE')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#F3E8FF')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedId(stmt.id)
                  }}
                >
                  <Eye className="w-3.5 h-3.5" />
                  פירוט
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Detail modal */}
      {selectedStmt && (
        <DetailModal
          stmt={selectedStmt}
          onClose={() => setSelectedId(null)}
          onStatusChange={handleStatusChange}
          onBalanceUpdate={handleBalanceUpdate}
        />
      )}
    </div>
  )
}
