import { Plus, Trash2 } from 'lucide-react'
import { newLine, type Line } from '../../lib/lineItems'

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
  lines, onChange, priceLabel = 'מחיר',
}: {
  lines: Line[]
  onChange: (next: Line[]) => void
  priceLabel?: string
}) {
  const set = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, j) => j === i ? { ...l, ...patch, uncertain: false } : l))

  return (
    <div className="border" style={{ borderColor: '#E2E4E9' }}>
      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 72px 84px 38px', background: '#F8F8FA', borderBottom: '1px solid #E2E4E9', fontSize: '11.5px', fontWeight: 800, color: '#6B6E73' }}
      >
        <span style={{ padding: '7px 11px' }}>פריט</span>
        <span style={{ padding: '7px 11px' }}>כמות</span>
        <span style={{ padding: '7px 11px' }}>{priceLabel}</span>
        <span />
      </div>

      {lines.map((l, i) => (
        <div
          key={l.key}
          className="grid items-center"
          style={{
            gridTemplateColumns: '1fr 72px 84px 38px',
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
          <button
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
            title="מחיקת שורה"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9C7CC' }}
          ><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}

      <button
        onClick={() => onChange([...lines, newLine()])}
        className="inline-flex items-center gap-1.5"
        style={{ background: 'transparent', border: 'none', color: 'var(--brand-primary)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', padding: '9px 11px' }}
      ><Plus className="w-3.5 h-3.5" />הוספת שורה</button>
    </div>
  )
}
