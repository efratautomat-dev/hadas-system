import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { NOTE_SOURCES, type NoteOpenIntent, type DerivedNoteRef, type SourceRow } from '../lib/noteSources'

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

export const NOTE_TAG_STYLE: Record<NoteTag, { bg: string; fg: string }> = {
  suppliers:  { bg: 'var(--brand-active-bg)', fg: 'var(--brand-primary)' },
  payments:   { bg: '#DBEAFE', fg: '#1E40AF' },
  statements: { bg: '#FEF3C7', fg: '#92400E' },
}

/**
 * One row in the panel, whichever kind it is.
 *
 * The panel renders a single ordered feed, so both kinds have to be the same
 * shape by the time they reach it. `editable` is the whole difference: a note
 * written in the panel can be changed there, a collected one is edited where it
 * was written and only LINKED to from here.
 */
export interface FeedNote {
  key:       string
  /** 'manual' for a panel note, otherwise the NoteSource key. */
  sourceKey: string
  label:     string
  style:     { bg: string; fg: string }
  body:      string
  /** ISO timestamp, or '' when the record carries no date. */
  date:      string
  editable:  boolean
  /** Present on panel notes — what update()/remove() act on. */
  noteId?:   string
  authorEmail?: string | null
  /** Present on collected notes. */
  ref?:      DerivedNoteRef
  open?:     NoteOpenIntent
}

/** Newest first. Undated rows sink to the bottom rather than to the top: an
 *  undated note is not "the oldest", it is unplaced, and sorting it into the
 *  distant past would bury real history under it. */
function byDateDesc(a: FeedNote, b: FeedNote): number {
  if (!a.date && !b.date) return 0
  if (!a.date) return 1
  if (!b.date) return -1
  return b.date.localeCompare(a.date)
}

/**
 * The per-supplier note log — a small CRM against a supplier card.
 *
 * Reads go through the anon client (RLS-enforced, manager-only), writes through
 * hadas-api like every other write in the app. Pass `null` when no supplier is in
 * focus: the hook then holds no rows and issues no query, which is what the
 * payments screen needs before a row is opened.
 *
 * Alongside the written notes it collects every OTHER note the system already
 * holds about this supplier, declared in ../lib/noteSources. Those are read-only
 * and carry a link back to the record they came from.
 */
export function useSupplierNotes(supplierId: string | null) {
  const [own, setOwn]         = useState<SupplierNote[]>([])
  const [derived, setDerived] = useState<FeedNote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supplierId) { setOwn([]); setDerived([]); setError(null); return }
    setLoading(true)
    try {
      const { data: rows, error: err } = await supabase
        .from('supplier_notes')
        .select('*')
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false })   // newest first
      if (err) throw err
      setOwn((rows ?? []).map(r => ({
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
      setOwn([])
    } finally {
      setLoading(false)
    }
  }, [supplierId])

  /**
   * Collect the notes that live elsewhere.
   *
   * One query per source, in parallel, driven entirely by the registry — this
   * function names no table and no column, so a new source needs no change here.
   * A source that FAILS is skipped rather than failing the panel: a missing
   * table or a tightened policy on one screen should cost that screen's notes,
   * not everything the owner came to read.
   */
  const loadDerived = useCallback(async () => {
    if (!supplierId) { setDerived([]); return }
    const perSource = await Promise.all(NOTE_SOURCES.map(async (src) => {
      try {
        const { data, error: err } = await supabase
          .from(src.table)
          .select(src.columns)
          .eq(src.supplierColumn, supplierId)
        if (err) throw err
        const out: FeedNote[] = []
        for (const raw of (data ?? []) as unknown as SourceRow[]) {
          const body = src.body(raw)
          if (!body) continue                       // empty means absent
          out.push({
            key:       `${src.key}:${String(raw.id ?? out.length)}`,
            sourceKey: src.key,
            label:     src.label,
            style:     src.style,
            body,
            date:      src.date(raw) ?? '',
            editable:  false,
            ref:       src.ref(raw),
            open:      src.open(raw),
          })
        }
        return out
      } catch (e) {
        console.warn(`[supplier-notes] source "${src.key}" skipped:`, e)
        return [] as FeedNote[]
      }
    }))
    setDerived(perSource.flat())
  }, [supplierId])

  // Both halves of the feed refresh together — a supplier change has to move
  // them as one, or the panel briefly shows one supplier's written notes beside
  // another's collected ones.
  useEffect(() => { void load(); void loadDerived() }, [load, loadDerived])

  const ownAsFeed: FeedNote[] = own.map(n => ({
    key:         `manual:${n.id}`,
    sourceKey:   'manual',
    label:       NOTE_TAG_LABEL[n.tag] ?? n.tag,
    style:       NOTE_TAG_STYLE[n.tag] ?? NOTE_TAG_STYLE.suppliers,
    body:        n.body,
    date:        n.createdAt,
    editable:    true,
    noteId:      n.id,
    authorEmail: n.authorEmail,
  }))

  const feed = [...ownAsFeed, ...derived].sort(byDateDesc)

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
    setOwn(prev => prev.filter(n => n.id !== id))
  }

  return {
    /** Panel notes only — kept for callers that count what THIS supplier's log holds. */
    data: own,
    /** Everything the panel shows, ordered newest first. */
    feed,
    loading, error, create, update, remove,
    reload: async () => { await Promise.all([load(), loadDerived()]) },
  }
}
