import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Alert, AlertType, AlertStatus } from '../data/mockData'
import { mockAlerts } from '../data/mockData'
import { tierAllowsAlert } from '../lib/tiers'

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function useAlerts() {
  const [data, setData]       = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase
        .from('alerts')
        .select('*')
        .order('created_at', { ascending: false })

      if (!error && rows && rows.length > 0) {
        setData(
          // Tier filter lives HERE, at the single source every consumer reads —
          // the dashboard feed, the alerts screen, its status counters and the
          // sidebar badge. Filtering at each call site would let one of them
          // drift and quietly surface a feature the viewer's tier excludes.
          rows.filter((r) => tierAllowsAlert(r.type as string)).map((r) => {
            const payload = (r.payload ?? r.details) as Record<string, unknown> | null
            return {
              id:          String(r.id),
              // No default of 'duplicate_invoice': a typeless row is not a duplicate,
              // and saying so would put a red כפילות badge on something nobody
              // classified. An empty type falls through to the gray raw-label badge.
              type:        (r.type as AlertType) ?? '',
              date:        r.created_at ? fmtDate(r.created_at as string) : '',
              description: String(r.message ?? ''),
              status:      ((r.status === 'unread' ? 'new' : r.status) ?? (r.resolved ? 'resolved' : 'new')) as AlertStatus,
              supplier:    payload?.typedSupplierName as string | undefined,
              relatedId:   undefined,
              payload:     payload ?? undefined,
            } satisfies Alert
          }),
        )
      } else {
        console.warn(
          '[useAlerts] falling back to mockAlerts — supabase returned no rows or an error:',
          error ?? '(no rows)',
        )
        setData(mockAlerts.filter((a) => tierAllowsAlert(a.type)))
      }
    } catch (e) {
      console.warn('[useAlerts] falling back to mockAlerts — exception thrown:', e)
      setData(mockAlerts)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const markRead = async (id: string) => {
    // Optimistic update first
    setData((prev) => prev.map((a) => a.id === id ? { ...a, status: 'read' as AlertStatus } : a))
    await supabase.from('alerts').update({ status: 'read' }).eq('id', id)
  }

  const markResolved = async (id: string) => {
    setData((prev) => prev.map((a) => a.id === id ? { ...a, status: 'resolved' as AlertStatus } : a))
    await supabase.from('alerts').update({ status: 'resolved', resolved: true }).eq('id', id)
  }

  const remove = async (id: string) => {
    setData((prev) => prev.filter((a) => a.id !== id))
    await supabase.from('alerts').delete().eq('id', id)
  }

  return { data, loading, markRead, markResolved, remove, reload: load }
}
