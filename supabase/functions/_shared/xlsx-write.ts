// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  xlsx-write (shared)                                                      ║
// ║  Writes a multi-sheet .xlsx from rows of plain values. No dependencies.    ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// WHY HAND-ROLLED INSTEAD OF SheetJS.
// The weekly backup has to produce a readable workbook on a runtime nobody here
// can try: this repo has no precedent for a heavy ESM dependency in an edge
// function, and the one candidate (SheetJS from a CDN) branches on node built-ins
// that the edge runtime only shims. "Probably loads" is not a basis for the half
// of a backup a person actually opens.
//
// An .xlsx is a ZIP of XML. Writing one is ~200 lines of known-shape output that
// can be verified from this machine by reading the result back with a real
// spreadsheet library — which is exactly what was done. That trade (more lines,
// zero unverifiable dependencies) is the right way round for a backup.
//
// Compression is an OPTIMISATION, not a requirement: CompressionStream
// ('deflate-raw') is used when the runtime has it, and entries are stored
// uncompressed when it does not. Both are valid ZIPs, so a missing API makes the
// file bigger and never makes it unreadable.
//
// Deliberately NOT supported, because the backup has no use for it: formulas,
// styling beyond a bold header row, merged cells, dates as Excel serials (an ISO
// string is unambiguous and cannot be mis-shifted by a timezone).

/** Excel's own hard limits, asserted rather than discovered in a corrupt file. */
export const XLSX_MAX_ROWS_PER_SHEET = 1_048_576;
export const XLSX_MAX_CELL_CHARS     = 32_767;
/** Appended to a value this cut short, so a truncated cell can never read as whole. */
export const TRUNCATION_MARK = "…[נחתך]";

export interface SheetSpec {
  /** ≤31 chars, unique, none of [ ] : * ? / \ */
  name: string;
  /** First row, rendered bold. */
  header: string[];
  /** Body. `null` / `undefined` produce an EMPTY cell, never the text "null". */
  rows: (string | number | boolean | null | undefined)[][];
}

// ── XML ─────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    // XML 1.0 forbids most control characters outright — they cannot be escaped,
    // only dropped, and a single stray 0x00 from a text column would make the
    // whole workbook unopenable. Tab / LF / CR are legal and kept.
    else if (code < 0x20 && ch !== "\t" && ch !== "\n" && ch !== "\r") continue;
    else out += ch;
  }
  return out;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1, out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(ref: string, value: SheetSpec["rows"][number][number], bold: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  const style = bold ? ' s="1"' : "";

  if (typeof value === "number") {
    // NaN / Infinity have no numeric representation in a sheet; write what the
    // value actually was rather than a number that is not the value.
    if (!Number.isFinite(value)) {
      return `<c r="${ref}"${style} t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`;
    }
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  let text = value;
  if (text.length > XLSX_MAX_CELL_CHARS) {
    text = text.slice(0, XLSX_MAX_CELL_CHARS - TRUNCATION_MARK.length) + TRUNCATION_MARK;
  }
  // xml:space="preserve" or Excel eats leading/trailing whitespace.
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function sheetXml(sheet: SheetSpec): string {
  const total = sheet.rows.length + 1;
  if (total > XLSX_MAX_ROWS_PER_SHEET) {
    throw new Error(
      `sheet "${sheet.name}" has ${total} rows, over Excel's limit of ${XLSX_MAX_ROWS_PER_SHEET}`,
    );
  }

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    // rightToLeft: a Hebrew workbook that opens left-to-right reads wrong, and
    // the first column of a backup is the one you look at.
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    "<sheetData>",
  ];

  const headerCells = sheet.header
    .map((h, c) => cellXml(`${columnLetter(c)}1`, h, true))
    .join("");
  parts.push(`<row r="1">${headerCells}</row>`);

  for (let r = 0; r < sheet.rows.length; r++) {
    const rowNum = r + 2;
    const cells = sheet.rows[r]
      .map((v, c) => cellXml(`${columnLetter(c)}${rowNum}`, v, false))
      .join("");
    // An all-empty row still needs its <row> element so row numbers keep lining
    // up with the data; a skipped row would silently shift everything below it.
    parts.push(`<row r="${rowNum}">${cells}</row>`);
  }

  parts.push("</sheetData></worksheet>");
  return parts.join("");
}

// ── ZIP ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** deflate-raw where the runtime has it; otherwise the bytes unchanged (STORE). */
async function deflateRaw(bytes: Uint8Array): Promise<{ data: Uint8Array; method: 0 | 8 }> {
  const Compression = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!Compression) return { data: bytes, method: 0 };
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Compression("deflate-raw"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    // A tiny entry can "compress" larger than it started; storing is then both
    // smaller and simpler, and the reader cannot tell the difference.
    return packed.length < bytes.length ? { data: packed, method: 8 } : { data: bytes, method: 0 };
  } catch {
    return { data: bytes, method: 0 };
  }
}

interface ZipEntry { name: string; bytes: Uint8Array }

function u16(v: number): number[] { return [v & 0xFF, (v >>> 8) & 0xFF] }
function u32(v: number): number[] { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF] }

async function buildZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;

  // Every entry name here is pure ASCII (xl/worksheets/sheet1.xml and friends),
  // so no UTF-8 name flag is needed. A non-ASCII name would require bit 11 set.
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const { data, method } = await deflateRaw(entry.bytes);
    const crc = crc32(entry.bytes);

    const local = [
      ...u32(0x04034B50), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0),                        // mtime/mdate — fixed, see below
      ...u32(crc), ...u32(data.length), ...u32(entry.bytes.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    chunks.push(new Uint8Array(local), nameBytes, data);

    central.push(
      ...u32(0x02014B50), ...u16(20), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(entry.bytes.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...Array.from(nameBytes),
    );
    offset += local.length + nameBytes.length + data.length;
  }

  const centralBytes = new Uint8Array(central);
  const end = new Uint8Array([
    ...u32(0x06054B50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralBytes.length), ...u32(offset), ...u16(0),
  ]);

  // The entry timestamps are left at zero on purpose: the only thing a real
  // mtime would add is a reason for two backups of identical data to differ.
  chunks.push(centralBytes, end);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out;
}

// ── Workbook ────────────────────────────────────────────────────────────────

const CONTENT_TYPES = (count: number) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  Array.from({ length: count }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("") +
  "</Types>";

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

// Two fonts, one style: index 0 plain, index 1 bold (the header row).
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  "</cellXfs></styleSheet>";

/**
 * Builds the .xlsx. Sheet names are validated here rather than trusted: an
 * over-long or duplicate name is a file Excel refuses to open at all, which
 * would be discovered by the one person opening the backup in an emergency.
 */
export async function writeXlsx(sheets: SheetSpec[]): Promise<Uint8Array> {
  if (!sheets.length) throw new Error("writeXlsx: no sheets");

  const seen = new Set<string>();
  for (const s of sheets) {
    if ([...s.name].length > 31) throw new Error(`sheet name over 31 chars: ${s.name}`);
    if (/[[\]:*?/\\]/.test(s.name)) throw new Error(`sheet name has a forbidden char: ${s.name}`);
    const key = s.name.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate sheet name: ${s.name}`);
    seen.add(key);
  }

  const enc = new TextEncoder();
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s, i) =>
      `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml",       bytes: enc.encode(CONTENT_TYPES(sheets.length)) },
    { name: "_rels/.rels",               bytes: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml",           bytes: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode(workbookRels) },
    { name: "xl/styles.xml",             bytes: enc.encode(STYLES) },
  ];
  for (let i = 0; i < sheets.length; i++) {
    entries.push({
      name:  `xl/worksheets/sheet${i + 1}.xml`,
      bytes: enc.encode(sheetXml(sheets[i])),
    });
  }

  return buildZip(entries);
}
