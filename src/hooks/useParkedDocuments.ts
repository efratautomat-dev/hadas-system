import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

// ── Documents that never got in ──────────────────────────────────────────────
//
// Ingest retries a failing email twice, then labels it "פענוח נכשל" so it stops
// clogging the queue — and until now nothing in the app said so. A supplier's
// invoice could sit unread for months while every screen read as healthy.
//
// This is the counter that makes that impossible. It matters most in exactly the
// month it is least likely to be noticed by memory: the busy one.

export interface ParkedDocument {
  gmailMessageId: string
  attempts: number
  lastAttemptAt: string
  lastError: string
}

export function useParkedDocuments() {
  const [data, setData] = useState<ParkedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/ingest/parked') as { parked?: ParkedDocument[] }
      setData(res.parked ?? [])
      setError(null)
    } catch (e) {
      // A failure to READ the parked list must not itself be silent — that would
      // be the same defect one level up.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  /**
   * `requeue` sweeps emails wearing the FAILED label. `sweep` goes after the
   * other hole: emails that failed, were left unlabeled for a retry, and then
   * aged past the routine 14-day window — invisible to requeue entirely.
   */
  const retry = async (mode: 'requeue' | 'sweep' = 'requeue') => {
    setBusy(true)
    try {
      const res = await api.put('/ingest/requeue', { mode }) as
        { parkedBefore?: number; parkedAfter?: number }
      await load()
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally { setBusy(false) }
  }

  return { data, loading, error, busy, retry, reload: load }
}
