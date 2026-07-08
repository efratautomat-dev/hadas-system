import { useState, useEffect } from 'react'
import { Users, Plus, Search, Pencil, ChevronLeft, X, LayoutGrid, Table2 } from 'lucide-react'
import { useSuppliers } from '../hooks/useSuppliers'
import { useCategories } from '../hooks/useCategories'
import { STATUS } from '../theme/status'
import SupplierDetail, { type Supplier } from './SupplierDetail'
import { Button } from './ui/Button'

// Active/inactive uses the FIXED functional tokens (green = active, gray = inactive),
// never the brand palette — so the state reads the same after any reskin.
const activePill = (active: boolean) => active ? STATUS.green : STATUS.gray

// "current balance as of today" — the balance figure is the computed live balance;
// this stamps it with today's date so the number is unambiguous.
function todayHe(): string {
  return new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function useIsTablet() {
  const [v, setV] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth <= 1024
  )
  useEffect(() => {
    const h = () => setV(window.innerWidth >= 768 && window.innerWidth <= 1024)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

const CATEGORIES = [
  'ספקים ביגוד',
  'ספקים כיסויי ראש',
  'ספקים בגדי ים',
  'ספקים שונות',
  'הוצאות ניהול',
  'הוצאות משרד',
  'תשלומי מס הכנסה',
  'משכורות',
  'שונות',
]

const categoryColors: Record<string, { bg: string; color: string }> = {
  'ספקים ביגוד':       { bg: '#EFF6FF', color: '#1D4ED8' },
  'ספקים כיסויי ראש':  { bg: '#FDF4FF', color: '#9333EA' },
  'ספקים בגדי ים':     { bg: '#F0FDFA', color: '#0F766E' },
  'ספקים שונות':       { bg: '#F3F4F6', color: '#4B5563' },
  'הוצאות ניהול':      { bg: '#FFF7ED', color: '#C2410C' },
  'הוצאות משרד':       { bg: '#FEF9C3', color: '#92400E' },
  'תשלומי מס הכנסה':   { bg: '#FFF1F2', color: '#BE123C' },
  'משכורות':           { bg: '#F0FDF4', color: '#16A34A' },
  'שונות':             { bg: '#F3F4F6', color: '#6B7280' },
  // legacy mock categories
  'מוצרי חלב':         { bg: '#EFF6FF', color: '#1D4ED8' },
  'משקאות':            { bg: '#F0FDF4', color: '#16A34A' },
  'מזון יבש':          { bg: '#FFF7ED', color: '#C2410C' },
  'ממתקים':            { bg: '#FDF4FF', color: '#9333EA' },
  'שתייה חמה':         { bg: '#FEF3C7', color: '#92400E' },
  'מאפים':             { bg: '#FFF1F2', color: '#BE123C' },
}

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

// ── Shared bits (used by both card and table views) ─────────────────────────
function StatusPill({ status }: { status: string }) {
  const sw = activePill(status === 'פעיל')
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap"
      style={{ fontSize: '12px', padding: '4px 11px', background: sw.bg, color: sw.fg }}
    >
      <span style={{ width: '6px', height: '6px', borderRadius: '999px', background: sw.fg }} />
      {status}
    </span>
  )
}

function CategoryChip({ category }: { category: string }) {
  const c = categoryColors[category] ?? { bg: '#F3F4F6', color: '#6B7280' }
  return (
    <span
      className="inline-block rounded-full font-medium truncate align-middle"
      style={{ fontSize: '12px', padding: '4px 11px', background: c.bg, color: c.color, maxWidth: '100%' }}
      title={category}
    >
      {category || '—'}
    </span>
  )
}

// ─── Form types ─────────────────────────────────────────────────────────────

type EditFormState = {
  name: string
  hp: string
  category: string
  contact: string
  email: string
  phone: string
  openingBalance: string
  openingBalanceDate: string
  notes: string
}

const emptyForm: EditFormState = {
  name: '', hp: '', category: CATEGORIES[0],
  contact: '', email: '', phone: '',
  openingBalance: '', openingBalanceDate: '',
  notes: '',
}

const inputBase: React.CSSProperties = {
  height: '44px', padding: '0 14px', fontSize: '16px',
  outline: 'none', border: '1px solid #DEDFE5', borderRadius: '12px',
  background: 'white', width: '100%', color: '#1F2937', boxSizing: 'border-box',
}

const textareaBase: React.CSSProperties = {
  padding: '12px 14px', fontSize: '16px',
  outline: 'none', border: '1px solid #EEEEF2', borderRadius: '12px',
  background: 'white', width: '100%', color: '#1F2937',
  resize: 'vertical', minHeight: '80px', boxSizing: 'border-box',
}

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = 'var(--brand-primary)'
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = '#DEDFE5'
}

function FormField({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-right mb-1.5" style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>
        {label}
        {required && <span style={{ color: 'var(--brand-primary)' }}> *</span>}
      </p>
      {children}
    </div>
  )
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="flex-1 h-px" style={{ background: '#EEEEF2' }} />
      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand-primary)', whiteSpace: 'nowrap', letterSpacing: '0.05em' }}>
        {title}
      </span>
    </div>
  )
}

function SupplierFormCard({
  title, form, onChange, onSave, onCancel,
}: {
  title: string
  form: EditFormState
  onChange: (f: EditFormState) => void
  onSave: () => void
  onCancel: () => void
}) {
  const canSave = form.name.trim().length > 0

  // Category options come from the managed pool (Settings → categories); fall back
  // to the built-in list if the pool is empty/unavailable, and always keep the
  // current value selectable.
  const { data: cats } = useCategories()
  const managed = cats.map(c => c.name)
  const base = managed.length ? managed : CATEGORIES
  const catOptions = form.category && !base.includes(form.category) ? [form.category, ...base] : base

  return (
    <div className="bg-white rounded-2xl flex flex-col" style={{ border: '1px solid #EEEEF2' }}>
      <div className="p-5 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={onCancel}
            className="text-gray-400 transition-colors rounded-lg p-1"
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}
          >
            <X className="w-4 h-4" />
          </button>
          <h3 className="font-semibold text-right" style={{ fontSize: '16px', color: '#1A1A2E' }}>{title}</h3>
        </div>

        {/* ── קבוצה 1: פרטי זיהוי ── */}
        <div>
          <GroupHeader title="פרטי זיהוי" />
          <div className="flex flex-col gap-3">
            <FormField label="שם ספק" required>
              <input
                value={form.name}
                onChange={(e) => onChange({ ...form, name: e.target.value })}
                placeholder="שם הספק"
                className="text-right placeholder-gray-300"
                style={inputBase}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </FormField>

            <FormField label="ח.פ / ע.מ">
              <input
                value={form.hp}
                onChange={(e) => onChange({ ...form, hp: e.target.value })}
                placeholder="000000000"
                dir="ltr"
                className="text-left placeholder-gray-300"
                style={inputBase}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </FormField>

            <FormField label="קטגוריה">
              <select
                value={form.category}
                onChange={(e) => onChange({ ...form, category: e.target.value })}
                style={{ ...inputBase, direction: 'rtl', cursor: 'pointer' }}
                onFocus={focusBorder}
                onBlur={blurBorder}
              >
                {catOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </FormField>
          </div>
        </div>

        {/* ── קבוצה 2: פרטי קשר ── */}
        <div>
          <GroupHeader title="פרטי קשר" />
          <div className="flex flex-col gap-3">
            <FormField label="שם איש קשר">
              <input
                value={form.contact}
                onChange={(e) => onChange({ ...form, contact: e.target.value })}
                placeholder="שם מלא"
                className="text-right placeholder-gray-300"
                style={inputBase}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </FormField>

            <FormField label="מייל">
              <input
                type="email"
                value={form.email}
                onChange={(e) => onChange({ ...form, email: e.target.value })}
                placeholder="name@company.co.il"
                dir="ltr"
                className="text-left placeholder-gray-300"
                style={inputBase}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </FormField>

            <FormField label="טלפון">
              <input
                value={form.phone}
                onChange={(e) => onChange({ ...form, phone: e.target.value })}
                placeholder="0X-XXXXXXX"
                dir="ltr"
                className="text-left placeholder-gray-300"
                style={inputBase}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </FormField>
          </div>
        </div>

        {/* ── קבוצה 3: כספי ── */}
        <div>
          <GroupHeader title="כספי" />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="יתרת פתיחה">
              <input
                type="number"
                value={form.openingBalance}
                onChange={(e) => onChange({ ...form, openingBalance: e.target.value })}
                placeholder="0"
                dir="ltr"
                className="text-left placeholder-gray-300"
                style={inputBase}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </FormField>
            <FormField label="תאריך יתרת פתיחה">
              <input
                type="date"
                value={form.openingBalanceDate}
                onChange={(e) => onChange({ ...form, openingBalanceDate: e.target.value })}
                style={{ ...inputBase, direction: 'ltr' }}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </FormField>
          </div>
        </div>

        {/* ── קבוצה 4: כללי ── */}
        <div>
          <GroupHeader title="כללי" />
          <FormField label="הערות">
            <textarea
              value={form.notes}
              onChange={(e) => onChange({ ...form, notes: e.target.value })}
              placeholder="הערות נוספות..."
              className="text-right placeholder-gray-300"
              style={textareaBase}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </FormField>
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex gap-2 px-5 pb-5">
        <Button
          type="button"
          variant="primary"
          onClick={onSave}
          disabled={!canSave}
          className="flex-1"
        >
          שמור
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="flex-1"
        >
          ביטול
        </Button>
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'פעיל' | 'לא פעיל'

function supplierToForm(sup: Supplier): EditFormState {
  return {
    name: sup.name,
    hp: sup.hp ?? '',
    category: CATEGORIES.includes(sup.category) ? sup.category : CATEGORIES[0],
    contact: sup.contact,
    email: sup.email ?? '',
    phone: sup.phone,
    openingBalance: sup.openingBalance !== undefined ? String(sup.openingBalance) : '',
    openingBalanceDate: sup.openingBalanceDate ?? '',
    notes: sup.notes ?? '',
  }
}

interface AlertPrefill {
  alertId:      string
  supplierName: string
  payload:      Record<string, unknown>
}

interface SuppliersProps {
  onViewLedger?: (supplierId: string) => void
  onViewPayments?: (supplierName: string) => void
  controlledViewId?: string | null
  // When set, the supplier whose name matches is opened in detail view.
  // Used by unmatched_credit_note alerts whose payload only carries the supplier's name.
  // Falls back to the list view if no matching supplier exists.
  controlledViewName?: string | null
  onOpenDetail?: (id: string) => void
  onCloseDetail?: () => void
  onOpenInvoice?: (invoiceId: string) => void
  prefillForAlert?: AlertPrefill | null
  onAlertSupplierCreated?: (supplierId: string, alertId: string, payload: Record<string, unknown>) => Promise<void>
  onCancelAlertPrefill?: () => void
}

export default function Suppliers({
  onViewLedger,
  onViewPayments,
  controlledViewId,
  controlledViewName,
  onOpenDetail,
  onCloseDetail,
  onOpenInvoice,
  prefillForAlert,
  onAlertSupplierCreated,
  onCancelAlertPrefill,
}: SuppliersProps) {
  const isTablet = useIsTablet()
  const { data: serverSuppliers, loading, error, create: createSupplier, update: updateSupplier, remove: removeSupplier } = useSuppliers()

  const [suppliers, setSuppliers]         = useState<Supplier[]>([])
  const [internalViewId, setInternalViewId] = useState<string | null>(null)
  // Resolve viewId from explicit ID first, then from name lookup, then from internal state.
  const nameMatchId = controlledViewName
    ? (suppliers.find(s => s.name === controlledViewName)?.id ?? null)
    : null
  const viewId    = controlledViewId !== undefined ? controlledViewId
                  : nameMatchId !== null            ? nameMatchId
                  : internalViewId
  const openDetail  = (id: string) => onOpenDetail  ? onOpenDetail(id)  : setInternalViewId(id)
  const closeDetail = ()           => onCloseDetail ? onCloseDetail()    : setInternalViewId(null)
  const [editingId,  setEditingId]     = useState<string | null>(null)
  const [editForm,   setEditForm]      = useState<EditFormState | null>(null)
  const [showAdd,    setShowAdd]       = useState(false)
  const [addForm,    setAddForm]       = useState<EditFormState>({ ...emptyForm })
  const [search,     setSearch]        = useState('')
  // Default to active-only: inactive suppliers are hidden until the user picks
  // the "לא פעילים" filter (deactivation replaces hard delete — spec/01-PRD.md §2).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('פעיל')
  // Card vs table view — cards for overview, table for dense scanning. Remembered
  // per session (sessionStorage), so it resets on a new session but persists across
  // navigation within one.
  const [view, setView] = useState<'cards' | 'table'>(
    () => (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('suppliersView') === 'table') ? 'table' : 'cards',
  )
  const setViewPersist = (v: 'cards' | 'table') => {
    setView(v)
    try { sessionStorage.setItem('suppliersView', v) } catch { /* ignore */ }
  }

  useEffect(() => {
    setSuppliers([...serverSuppliers] as Supplier[])
  }, [serverSuppliers])

  // Auto-open Add form when arriving from an alert with a prefilled supplier name
  useEffect(() => {
    if (prefillForAlert?.supplierName) {
      setAddForm({ ...emptyForm, name: prefillForAlert.supplierName })
      setShowAdd(true)
    }
  }, [prefillForAlert])

  // ── Detail view ───────────────────────────────────────────────────────────
  if (viewId) {
    const sup = suppliers.find((s) => s.id === viewId)
    if (!sup) return null
    return (
      <SupplierDetail
        supplier={sup}
        onBack={closeDetail}
        onEdit={() => {
          closeDetail()
          setEditingId(sup.id)
          setEditForm(supplierToForm(sup))
        }}
        onDelete={async () => {
          closeDetail()
          try {
            await removeSupplier(sup.id)
          } catch {
            // hook sets error state
          }
        }}
        onViewLedger={onViewLedger ? () => onViewLedger(sup.id) : undefined}
        onViewPayments={onViewPayments ? () => onViewPayments(sup.name) : undefined}
        onOpenInvoice={onOpenInvoice}
        onToggleActive={async (nextActive: boolean) => {
          try {
            await updateSupplier(sup.id, { active: nextActive })
          } catch {
            // hook sets error state
          }
        }}
      />
    )
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const startEdit = (sup: Supplier) => {
    setEditingId(sup.id)
    setEditForm(supplierToForm(sup))
  }

  const saveEdit = async () => {
    if (!editForm || !editingId) return
    const balance = editForm.openingBalance ? Number(editForm.openingBalance) : 0
    const body = {
      name: editForm.name, hp: editForm.hp, category: editForm.category,
      contact: editForm.contact, email: editForm.email, phone: editForm.phone,
      openingBalance: balance, openingBalanceDate: editForm.openingBalanceDate,
      notes: editForm.notes,
    }
    const savedId = editingId
    setEditingId(null)
    setEditForm(null)
    try {
      await updateSupplier(savedId, body)
    } catch {
      // hook sets error state
    }
  }

  const saveAdd = async () => {
    if (!addForm.name.trim()) return
    const balance = addForm.openingBalance ? Number(addForm.openingBalance) : 0
    const body = {
      name: addForm.name, hp: addForm.hp, category: addForm.category,
      contact: addForm.contact, email: addForm.email, phone: addForm.phone,
      openingBalance: balance, openingBalanceDate: addForm.openingBalanceDate,
      notes: addForm.notes,
    }
    const pendingAlert = prefillForAlert   // capture before UI resets
    setShowAdd(false)
    setAddForm({ ...emptyForm })
    try {
      const newId = await createSupplier(body)
      if (pendingAlert && newId && onAlertSupplierCreated) {
        await onAlertSupplierCreated(newId, pendingAlert.alertId, pendingAlert.payload)
      }
    } catch {
      // hook sets error state
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const filtered = suppliers.filter((s) => {
    const q = search.trim().toLowerCase()
    // hp (ח.פ) match: compare both raw and digits-only, so "51-423-789" is found
    // by typing "514423789" and vice-versa.
    const qDigits  = q.replace(/\D/g, '')
    const hpDigits = (s.hp || '').replace(/\D/g, '')
    const matchSearch =
      !q ||
      (s.name || '').toLowerCase().includes(q) ||
      (s.contact || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q) ||
      (s.hp || '').toLowerCase().includes(q) ||
      (qDigits.length > 0 && hpDigits.includes(qDigits))
    const matchStatus = statusFilter === 'all' || s.status === statusFilter
    return matchSearch && matchStatus
  })

  const activeCount  = suppliers.filter((s) => s.status === 'פעיל').length
  const totalBalance = suppliers.reduce((sum, s) => sum + (Number(s.balance) || 0), 0)
  const today = todayHe()

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading && suppliers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl p-3 text-sm text-right" style={{ background: '#FEF9C3', color: '#92400E' }}>
          לא ניתן לטעון נתונים מהשרת — מוצגים נתוני ברירת מחדל
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-right">
          <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>ספקים</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: isTablet ? '16px' : '14px' }}>
            {suppliers.length} ספקים במערכת
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => { setShowAdd(true); setAddForm({ ...emptyForm }) }}
          className="flex-shrink-0"
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          הוסף ספק
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'סה"כ ספקים',   value: String(suppliers.length), color: '#1F2937' },
          { label: 'ספקים פעילים', value: String(activeCount),       color: '#16A34A' },
          { label: 'יתרה כוללת',   value: formatILS(totalBalance),   color: '#1F2937' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-white rounded-2xl p-4 shadow-sm border text-center"
            style={{ borderColor: '#EEEEF2' }}
          >
            <p className="text-2xl" style={{ color, fontWeight: 500 }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: isTablet ? '15px' : '13px' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-white rounded-xl border p-1 flex-shrink-0" style={{ borderColor: '#EEEEF2' }}>
          {(['all', 'פעיל', 'לא פעיל'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className="rounded-lg px-3 font-medium transition-all"
              style={{
                minHeight: isTablet ? '40px' : '34px',
                fontSize: isTablet ? '16px' : '13px',
                background: statusFilter === f ? 'var(--brand-primary)' : 'transparent',
                color: statusFilter === f ? 'white' : '#6B7280',
              }}
            >
              {f === 'all' ? 'הכל' : f === 'פעיל' ? 'פעילים' : 'לא פעילים'}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-2 flex-1 bg-white rounded-xl border px-4"
          style={{ borderColor: '#EEEEF2', minHeight: '44px' }}
        >
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="חיפוש לפי שם, ח.פ, קטגוריה, איש קשר..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-gray-700 text-right"
            style={{ fontSize: '16px' }}
          />
        </div>

        {/* View toggle: cards ⇄ table (remembered per session) */}
        <div className="flex items-center gap-1 bg-white rounded-xl border p-1 flex-shrink-0" style={{ borderColor: '#EEEEF2' }}>
          {([
            { key: 'cards', Icon: LayoutGrid, label: 'תצוגת כרטיסים' },
            { key: 'table', Icon: Table2,     label: 'תצוגת טבלה' },
          ] as const).map(({ key, Icon, label }) => {
            const on = view === key
            return (
              <button
                key={key}
                onClick={() => setViewPersist(key)}
                title={label}
                aria-label={label}
                className="flex items-center justify-center rounded-lg transition-all"
                style={{
                  width: isTablet ? '44px' : '38px',
                  height: isTablet ? '40px' : '34px',
                  background: on ? 'var(--brand-primary)' : 'transparent',
                  color: on ? 'white' : '#9CA3AF',
                }}
              >
                <Icon className="w-4 h-4" />
              </button>
            )
          })}
        </div>
      </div>

      {/* List — empty state, else the chosen view */}
      {filtered.length === 0 && !showAdd && !editingId ? (
        <div className="py-16 text-center text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p style={{ fontSize: '16px' }}>לא נמצאו ספקים</p>
        </div>
      ) : view === 'cards' ? (

        /* ─────────── CARD VIEW (add/edit forms render inline in the grid) ─────────── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {showAdd && (
            <SupplierFormCard
              title="ספק חדש"
              form={addForm}
              onChange={setAddForm}
              onSave={saveAdd}
              onCancel={() => { setShowAdd(false); if (prefillForAlert) onCancelAlertPrefill?.() }}
            />
          )}
          {filtered.map((sup) => {
            if (editingId === sup.id && editForm) {
              return (
                <SupplierFormCard
                  key={sup.id}
                  title={`עריכת ${sup.name}`}
                  form={editForm}
                  onChange={(f) => setEditForm(f)}
                  onSave={saveEdit}
                  onCancel={() => { setEditingId(null); setEditForm(null) }}
                />
              )
            }
            const contactLine = [sup.contact, sup.phone].filter(Boolean).join(' · ') || '—'
            return (
              <div
                key={sup.id}
                onClick={() => openDetail(sup.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') openDetail(sup.id) }}
                className="bg-white flex flex-col transition-all"
                style={{ border: '1px solid #EEEEF2', borderRadius: '16px', boxShadow: '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 2px 6px rgba(16,17,21,.06), 0 12px 28px rgba(16,17,21,.10)'; el.style.borderColor = '#E4E5EA' }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)'; el.style.borderColor = '#EEEEF2' }}
              >
                {/* Accent strip on the RTL right edge — subtle BRAND accent (not status) */}
                <span aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '4px', background: 'var(--brand-primary)' }} />

                <div className="flex-1 flex flex-col gap-4" style={{ padding: '20px 22px 20px 20px' }}>
                  {/* status + category */}
                  <div className="flex items-center justify-between gap-2" style={{ minHeight: '28px' }}>
                    <StatusPill status={sup.status} />
                    <span className="min-w-0" style={{ maxWidth: '58%' }}><CategoryChip category={sup.category} /></span>
                  </div>
                  {/* name + contact */}
                  <div className="text-right" style={{ minHeight: isTablet ? '52px' : '46px' }}>
                    <h3 className="truncate" style={{ color: '#12131A', fontSize: isTablet ? '20px' : '18px', fontWeight: 700, letterSpacing: '-0.01em' }}>{sup.name}</h3>
                    <p className="text-gray-400 mt-1 truncate" style={{ fontSize: isTablet ? '14px' : '13px' }}>{contactLine}</p>
                  </div>
                  {/* current balance, stamped with today's date */}
                  <div style={{ background: '#F7F7FA', borderRadius: '14px', padding: '14px 16px' }}>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: '11px', color: '#9CA3AF' }}>נכון ל־{today}</span>
                      <span style={{ fontSize: '12px', color: '#9CA3AF', fontWeight: 500 }}>יתרה עדכנית</span>
                    </div>
                    <p className="text-right mt-1" style={{ fontSize: isTablet ? '26px' : '23px', fontWeight: 700, color: '#12131A', letterSpacing: '-0.02em' }}>
                      {formatILS(Number(sup.balance) || 0)}
                    </p>
                  </div>
                </div>
                {/* actions — lighter now that the whole card is clickable */}
                <div className="flex gap-2 mt-auto" style={{ padding: '0 22px 20px 20px' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDetail(sup.id) }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all"
                    style={{ minHeight: '38px', fontSize: '13px', background: 'var(--brand-active-bg)', color: 'var(--brand-primary)' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FAE6E9')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-active-bg)')}
                  >
                    פרטים
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(sup) }}
                    className="flex items-center justify-center rounded-xl transition-all"
                    title="עריכה"
                    style={{ minHeight: '38px', width: '44px', background: 'white', border: '1px solid #E7E8EC', color: 'var(--brand-primary)' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F7F7FA')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

      ) : (

        /* ─────────── TABLE VIEW (add/edit forms render above the table) ─────────── */
        <div className="space-y-4">
          {showAdd && (
            <div style={{ maxWidth: '560px' }}>
              <SupplierFormCard
                title="ספק חדש"
                form={addForm}
                onChange={setAddForm}
                onSave={saveAdd}
                onCancel={() => { setShowAdd(false); if (prefillForAlert) onCancelAlertPrefill?.() }}
              />
            </div>
          )}
          {editingId && editForm && (
            <div style={{ maxWidth: '560px' }}>
              <SupplierFormCard
                title={`עריכת ${suppliers.find((s) => s.id === editingId)?.name ?? 'ספק'}`}
                form={editForm}
                onChange={(f) => setEditForm(f)}
                onSave={saveEdit}
                onCancel={() => { setEditingId(null); setEditForm(null) }}
              />
            </div>
          )}
          <div className="bg-white overflow-x-auto" style={{ border: '1px solid #EEEEF2', borderRadius: '16px', boxShadow: '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)' }}>
            <div style={{ minWidth: '640px' }}>
              {/* header */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr 1.1fr 1fr 92px', gap: '12px', padding: '13px 20px', borderBottom: '1px solid #EEEEF2', background: '#FAFAFC' }}>
                {['ספק', 'קטגוריה', `יתרה · ${today}`, 'סטטוס', ''].map((h, i) => (
                  <span key={i} className="text-right" style={{ fontSize: '12px', fontWeight: 700, color: '#8A8D94', letterSpacing: '0.01em' }}>{h}</span>
                ))}
              </div>
              {/* rows */}
              {filtered.length === 0 ? (
                <p className="text-center text-gray-400" style={{ padding: '40px', fontSize: '15px' }}>לא נמצאו ספקים</p>
              ) : filtered.map((sup, idx) => {
                const contactLine = [sup.contact, sup.phone].filter(Boolean).join(' · ')
                return (
                  <div
                    key={sup.id}
                    onClick={() => openDetail(sup.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') openDetail(sup.id) }}
                    className="items-center transition-colors"
                    style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr 1.1fr 1fr 92px', gap: '12px', padding: '12px 20px', borderTop: idx === 0 ? 'none' : '1px solid #F1F2F4', cursor: 'pointer' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FAFAFC')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                  >
                    <div className="min-w-0 text-right">
                      <p className="truncate" style={{ fontSize: '15px', fontWeight: 600, color: '#12131A' }}>{sup.name}</p>
                      {contactLine && <p className="truncate text-gray-400" style={{ fontSize: '12px', marginTop: '2px' }}>{contactLine}</p>}
                    </div>
                    <div className="min-w-0 text-right"><CategoryChip category={sup.category} /></div>
                    <div className="text-right" style={{ fontSize: '15px', fontWeight: 600, color: '#12131A' }}>{formatILS(Number(sup.balance) || 0)}</div>
                    <div className="text-right"><StatusPill status={sup.status} /></div>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); openDetail(sup.id) }}
                        title="פרטים"
                        className="flex items-center justify-center rounded-lg transition-colors"
                        style={{ width: '34px', height: '34px', background: 'var(--brand-active-bg)', color: 'var(--brand-primary)' }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FAE6E9')}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-active-bg)')}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(sup) }}
                        title="עריכה"
                        className="flex items-center justify-center rounded-lg transition-colors"
                        style={{ width: '34px', height: '34px', background: 'white', border: '1px solid #E7E8EC', color: 'var(--brand-primary)' }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F7F7FA')}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
