import { Plus, Trash2 } from 'lucide-react'
import { newLine, rowTotal, lineAmounts, type Line } from '../../lib/lineItems'
import { vatPercentFor } from '../../lib/vat'

// ── פריטים, כמויות ומחירים ───────────────────────────────────────────────────
//
// One editor, two callers: the typed receipt and the confirmation screen after a
// handwritten sheet is read. They ask for exactly the same three things, and the
// owner asked for the price on both — a free-text box on one and a priced grid on
// the other would have been two ways to record one delivery.
//
// The price column is OPTIONAL by design: goods often arrive with no price on
// them, and a required field you cannot fill is a field people put a zero in.

const CELL: React.CSSProperties = {
  border: 'none', background: 'transparent', padding: '9px 11px',
  fontSize: '13.5px', fontFamily: 'inherit', outline: 'none', width: '100%',
}

export default function LineItemsEditor({
  lines, onChange, isoDate,
}: {
  lines: Line[]
  onChange: (next: Line[]) => void
  /** The delivery's date — the VAT rate is keyed on it, never on today. */
  isoDate?: string | null
}) {
  const amounts = lineAmounts(lines, isoDate)
  const set = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, j) => j === i ? { ...l, ...patch, uncertain: false } : l))

  return (
    <div className="border" style={{ borderColor: '#E2E4E9' }}>
      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 66px 92px 84px 38px', background: '#F8F8FA', borderBottom: '1px solid #E2E4E9', fontSize: '11.5px', fontWeight: 800, color: '#6B6E73' }}
      >
        <span style={{ padding: '7px 11px' }}>פריט</span>
        <span style={{ padding: '7px 11px' }}>כמות</span>
        {/* Said on the header, because it decides what the total means. The
            supplier's own note prints the price this way and the owner asked for
            the same: the column is pre-VAT and the total adds it. */}
        <span style={{ padding: '7px 11px' }}>מחיר ליחידה<span style={{ fontWeight: 600, color: '#9CA3AF' }}> (לפני מע"מ)</span></span>
        {/* Computed, never typed. Showing it makes the arithmetic visible, which
            is how a wrong unit price gets noticed on the line rather than in a
            grand total nobody can take apart. */}
        <span style={{ padding: '7px 11px', color: '#9CA3AF' }}>סה"כ</span>
        <span />
      </div>

      {lines.map((l, i) => (
        <div
          key={l.key}
          className="grid items-center"
          style={{
            gridTemplateColumns: '1fr 66px 92px 84px 38px',
            borderBottom: '1px solid #F3F4F6',
            background: l.uncertain ? '#FFFBEB' : undefined,
          }}
        >
          <input value={l.item} onChange={e => set(i, { item: e.target.value })} style={CELL} />
          <input
            value={l.quantity}
            inputMode="decimal"
            onChange={e => set(i, { quantity: e.target.value })}
            style={{ ...CELL, borderInlineStart: '1px solid #F3F4F6' }}
          />
          <input
            value={l.price}
            inputMode="decimal"
            placeholder="—"
            onChange={e => set(i, { price: e.target.value })}
            style={{ ...CELL, borderInlineStart: '1px solid #F3F4F6', fontVariantNumeric: 'tabular-nums' }}
          />
          <span
            style={{
              padding: '9px 11px', fontSize: '13px', color: '#6B6E73',
              borderInlineStart: '1px solid #F3F4F6', fontVariantNumeric: 'tabular-nums',
              background: '#FAFAFC',
            }}
          >
            {rowTotal(l) !== null ? `₪${rowTotal(l)!.toLocaleString('he-IL')}` : '—'}
          </span>
          <button
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
            title="מחיקת שורה"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9C7CC' }}
          ><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}

      {amounts && (
        <div style={{ borderTop: '1px solid #E2E4E9', background: '#FAFAFC', padding: '8px 11px' }}>
          {/* All three, and in this order: the column she filled, what the state
              adds, and what the delivery is actually worth. A single number
              labelled "total" is the ambiguity this whole change is about. */}
          <div className="flex items-center justify-between" style={{ fontSize: '12.5px', color: '#6B6E73' }}>
            <span>סה"כ לפני מע"מ</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>₪{amounts.net.toLocaleString('he-IL')}</span>
          </div>
          <div className="flex items-center justify-between" style={{ fontSize: '12.5px', color: '#6B6E73', marginTop: '2px' }}>
            <span>מע"מ {vatPercentFor(isoDate)}%</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>₪{amounts.vat.toLocaleString('he-IL')}</span>
          </div>
          <div
            className="flex items-center justify-between"
            style={{ fontSize: '13px', fontWeight: 800, marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #E9E9EE' }}
          >
            <span>סה"כ כולל מע"מ</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>₪{amounts.gross.toLocaleString('he-IL')}</span>
          </div>
        </div>
      )}

      <button
        onClick={() => onChange([...lines, newLine()])}
        className="inline-flex items-center gap-1.5"
        style={{ background: 'transparent', border: 'none', color: 'var(--brand-primary)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', padding: '9px 11px' }}
      ><Plus className="w-3.5 h-3.5" />הוספת שורה</button>
    </div>
  )
}
