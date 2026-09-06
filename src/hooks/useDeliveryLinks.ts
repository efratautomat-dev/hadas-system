import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { subscribe } from '../lib/dataBus'

// ── Which invoices belong to which delivery ──────────────────────────────────
//
// `delivery_note_invoices` is the many-to-many, and until now NOTHING on the
// frontend read it. Screens read `delivery_notes.invoice_id`, a single column kept
// for backward compatibility — so attaching a second invoice wrote both rows to
// the link table, overwrote that column, and the second invoice vanished from the
// screen while remaining perfectly linked in the database.
//
// Both directions of the relationship are real and the owner named both:
//
//   several invoices on ONE delivery — the supplier billed it in parts
//   one invoice across SEVERAL deliveries — he combined a week, or a delivery was
//     split because only part of it arrived
//
// The second direction always worked, because each delivery carries its own
// `invoice_id`. The first was invisible.

export interface DeliveryLink {
  deliveryNoteId: string
  invoiceId: string
}

export function useDeliveryLinks() {
  const [data, setData] = useState<DeliveryLink[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: rows } = await supabase
      .from('delivery_note_invoices')
      .select('delivery_note_id, invoice_id')
    setData((rows ?? []).map(r => ({
      deliveryNoteId: String(r.delivery_note_id),
      invoiceId:      String(r.invoice_id),
    })))
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])
  useEffect(() => subscribe(['delivery_notes', 'invoices'], load), [load])

  /** Invoice ids attached to one delivery. */
  const invoicesFor = useCallback(
    (noteId: string) => data.filter(l => l.deliveryNoteId === noteId).map(l => l.invoiceId),
    [data])

  /** Delivery ids one invoice covers — the consolidated case. */
  const deliveriesFor = useCallback(
    (invoiceId: string) => data.filter(l => l.invoiceId === invoiceId).map(l => l.deliveryNoteId),
    [data])

  return { data, loading, invoicesFor, deliveriesFor, reload: load }
}
