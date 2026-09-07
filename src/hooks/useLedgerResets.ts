import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { subscribe } from '../lib/dataBus'
import type { ResetLike } from '../lib/ledgerEngine'

// ── Declared zero points ─────────────────────────────────────────────────────
//
// Read for EVERY supplier at once, not per card. Three screens show a balance —
// the list, the supplier page and the ledger — and each of them builds it from
// the whole set of invoices and payments anyway. Fetching resets per supplier
// would mean a screen that shows twenty balances issuing twenty requests, and a
// window where nineteen of them are still the old figure.
//
// RLS makes this manager-only at the data layer, so an employee's read comes back
// empty rather than forbidden. That is the right shape: she has no balance to see
// in the first place, and an error here would break screens that merely happen to
// be built from a hook that mentions money.

export interface LedgerReset {
  id: string
  supplier_id: string
  reset_on: string
  reason: string
  author_email: string | null
  created_at: string
}

export function useLedgerResets() {
  const [data, setData] = useState<LedgerReset[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('ledger_resets')
      .select('*')
      .order('reset_on', { ascending: true })
    if (error) {
      // Not a fallback to fiction: an unreadable reset table means "no resets",
      // and the ledger it feeds is then the plain arithmetic it always was.
      console.warn('[useLedgerResets] read failed:', error.message)
      setData([])
    } else {
      setData((rows ?? []) as LedgerReset[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => subscribe(['ledger_resets', 'suppliers'], load), [load])

  /** Declare this supplier square as of today, with a reason. */
  const create = async (supplierId: string, reason: string) => {
    await api.post(`/suppliers/${supplierId}/ledger-reset`, { reason })
    await load()
  }

  /** Undo one. Additive by construction, so removing it restores the balance. */
  const remove = async (id: string) => {
    await api.delete(`/ledger-resets/${id}`)
    await load()
  }

  /** What the engine wants, for every supplier. */
  const asEngineInput = data as ResetLike[]

  return { data, asEngineInput, loading, create, remove, reload: load }
}
