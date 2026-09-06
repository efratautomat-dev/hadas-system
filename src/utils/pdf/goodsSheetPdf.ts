import { escHtml, openPrintWindow } from './pdfConfig'

// ── The blank goods sheet ────────────────────────────────────────────────────
//
// The printed half of the owner's decision: employees fill a FIXED form by hand —
// item and quantity — and photograph it. The fixed shape is what makes the reading
// reliable, so the sheet is a real artefact rather than a suggestion.
//
// Two things are on it that are NOT for the employee to fill:
//
//   the supplier — printed when the sheet is printed from a supplier's card, so
//                  the page in her hand already says whose goods it is. It is
//                  never read back off the photo; the card is the answer.
//   the date     — stamped at capture.
//
// The instruction line says so, because a sheet that invites writing a supplier
// gets one written on it, and the system will ignore it silently. Telling her up
// front costs a line; discovering it costs a delivery filed to nobody.

export function printGoodsSheet(opts: { supplierName?: string; rows?: number } = {}): void {
  const supplier = opts.supplierName?.trim() ?? ''
  // Enough lines for a normal delivery, and few enough that the boxes stay big
  // enough to write in — a cramped grid is what produces handwriting nothing can
  // read.
  const rows = opts.rows ?? 16

  const body = Array.from({ length: rows })
    .map(() => '<tr><td class="item"></td><td class="qty"></td><td class="price"></td></tr>')
    .join('')

  openPrintWindow(`<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>קליטת סחורה</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Heebo', Arial, sans-serif; color: #1F2125; margin: 0; }
  .head { border-bottom: 2px solid #1F2125; padding-bottom: 10px; margin-bottom: 4px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sup { font-size: 15px; font-weight: 700; }
  .sup .blank { display: inline-block; min-width: 220px; border-bottom: 1px solid #9CA3AF; }
  .note { font-size: 12px; color: #6B6E73; margin: 6px 0 14px; }
  .note b { color: #1F2125; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 12px; text-align: right; padding: 7px 10px; background: #F3F4F6;
       border: 1px solid #9CA3AF; }
  td { border: 1px solid #C9CBD2; height: 30px; }
  td.qty   { width: 80px; border-inline-start: 1px solid #9CA3AF; }
  td.price { width: 90px; border-inline-start: 1px solid #9CA3AF; }
  .foot { margin-top: 14px; font-size: 11px; color: #9CA3AF; display: flex;
          justify-content: space-between; }
  @media print { .noprint { display: none; } }
</style></head>
<body onload="window.print()">
  <div class="head">
    <h1>קליטת סחורה</h1>
    <div class="sup">ספק: ${supplier ? escHtml(supplier) : '<span class="blank"></span>'}</div>
  </div>
  <p class="note">
    למלא <b>פריטים, כמויות, ומחיר עלות אם הוא מופיע על הסחורה</b>.
    עמודת המחיר לא חובה — משאירים ריק כשאין.
    אין צורך לרשום תאריך — הוא נרשם בצילום${
      supplier ? ', והספק כבר מודפס למעלה' : ''
    }.
  </p>
  <table>
    <thead><tr><th>פריט</th><th class="qty">כמות</th><th class="price">מחיר עלות</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">
    <span>נקלט ע"י: ____________________</span>
    <span>לצילום מתוך כרטיס הספק במערכת</span>
  </div>
</body></html>`)
}
