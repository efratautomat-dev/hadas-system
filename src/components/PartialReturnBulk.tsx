import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useInvoices } from '../hooks/useInvoices'
import { api } from '../lib/api'

// ── "החזר חלקי" switched ON for a supplier → what about the invoices already filed?
//
// The supplier setting only reaches NEW invoices (ingest files them under the
// month's "החזר חלקי" folder). The owner said 21.10 that existing ones have to
// move too, so the moment the setting is saved ON she is shown this supplier's
// invoices that are not yet marked, all ticked, and each one she keeps ticked
// goes through the invoice's OWN mark (PUT /invoices/:id isPartialReturn) — the
// same route as ticking "החזר חלקי" on a single invoice, which re-files its
// Drive copy. One by one on purpose: each is a Drive move, and a failure on one
// must name that one rather than sink the batch.
const formatILS = (n: number) => `₪${(Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`

export default function PartialReturnBulk({
  supplierId, supplierName, onClose,
}: {
  supplierId: string
  supplierName: string
  onClose: () => void
}) {
  const { data: invoices, loading } = useInvoices()
  const candidates = useMemo(
    () => invoices.filter(i => i.supplierId === supplierId && !i.isPartialReturn),
    [invoices, supplierId],
  )
  // Unticked ids — everything starts ticked, so a late-loading list is ticked too.
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ ok: number; failed: string[] } | null>(null)
  const chosen = candidates.filter(i => !skip[i.id])

  async function apply() {
    setBusy(true)
    let ok = 0
    const failed: string[] = []
    for (const inv of chosen) {
      try {
        await api.put(`/invoices/${inv.id}`, { isPartialReturn: true })
        ok++
      } catch {
        failed.push(inv.invoiceNumber || inv.id)
      }
    }
    setBusy(false)
    setDone({ ok, failed })
  }

  const btn: React.CSSProperties = {
    borderRadius: '10px', padding: '9px 16px', minHeight: '42px', fontSize: '14px',
    fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#1F2937' }}>החזר חלקי — {supplierName}</h2>
          {!busy && (
            <button onClick={onClose} aria-label="סגירה" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {done ? (
          <>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.7, color: '#065F46', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '12px', padding: '12px 14px' }}>
              {done.ok} חשבוניות סומנו "החזר חלקי", והקבצים שלהן הועברו בדרייב לתיקיית "החזר חלקי" של החודש.
            </p>
            {done.failed.length > 0 && (
              <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.7, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px', padding: '12px 14px' }}>
                לא עודכנו: {done.failed.join(', ')} — אפשר לסמן אותן אחת-אחת בעריכת החשבונית.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ ...btn, background: 'var(--brand-primary)', color: 'white', border: 'none' }}>סגירה</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.7, color: '#374151' }}>
              מעכשיו כל חשבונית <strong>חדשה</strong> של הספק תתויק ב"החזר חלקי". <strong>אילו חשבוניות קיימות להעביר גם?</strong>
            </p>
            {loading && candidates.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#6B7280' }}>טוען חשבוניות…</p>
            ) : candidates.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#6B7280' }}>אין לספק חשבוניות קיימות שעוד לא סומנו.</p>
            ) : (
              <div style={{ border: '1px solid #E2E4E9', borderRadius: '12px', overflow: 'hidden' }}>
                {candidates.map(inv => (
                  <label
                    key={inv.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: '1px solid #EEF0F3', fontSize: '14px', minHeight: '44px', cursor: busy ? 'default' : 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={!skip[inv.id]}
                      disabled={busy}
                      onChange={() => setSkip(s => ({ ...s, [inv.id]: !s[inv.id] }))}
                      style={{ width: '20px', height: '20px', accentColor: 'var(--brand-primary)', flexShrink: 0 }}
                    />
                    <span>
                      <strong>{inv.invoiceNumber || 'ללא מספר'}</strong>
                      <span style={{ color: '#6B7280' }}> · {inv.date || '—'} · {formatILS(inv.amount)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={onClose} disabled={busy} style={{ ...btn, background: 'white', color: '#374151', border: '1px solid #D1D5DB' }}>
                רק חשבוניות חדשות
              </button>
              <button
                onClick={apply}
                disabled={busy || chosen.length === 0}
                style={{ ...btn, border: 'none', color: 'white', background: busy || chosen.length === 0 ? '#D1D5DB' : 'var(--brand-primary)', cursor: busy || chosen.length === 0 ? 'not-allowed' : 'pointer' }}
              >
                {busy ? 'מעביר…' : `סמן והעבר ${chosen.length} חשבוניות`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
