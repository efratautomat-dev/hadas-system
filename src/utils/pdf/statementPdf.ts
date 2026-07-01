import { PDF_BASE_CSS, getPdfLogoUrl, fmtILS, todayHebrew, escHtml, openPrintWindow } from './pdfConfig'

export interface StatementActivityRow {
  date: string
  type: string
  docId: string
  description: string
  debit: number
  credit: number
}

export interface StatementPDFData {
  id: string
  month: string
  status: string
  our_balance: number
  vendor_balance: number | null
  diff: number
  uploaded_at: string
  supplierName: string
  supplierHp?: string
  supplierContact?: string
  supplierPhone?: string
  activityRows?: StatementActivityRow[]
  notes?: string
}

const STATUS_HE: Record<string, string> = {
  matched:       'תואם',
  mismatch:      'אי-התאמה',
  pending:       'ממתין',
  investigating: 'בבדיקה',
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  matched:       { bg: '#DCFCE7', color: '#166534' },
  mismatch:      { bg: '#FEE2E2', color: '#DC2626' },
  pending:       { bg: '#FEF9C3', color: '#A16207' },
  investigating: { bg: '#DBEAFE', color: '#1E40AF' },
}

export function printStatementPDF(data: StatementPDFData): void {
  const logoUrl   = getPdfLogoUrl()
  const today     = todayHebrew()
  const st        = STATUS_STYLE[data.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
  const statusHe  = STATUS_HE[data.status] ?? data.status
  const suppSlug  = data.supplierName.replace(/[^א-תa-zA-Z0-9]/g, '-')
  const title     = `התאמת-כרטסת-${data.id}-ספק-${suppSlug}-${data.month.replace('/', '-')}`

  const activityTable = buildActivityTable(data.activityRows)

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;900&display=swap" rel="stylesheet">
  <style>
    ${PDF_BASE_CSS}
    .balance-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 10px; margin-bottom: 4px; }
    .balance-card { border: 1px solid #EEEEF2; border-radius: 10px; padding: 10px 12px; }
    .balance-lbl  { font-size: 10px; color: #9CA3AF; font-weight: 600; margin-bottom: 4px; }
    .balance-val  { font-size: 15px; font-weight: 700; color: #1F2937; direction: ltr; text-align: right; }
    .tbl          { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tbl thead tr { background: #D32F4A; }
    .tbl th       { padding: 8px 10px; color: white; font-weight: 700; text-align: right; font-size: 11px; }
    .tbl th.num   { text-align: left; }
    .tbl td       { padding: 8px 10px; border-bottom: 1px solid #EEEEF2; vertical-align: middle; }
    .tbl td.num   { text-align: left; font-weight: 500; }
    .tbl tr:nth-child(even) td { background: #FAFAFC; }
    .tbl tfoot tr td { background: #FDF2F4; font-weight: 700; border-top: 2px solid #D32F4A; }
    .type-badge   { display: inline-block; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="hdr">
    <div>
      <p class="doc-title">התאמת כרטסת</p>
      <p class="doc-sub">${escHtml(data.supplierName)} · ${escHtml(data.month)}</p>
    </div>
    <img src="${logoUrl}" class="logo" alt="לוגו" onerror="this.style.display='none'"/>
  </div>

  <!-- Section 1: Document Info -->
  <div class="sec">
    <p class="sec-title">פרטי מסמך</p>
    <div class="grid3">
      <div>
        <p class="lbl">מספר מסמך</p>
        <p class="val" style="direction:ltr;text-align:right">${escHtml(data.id)}</p>
      </div>
      <div>
        <p class="lbl">תקופה</p>
        <p class="val">${escHtml(data.month)}</p>
      </div>
      <div>
        <p class="lbl">סטטוס</p>
        <span style="display:inline-block;padding:3px 10px;border-radius:7px;font-size:12px;font-weight:700;background:${st.bg};color:${st.color}">
          ${escHtml(statusHe)}
        </span>
      </div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div><p class="lbl">תאריך הפקה</p><p class="val">${today}</p></div>
      <div><p class="lbl">תאריך העלאה</p><p class="val">${escHtml(data.uploaded_at || '—')}</p></div>
    </div>
  </div>

  <!-- Section 2: Supplier -->
  <div class="sec">
    <p class="sec-title">פרטי ספק</p>
    <div class="grid2">
      <div><p class="lbl">שם הספק</p><p class="val">${escHtml(data.supplierName)}</p></div>
      ${data.supplierHp
        ? `<div><p class="lbl">מספר עוסק</p><p class="val">${escHtml(data.supplierHp)}</p></div>`
        : '<div></div>'}
      ${data.supplierContact
        ? `<div><p class="lbl">איש קשר</p><p class="val">${escHtml(data.supplierContact)}</p></div>`
        : '<div></div>'}
      ${data.supplierPhone
        ? `<div><p class="lbl">טלפון</p><p class="val" style="direction:ltr;text-align:right">${escHtml(data.supplierPhone)}</p></div>`
        : '<div></div>'}
    </div>
  </div>

  <!-- Section 3: Balance Summary -->
  <div class="sec">
    <p class="sec-title">סיכום יתרות</p>
    <div class="balance-grid">
      <div class="balance-card">
        <p class="balance-lbl">יתרה שלנו</p>
        <p class="balance-val">${fmtILS(data.our_balance)}</p>
      </div>
      <div class="balance-card">
        <p class="balance-lbl">יתרת ספק</p>
        <p class="balance-val">${data.vendor_balance != null ? fmtILS(data.vendor_balance) : '—'}</p>
      </div>
      <div class="balance-card">
        <p class="balance-lbl">הפרש</p>
        <p class="balance-val" style="color:${data.diff > 0 ? '#DC2626' : data.diff < 0 ? '#1E40AF' : '#166534'}">
          ${data.diff !== 0 ? fmtILS(data.diff) : '—'}
        </p>
      </div>
      <div class="balance-card" style="grid-column:span 2">
        <p class="balance-lbl">סטטוס התאמה</p>
        <p class="balance-val">${escHtml(statusHe)}</p>
      </div>
    </div>
  </div>

  ${activityTable}

  ${data.notes
    ? `<div class="sec">
        <p class="sec-title">הערות</p>
        <p class="val" style="line-height:1.7">${escHtml(data.notes)}</p>
      </div>`
    : ''}

  <!-- Footer -->
  <div class="footer">מסמך זה הופק אוטומטית ממערכת הדס בתאריך ${today}</div>

  <script>
    document.fonts.ready.then(function() { setTimeout(function() { window.print() }, 400) })
  </script>
</body>
</html>`

  openPrintWindow(html)
}

const TYPE_BADGE: Record<string, { bg: string; color: string }> = {
  'חשבונית': { bg: '#FEF9C3', color: '#A16207' },
  'תשלום':   { bg: '#DCFCE7', color: '#166534' },
  'חזרה':    { bg: '#DBEAFE', color: '#1E40AF' },
  'זיכוי':   { bg: '#F3E8FF', color: '#7C3AED' },
}

function buildActivityTable(rows: StatementActivityRow[] | undefined): string {
  if (!rows || rows.length === 0) return ''

  let runningBalance = 0
  const rowsHtml = rows.map(row => {
    runningBalance += row.debit - row.credit
    const tb = TYPE_BADGE[row.type] ?? { bg: '#F3F4F6', color: '#6B7280' }
    return `<tr>
      <td>${escHtml(row.date)}</td>
      <td><span class="type-badge" style="background:${tb.bg};color:${tb.color}">${escHtml(row.type)}</span></td>
      <td style="direction:ltr;text-align:right">${escHtml(row.docId)}</td>
      <td>${escHtml(row.description)}</td>
      <td class="num" style="color:#A16207">${row.debit > 0 ? fmtILS(row.debit) : '—'}</td>
      <td class="num" style="color:#166534">${row.credit > 0 ? fmtILS(row.credit) : '—'}</td>
      <td class="num" style="font-weight:700">${fmtILS(runningBalance)}</td>
    </tr>`
  }).join('')

  return `<div class="sec">
    <p class="sec-title">פירוט תנועות בתקופה</p>
    <table class="tbl">
      <thead>
        <tr>
          <th>תאריך</th>
          <th>סוג</th>
          <th>מס׳ מסמך</th>
          <th>תיאור</th>
          <th class="num">חיוב</th>
          <th class="num">זיכוי</th>
          <th class="num">יתרה רצה</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="color:#6B7280;font-size:12px">סה"כ</td>
          <td class="num" style="color:#A16207">${fmtILS(rows.reduce((s, r) => s + r.debit, 0))}</td>
          <td class="num" style="color:#166534">${fmtILS(rows.reduce((s, r) => s + r.credit, 0))}</td>
          <td class="num" style="color:#D32F4A;font-size:14px">${fmtILS(runningBalance)}</td>
        </tr>
      </tfoot>
    </table>
  </div>`
}
