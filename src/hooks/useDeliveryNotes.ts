import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockDeliveryNotes, type DeliveryNote } from '../data/mockData'

export function useDeliveryNotes() {
  const [data, setData] = useState<DeliveryNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('delivery_notes').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows as DeliveryNote[])
      } else {
        setData(mockDeliveryNotes)
        if (err) setError(err.message)
      }
    } catch {
      setData(mockDeliveryNotes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const update = async (id: string, body: Partial<DeliveryNote> & { invoiceId?: string }) => {
    await api.put(`/delivery-notes/${id}`, body)
    await load()
  }

  const link = async (id: string, invoiceId: string) => {
    await api.put(`/delivery-notes/${id}/link`, { invoice_id: invoiceId })
    await load()
  }

  const unlink = async (id: string) => {
    await api.put(`/delivery-notes/${id}/unlink`, {})
    await load()
  }

  const remove = async (id: string) => {
    await api.delete(`/delivery-notes/${id}`)
    await load()
  }

  return { data, loading, error, update, link, unlink, remove }
}
