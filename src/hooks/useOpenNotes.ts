import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { subscribe } from '../lib/dataBus'
import { NOTE_SOURCES, type NoteOpenIntent, type SourceRow } from '../lib/noteSources'
import { NOTE_TAG_LABEL, NOTE_TAG_STYLE, type NoteTag } from './useSupplierNotes'

// ── Every note nobody has marked handled, across all suppliers ───────────────
//
// The home screen's noticeboard. Same registry as the supplier notes panel
// (`noteSources`), same `note_handled` mark — so a note cleared here is cleared
// in the panel and the other way round. "Open" means NOT MARKED HANDLED, not
// "written recently": a note from two weeks ago that nobody answered is exactly
// what the board exists for.
//
// A fixed number of queries — one per source plus three — however many suppliers
// there are. A failing source costs its notes, never the board.

export interface OpenNote {
  key:          string
  sourceKey:    string
  recordId:     string
  supplierId:   string
  supplierName: string
  label:        string
  style:        { bg: string; fg: string }
  body:         string
  /** ISO, or '' when the record carries no date. */
  date:         string
  open:         NoteOpenIntent
}

export function useOpenNotes() {
  const [notes, setNotes]     = useState<OpenNote[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const names = new Map<string, string>()
    const handled = new Set<string>()
    const out: OpenNote[] = []

    await Promise.all([
      (async () => {
        try {
          const { data, error } = await supabase.from('suppliers_v').select('id, name')
          if (error) throw error
          for (const r of data ?? []) names.set(String(r.id), String(r.name ?? ''))
        } catch (e) { console.warn('[open-notes] supplier names unavailable:', e) }
      })(),
      (async () => {
        try {
          const { data, error } = await supabase.from('note_handled').select('source_key, record_id')
          if (error) throw error
          for (const r of data ?? []) handled.add(`${r.source_key}:${r.record_id}`)
        } catch (e) { console.warn('[open-notes] handled marks unavailable:', e) }
      })(),
      (async () => {
        try {
          const { data, error } = await supabase
            .from('supplier_notes')
            .select('id, supplier_id, body, tag, created_at')
          if (error) throw error
          for (const r of data ?? []) {
            const body = String(r.body ?? '').trim()
            if (!body) continue
            const tag = (r.tag ?? 'suppliers') as NoteTag
            const supplierId = String(r.supplier_id ?? '')
            out.push({
              key: `manual:${r.id}`, sourceKey: 'manual', recordId: String(r.id),
              supplierId, supplierName: '',
              label: NOTE_TAG_LABEL[tag] ?? 'ספק',
              style: NOTE_TAG_STYLE[tag] ?? NOTE_TAG_STYLE.suppliers,
              body, date: String(r.created_at ?? ''),
              open: { page: 'suppliers', supplierViewId: supplierId },
            })
          }
        } catch (e) { console.warn('[open-notes] panel notes unavailable:', e) }
      })(),
      ...NOTE_SOURCES.map(async (src) => {
        try {
          const { data, error } = await supabase
            .from(src.table)
            .select(src.columns)
            .not(src.noteColumn, 'is', null)
          if (error) throw error
          for (const raw of (data ?? []) as unknown as SourceRow[]) {
            const body = src.body(raw)
            if (!body) continue
            out.push({
              key: `${src.key}:${String(raw.id ?? '')}`, sourceKey: src.key, recordId: String(raw.id ?? ''),
              supplierId: String(raw[src.supplierColumn] ?? ''), supplierName: '',
              label: src.label, style: src.style,
              body, date: src.date(raw) ?? '',
              open: src.open(raw),
            })
          }
        } catch (e) { console.warn(`[open-notes] source "${src.key}" skipped:`, e) }
      }),
    ])

    setNotes(out
      .filter(n => n.supplierId && !handled.has(`${n.sourceKey}:${n.recordId}`))
      .map(n => ({ ...n, supplierName: names.get(n.supplierId) ?? '' }))
      // Newest first; undated sinks — it is unplaced, not old.
      .sort((a, b) => (!a.date ? 1 : !b.date ? -1 : b.date.localeCompare(a.date))))
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(
    () => subscribe(['supplier_notes', 'suppliers', 'invoices', 'payments', 'returns', 'statements', 'delivery_notes'], load),
    [load],
  )

  /** Clear a note off the board. Optimistic — the line goes the moment she clicks. */
  const markHandled = async (n: OpenNote) => {
    setNotes(prev => prev.filter(x => x.key !== n.key))
    try {
      await api.put('/note-handled', { sourceKey: n.sourceKey, recordId: n.recordId, supplierId: n.supplierId, handled: true })
    } catch (e) {
      console.error('[open-notes] handled toggle failed:', e)
      await load()
    }
  }

  return { notes, loading, markHandled }
}
