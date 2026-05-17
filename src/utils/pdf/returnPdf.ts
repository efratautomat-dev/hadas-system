import { PDF_BASE_CSS, getPdfLogoUrl, fmtILS, todayHebrew, escHtml, openPrintWindow } from './pdfConfig'

export interface ReturnPDFData {
  id: string
  date: string           // DD/MM/YYYY
  dateIso: string        // YYYY-MM-DD
  status: string
  amount: number
  reason: string
  detail: string
  originalInvoiceId: string | null
  createdBy: string
  supplierName: string
  supplierHp?: string
  supplierContact?: string
  supplierPhone?: string
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  'אושר':   { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#FEF3C7', color: '#D97706' },
  'נדחה':   { bg: '#FEE2E2', color: '#DC2626' },
}

export function printReturnPDF(data: ReturnPDFData): void {
  const logoUrl = getPdfLogoUrl()
  const today   = todayHebrew()
  const st      = STATUS_STYLE[data.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
  const title   = `חזרה-${data.id}-${data.dateIso}`

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;900&display=swap" rel="stylesheet">
  <style>
    ${PDF_BASE_CSS}
    .amount-box { background: #FDF2F4; border: 1px solid #FECDD3; border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; }
    .amount-big { font-size: 26px; font-weight: 900; color: #D32F4A; direction: ltr; }
    .sig-line   { border-bottom: 1px solid #9CA3AF; height: 36px; margin-top: 8px; width: 55%; }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="hdr">
    <div>
      <p class="doc-title">מסמך חזרה</p>
      <p class="doc-sub">הדס - ניהול ספקים</p>
    </div>
    <img src="${logoUrl}" class="logo" alt="לוגו" onerror="this.style.display='none'"/>
  </div>

  <!-- Section 1: Document Info -->
  <div class="sec">
    <p class="sec-title">פרטי מסמך</p>
    <div class="grid3">
      <div>
        <p class="lbl">מספר חזרה</p>
        <p class="val" style="direction:ltr;text-align:right">${escHtml(data.id)}</p>
      </div>
      <div>
        <p class="lbl">תאריך</p>
        <p class="val">${escHtml(data.date)}</p>
      </div>
      <div>
        <p class="lbl">סטטוס</p>
        <span style="display:inline-block;padding:3px 10px;border-radius:7px;font-size:12px;font-weight:700;background:${st.bg};color:${st.color}">
          ${escHtml(data.status)}
        </span>
      </div>
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

  <!-- Section 3: Return Details -->
  <div class="sec">
    <p class="sec-title">פרטי החזרה</p>
    <div class="amount-box">
      <p class="lbl" style="margin:0">סכום החזרה</p>
      <p class="amount-big">${fmtILS(data.amount)}</p>
    </div>
    <div class="grid2" style="margin-bottom:12px">
      <div><p class="lbl">סיבה</p><p class="val">${escHtml(data.reason)}</p></div>
      ${data.originalInvoiceId
        ? `<div><p class="lbl">חשבונית קשורה</p><p class="val" style="direction:ltr;text-align:right">${escHtml(data.originalInvoiceId)}</p></div>`
        : '<div></div>'}
    </div>
    ${data.detail
      ? `<div><p class="lbl">פירוט</p><p class="val" style="line-height:1.7;margin-top:2px">${escHtml(data.detail)}</p></div>`
      : ''}
  </div>

  <!-- Section 4: Signature -->
  <div class="sec">
    <p class="sec-title">חתימה ואישור</p>
    <div class="grid2" style="margin-bottom:14px">
      <div><p class="lbl">נוצר על ידי</p><p class="val">${escHtml(data.createdBy || '—')}</p></div>
      <div><p class="lbl">תאריך הפקה</p><p class="val">${today}</p></div>
    </div>
    <p class="lbl">חתימה</p>
    <div class="sig-line"></div>
  </div>

  <!-- Footer -->
  <div class="footer">מסמך זה הופק אוטומטית ממערכת הדס בתאריך ${today}</div>

  <script>
    document.fonts.ready.then(function() { setTimeout(function() { window.print() }, 400) })
  </script>
</body>
</html>`

  openPrintWindow(html)
}
