// Bizibox export template.
//
// WHY THIS EXISTS
// The export used to build a workbook from scratch — `new Workbook()`, one sheet,
// six header cells. That produced a file that LOOKS like Bizibox's template but
// shares none of its workbook metadata. Bizibox rejected rows from it (checks
// imported, bank transfers did not); pasting the very same rows into a freshly
// downloaded Bizibox template imported all of them. So the discriminator is the
// WORKBOOK, not the row values.
//
// Bizibox also revises its template over time, which is what makes a bundled
// copy go stale. Therefore:
//   1. The export FILLS the real template instead of imitating it.
//   2. The template is fetched from Storage first, so a new one can be uploaded
//      from Settings without a code change or a deploy.
//   3. The copy bundled in `public/` is the fallback, so the export never breaks
//      if Storage is empty or unreachable.

import ExcelJS from 'exceljs'
import { supabase } from './supabase'

/** Storage bucket + path holding the owner-uploaded template. */
export const TEMPLATE_BUCKET = 'branding'
export const TEMPLATE_PATH   = 'bizbox-template.xlsx'

/** The copy that ships with the app, used when Storage has none. */
export const BUNDLED_TEMPLATE_URL = '/add_tazrim_template.xlsx'

export interface LoadedTemplate {
  /** The template file exactly as stored — the export writes rows INTO these
   *  bytes rather than re-serialising a parsed workbook (see lib/bizboxWrite). */
  bytes: ArrayBuffer
  /** 1-based index of the header row; data starts at headerRow + 1. */
  headerRow: number
  /** Header labels, in the template's own order — the export writes to match. */
  headers: string[]
  /** Where the template came from, for the UI to report honestly. */
  source: 'uploaded' | 'bundled'
}

// The header cell that identifies the row Bizibox reads its columns from. Any of
// these marks the header row, so a renamed column elsewhere doesn't break detection.
const HEADER_MARKERS = ['סוג_פעולה', 'סוג פעולה', 'סוג_תשלום']

function findHeaderRow(sheet: ExcelJS.Worksheet): { row: number; headers: string[] } {
  // Scan the first few rows — some templates carry a title or a blank line above
  // the headers.
  for (let r = 1; r <= Math.min(10, sheet.rowCount || 10); r++) {
    const values = (sheet.getRow(r).values as unknown[]).slice(1)
      .map(v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v)))
    if (values.some(v => HEADER_MARKERS.includes(String(v)))) {
      // Trim trailing blanks so the column count matches the real header.
      while (values.length && !values[values.length - 1]) values.pop()
      return { row: r, headers: values.map(String) }
    }
  }
  throw new Error('לא נמצאה שורת כותרות בטמפליט — ודאי שהקובץ הוא טמפליט ביזיבוקס תקין')
}

async function fetchUploadedTemplate(): Promise<ArrayBuffer | null> {
  try {
    const { data, error } = await supabase.storage.from(TEMPLATE_BUCKET).download(TEMPLATE_PATH)
    if (error || !data) return null
    return await data.arrayBuffer()
  } catch {
    // Storage unreachable / bucket missing — fall back rather than fail the export.
    return null
  }
}

/**
 * Load the Bizibox template, preferring an uploaded one over the bundled copy.
 * Throws only when NEITHER can be read — at that point the export genuinely
 * cannot produce a valid file and must say so rather than emit a broken one.
 */
export async function loadBizboxTemplate(): Promise<LoadedTemplate> {
  let source: LoadedTemplate['source'] = 'uploaded'
  let buf = await fetchUploadedTemplate()

  if (!buf) {
    source = 'bundled'
    const res = await fetch(BUNDLED_TEMPLATE_URL)
    if (!res.ok) throw new Error(`לא ניתן לטעון את טמפליט ביזיבוקס (${res.status})`)
    buf = await res.arrayBuffer()
  }

  // ExcelJS is used to READ the header layout only. Writing goes through
  // lib/bizboxWrite, which edits the original bytes — an ExcelJS round-trip
  // corrupts the template's data-validation ranges and drops its drawings.
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buf.slice(0))

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('טמפליט ביזיבוקס ריק — אין בו גיליונות')

  const { row, headers } = findHeaderRow(sheet)
  return { bytes: buf, headerRow: row, headers, source }
}

/**
 * Validate a file the owner is about to upload as the new template: it must be a
 * readable workbook with a recognisable header row. Returns the headers so the
 * UI can show what was detected — an upload that silently replaces the template
 * with an unusable file would break the export at the worst possible moment.
 */
export async function inspectTemplateFile(file: File): Promise<{ headers: string[]; sheetName: string }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('הקובץ ריק — אין בו גיליונות')
  const { headers } = findHeaderRow(sheet)
  return { headers, sheetName: sheet.name }
}
