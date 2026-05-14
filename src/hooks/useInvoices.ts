import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockInvoices, type Invoice } from '../data/mockData'

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const parts = iso.split('T')[0].split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

export function useInvoices() {
  const [data, setData]       = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('invoices').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows.map(r => ({
          // Spread raw DB row first so any extra N8N fields are preserved
          ...r,
          // ── renamed columns: DB name → frontend name ──────────────────────
          supplierId:        r.supplier_id        ?? '',
          supplier:          r.supplier_name      ?? '',
          invoiceNumber:     r.invoice_number     ?? '',
          invoiceDate:       r.invoice_date       ?? '',
          date:              isoToDisplay(r.invoice_date ?? ''),
          amountBeforeVat:   Number(r.amount_before_vat ?? 0),
          vat:               Number(r.vat_amount         ?? 0),
          amount:            Number(r.total_amount       ?? 0),
          lineDetails:       r.line_items         ?? '',
          senderName:        r.sender_name        ?? '',
          senderEmail:       r.email_sender       ?? '',
          driveFileLink:     r.drive_file_link    ?? '',
          monthFolderLink:   r.drive_folder_link  ?? '',
          originalEmailLink: r.message_link       ?? '',
          emailReceivedAt:   r.received_at        ?? '',
          n8nErrorLink:      r.execution_log_url  ?? '',
          decodeQuality:     r.ai_confidence      ?? '',
          // sentToAccountant derived from transferred_at timestamp
          sentToAccountant:  r.transferred_at != null,
          isDuplicate:       r.is_duplicate       ?? false,
          hasError:          r.has_error          ?? false,
          status:            r.status             ?? '',
          category:          r.category           ?? '',
          // duplicateFlag derived from is_duplicate (no DB column)
          duplicateFlag:     r.is_duplicate ? ('כפילות אפשרית' as const) : null,
          duplicateNote:     '',
          // Fields with no DB column — safe defaults
          isPartialReturn:   false,
          emailId:           '',
          uploadDate:        '',
        })) as Invoice[])
        setError(null)
      } else {
        setData(mockInvoices)
        if (err) setError(err.message)
      }
    } catch {
      setData(mockInvoices)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (body: Partial<Invoice>) => {
    console.log('[useInvoices] create payload:', body)
    try {
      const res = await api.post('/invoices', body)
      console.log('[useInvoices] create response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useInvoices] create error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const update = async (id: string, body: Partial<Invoice>) => {
    console.log('[useInvoices] update payload:', { id, ...body })
    try {
      const res = await api.put(`/invoices/${id}`, body)
      console.log('[useInvoices] update response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useInvoices] update error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const updateStatus = async (id: string, status: string) => {
    console.log('[useInvoices] updateStatus:', { id, status })
    try {
      const res = await api.put(`/invoices/${id}/status`, { status })
      console.log('[useInvoices] updateStatus response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useInvoices] updateStatus error:', msg)
      setError(`שגיאה בעדכון סטטוס: ${msg}`)
      throw err
    }
  }

  const remove = async (id: string) => {
    console.log('[useInvoices] delete id:', id)
    try {
      const res = await api.delete(`/invoices/${id}`)
      console.log('[useInvoices] delete response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useInvoices] delete error:', msg)
      setError(`שגיאה במחיקה: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, create, update, updateStatus, remove }
}
