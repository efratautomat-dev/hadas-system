import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { subscribe } from '../lib/dataBus'

// ── "הייתי רוצה שיהיה אחרת" ──────────────────────────────────────────────────
//
// A request about the SYSTEM, not a note about a supplier — so it does not go in
// the notes panel. It records which screen she was on when she wrote it, because
// "the filter here is annoying" means nothing once you no longer know where
// "here" was. Read back as one list, in order.
//
// ⚠️ Demo-only today, like useTasks: no table in the live system yet.

export interface Wish {
  id:        string
  body:      string
  page:      string
  pageLabel: string
  createdAt: string
}

export function useWishes() {
  const [wishes, setWishes] = useState<Wish[]>([])

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('wishes').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setWishes((data ?? []).map(r => ({
        id:        String(r.id),
        body:      String(r.body ?? ''),
        page:      String(r.page ?? ''),
        pageLabel: String(r.page_label ?? ''),
        createdAt: String(r.created_at ?? ''),
      })))
    } catch (e) {
      console.warn('[wishes] unavailable:', e)
      setWishes([])
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => subscribe(['wishes'], load), [load])

  const add = async (body: string, page: string, pageLabel: string) => {
    if (!body.trim()) return
    await api.post('/wishes', { body: body.trim(), page, pageLabel })
  }

  return { wishes, add }
}
