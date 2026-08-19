import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

/** Which screen a note was written on. DERIVED there, never picked by hand. */
export type NoteTag = 'suppliers' | 'payments' | 'statements'

export interface SupplierNote {
  id: string
  supplierId: string
  body: string
  tag: NoteTag
  /** The verified email of whoever wrote it, stamped by the server. */
  authorEmail: string | null
  createdAt: string
  updatedAt: string
}

export const NOTE_TAG_LABEL: Record<NoteTag, string> = {
  suppliers:  'ספק',
  payments:   'תשלומים',
  statements: 'כרטסות',
}

/**
 * The per-supplier note log — a small CRM against a supplier card.
 *
 * Reads go through the anon client (RLS-enforced, manager-only), writes through
 * hadas-api like every other write in the app. Pass `null` when no supplier is in
 * focus: the hook then holds no rows and issues no query, which is what the
 * payments screen needs before a row is opened.
 */
export function useSupplierNotes(supplierId: string | null) {
  const [data, setData]       = useState<SupplierNote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supplierId) { setData([]); setError(null); return }
    setLoading(true)
    try {
      const { data: rows, error: err } = await supabase
        .from('supplier_notes')
        .select('*')
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false })   // newest first
      if (err) throw err
      setData((rows ?? []).map(r => ({
        id:          String(r.id),
        supplierId:  r.supplier_id ?? '',
        body:        r.body ?? '',
        tag:         (r.tag ?? 'suppliers') as NoteTag,
        authorEmail: r.author_email ?? null,
        createdAt:   r.created_at ?? '',
        updatedAt:   r.updated_at ?? '',
      })))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setData([])
    } finally {
      setLoading(false)
    }
  }, [supplierId])

  useEffect(() => { void load() }, [load])

  /** The tag comes from the CALLER (the screen), never from the user. */
  const create = async (body: string, tag: NoteTag) => {
    if (!supplierId || !body.trim()) return
    await api.post('/supplier-notes', { supplierId, body: body.trim(), tag })
    await load()
  }

  /** Text only. The tag and the author record where and by whom it was written —
   *  rewriting either on an edit would falsify the record. */
  const update = async (id: string, body: string) => {
    if (!body.trim()) return
    await api.put(`/supplier-notes/${id}`, { body: body.trim() })
    await load()
  }

  const remove = async (id: string) => {
    await api.delete(`/supplier-notes/${id}`)
    setData(prev => prev.filter(n => n.id !== id))
  }

  return { data, loading, error, create, update, remove, reload: load }
}
