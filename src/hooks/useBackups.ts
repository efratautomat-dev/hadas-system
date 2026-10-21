import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { subscribe } from '../lib/dataBus'
import { DEMO_MODE } from '../lib/demo'

// ── The weekly backup, as the Settings panel sees it ─────────────────────────
//
// Reads go through the anon client under RLS, like every other hook here; the
// policy on `backup_runs` is manager-only, so an employee's read comes back empty
// rather than forbidden. That is the right shape — Settings is manager-only at
// the routing level anyway, and an error would be worse than an empty list.
//
// The one thing this hook does that the others do not: it POLLS while a run is in
// flight. A full dump takes longer than a request wants to stay open, and the
// HTTP reply to "גיבוי עכשיו" is a convenience — `backup_runs` is the record. So
// the button fires and returns, and the panel then watches the row until it
// settles. Without the poll the screen would sit on "running" until something
// else happened to reload it.

/** How long after the last successful backup the panel turns red. */
export const BACKUP_STALE_DAYS = 10
const POLL_MS = 4000
/** A dump that has not finished by now is stuck; the lease is swept at 30 min. */
const POLL_GIVE_UP_MS = 5 * 60 * 1000

export interface BackupTableCount {
  table: string
  label: string
  rows: number
  expected: number
}

export interface BackupSummary {
  tables?: BackupTableCount[]
  warnings?: string[]
  unlisted?: string[]
  excluded?: string[]
  notBackedUp?: string[]
  /** Present on a failed run that came up short: the two numbers that matter. */
  table?: string
  expected?: number
  collected?: number
}

export interface BackupRun {
  id: string
  kind: 'backup' | 'cleanup'
  status: 'running' | 'ok' | 'failed'
  run_date: string
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  triggered_by: 'cron' | 'manual'
  actor_email: string | null
  drive_folder_link: string | null
  quarter_anchor: string | null
  quarter_folder_link: string | null
  total_rows: number | null
  file_count: number | null
  bytes: number | null
  readable_format: 'xlsx' | 'csv' | 'none' | null
  summary: BackupSummary | null
  error: string | null
  error_stage: string | null
}

export function useBackups() {
  const [data, setData] = useState<BackupRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollStarted = useRef<number>(0)

  const load = useCallback(async () => {
    const { data: rows, error: err } = await supabase
      .from('backup_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20)
    if (err) {
      // An unreadable history is not "no backups ever" — saying so would be the
      // one lie this panel exists to prevent. It reports that it cannot tell.
      setError(err.message)
      setData([])
    } else {
      setError(null)
      setData((rows ?? []) as BackupRun[])
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])
  useEffect(() => subscribe(['backup_runs'], load), [load])

  const runs = data.filter(r => r.kind === 'backup')
  const latest = runs[0] ?? null
  const isRunning = latest?.status === 'running'

  // Watch a run through to its end. The timer is cleared on unmount and whenever
  // the row settles, so leaving the tab mid-backup leaves nothing behind.
  useEffect(() => {
    if (!isRunning) {
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null }
      pollStarted.current = 0
      return
    }
    if (!pollStarted.current) pollStarted.current = Date.now()
    if (Date.now() - pollStarted.current > POLL_GIVE_UP_MS) return

    pollTimer.current = setTimeout(() => { void load() }, POLL_MS)
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current) }
  }, [isRunning, data, load])

  const runNow = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/backups/run', {})
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  const cleanupYear = async (year: number) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.post('/backups/year-end-cleanup', { year, confirm: true })
      await load()
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  return {
    /** Backup runs only, newest first. */
    runs,
    /** Prunes, for the cleanup card's own history. */
    cleanups: data.filter(r => r.kind === 'cleanup'),
    latest,
    isRunning,
    loading,
    error,
    busy,
    /** The demo has no Drive behind it, so the button says so instead of lying. */
    canRun: !DEMO_MODE,
    runNow,
    cleanupYear,
    reload: load,
  }
}
