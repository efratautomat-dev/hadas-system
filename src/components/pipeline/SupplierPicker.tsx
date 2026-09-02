import { useState } from 'react'
import { UserCog, Check, X } from 'lucide-react'
import { SearchableSelect } from '../SearchableSelect'

// ── "שינוי ספק" for a delivery note ──────────────────────────────────────────
//
// The same control the statements screen offers, for the same reason: a document
// matched to the wrong supplier is one problem, not two, and it deserves one
// answer rather than a second invention per screen.
//
// It sends the ID ONLY. The server resolves the name from it, so a delivery can
// never show one supplier and belong to another — the exact defect that free-text
// supplier fields produced on the invoice screen before it was made read-only.
//
// Why a confirmation step: reassigning moves the delivery into another supplier's
// chain, where it will be offered against THAT supplier's invoices. That is not a
// correction anyone should make by brushing past a dropdown.

export default function SupplierPicker({
  current, suppliers, onClose, onPick,
}: {
  current: string
  suppliers: { id: string; name: string; hp?: string }[]
  onClose: () => void
  onPick: (supplierId: string) => Promise<void>
}) {
  const [picked, setPicked] = useState(current)
  const [busy, setBusy] = useState(false)
  const changed = !!picked && picked !== current
  const target = suppliers.find(s => s.id === picked)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', overflowY: 'auto', padding: '40px 12px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white shadow-2xl w-full" style={{ maxWidth: '480px', direction: 'rtl' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
          <span className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
            <UserCog className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            שינוי ספק
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
            title="סגירה"
          ><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4">
          <label className="block font-semibold" style={{ fontSize: '12.5px', color: '#6B6E73', marginBottom: '6px' }}>
            שיוך לספק
          </label>
          <SearchableSelect
            value={picked}
            onChange={setPicked}
            placeholder="-- בחר --"
            options={suppliers.map(s => ({ value: s.id, label: s.name, keywords: s.hp }))}
          />
          <p style={{ margin: '6px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
            חיפוש לפי שם או ח.פ.
          </p>

          {changed && (
            <p style={{
              marginTop: '14px', padding: '11px 13px', fontSize: '12.5px', color: '#92400E',
              background: '#FFFBEB', border: '1px solid #FDE68A',
            }}>
              התעודה תעבור לשרשרת של <b>{target?.name}</b>, ותוצע מול החשבוניות שלו.
            </p>
          )}
        </div>

        <div className="px-5 pb-5 flex items-center gap-2">
          <button
            disabled={!changed || busy}
            onClick={async () => { setBusy(true); try { await onPick(picked) } finally { setBusy(false) } }}
            className="font-semibold inline-flex items-center gap-1.5 text-white"
            style={{
              background: changed ? 'var(--brand-primary)' : '#D6D7DD', border: 'none',
              padding: '9px 18px', fontSize: '13px',
              cursor: !changed ? 'not-allowed' : busy ? 'wait' : 'pointer',
            }}
          ><Check className="w-4 h-4" />{busy ? 'משנה…' : 'שינוי'}</button>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
          >ביטול</button>
        </div>
      </div>
    </div>
  )
}
