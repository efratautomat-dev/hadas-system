// ─── DEMO DATA ADAPTER ───────────────────────────────────────────────────────
// Reads the curated, 100% fictitious demo-seed.json from the project root and
// maps every record into the *DB-column shape* that the existing data hooks
// (useSuppliers / useInvoices / usePayments / useReturns / useStatements /
// useAlerts / useDeliveryNotes / useEmployees) already know how to consume.
//
// Because the hooks map snake_case DB columns → camelCase UI fields, we emit rows
// in that same snake_case shape so the real mapping logic runs untouched — no
// component or hook is modified for demo mode.
//
// The seed file itself is the single source of truth and is NEVER edited here.
// The only place this adapter goes beyond a pure field-rename is documented inline
// (the duplicate-invoice pair, which materialises exactly the scenario the seed's
// own "חשבונית כפולה" alert describes, and a small set of delivery notes derived
// from seed suppliers so the dashboard doesn't fall back to unrelated legacy mock).

import seed from '../../demo-seed.json'
import { vatRateFor } from '../lib/vat'

type Row = Record<string, unknown>

// Origin-based URL to the bundled sample document, used so the in-app PDF/preview
// modal renders a real page without any Supabase Storage call.
const demoDoc = (file: string) =>
  (typeof window !== 'undefined' ? window.location.origin : '') + '/demo/' + file

const DOC_URL = demoDoc('sample-invoice.html')

// ── lookups ──────────────────────────────────────────────────────────────────
const nameToId: Record<string, string> = {}
for (const s of seed.suppliers) nameToId[s.name] = s.id

// ── suppliers ────────────────────────────────────────────────────────────────
// useSuppliers reads: id, name, hp, contact, opening_balance, email, phone, category
const suppliers: Row[] = seed.suppliers.map((s) => ({
  id: s.id,
  name: s.name,
  hp: s.tax_id,
  contact: '',
  email: s.email,
  phone: s.phone,
  category: s.category,
  opening_balance: 0,
}))

// ── invoices ─────────────────────────────────────────────────────────────────
// The seed's "חשבונית כפולה" alert states invoice 4471 from "הדפסות רימון" was
// ingested twice. We materialise that exact pair by aligning two existing seed
// invoices from that supplier (inv_025 / inv_026) onto invoice number 4471 and
// flagging both — making the dataset internally consistent so the duplicate
// comparison modal is demonstrable. No invoices are added or removed.
const DUP_PAIR = new Set(['inv_025', 'inv_026'])

const invoices: Row[] = seed.invoices.map((inv) => {
  const isDup = DUP_PAIR.has(inv.id)
  // Split at the rate in force on the invoice's own date (17% → 18% on 1.1.2025).
  const before = Math.round(inv.amount / (1 + vatRateFor(inv.date)))
  return {
    id: inv.id,
    invoice_number: isDup ? '4471' : inv.number,
    invoice_date: inv.date,
    received_at: `${inv.date}T09:00:00`,
    total_amount: inv.amount,
    amount_before_vat: before,
    vat_amount: inv.amount - before,
    supplier_id: inv.supplier_id,
    supplier_name: inv.supplier_name,
    category: inv.category,
    status: inv.status,
    is_duplicate: isDup,
    has_error: false,
    // Paid invoices are treated as already forwarded to the accountant so the
    // derived-status badges show a realistic mix (green "הועבר לרו״ח").
    transferred_at: inv.status === 'שולם' ? `${inv.date}T12:00:00` : null,
    storage_url: DOC_URL,
    drive_file_link: DOC_URL,
    sender_name: inv.supplier_name,
    email_sender: nameToId[inv.supplier_name] ? `${inv.supplier_id}@demo.co.il` : '',
    email_subject: `חשבונית ${isDup ? '4471' : inv.number} — ${inv.supplier_name}`,
  }
})

// ── payments ─────────────────────────────────────────────────────────────────
// usePayments reads: payment_type, payment_date, reference, value_date, amount,
// status, supplier_id, bizbox_exported_at, created_at
const payments: Row[] = seed.payments.map((p) => ({
  id: p.id,
  supplier_id: nameToId[p.supplier_name] ?? '',
  amount: p.amount,
  payment_type: p.method,
  payment_date: p.date,
  value_date: p.date,
  reference: p.invoice_id,
  notes: '',
  status: 'paid',
  bizbox_exported_at: null,
  created_at: `${p.date}T08:00:00`,
}))

// ── returns ──────────────────────────────────────────────────────────────────
// useReturns reads DB columns; ReturnStatus is one of אושר|בטיפול|נדחה, so the
// seed's Hebrew lifecycle labels are mapped onto that union.
const RETURN_STATUS: Record<string, string> = {
  'הסתיים': 'אושר',
  'ממתין לזיכוי': 'בטיפול',
}
const returns: Row[] = seed.returns.map((r) => ({
  id: r.id,
  supplier_id: nameToId[r.supplier_name] ?? '',
  date: r.date,
  amount: r.amount,
  reason: r.reason,
  detail: '',
  invoice_id: null,
  status: RETURN_STATUS[r.status] ?? 'בטיפול',
  employee_id: null,
  created_by: 'דנה לוי',
  drive_file_link: r.credit_note_number ? DOC_URL : '',
  supplier_credit_note_number: r.credit_note_number,
  supplier_credit_note_date: r.credit_note_date,
  supplier_credit_note_amount: r.credit_note_amount,
}))

// ── vendor_statements ────────────────────────────────────────────────────────
// useStatements reads: supplier_id, month, our_balance, vendor_balance, diff,
// status, uploaded_at, storage_url, drive_file_link, email_sender, match_method
// (+ resolution_notes — the manager's reconciliation note).
//
// `closing_balance` is what the SUPPLIER's document says. `our_balance` is left
// to the screen, which recomputes it live from these same invoices/payments via
// the shared ledger engine — so the demo can never show a figure the seed's own
// rows don't produce. Each statement's document is a bundled HTML page under
// public/demo/ whose rows add up to exactly that closing balance; the seed's
// `_why` field records what explains each gap.
const vendor_statements: Row[] = seed.vendor_statements.map((v) => ({
  id: v.id,
  // An empty supplier_name is an ORPHAN — arrived with no supplier match at all.
  supplier_id: v.supplier_name ? nameToId[v.supplier_name] ?? '' : '',
  month: v.period,
  our_balance: 0,
  vendor_balance: v.closing_balance,
  diff: 0,
  status: v.status,
  uploaded_at: v.uploaded_at,
  storage_url: demoDoc(v.document),
  drive_file_link: null,
  email_sender: v.email_sender,
  match_method: v.match_method,
  resolution_notes: v.resolution_notes,
}))

// ── alerts ───────────────────────────────────────────────────────────────────
// useAlerts reads: id, type, created_at, message, status, payload (or details).
// Alert.supplier is taken from payload.typedSupplierName; routing keys come from
// payload (existingInvoiceId / supplierId / supplierName). Seed types are kept
// verbatim; 'supplier_incomplete' gets a badge via the demo-safe config entry
// added in Alerts.tsx. The duplicate alert points at one half of the 4471 pair.
const ALERT_DATE: Record<string, string> = {
  al_01: '2026-06-12',
  al_02: '2026-06-11',
  al_03: '2026-06-10',
  al_04: '2026-06-09',
  al_05: '2026-06-08',
  al_06: '2026-07-02',
}
const ALERT_STATUS: Record<string, string> = {
  al_01: 'unread',
  al_02: 'unread',
  al_03: 'unread',
  al_04: 'read',
  al_05: 'unread',
  al_06: 'unread',
}
function alertPayload(a: (typeof seed.alerts)[number]): Row {
  switch (a.type) {
    case 'invoice_duplicate':
      return {
        typedSupplierName: 'הדפסות רימון',
        existingInvoiceId: 'inv_026',
        invoiceNumber: '4471',
        supplierId: 'sup_03',
      }
    case 'supplier_incomplete':
      return { typedSupplierName: 'חוטי זוהר', supplierId: a.entity_id ?? '' }
    case 'unmatched_credit_note':
      return { typedSupplierName: 'מכבסת היוקרה', supplierName: 'מכבסת היוקרה', supplierId: 'sup_09' }
    case 'invoice_old_date':
      return { existingInvoiceId: a.entity_id ?? '', invoiceId: a.entity_id ?? '' }
    // statementId is the routing key the alerts screen uses to deep-link into
    // ONE statement's reconciliation page (Alerts.routeAlert).
    case 'statement_mismatch':
      return { statementId: a.entity_id ?? '', typedSupplierName: 'הדפסות רימון', supplierId: 'sup_03' }
    default:
      return {}
  }
}
const alerts: Row[] = seed.alerts.map((a) => ({
  id: a.id,
  type: a.type,
  created_at: ALERT_DATE[a.id] ?? '2026-06-08',
  message: a.detail,
  status: ALERT_STATUS[a.id] ?? 'unread',
  resolved: false,
  payload: alertPayload(a),
}))

// ── delivery_notes ───────────────────────────────────────────────────────────
// The seed has no delivery notes, but the dashboard shows a "תעודות משלוח" card
// and useDeliveryNotes falls back to unrelated legacy mock data on an empty
// result — which would put off-brand names on screen. So we derive a few notes
// straight from seed suppliers/invoices to keep everything consistent.
const delivery_notes: Row[] = [
  { id: 'dn_01', supplier_id: 'sup_02', supplier_name: 'אריזות שקד',       date: '2026-06-03', amount: 7700,  status: 'pending',  invoice_id: null,    drive_file_link: DOC_URL },
  { id: 'dn_02', supplier_id: 'sup_07', supplier_name: 'חוטי זוהר',        date: '2026-06-06', amount: 21400, status: 'pending',  invoice_id: null,    drive_file_link: DOC_URL },
  { id: 'dn_03', supplier_id: 'sup_04', supplier_name: 'סיטונאות אופיר',   date: '2026-06-02', amount: 5850,  status: 'archived', invoice_id: 'inv_033', drive_file_link: DOC_URL },
  { id: 'dn_04', supplier_id: 'sup_03', supplier_name: 'הדפסות רימון',     date: '2026-06-11', amount: 7190,  status: 'archived', invoice_id: 'inv_025', drive_file_link: DOC_URL },
]

// ── employees ────────────────────────────────────────────────────────────────
const employees: Row[] = [
  { id: 'emp_01', name: 'דנה לוי',  role: 'מנהלת', phone: '', active: true, created_at: '2026-01-01' },
  { id: 'emp_02', name: 'נועה כהן', role: 'עובדת', phone: '', active: true, created_at: '2026-01-01' },
]

// ── demo user (injected by the stubbed auth so the full manager UI renders) ───
const demoMeta = seed._meta.demo_user
export const demoUser = {
  id: 'demo-manager',
  email: demoMeta.email,
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'demo' },
  user_metadata: { name: demoMeta.name, role: demoMeta.role },
  created_at: '2026-01-01T00:00:00Z',
}

// allowed_users gates the manager role in useAuth.fetchRole — return the demo
// manager so the full app (not the employee dashboard) is shown.
const allowed_users: Row[] = [{ email: demoMeta.email, role: demoMeta.role }]

// ── table registry consumed by the demo Supabase client ──────────────────────
export const demoTables: Record<string, Row[]> = {
  suppliers,
  invoices,
  payments,
  returns,
  vendor_statements,
  alerts,
  delivery_notes,
  employees,
  allowed_users,
  app_settings: [],
  system_logs: [],
}
