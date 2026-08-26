import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockInvoices, type Invoice } from '../data/mockData'
import { isoToDisplay } from '../lib/dates'


export function useInvoices() {
  const [data, setData]       = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase
        .from('invoices_v')   // role-aware view: cost columns NULL for employees (DB-enforced)
        .select('*')
        .order('invoice_date', { ascending: false, nullsFirst: false })
        .order('received_at', { ascending: false, nullsFirst: false })
      if (!err && rows && rows.length > 0) {
        setData(rows.map(r => ({
          // Spread raw DB row first so any extra N8N fields are preserved
          ...r,
          // ── renamed columns: DB name → frontend name ──────────────────────
          supplierId:        r.supplier_id        ?? '',
          supplier:          r.supplier_name      ?? '',
          invoiceNumber:     r.invoice_number     ?? '',
          invoiceDate:       (r.invoice_date       ?? '').slice(0, 10),
          date:              isoToDisplay(r.invoice_date ?? ''),
          amountBeforeVat:   Number(r.amount_before_vat ?? 0),
          vat:               Number(r.vat_amount         ?? 0),
          amount:            Number(r.total_amount       ?? 0),
          lineDetails:       r.line_items         ?? '',
          senderName:        r.sender_name        ?? '',
          senderEmail:       r.email_sender       ?? '',
          driveFileLink:     r.drive_file_link    ?? '',
          storage_url:       r.storage_url        ?? null,
          monthFolderLink:   r.drive_folder_link  ?? '',
          originalEmailLink: r.message_link       ?? '',
          emailReceivedAt:   (r.received_at        ?? '').slice(0, 16),
          createdAt:         r.created_at         ?? '',
          n8nErrorLink:      r.execution_log_url  ?? '',
          decodeQuality:     r.ai_confidence      ?? '',
          // sentToAccountant derived from transferred_at timestamp
          sentToAccountant:  r.transferred_at != null,
          isDuplicate:       r.is_duplicate       ?? false,
          hasError:          r.has_error          ?? false,
          awaitingApproval:  r.awaiting_approval  ?? false,
          // The pipeline's own gate — a TIMESTAMP, not a flag, so absence is the
          // pending state. Mapped explicitly even though `...r` already carries the
          // snake_case column, so the field the ledger reads is typed and greppable.
          ledgerApprovedAt:  r.ledger_approved_at ?? null,
          notes:             r.notes              ?? '',
          status:            r.status             ?? '',
          category:          r.category           ?? '',
          // duplicateFlag derived from is_duplicate (no DB column)
          duplicateFlag:     r.is_duplicate ? ('כפילות אפשרית' as const) : null,
          duplicateNote:     '',
          isPartialReturn:   r.partial_return ?? false,
          emailSubject:      r.email_subject ?? '',
          gmailMessageId:    r.gmail_message_id ?? '',
          // Fields with no DB column — safe defaults
          emailId:           '',
          uploadDate:        '',
        })) as Invoice[])
        setError(null)
      } else {
        console.warn(
          '[useInvoices] falling back to mockInvoices — supabase returned no rows or an error:',
          err ?? '(no rows)',
        )
        setData(mockInvoices)
        if (err) setError(err.message)
      }
    } catch (e) {
      console.warn('[useInvoices] falling back to mockInvoices — exception thrown:', e)
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

  // ─── The goods pipeline's gate into the ledger (§6.e) ──────────────────────
  // NOT the ₪20K threshold gate — that one is cleared from the alerts screen via
  // `PUT /invoices/:id/approve`. This one lets a goods↔invoice PAIR into the ledger,
  // and approving once moves every delivery note attached to the invoice, which is
  // what makes a consolidated invoice one decision instead of five (§6.7).
  // Returns how many notes moved so the caller can say so.
  const ledgerApprove = async (id: string): Promise<number> => {
    try {
      const res = await api.put(`/invoices/${id}/ledger-approve`, {})
      await load()
      return (res as { notesMoved?: number }).notesMoved ?? 0
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useInvoices] ledgerApprove error:', msg)
      setError(`שגיאה באישור לכרטסת: ${msg}`)
      throw err
    }
  }

  // Reversible on purpose (§6.14): an approval given by mistake is a mistake about a
  // pair, not about a document, and taking it back destroys nothing.
  const ledgerUnapprove = async (id: string): Promise<number> => {
    try {
      const res = await api.put(`/invoices/${id}/ledger-unapprove`, {})
      await load()
      return (res as { notesMoved?: number }).notesMoved ?? 0
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useInvoices] ledgerUnapprove error:', msg)
      setError(`שגיאה בביטול האישור: ${msg}`)
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

  return { data, loading, error, create, update, updateStatus, remove, ledgerApprove, ledgerUnapprove }
}
