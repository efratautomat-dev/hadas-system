import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { subscribe } from '../lib/dataBus'
import { NOTE_SOURCES } from '../lib/noteSources'

// ── Which suppliers have anything written about them ─────────────────────────
//
// The owner: "להוסיף את סמל ההערות גם בכרטיס הספק מבחוץ, ולא רק לחשבונית שיש
// הערה." The invoice list has carried that marker for a while, and for the
// reason that applies here too: a note nobody can see the EXISTENCE of waits to
// be stumbled on.
//
// ⚠️ THE BUG THIS FILE WAS REWRITTEN FOR — "האייקון מוצג רק לחלק מאלו שיש להם
// הערות". The first version read `supplier_notes` alone, which is only the notes
// written IN the panel. But the panel is a cross-section: most notes in this
// system are written somewhere else entirely — on a payment, on a return, on an
// invoice, on a statement, and now on a delivery — and collected from there. So
// a supplier whose only note lived on an invoice had a full notes panel and no
// marker, which reads as a broken icon rather than a partial one.
//
// The marker now asks the SAME REGISTRY the panel reads, so the two cannot
// disagree and a new source gets its marker for free — the rule noteSources
// states about itself.
//
// One small query per source, and `noteColumn` is why they stay small: ids of
// rows whose note is not empty, nothing else. No bodies, no figures — safe on a
// list an employee can see.

export function useSuppliersWithNotes(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const found = new Set<string>()

    // Notes written in the panel itself. Not in the registry — the registry
    // declares notes that live ELSEWHERE — so it is asked for separately.
    try {
      const { data, error } = await supabase.from('supplier_notes').select('supplier_id')
      if (error) throw error
      for (const r of data ?? []) found.add(String(r.supplier_id))
    } catch (e) {
      console.warn('[suppliers] own-note markers unavailable:', e)
    }

    await Promise.all(NOTE_SOURCES.map(async (src) => {
      try {
        const { data, error } = await supabase
          .from(src.table)
          .select(`${src.supplierColumn}, ${src.noteColumn}`)
          .not(src.noteColumn, 'is', null)
          .neq(src.noteColumn, '')
        if (error) throw error
        for (const raw of (data ?? []) as unknown as Record<string, unknown>[]) {
          // `body` is not consulted here (it needs the whole row), so an
          // all-whitespace note is filtered in JS rather than in SQL.
          if (!String(raw[src.noteColumn] ?? '').trim()) continue
          const id = String(raw[src.supplierColumn] ?? '')
          if (id) found.add(id)
        }
      } catch (e) {
        // A marker is an aid, not a fact the screen depends on: one failing
        // source costs its icons, never the list.
        console.warn(`[suppliers] note markers for "${src.key}" unavailable:`, e)
      }
    }))

    setIds(found)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(
    () => subscribe(['supplier_notes', 'suppliers', 'invoices', 'payments', 'returns', 'statements', 'delivery_notes'], load),
    [load],
  )

  return ids
}
