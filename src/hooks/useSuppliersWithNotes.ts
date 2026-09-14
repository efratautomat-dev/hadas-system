import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { subscribe } from '../lib/dataBus'

// ── Which suppliers have anything written about them ─────────────────────────
//
// The owner: "להוסיף את סמל ההערות גם בכרטיס הספק מבחוץ, ולא רק לחשבונית שיש
// הערה." The invoice list has carried that marker for a while, and for the
// reason that applies here too: a note nobody can see the EXISTENCE of waits to
// be stumbled on. The suppliers screen is where she decides whose card to open,
// so it is where "there is something written here" has to be visible.
//
// One query for the whole screen, not one per card. It asks for ids alone — no
// bodies, no counts of anything financial — so it is safe on a list an employee
// can see, and cheap enough to re-run whenever notes change.

export function useSuppliersWithNotes(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('supplier_notes').select('supplier_id')
      if (error) throw error
      setIds(new Set((data ?? []).map(r => String(r.supplier_id))))
    } catch (e) {
      // A marker is an aid, not a fact the screen depends on: losing it costs an
      // icon, and failing the list over it costs the list.
      console.warn('[suppliers] note markers unavailable:', e)
      setIds(new Set())
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => subscribe(['supplier_notes', 'suppliers'], load), [load])

  return ids
}
