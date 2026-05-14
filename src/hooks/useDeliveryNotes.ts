import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockDeliveryNotes, type DeliveryNote } from '../data/mockData'

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const parts = iso.split('T')[0].split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

export function useDeliveryNotes() {
  const [data, setData]       = useState<DeliveryNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('delivery_notes').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows.map(r => ({
          ...r,
          supplierId:      r.supplier_id ?? '',
          supplierName:    r.supplier_name ?? '',
          // DB `date` column (ISO format) → isoDate frontend field
          isoDate:         r.date         ?? '',
          // derive display date from the ISO date
          date:            isoToDisplay(r.date ?? ''),
          // DB `invoice_id` column → linkedInvoiceId frontend field
          linkedInvoiceId: r.invoice_id   ?? undefined,
          amount:          Number(r.amount ?? 0),
          status:          r.status       ?? 'pending',
          // notes field doesn't exist in DB; omit it
        })) as DeliveryNote[])
        setError(null)
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
    console.log('[useDeliveryNotes] update payload:', { id, ...body })
    try {
      const res = await api.put(`/delivery-notes/${id}`, body)
      console.log('[useDeliveryNotes] update response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] update error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const link = async (id: string, invoiceId: string) => {
    console.log('[useDeliveryNotes] link:', { id, invoiceId })
    try {
      const res = await api.put(`/delivery-notes/${id}/link`, { invoice_id: invoiceId })
      console.log('[useDeliveryNotes] link response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] link error:', msg)
      setError(`שגיאה בשיוך חשבונית: ${msg}`)
      throw err
    }
  }

  const unlink = async (id: string) => {
    console.log('[useDeliveryNotes] unlink id:', id)
    try {
      const res = await api.put(`/delivery-notes/${id}/unlink`, {})
      console.log('[useDeliveryNotes] unlink response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] unlink error:', msg)
      setError(`שגיאה בביטול שיוך: ${msg}`)
      throw err
    }
  }

  const remove = async (id: string) => {
    console.log('[useDeliveryNotes] delete id:', id)
    try {
      const res = await api.delete(`/delivery-notes/${id}`)
      console.log('[useDeliveryNotes] delete response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] delete error:', msg)
      setError(`שגיאה במחיקה: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, update, link, unlink, remove }
}
