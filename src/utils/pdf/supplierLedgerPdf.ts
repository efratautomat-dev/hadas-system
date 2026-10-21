import { openPrintWindow, PDF_BRAND, PDF_BRAND_LIGHT, escHtml } from './pdfConfig'

// ── The supplier ledger as a document — "הדפסת כרטסת" ─────────────────────────
//
// Moved here from the old "כרטסת ספק" screen when that screen was folded into
// the supplier card (21.10): printing was the one thing only it could do. Same
// document, same rules — in particular the reset rule below.

export interface SupplierLedgerPrintRow {
  displayDate: string
  description: string
  /** 'פתיחה' | 'חשבונית' | 'תשלום' | 'זיכוי' — anything else prints unbadged. */
  type: string
  debit: number
  credit: number
  runningBalance: number
  isReset: boolean
}

const typeBadge: Record<string, { bg: string; color: string }> = {
  'פתיחה':   { bg: '#F3F4F6', color: '#6B7280' },
  'חשבונית': { bg: '#FEF9C3', color: '#A16207' },
  'תשלום':   { bg: '#DCFCE7', color: '#166534' },
  'זיכוי':   { bg: '#DBEAFE', color: '#1E40AF' },
}

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

export function printSupplierLedger(data: {
  supplier: { name: string; contact?: string; phone?: string }
  /** Chronological (oldest first), the opening row included when there is one. */
  rows: SupplierLedgerPrintRow[]
  /** '' = from the beginning / up to today. Display strings, day-first. */
  fromDisplay: string
  toDisplay: string
  /** The balance at the end of what is printed. */
  finalBalance: number
  logoUrl: string
}): void {
  const today = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })

  // ── What the printed ledger shows after a reset ───────────────────────────
  //
  // The owner: "כמובן שבהדפסת כרטסת זה לא יופיע." The reset line is internal —
  // it says the shop's own records got tangled, which is nobody else's business.
  // Dropping only the LINE would print a running balance that jumps for no
  // visible reason, so the print starts AFTER the last reset, opening at 0 —
  // exactly what the reset declared. `rows` is chronological, so that is a suffix.
  const lastReset = data.rows.map(r => r.isReset).lastIndexOf(true)
  const printRows = lastReset === -1 ? data.rows : data.rows.slice(lastReset + 1)
  const printDebit  = printRows.reduce((sum, r) => sum + r.debit, 0)
  const printCredit = printRows.reduce((sum, r) => sum + r.credit, 0)

  const rowsHtml = printRows.map(row => {
    const bs = typeBadge[row.type] ?? typeBadge['פתיחה']
    const isOpening = row.type === 'פתיחה'
    return `<tr style="border-bottom:1px solid #EEEEF2;background:${isOpening ? PDF_BRAND_LIGHT : 'white'}">
      <td style="padding:9px 12px">${escHtml(row.displayDate)}</td>
      <td style="padding:9px 12px">${escHtml(row.description)}</td>
      <td style="padding:9px 6px;text-align:center">
        <span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;background:${bs.bg};color:${bs.color}">${escHtml(row.type)}</span>
      </td>
      <td style="padding:9px 12px;text-align:left;color:#A16207;font-weight:500">${row.debit > 0 ? formatILS(row.debit) : '—'}</td>
      <td style="padding:9px 12px;text-align:left;color:#166534;font-weight:500">${row.credit > 0 ? formatILS(row.credit) : '—'}</td>
      <td style="padding:9px 12px;text-align:left;font-weight:700;color:#1F2937">${formatILS(row.runningBalance)}</td>
    </tr>`
  }).join('')

  const range = data.fromDisplay || data.toDisplay
    ? `${data.fromDisplay || 'מתחילת הכרטסת'} – ${data.toDisplay || 'היום'}`
    : 'כל התקופה'
  const contact = [data.supplier.contact, data.supplier.phone].filter(Boolean).map(escHtml).join(' · ')

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>כרטסת ספק – ${escHtml(data.supplier.name)}</title>
  <style>
    *{box-sizing:border-box;font-family:Arial,sans-serif}
    body{margin:24px;color:#1F2937;direction:rtl}
    .hdr{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;margin-bottom:20px;border-bottom:2px solid ${PDF_BRAND}}
    .logo{height:56px;object-fit:contain}
    table{width:100%;border-collapse:collapse}
    thead tr{background:${PDF_BRAND}}
    th{padding:10px 12px;color:white;font-size:13px;text-align:right;font-weight:600}
    th.num{text-align:left}
    .foot-row{background:${PDF_BRAND_LIGHT};border-top:2px solid ${PDF_BRAND}}
    .foot-row td{padding:10px 12px;font-weight:700}
    @media print{@page{margin:1cm}}
  </style>
</head>
<body>
<div class="hdr">
  <div style="text-align:left;font-size:12px;color:#6B7280;line-height:2">
    <div>תאריך הפקה: <strong>${today}</strong></div>
    <div>טווח תאריכים: <strong>${escHtml(range)}</strong></div>
  </div>
  <div style="text-align:right">
    <div style="font-size:12px;color:#9CA3AF;margin-bottom:4px">כרטסת ספק</div>
    <div style="font-size:22px;font-weight:900;color:${PDF_BRAND}">${escHtml(data.supplier.name)}</div>
    ${contact ? `<div style="font-size:12px;color:#6B7280;margin-top:2px">${contact}</div>` : ''}
  </div>
  <img src="${escHtml(data.logoUrl)}" class="logo" alt="לוגו" onerror="this.style.display='none'"/>
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
      <td style="text-align:left;color:#A16207">${formatILS(printDebit)}</td>
      <td style="text-align:left;color:#166534">${formatILS(printCredit)}</td>
      <td style="text-align:left;color:${PDF_BRAND};font-size:15px">${formatILS(data.finalBalance)}</td>
    </tr>
  </tfoot>
</table>
<script>
    document.fonts.ready.then(function() { setTimeout(function() { window.print() }, 400) })
  </script>
</body></html>`

  openPrintWindow(html)
}
