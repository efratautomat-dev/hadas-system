import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { subscribe } from '../lib/dataBus'

// ── ✓ on our ledger ──────────────────────────────────────────────────────────
//
// "This movement of ours appears on the supplier's statement too." The owner's
// rule (21.10): a tick is certain and it STAYS — it belongs to the ledger row
// (an invoice or a payment), not to the statement it was ticked against, so every
// statement of that supplier, earlier or later, shows it. Hence one supplier's
// set of row ids, not a per-statement list.
//
// Manager-only by RLS; an employee's read comes back empty (she never sees this
// screen anyway). A failed write rolls the tick back and is reported through
// `error`, so the screen never shows a ✓ the database does not hold.
export function useLedgerMarks(supplierId: string | null | undefined) {
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supplierId) { setMarked(new Set()); return }
    const { data, error: err } = await supabase
      .from('ledger_marks')
      .select('row_id')
      .eq('supplier_id', supplierId)
    if (err) {
      console.warn('[useLedgerMarks] read failed:', err.message)
      return
    }
    setMarked(new Set((data ?? []).map(r => String((r as { row_id: string }).row_id))))
  }, [supplierId])

  useEffect(() => { load() }, [load])
  useEffect(() => subscribe(['ledger_marks'], load), [load])

  /** Tick or untick one row — optimistic, rolled back if the server refuses. */
  const toggle = async (rowId: string) => {
    if (!supplierId) return
    const next = !marked.has(rowId)
    const apply = (on: boolean) => setMarked(prev => {
      const s = new Set(prev)
      if (on) s.add(rowId); else s.delete(rowId)
      return s
    })
    apply(next)
    setError(null)
    try {
      await api.put('/ledger-marks', { supplierId, rowId, marked: next })
    } catch (e) {
      apply(!next)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return { marked, toggle, error }
}
