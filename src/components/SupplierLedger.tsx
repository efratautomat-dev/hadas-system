import { useState, useEffect, useMemo } from 'react'
import { Printer, BookOpen } from 'lucide-react'
import { useSuppliers } from '../hooks/useSuppliers'
import { useInvoices } from '../hooks/useInvoices'
import { usePayments } from '../hooks/usePayments'
import { useAppLogo } from '../hooks/useAppLogo'
import { SearchableSelect } from './SearchableSelect'
import SectionHeader from './SectionHeader'

type EntryType = 'חשבונית' | 'תשלום' | 'זיכוי'

interface TableRow {
  id: string
  displayDate: string
  description: string
  type: 'פתיחה' | EntryType
  debit: number
  credit: number
  runningBalance: number
}

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const typeBadge: Record<string, { bg: string; color: string }> = {
  'פתיחה':   { bg: '#F3F4F6', color: '#6B7280' },
  'חשבונית': { bg: '#FEF9C3', color: '#A16207' },
  'תשלום':   { bg: '#DCFCE7', color: '#166534' },
  'זיכוי':   { bg: '#DBEAFE', color: '#1E40AF' },
}

const COL = '90px 1fr 80px 110px 110px 130px'

function useIsMobile() {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 640)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

const COL_D = COL
const COL_M = '80px 1fr 110px'

export default function SupplierLedger({ initialSupplierId }: { initialSupplierId?: string }) {
  const { data: suppliersData, loading } = useSuppliers()
  const { data: allInvoices } = useInvoices()
  const { data: allPayments } = usePayments()
  const { logoUrl } = useAppLogo()
  const [selectedSupplierId, setSelectedSupplierId] = useState(initialSupplierId ?? '')
  const [fromDate, setFromDate] = useState('2026-01-01')
  const [toDate,   setToDate]   = useState('2026-12-31')
  const isMobile = useIsMobile()
  const activeCOL = isMobile ? COL_M : COL_D

  useEffect(() => {
    if (!selectedSupplierId && suppliersData.length > 0) {
      setSelectedSupplierId(initialSupplierId ?? suppliersData[0].id)
    }
  }, [suppliersData, initialSupplierId, selectedSupplierId])

  const supplier      = suppliersData.find(s => s.id === selectedSupplierId)
  // openingBalance is attached at runtime by useSuppliers (not in the mock-derived type).
  const baseOpening   = Number((supplier as { openingBalance?: number } | undefined)?.openingBalance ?? 0)

  // Real ledger entries for the selected supplier, keyed by SUPPLIER_ID
  // (spec/06-RULES.md §2b). Invoices are debits; credit notes (negative invoices)
  // and non-cancelled payments are credits. Returns are excluded — only a matching
  // credit note (a negative invoice) moves the balance.
  const allEntries = useMemo(() => {
    const invEntries = allInvoices
      .filter(inv => inv.supplierId === selectedSupplierId)
      .map(inv => {
        const isCredit = inv.amount < 0
        return {
          id: inv.id,
          date: inv.invoiceDate || '',
          displayDate: inv.date || '',
          description: `${isCredit ? 'זיכוי' : 'חשבונית'} ${inv.invoiceNumber || inv.id}`,
          type: (isCredit ? 'זיכוי' : 'חשבונית') as EntryType,
          debit:  isCredit ? 0 : inv.amount,
          credit: isCredit ? -inv.amount : 0,
        }
      })
    const payEntries = allPayments
      .filter(pay => pay.supplier_id === selectedSupplierId && pay.status !== 'cancelled')
      .map(pay => ({
        id: String(pay.id),
        date: pay.date || '',
        displayDate: pay.date ? isoToDisplay(pay.date) : '',
        description: `תשלום · ${pay.type}`,
        type: 'תשלום' as EntryType,
        debit: 0,
        credit: pay.amount,
      }))
    return [...invEntries, ...payEntries]
  }, [allInvoices, allPayments, selectedSupplierId])

  // Accumulated balance before the selected period
  const beforePeriod      = allEntries.filter(e => e.date < fromDate)
  const beforeNet         = beforePeriod.reduce((s, e) => s + e.debit - e.credit, 0)
  const periodOpenBalance = baseOpening + beforeNet

  // Entries within the date range
  const inPeriod = [...allEntries.filter(e => e.date >= fromDate && e.date <= toDate)]
    .sort((a, b) => a.date.localeCompare(b.date))

  let running = periodOpenBalance
  const rows: TableRow[] = [
    {
      id: 'opening',
      displayDate: isoToDisplay(fromDate),
      description: 'יתרת פתיחה',
      type: 'פתיחה',
      debit: 0,
      credit: 0,
      runningBalance: periodOpenBalance,
    },
    ...inPeriod.map(e => {
      running += e.debit - e.credit
      return {
        id: e.id,
        displayDate: e.displayDate,
        description: e.description,
        type: e.type as 'פתיחה' | EntryType,
        debit: e.debit,
        credit: e.credit,
        runningBalance: running,
      }
    }),
  ]

  const totalDebit   = inPeriod.reduce((s, e) => s + e.debit, 0)
  const totalCredit  = inPeriod.reduce((s, e) => s + e.credit, 0)
  const finalBalance = running

  // Display newest-first. The running balance above is computed in chronological
  // order (oldest→newest), so each row already carries its correct accumulated
  // balance; here we only REVERSE the on-screen order. Result: the latest
  // transaction (carrying finalBalance) sits at the top, and the opening-balance
  // row drops to the bottom — reading bottom-up is still chronological.
  const displayRows = [...rows].reverse()

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!supplier) return
    const today      = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })
    const fromDisp   = isoToDisplay(fromDate)
    const toDisp     = isoToDisplay(toDate)
    const rowsHtml = rows.map(row => {
      const bs = typeBadge[row.type] ?? typeBadge['פתיחה']
      const isOpening = row.type === 'פתיחה'
      return `<tr style="border-bottom:1px solid #EEEEF2;background:${isOpening ? '#FDF2F4' : 'white'}">
        <td style="padding:9px 12px">${row.displayDate}</td>
        <td style="padding:9px 12px">${row.description}</td>
        <td style="padding:9px 6px;text-align:center">
          <span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;background:${bs.bg};color:${bs.color}">${row.type}</span>
        </td>
        <td style="padding:9px 12px;text-align:left;color:#A16207;font-weight:500">${row.debit > 0 ? formatILS(row.debit) : '—'}</td>
        <td style="padding:9px 12px;text-align:left;color:#166534;font-weight:500">${row.credit > 0 ? formatILS(row.credit) : '—'}</td>
        <td style="padding:9px 12px;text-align:left;font-weight:700;color:#1F2937">${formatILS(row.runningBalance)}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>כרטסת ספק – ${supplier.name}</title>
  <style>
    *{box-sizing:border-box;font-family:Arial,sans-serif}
    body{margin:24px;color:#1F2937;direction:rtl}
    .hdr{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;margin-bottom:20px;border-bottom:2px solid #D32F4A}
    .logo{height:56px;object-fit:contain}
    table{width:100%;border-collapse:collapse}
    thead tr{background:#D32F4A}
    th{padding:10px 12px;color:white;font-size:13px;text-align:right;font-weight:600}
    th.num{text-align:left}
    .foot-row{background:#FDF2F4;border-top:2px solid #D32F4A}
    .foot-row td{padding:10px 12px;font-weight:700}
    @media print{@page{margin:1cm}}
  </style>
</head>
<body>
<div class="hdr">
  <div style="text-align:left;font-size:12px;color:#6B7280;line-height:2">
    <div>תאריך הפקה: <strong>${today}</strong></div>
    <div>טווח תאריכים: <strong>${fromDisp} – ${toDisp}</strong></div>
  </div>
  <div style="text-align:right">
    <div style="font-size:12px;color:#9CA3AF;margin-bottom:4px">כרטסת ספק</div>
    <div style="font-size:22px;font-weight:900;color:#D32F4A">${supplier.name}</div>
    <div style="font-size:12px;color:#6B7280;margin-top:2px">${supplier.contact} · ${supplier.phone}</div>
  </div>
  <img src="${logoUrl}" class="logo" alt="לוגו" onerror="this.style.display='none'"/>
</div>
<table>
  <thead>
    <tr>
      <th>תאריך</th><th>תיאור</th><th style="text-align:center">סוג</th>
      <th class="num">חובה</th><th class="num">זכות</th><th class="num">יתרה מצטברת</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot>
    <tr class="foot-row">
      <td colspan="3" style="color:#6B7280;font-size:13px">סיכום תקופה</td>
      <td style="text-align:left;color:#A16207">${formatILS(totalDebit)}</td>
      <td style="text-align:left;color:#166534">${formatILS(totalCredit)}</td>
      <td style="text-align:left;color:#D32F4A;font-size:15px">${formatILS(finalBalance)}</td>
    </tr>
  </tfoot>
</table>
</body></html>`

    const w = window.open('', '_blank', 'width=1000,height=750')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading && suppliersData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#D32F4A' }} />
      </div>
    )
  }

  if (!supplier) return null

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-right">
          <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>כרטסת ספק</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: '15px' }}>כרטסת עסקאות מפורטת לפי ספק ותקופה</p>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 rounded-xl font-semibold transition-all"
          style={{ minHeight: '44px', padding: '0 18px', background: '#FDF2F4', color: '#D32F4A', fontSize: '16px' }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#FFE4E2')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#FDF2F4')}
        >
          <Printer className="w-4 h-4" />
          הדפסה
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border p-5" style={{ borderColor: '#EEEEF2' }}>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: '1fr 160px 160px' }}
        >
          {/* Supplier dropdown */}
          <div>
            <p className="text-right mb-1.5" style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>ספק</p>
            <SearchableSelect
              value={selectedSupplierId}
              onChange={setSelectedSupplierId}
              placeholder="בחר ספק"
              options={suppliersData.map(s => ({
                value: s.id,
                label: s.name,
                keywords: (s as { hp?: string }).hp,
              }))}
              style={{ height: '44px', fontSize: '16px', borderRadius: '12px' }}
            />
          </div>

          {/* From date */}
          <div>
            <p className="text-right mb-1.5" style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>מתאריך</p>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              style={{
                height: '44px', width: '100%', padding: '0 12px', fontSize: '15px',
                border: '1px solid #EEEEF2', borderRadius: '12px', outline: 'none',
                background: 'white', direction: 'ltr',
              }}
              onFocus={e => (e.target.style.borderColor = '#D32F4A')}
              onBlur={e  => (e.target.style.borderColor = '#EEEEF2')}
            />
          </div>

          {/* To date */}
          <div>
            <p className="text-right mb-1.5" style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>עד תאריך</p>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              style={{
                height: '44px', width: '100%', padding: '0 12px', fontSize: '15px',
                border: '1px solid #EEEEF2', borderRadius: '12px', outline: 'none',
                background: 'white', direction: 'ltr',
              }}
              onFocus={e => (e.target.style.borderColor = '#D32F4A')}
              onBlur={e  => (e.target.style.borderColor = '#EEEEF2')}
            />
          </div>
        </div>
      </div>

      {/* Ledger table card */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>

        {/* Card header */}
        <SectionHeader
          className="px-5 py-4 border-b"
          style={{ borderColor: '#F5EEEE' }}
          action={<><BookOpen className="w-4 h-4 text-gray-400" /><span className="text-gray-400" style={{ fontSize: '13px' }}>{inPeriod.length} תנועות בתקופה</span></>}
          title={<><span className="font-bold text-gray-800" style={{ fontSize: '16px' }}>{supplier.name}</span><BookOpen className="w-4 h-4 text-gray-400" /></>}
        />

        {/* Scrollable table */}
        <div style={{ overflowX: 'auto' }}>

          {/* Column headers */}
          <div
            className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
            style={{ gridTemplateColumns: activeCOL, borderColor: '#EEEEF2', fontSize: '11px', minWidth: isMobile ? '300px' : '660px', padding: '10px 16px' }}
          >
            <span className="text-right">תאריך</span>
            <span className="text-right">תיאור</span>
            {!isMobile && <span className="text-center">סוג</span>}
            {!isMobile && <span className="text-left">חובה</span>}
            {!isMobile && <span className="text-left">זכות</span>}
            <span className="text-left">יתרה</span>
          </div>

          {/* Rows */}
          {displayRows.map((row) => {
            const badge     = typeBadge[row.type] ?? typeBadge['פתיחה']
            const isOpening = row.type === 'פתיחה'
            return (
              <div
                key={row.id}
                className="grid items-center"
                style={{
                  gridTemplateColumns: activeCOL,
                  borderBottom: '1px solid #EEEEF2',
                  background: isOpening ? '#FDF2F4' : undefined,
                  minWidth: isMobile ? '300px' : '660px',
                  minHeight: '56px',
                  padding: '12px 16px',
                }}
              >
                <span className="text-right text-gray-400" style={{ fontSize: '13px' }}>
                  {row.displayDate}
                </span>
                <span className="text-right text-gray-700" style={{ fontSize: '14px' }}>
                  {row.description}
                </span>
                {!isMobile && (
                  <span className="flex justify-center">
                    <span
                      className="rounded-lg font-medium"
                      style={{ fontSize: '11px', padding: '3px 8px', background: badge.bg, color: badge.color }}
                    >
                      {row.type}
                    </span>
                  </span>
                )}
                {!isMobile && (
                  <span className="text-left font-medium" style={{ color: '#A16207', fontSize: '14px' }}>
                    {row.debit > 0 ? formatILS(row.debit) : '—'}
                  </span>
                )}
                {!isMobile && (
                  <span className="text-left font-medium" style={{ color: '#166534', fontSize: '14px' }}>
                    {row.credit > 0 ? formatILS(row.credit) : '—'}
                  </span>
                )}
                <span className="text-left font-semibold" style={{ fontSize: '15px', color: isOpening ? '#6B7280' : '#1F2937' }}>
                  {formatILS(row.runningBalance)}
                </span>
              </div>
            )
          })}

          {/* Summary row */}
          <div
            className="grid items-center"
            style={{ gridTemplateColumns: activeCOL, borderTop: '2px solid #D32F4A', background: '#FDF2F4', minWidth: isMobile ? '300px' : '660px', padding: '12px 16px' }}
          >
            <div style={{ gridColumn: isMobile ? 'span 1' : 'span 3', textAlign: 'right' }}>
              <span className="font-bold" style={{ fontSize: '13px', color: '#6B7280' }}>סיכום תקופה</span>
            </div>
            {!isMobile && (
              <span className="text-left font-semibold" style={{ color: '#A16207', fontSize: '15px' }}>
                {formatILS(totalDebit)}
              </span>
            )}
            {!isMobile && (
              <span className="text-left font-semibold" style={{ color: '#166534', fontSize: '15px' }}>
                {formatILS(totalCredit)}
              </span>
            )}
            <span className="text-left font-semibold" style={{ color: '#D32F4A', fontSize: '16px' }}>
              {formatILS(finalBalance)}
            </span>
          </div>

        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#EEEEF2' }}>
          <p style={{ fontSize: '11px', color: '#A16207', fontWeight: 600, marginBottom: '6px' }}>סה"כ חובה</p>
          <p className="text-2xl" style={{ fontWeight: 500, color: '#A16207' }}>{formatILS(totalDebit)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#EEEEF2' }}>
          <p style={{ fontSize: '11px', color: '#166534', fontWeight: 600, marginBottom: '6px' }}>סה"כ זכות</p>
          <p className="text-2xl" style={{ fontWeight: 500, color: '#166534' }}>{formatILS(totalCredit)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#EEEEF2' }}>
          <p style={{ fontSize: '11px', color: '#D32F4A', fontWeight: 600, marginBottom: '6px' }}>יתרה סופית</p>
          <p className="text-2xl" style={{ fontWeight: 500, color: '#D32F4A' }}>{formatILS(finalBalance)}</p>
        </div>
      </div>

    </div>
  )
}
