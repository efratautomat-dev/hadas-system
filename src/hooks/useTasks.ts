import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { subscribe } from '../lib/dataBus'
import type { NoteOpenIntent } from '../lib/noteSources'

// ── Her own to-do list ───────────────────────────────────────────────────────
//
// The one block on the home screen that is not derived from data: she writes
// these herself. A note says something HAPPENED; a task says she has to DO
// something — so "→ משימה" on a note turns one into the other, and the task keeps
// where it came from (`from`) so the context is one click away.
//
// ⚠️ Demo-only today. The live system has no `tasks` table yet; the home screen
// that uses this hook is rendered only in demo mode (Layout). Moving it to
// production means a migration and two hadas-api routes, not a change here.

export interface Task {
  id:        string
  body:      string
  done:      boolean
  createdAt: string
  doneAt:    string | null
  /** Where it was born — "נוצרה מהערה · חוטי זוהר · 15/06" — and how to get back. */
  fromLabel:  string | null
  fromIntent: NoteOpenIntent | null
  /** The note it was made from, so the board can say "already a task". */
  fromKey:    string | null
}

export interface NewTask {
  body: string
  fromLabel?: string
  fromIntent?: NoteOpenIntent
  fromKey?: string
}

export function useTasks() {
  const [tasks, setTasks]     = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setTasks((data ?? []).map(r => ({
        id:         String(r.id),
        body:       String(r.body ?? ''),
        done:       !!r.done,
        createdAt:  String(r.created_at ?? ''),
        doneAt:     r.done_at ?? null,
        fromLabel:  r.from_label ?? null,
        fromIntent: (r.from_intent as NoteOpenIntent | null) ?? null,
        fromKey:    r.from_key ?? null,
      })))
    } catch (e) {
      console.warn('[tasks] unavailable:', e)
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => subscribe(['tasks'], load), [load])

  const add = async (t: NewTask) => {
    const body = t.body.trim()
    if (!body) return
    await api.post('/tasks', { body, fromLabel: t.fromLabel, fromIntent: t.fromIntent, fromKey: t.fromKey })
  }

  /** Optimistic — a checkbox that waits for a round trip reads as broken. */
  const setDone = async (id: string, done: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    try { await api.put(`/tasks/${id}`, { done }) } catch (e) { console.error('[tasks] toggle failed:', e); await load() }
  }

  const remove = async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    try { await api.delete(`/tasks/${id}`) } catch (e) { console.error('[tasks] delete failed:', e); await load() }
  }

  return { tasks, loading, add, setDone, remove }
}
