import { useEffect, useState } from 'react'
import { ReceiptText, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── "התקבלה קבלה תמורת תשלום" ────────────────────────────────────────────────
//
// A handful of suppliers never issue an invoice. The goods arrive, the money goes
// out, and the paperwork that comes back is a receipt — proof the payment
// happened, not a demand for it. The pipeline waits forever for an invoice that
// does not exist, and the ledger, holding a payment with nothing on the other
// side of it, reads as though the supplier owes us money.
//
// Marking the receipt does both halves of one event: the payment stops counting,
// and the delivery stops waiting.
//
// ⚠️ The payments are CHOSEN, never guessed. It is tempting to settle "the open
// payment for this supplier" automatically — there is usually exactly one — but
// the week there are two, the wrong one is silently zeroed and the balance is
// quietly wrong with nothing to show for it. Picking is three seconds.

interface OpenPayment {
  id: string
  amount: number
  date: string
  type: string
}

function fmtILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

function fmtDate(iso: string) {
  if (!iso) return 'ללא תאריך'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

export function ReceiptSettle({
  supplierId, settledAt, onSettle, onUndo, btnStyle,
}: {
  supplierId: string
  /** Already closed by a receipt — the control becomes the way back. */
  settledAt?: string | null
  onSettle: (paymentIds: string[]) => Promise<void>
  onUndo: () => Promise<void>
  btnStyle: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<OpenPayment[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetched when the panel opens, not on mount: most deliveries are never settled
  // this way, and a query per row of the goods list to serve a rare button is the
  // wrong trade.
  useEffect(() => {
    if (!open || !supplierId) return
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase
        .from('payments')
        .select('id, amount, payment_date, payment_type, status, receipt_settled_at')
        .eq('supplier_id', supplierId)
        .is('receipt_settled_at', null)
        .order('payment_date', { ascending: false })
        .limit(30)
      if (!alive) return
      if (err) { setError(err.message); setRows([]); return }
      setRows((data ?? [])
        .filter(r => String(r.status ?? '') !== 'cancelled')
        .map(r => ({
          id: String(r.id),
          amount: Number(r.amount ?? 0),
          date: String(r.payment_date ?? ''),
          type: String(r.payment_type ?? ''),
        })))
    })()
    return () => { alive = false }
  }, [open, supplierId])

  const toggle = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const confirm = async () => {
    if (picked.size === 0) return
    setBusy(true)
    setError(null)
    try {
      await onSettle([...picked])
      setOpen(false)
      setPicked(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה לא נשמרה')
    } finally {
      setBusy(false)
    }
  }

  // Already settled: the only thing left to offer is the way back.
  if (settledAt) {
    return (
      <div style={{ display: 'grid', gap: '6px' }}>
        <div
          className="inline-flex items-center gap-1.5"
          style={{
            padding: '8px 12px', background: '#E9F4ED', color: '#166534',
            fontSize: '12.5px', fontWeight: 700, borderRadius: 'var(--ui-radius, 2px)',
          }}
        ><ReceiptText size={13} />נסגר בקבלה</div>
        <button
          onClick={() => { setBusy(true); onUndo().finally(() => setBusy(false)) }}
          disabled={busy}
          style={{
            background: 'transparent', border: 'none', color: '#9CA3AF',
            fontSize: '11.5px', cursor: 'pointer', fontFamily: 'inherit',
            textDecoration: 'underline', padding: 0, textAlign: 'start',
          }}
        >בטל סגירה בקבלה</button>
      </div>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={btnStyle}>
        <ReceiptText size={14} />התקבלה קבלה תמורת תשלום
      </button>
    )
  }

  return (
    <div
      style={{
        border: '1px solid var(--brand-primary)', background: '#FFF8F9',
        padding: '12px 14px', borderRadius: 'var(--ui-radius, 2px)',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>איזה תשלום הקבלה סוגרת?</span>
        <button
          onClick={() => setOpen(false)}
          title="ביטול"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 0, display: 'flex' }}
        ><X size={15} /></button>
      </div>

      {rows === null ? (
        <p style={{ fontSize: '12.5px', color: '#9CA3AF', margin: 0 }}>טוען תשלומים…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: '12.5px', color: '#6B6E73', margin: 0, lineHeight: 1.6 }}>
          אין לספק הזה תשלומים פתוחים. אם התשלום עוד לא נרשם — צריך לרשום אותו
          במסך התשלומים קודם.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '4px', maxHeight: '190px', overflowY: 'auto', marginBottom: '10px' }}>
          {rows.map(p => (
            <label
              key={p.id}
              className="flex items-center gap-2"
              style={{
                padding: '7px 9px', background: 'white', border: '1px solid #E2E4E9',
                cursor: 'pointer', fontSize: '12.5px', borderRadius: 'var(--ui-radius, 2px)',
              }}
            >
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtILS(p.amount)}</span>
              <span style={{ color: '#9CA3AF' }}>{fmtDate(p.date)}</span>
              {p.type && <span style={{ color: '#9CA3AF' }}>· {p.type}</span>}
            </label>
          ))}
        </div>
      )}

      {error && <p style={{ fontSize: '12px', color: '#B91C1C', margin: '0 0 8px' }}>{error}</p>}

      {rows !== null && rows.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={confirm}
            disabled={busy || picked.size === 0}
            style={{
              padding: '7px 16px', fontSize: '12.5px', fontWeight: 700, fontFamily: 'inherit',
              border: '1px solid ' + (picked.size ? 'var(--brand-primary)' : '#E2E4E9'),
              background: picked.size ? 'var(--brand-primary)' : '#E2E4E9',
              color: picked.size ? 'white' : '#9CA3AF',
              cursor: busy || !picked.size ? 'default' : 'pointer',
              borderRadius: 'var(--ui-radius, 2px)',
            }}
          >{busy ? 'שומר…' : 'סגור בקבלה'}</button>
          <button
            onClick={() => setOpen(false)}
            style={{
              padding: '7px 16px', border: '1px solid #E2E4E9', background: 'white',
              color: '#6B6E73', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', borderRadius: 'var(--ui-radius, 2px)',
            }}
          >ביטול</button>
        </div>
      )}
    </div>
  )
}
