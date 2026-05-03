import { useState, useEffect } from 'react'
import { FileText, Search } from 'lucide-react'
import { mockInvoices } from '../data/mockData'

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

const statusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: '#FEF9C3', color: '#A16207' },
  'שולם':   { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#DBEAFE', color: '#1E40AF' },
}

function formatILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

type StatusFilter = 'all' | 'ממתין' | 'שולם' | 'בטיפול'

export default function Invoices() {
  const isTablet = useIsTablet()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filtered = mockInvoices.filter((inv) => {
    const matchSearch = inv.supplier.includes(search) || inv.id.includes(search)
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter
    return matchSearch && matchStatus
  })

  const pendingCount  = mockInvoices.filter((i) => i.status === 'ממתין').length
  const paidCount     = mockInvoices.filter((i) => i.status === 'שולם').length
  const processingCount = mockInvoices.filter((i) => i.status === 'בטיפול').length
  const totalAmount   = mockInvoices.reduce((s, i) => s + i.amount, 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-right">
        <h1 className="text-2xl font-black text-gray-800">חשבוניות</h1>
        <p className="text-gray-500 mt-0.5" style={{ fontSize: isTablet ? '16px' : '14px' }}>
          {mockInvoices.length} חשבוניות במערכת
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'סה"כ סכום',     value: formatILS(totalAmount), color: '#1F2937' },
          { label: 'ממתין לתשלום',  value: String(pendingCount),    color: '#A16207' },
          { label: 'שולם',          value: String(paidCount),       color: '#166534' },
          { label: 'בטיפול',        value: String(processingCount), color: '#1E40AF' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-white rounded-2xl p-4 shadow-sm border text-center"
            style={{ borderColor: '#F0E8E7' }}
          >
            <p className="text-3xl font-black" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: isTablet ? '15px' : '13px' }}>
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1 bg-white rounded-xl border p-1 flex-shrink-0"
          style={{ borderColor: '#F0E8E7' }}
        >
          {(['all', 'ממתין', 'שולם', 'בטיפול'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className="rounded-lg px-3 font-medium transition-all"
              style={{
                minHeight: isTablet ? '40px' : '34px',
                fontSize: isTablet ? '16px' : '13px',
                background: statusFilter === f ? '#8B1A3A' : 'transparent',
                color: statusFilter === f ? 'white' : '#6B7280',
              }}
            >
              {f === 'all' ? 'הכל' : f}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-2 flex-1 bg-white rounded-xl border px-4"
          style={{ borderColor: '#F0E8E7', minHeight: '44px' }}
        >
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="חיפוש לפי ספק או מספר חשבונית..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-gray-700 text-right"
            style={{ fontSize: '16px' }}
          />
        </div>
      </div>

      {/* Invoice list */}
      <div
        className="bg-white rounded-2xl shadow-sm border overflow-hidden"
        style={{ borderColor: '#F0E8E7' }}
      >
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p style={{ fontSize: '16px' }}>לא נמצאו חשבוניות</p>
          </div>
        ) : (
          <div>
            {filtered.map((inv, i) => {
              const st = statusStyle[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between cursor-pointer transition-colors"
                  style={{
                    padding: isTablet ? '16px 20px' : '14px 20px',
                    minHeight: isTablet ? '68px' : undefined,
                    borderTop: i > 0 ? '1px solid #F5EEEE' : undefined,
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = '#FFF8F7')
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = 'transparent')
                  }
                >
                  {/* LEFT side (end in RTL): status badge + amount */}
                  <div className="flex items-center gap-3">
                    <span
                      className="rounded-lg font-semibold flex-shrink-0"
                      style={{ ...st, fontSize: '13px', padding: '5px 12px' }}
                    >
                      {inv.status}
                    </span>
                    <span
                      className="font-black text-gray-800"
                      style={{ fontSize: isTablet ? '18px' : '16px' }}
                    >
                      {formatILS(inv.amount)}
                    </span>
                  </div>

                  {/* RIGHT side (start in RTL): supplier + id + date */}
                  <div className="text-right">
                    <p
                      className="font-bold text-gray-800"
                      style={{ fontSize: isTablet ? '16px' : '14px' }}
                    >
                      {inv.supplier}
                    </p>
                    <p className="text-gray-400 mt-0.5" style={{ fontSize: '12px' }}>
                      {inv.id} · {inv.date}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
