// Inject payment rows into the Bizibox template WITHOUT rewriting the workbook.
//
// WHY NOT ExcelJS
// Loading the template with ExcelJS and calling writeBuffer() re-serialises the
// whole workbook. Its round-trip is lossy and, worse, wrong in one specific way:
// it expands the template's `dataValidation` ranges to per-cell entries on load
// and re-groups them into OVERLAPPING ranges on write (`A2:A75` alongside
// `A10:A75`). Excel treats overlapping validation ranges as damaged content, and
// the whole point of this change is that Bizibox is sensitive to workbook
// structure. It also dropped the template's drawings.
//
// So we treat the .xlsx as what it is — a zip of XML — and touch exactly one
// part: the rows of the first worksheet. Everything else (validations, styles,
// drawings, the other sheets, content types) is carried over byte-for-byte.

import JSZip from 'jszip'

/** A cell value: text is written inline, numbers as numeric cells. */
export type CellValue = string | number

const COL_LETTERS = (n: number): string => {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel rejects raw control characters in XML — matching them is the point,
    // so the control-character class here is deliberate. A stray control char in
    // a supplier name or a note would otherwise produce a file Excel refuses.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

/**
 * Per-column style indices (the `s="N"` attribute) taken from a template row.
 * The template styles its data cells — column C carries a DATE format — so a
 * written cell must keep the style the template gave that column, or the export
 * silently loses the formatting the template exists to provide.
 */
type StyleMap = Map<number, string>

function stylesOfRow(rowXml: string | undefined): StyleMap {
  const map: StyleMap = new Map()
  if (!rowXml) return map
  for (const m of rowXml.matchAll(/<c\b[^>]*r="([A-Z]+)\d+"[^>]*?\bs="(\d+)"/g)) {
    // Column letter → 1-based index.
    let col = 0
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
    map.set(col, m[2])
  }
  return map
}

/** The template row's own attributes (height, custom formatting) minus `r`, so a
 *  replaced row keeps the shape the template gave it. */
function rowAttrs(rowXml: string | undefined): string {
  if (!rowXml) return ''
  const open = rowXml.match(/<row\b([^>]*?)\/?>/)
  if (!open) return ''
  return open[1].replace(/\s*\br="\d+"/, '').replace(/\/$/, '').trimEnd()
}

function buildRowXml(rowNumber: number, cells: CellValue[], styles: StyleMap, attrs = ''): string {
  const parts = cells.map((v, i) => {
    const col = i + 1
    const ref = `${COL_LETTERS(col)}${rowNumber}`
    const s = styles.get(col)
    const sAttr = s ? ` s="${s}"` : ''
    // An empty value still emits a STYLED empty cell, exactly as the template
    // does — dropping the cell entirely would diverge from the template's shape.
    if (v === '' || v === null || v === undefined) {
      return `<c r="${ref}"${sAttr}/>`
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return `<c r="${ref}"${sAttr}><v>${v}</v></c>`
    }
    // Inline strings keep us out of sharedStrings.xml entirely — no index
    // rewriting, no chance of corrupting the template's existing strings.
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`
  })
  return `<row r="${rowNumber}"${attrs}>${parts.join('')}</row>`
}

/** Name of the first worksheet part, resolved through the workbook relationships. */
async function firstSheetPath(zip: JSZip): Promise<string> {
  const wbXml = await zip.file('xl/workbook.xml')?.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (wbXml && relsXml) {
    const firstSheet = wbXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)
    if (firstSheet) {
      const rel = relsXml.match(new RegExp(`<Relationship[^>]*Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`))
      if (rel) return `xl/${rel[1].replace(/^\/?xl\//, '')}`
    }
  }
  // Fall back to the conventional path.
  return 'xl/worksheets/sheet1.xml'
}

/**
 * Return a copy of `templateBytes` with `rows` written starting at
 * `firstDataRow`. Any pre-existing rows at those numbers are replaced; the rest
 * of the workbook is untouched.
 */
export async function writeRowsIntoTemplate(
  templateBytes: ArrayBuffer,
  rows: CellValue[][],
  firstDataRow: number,
): Promise<Blob> {
  // createFolders:false — the template carries no directory entries and the
  // output must not gain any.
  const zip = await JSZip.loadAsync(templateBytes, { createFolders: false })
  const sheetPath = await firstSheetPath(zip)
  const sheetFile = zip.file(sheetPath)
  if (!sheetFile) throw new Error(`לא נמצא גיליון בטמפליט (${sheetPath})`)

  let xml = await sheetFile.async('string')

  // Rebuild <sheetData> from a number→XML map. Excel requires <row> elements in
  // ASCENDING r order — appending ours at the end produces a file Excel reports
  // as damaged, so existing rows are replaced in place and any new ones are
  // merged into the correct position.
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)
  if (!sheetDataMatch) throw new Error('מבנה הגיליון בטמפליט לא מזוהה — אין בו sheetData')

  const existing = new Map<number, string>()
  const inner = sheetDataMatch[1] ?? ''
  for (const m of inner.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g)) {
    existing.set(Number(m[1]), m[0])
  }

  // Style fallback for rows beyond the ones the template pre-styled: reuse the
  // FIRST data row's styles, which is what the template applies to its own body.
  const fallbackStyles = stylesOfRow(existing.get(firstDataRow))

  // Overwrite the target row numbers — a re-export never leaves a stale row.
  rows.forEach((cells, i) => {
    const n = firstDataRow + i
    const rowStyles = stylesOfRow(existing.get(n))
    // Merge: the row's own styles win, the first data row fills the gaps (its
    // rows 3+ style fewer columns than row 2 does).
    const styles: StyleMap = new Map(fallbackStyles)
    for (const [col, s] of rowStyles) styles.set(col, s)
    existing.set(n, buildRowXml(n, cells, styles, rowAttrs(existing.get(n))))
  })

  const rowsXml = [...existing.keys()].sort((a, b) => a - b)
    .map(n => existing.get(n)!).join('')
  xml = xml.replace(sheetDataMatch[0], `<sheetData>${rowsXml}</sheetData>`)

  // `dimension` tells Excel the used range; leaving a stale one can make it
  // ignore the appended rows.
  const lastRow = firstDataRow + rows.length - 1
  xml = xml.replace(/<dimension\b[^>]*\/>/, (m) => {
    const ref = m.match(/ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/)
    if (!ref) return m
    const endCol = ref[3]
    const endRow = Math.max(Number(ref[4]), lastRow)
    return `<dimension ref="${ref[1]}${ref[2]}:${endCol}${endRow}"/>`
  })

  zip.file(sheetPath, xml)
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  })
}
