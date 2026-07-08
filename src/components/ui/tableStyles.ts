import type { CSSProperties } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Shared DATA-TABLE style tokens — the single source of the unified table look
// (reference: the Suppliers table). Every screen's grid-"table" (Invoices,
// Payments, Returns, DeliveryNotes, StatementReconciliation) spreads these onto
// its header/rows so headers, spacing, separators and hover are pixel-identical.
// Columns (gridTemplateColumns) and minWidth stay per-screen — spread them in
// alongside these tokens. Status colors keep coming from <StatusBadge/>.
// ─────────────────────────────────────────────────────────────────────────────

// Outer wrapper: white surface, hairline border, 16px radius, soft shadow,
// horizontal scroll so wide tables never break the page.
export const tableWrap: CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #EEEEF2',
  borderRadius: '16px',
  boxShadow: '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)',
  overflowX: 'auto',
}

// Header row container — spread with { gridTemplateColumns, minWidth, display:'grid' }.
export const tableHeadRow: CSSProperties = {
  background: '#FAFAFC',
  borderBottom: '1px solid #EEEEF2',
  padding: '13px 20px',
  textAlign: 'right',
}

// Header cell text.
export const tableHeadCell: CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#8A8D94',
  whiteSpace: 'nowrap',
}

// Data row container — spread with { gridTemplateColumns, minWidth, display:'grid' }.
// Pass first=true on the first row to drop its top separator.
export const tableRow = (first = false): CSSProperties => ({
  padding: '13px 20px',
  borderTop: first ? undefined : '1px solid #F1F2F4',
  textAlign: 'right',
})

// Row hover background — set on mouseenter, clear ('transparent') on mouseleave.
export const TABLE_HOVER = '#FAFAFC'

// Common cell text styles.
export const tableCellStrong: CSSProperties = { fontSize: '15px', fontWeight: 600, color: '#12131A' }
export const tableCellMuted:  CSSProperties = { fontSize: '13px', color: '#6B7280' }
export const tableCellSubtle: CSSProperties = { fontSize: '12px', color: '#9CA3AF' }
