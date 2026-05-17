export const PDF_BRAND       = '#D32F4A'
export const PDF_BRAND_LIGHT = '#FDF2F4'
export const PDF_DIVIDER     = '#EEEEF2'
export const PDF_GRAY_1      = '#1F2937'
export const PDF_GRAY_4      = '#6B7280'
export const PDF_GRAY_5      = '#9CA3AF'

export function getPdfLogoUrl(): string {
  return `${window.location.origin}/store-logo.png.jpeg`
}

export function fmtILS(n: number | null | undefined): string {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

export function todayHebrew(): string {
  return new Date().toLocaleDateString('he-IL', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

export const PDF_BASE_CSS = `
  * { box-sizing: border-box; font-family: 'Rubik', Arial, sans-serif; margin: 0; padding: 0; }
  body { padding: 18mm 20mm; color: #1F2937; direction: rtl; background: white; font-size: 14px; line-height: 1.5; }
  @page { size: A4; margin: 0; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .hdr { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 14px; margin-bottom: 22px; border-bottom: 2px solid #D32F4A; }
  .logo { height: 50px; object-fit: contain; }
  .doc-title { font-size: 26px; font-weight: 900; color: #D32F4A; }
  .doc-sub { font-size: 13px; color: #6B7280; margin-top: 3px; }
  .sec { margin-bottom: 20px; }
  .sec-title { font-size: 10px; font-weight: 700; color: #D32F4A; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #EEEEF2; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .grid4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 14px; }
  .lbl { font-size: 11px; color: #9CA3AF; font-weight: 600; margin-bottom: 2px; }
  .val { font-size: 14px; color: #1F2937; font-weight: 500; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #EEEEF2; font-size: 11px; color: #9CA3AF; text-align: center; }
`

export function escHtml(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function openPrintWindow(html: string): void {
  const w = window.open('', '_blank', 'width=950,height=800')
  if (!w) return
  w.document.write(html)
  w.document.close()
}
