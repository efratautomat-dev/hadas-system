import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Search, AlertCircle, Info, AlertTriangle, Bug } from 'lucide-react'
import { supabase } from '../lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogRow {
  id:         number
  timestamp:  string
  source:     string
  level:      LogLevel
  message:    string
  context:    Record<string, unknown> | null
  message_id: string | null
}

const PAGE_SIZE = 50

const LEVEL_STYLE: Record<LogLevel, { bg: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  debug: { bg: '#F3F4F6', color: '#6B7280', Icon: Bug },
  info:  { bg: '#DBEAFE', color: '#1E40AF', Icon: Info },
  warn:  { bg: '#FEF3C7', color: '#92400E', Icon: AlertTriangle },
  error: { bg: '#FEE2E2', color: '#DC2626', Icon: AlertCircle },
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SystemLogs() {
  const [rows, setRows]               = useState<LogRow[]>([])
  const [sources, setSources]         = useState<string[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [page, setPage]               = useState(0)
  const [hasMore, setHasMore]         = useState(false)
  const [filterSource, setFilterSource] = useState('')
  const [filterLevel, setFilterLevel] = useState<'' | LogLevel>('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [search, setSearch]           = useState('')
  const [expanded, setExpanded]       = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('system_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

      if (filterSource) q = q.eq('source', filterSource)
      if (filterLevel)  q = q.eq('level',  filterLevel)
      if (dateFrom)     q = q.gte('timestamp', new Date(dateFrom).toISOString())
      if (dateTo)       q = q.lte('timestamp', new Date(dateTo + 'T23:59:59').toISOString())
      if (search.trim()) q = q.ilike('message_id', `%${search.trim()}%`)

      const { data, error: err } = await q
      if (err) throw err

      const list = (data ?? []) as LogRow[]
      setHasMore(list.length > PAGE_SIZE)
      setRows(list.slice(0, PAGE_SIZE))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, filterSource, filterLevel, dateFrom, dateTo, search])

  // Load list of distinct sources for the dropdown
  useEffect(() => {
    supabase
      .from('system_logs')
      .select('source')
      .limit(500)
      .then(({ data }) => {
        const uniq = [...new Set((data ?? []).map((r: { source: string }) => r.source))].sort()
        setSources(uniq)
      })
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30 seconds (only when on first page, no manual filters running)
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (page === 0) load()
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [page, load])

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resetFilters = () => {
    setFilterSource('')
    setFilterLevel('')
    setDateFrom('')
    setDateTo('')
    setSearch('')
    setPage(0)
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
          style={{ background: '#D32F4A', color: 'white', border: 'none', cursor: loading ? 'wait' : 'pointer' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          רענון
        </button>
        <div className="text-right">
          <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>לוגי מערכת</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: '14px' }}>
            ניטור פעילות Edge Functions ובדיקת תקלות
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-3 text-sm text-right" style={{ background: '#FEE2E2', color: '#991B1B' }}>
          שגיאה בטעינת לוגים: {error}
        </div>
      )}

      {/* Filters */}
      <div
        className="bg-white rounded-2xl p-4 border"
        style={{ borderColor: '#EEEEF2', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}
      >
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 text-right">מקור</label>
          <select
            value={filterSource}
            onChange={e => { setFilterSource(e.target.value); setPage(0) }}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: '#DEDFE5', textAlign: 'right' }}
          >
            <option value="">הכל</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 text-right">חומרה</label>
          <select
            value={filterLevel}
            onChange={e => { setFilterLevel(e.target.value as LogLevel | ''); setPage(0) }}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: '#DEDFE5', textAlign: 'right' }}
          >
            <option value="">הכל</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 text-right">מתאריך</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: '#DEDFE5', textAlign: 'right' }}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 text-right">עד תאריך</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(0) }}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: '#DEDFE5', textAlign: 'right' }}
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label className="block text-xs font-semibold text-gray-500 mb-1 text-right">חיפוש לפי message_id</label>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: '#DEDFE5' }}>
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
              className="flex-1 bg-transparent outline-none text-sm"
              dir="ltr"
              placeholder="message id..."
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            onClick={resetFilters}
            className="px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#F3F4F6', color: '#6B7280', border: 'none', cursor: 'pointer' }}
          >
            ניקוי
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
        {loading && rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400">טוען...</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400">לא נמצאו רשומות</div>
        ) : (
          <div>
            <div
              className="grid font-semibold text-gray-400 uppercase tracking-wider border-b"
              style={{ gridTemplateColumns: '160px 100px 130px 1fr 160px', borderColor: '#EEEEF2', fontSize: '11px', padding: '10px 16px' }}
            >
              <span className="text-right">תאריך</span>
              <span className="text-center">חומרה</span>
              <span className="text-right">מקור</span>
              <span className="text-right">הודעה</span>
              <span className="text-right">message_id</span>
            </div>
            {rows.map(row => {
              const st = LEVEL_STYLE[row.level]
              const isOpen = expanded.has(row.id)
              return (
                <div key={row.id} style={{ borderBottom: '1px solid #EEEEF2' }}>
                  <div
                    className="grid items-center cursor-pointer"
                    style={{
                      gridTemplateColumns: '160px 100px 130px 1fr 160px',
                      padding: '10px 16px',
                      transition: 'background 0.12s',
                    }}
                    onClick={() => toggleExpand(row.id)}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FDF5F6')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: '12px', color: '#6B7280', textAlign: 'right', direction: 'ltr' }}>{fmtTimestamp(row.timestamp)}</span>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <span style={{
                        ...st, fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '6px',
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                      }}>
                        <st.Icon className="w-3 h-3" />
                        {row.level}
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#374151', textAlign: 'right' }}>{row.source}</span>
                    <span style={{ fontSize: '13px', color: '#1F2937', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isOpen ? 'normal' : 'nowrap' }}>
                      {row.message}
                    </span>
                    <span style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'right', direction: 'ltr', fontFamily: 'monospace' }}>
                      {row.message_id ?? '—'}
                    </span>
                  </div>
                  {isOpen && row.context && (
                    <div style={{ padding: '10px 16px 14px', background: '#FAFAFC' }}>
                      <pre style={{
                        margin: 0,
                        padding: '12px',
                        background: '#1F2937',
                        color: '#D1FAE5',
                        borderRadius: '8px',
                        fontSize: '12px',
                        direction: 'ltr',
                        overflow: 'auto',
                        maxHeight: '400px',
                      }}>
                        {JSON.stringify(row.context, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{
              background: page === 0 ? '#F3F4F6' : 'white',
              color: page === 0 ? '#9CA3AF' : '#D32F4A',
              border: '1px solid #DEDFE5',
              cursor: page === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            הקודם
          </button>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{
              background: !hasMore ? '#F3F4F6' : 'white',
              color: !hasMore ? '#9CA3AF' : '#D32F4A',
              border: '1px solid #DEDFE5',
              cursor: !hasMore ? 'not-allowed' : 'pointer',
            }}
          >
            הבא
          </button>
        </div>
        <span style={{ fontSize: '13px', color: '#6B7280' }}>
          עמוד {page + 1} · {rows.length} רשומות
        </span>
      </div>
    </div>
  )
}
