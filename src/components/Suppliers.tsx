import { useState, useEffect } from 'react'
import { Users, Plus, Search, Pencil, ChevronLeft, X } from 'lucide-react'
import { useSuppliers } from '../hooks/useSuppliers'
import SupplierDetail, { type Supplier } from './SupplierDetail'

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

function formatILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
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
  outline: 'none', border: '1px solid #E2E4E9', borderRadius: '12px',
  background: 'white', width: '100%', color: '#1F2937', boxSizing: 'border-box',
}

const textareaBase: React.CSSProperties = {
  padding: '12px 14px', fontSize: '16px',
  outline: 'none', border: '1px solid #E2E4E9', borderRadius: '12px',
  background: 'white', width: '100%', color: '#1F2937',
  resize: 'vertical', minHeight: '80px', boxSizing: 'border-box',
}

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = '#E8645A'
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = '#E2E4E9'
}

function FormField({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-right mb-1.5" style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>
        {label}
        {required && <span style={{ color: '#E8645A' }}> *</span>}
      </p>
      {children}
    </div>
  )
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="flex-1 h-px" style={{ background: '#E2E4E9' }} />
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#8B1A3A', whiteSpace: 'nowrap', letterSpacing: '0.05em' }}>
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

  return (
    <div className="bg-white rounded-2xl flex flex-col" style={{ border: '2px solid #E8645A' }}>
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
          <h3 className="font-black text-gray-800 text-right" style={{ fontSize: '16px' }}>{title}</h3>
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
                {CATEGORIES.map((cat) => (
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
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="flex-1 rounded-xl font-semibold transition-all"
          style={{
            minHeight: '44px', fontSize: '15px',
            background: canSave ? '#7C3AED' : '#E5E7EB',
            color: canSave ? 'white' : '#9CA3AF',
          }}
        >
          שמור
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl font-semibold transition-all"
          style={{ minHeight: '44px', fontSize: '15px', background: '#F3F4F6', color: '#6B7280' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
        >
          ביטול
        </button>
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

interface SuppliersProps {
  onViewLedger?: (supplierId: string) => void
}

export default function Suppliers({ onViewLedger }: SuppliersProps) {
  const isTablet = useIsTablet()
  const { data: serverSuppliers, loading, error, create: createSupplier, update: updateSupplier, remove: removeSupplier } = useSuppliers()

  const [suppliers, setSuppliers]     = useState<Supplier[]>([])
  const [viewId,     setViewId]        = useState<string | null>(null)
  const [editingId,  setEditingId]     = useState<string | null>(null)
  const [editForm,   setEditForm]      = useState<EditFormState | null>(null)
  const [showAdd,    setShowAdd]       = useState(false)
  const [addForm,    setAddForm]       = useState<EditFormState>({ ...emptyForm })
  const [search,     setSearch]        = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    setSuppliers([...serverSuppliers] as Supplier[])
  }, [serverSuppliers])

  // ── Detail view ───────────────────────────────────────────────────────────
  if (viewId) {
    const sup = suppliers.find((s) => s.id === viewId)
    if (!sup) return null
    return (
      <SupplierDetail
        supplier={sup}
        onBack={() => setViewId(null)}
        onEdit={() => {
          setViewId(null)
          setEditingId(sup.id)
          setEditForm(supplierToForm(sup))
        }}
        onDelete={() => {
          setSuppliers((prev) => prev.filter((s) => s.id !== sup.id))
          setViewId(null)
          removeSupplier(sup.id).catch(() => {/* server sync failed silently */})
        }}
        onViewLedger={onViewLedger ? () => onViewLedger(sup.id) : undefined}
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
      notes: editForm.notes, balance,
    }
    setSuppliers((prev) => prev.map((s) =>
      s.id === editingId ? { ...s, ...body } : s
    ))
    setEditingId(null)
    setEditForm(null)
    try { await updateSupplier(editingId, body) } catch { /* server sync failed silently */ }
  }

  const saveAdd = async () => {
    if (!addForm.name.trim()) return
    const balance = addForm.openingBalance ? Number(addForm.openingBalance) : 0
    const body = {
      name: addForm.name, hp: addForm.hp, category: addForm.category,
      contact: addForm.contact, email: addForm.email, phone: addForm.phone,
      openingBalance: balance, openingBalanceDate: addForm.openingBalanceDate,
      notes: addForm.notes, status: 'פעיל', balance,
    }
    const newId = `SUP-${String(suppliers.length + 1).padStart(3, '0')}`
    setSuppliers((prev) => [...prev, { id: newId, paymentTerms: '', lastOrderDate: '', ...body } as any])
    setShowAdd(false)
    setAddForm({ ...emptyForm })
    try { await createSupplier(body) } catch { /* server sync failed silently */ }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const filtered = suppliers.filter((s) => {
    const matchSearch =
      (s.name || '').includes(search) || (s.contact || '').includes(search) || (s.category || '').includes(search)
    const matchStatus = statusFilter === 'all' || s.status === statusFilter
    return matchSearch && matchStatus
  })

  const activeCount  = suppliers.filter((s) => s.status === 'פעיל').length
  const totalBalance = suppliers.reduce((sum, s) => sum + s.balance, 0)

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading && suppliers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#E8645A' }} />
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
          <h1 className="text-2xl font-black text-gray-800">ספקים</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: isTablet ? '16px' : '14px' }}>
            {suppliers.length} ספקים במערכת
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddForm({ ...emptyForm }) }}
          className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all flex-shrink-0"
          style={{
            background: '#7C3AED',
            padding: isTablet ? '12px 20px' : '10px 18px',
            minHeight: '44px',
            fontSize: isTablet ? '16px' : '14px',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#6D28D9')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          הוסף ספק
        </button>
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
            style={{ borderColor: '#E2E4E9' }}
          >
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: isTablet ? '15px' : '13px' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-white rounded-xl border p-1 flex-shrink-0" style={{ borderColor: '#E2E4E9' }}>
          {(['all', 'פעיל', 'לא פעיל'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className="rounded-lg px-3 font-medium transition-all"
              style={{
                minHeight: isTablet ? '40px' : '34px',
                fontSize: isTablet ? '16px' : '13px',
                background: statusFilter === f ? '#8B1A3A' : 'transparent',
                color: statusFilter === f ? 'white' : '#6B7280',
              }}
            >
              {f === 'all' ? 'הכל' : f}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-2 flex-1 bg-white rounded-xl border px-4"
          style={{ borderColor: '#E2E4E9', minHeight: '44px' }}
        >
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="חיפוש לפי שם, קטגוריה, איש קשר..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-gray-700 text-right"
            style={{ fontSize: '16px' }}
          />
        </div>
      </div>

      {/* Card grid */}
      {filtered.length === 0 && !showAdd ? (
        <div className="py-16 text-center text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p style={{ fontSize: '16px' }}>לא נמצאו ספקים</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Add form card */}
          {showAdd && (
            <SupplierFormCard
              title="ספק חדש"
              form={addForm}
              onChange={setAddForm}
              onSave={saveAdd}
              onCancel={() => setShowAdd(false)}
            />
          )}

          {/* Supplier cards */}
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

            const catStyle = categoryColors[sup.category] ?? { bg: '#F3F4F6', color: '#6B7280' }
            const isActive = sup.status === 'פעיל'

            return (
              <div
                key={sup.id}
                className="bg-white rounded-2xl shadow-sm border flex flex-col"
                style={{ borderColor: '#E2E4E9' }}
              >
                <div className="p-5 flex-1 flex flex-col gap-4">

                  {/* Status | Category */}
                  <div className="flex items-center justify-between">
                    <span
                      className="rounded-lg font-bold"
                      style={{
                        fontSize: '12px', padding: '4px 12px',
                        background: isActive ? '#DCFCE7' : '#F3F4F6',
                        color: isActive ? '#16A34A' : '#6B7280',
                      }}
                    >
                      {sup.status}
                    </span>
                    <span
                      className="rounded-lg font-medium"
                      style={{
                        fontSize: '12px', padding: '4px 10px',
                        backgroundColor: catStyle.bg, color: catStyle.color,
                      }}
                    >
                      {sup.category}
                    </span>
                  </div>

                  {/* Name + contact */}
                  <div className="text-right">
                    <h3 className="font-black text-gray-800" style={{ fontSize: isTablet ? '20px' : '18px' }}>
                      {sup.name}
                    </h3>
                    <p className="text-gray-500 mt-1" style={{ fontSize: isTablet ? '15px' : '13px' }}>
                      {[sup.contact, sup.phone].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  {/* Balance box */}
                  <div className="rounded-xl p-3 text-right" style={{ background: '#F8F9FA' }}>
                    <p style={{ fontSize: '11px', color: '#9CA3AF' }}>
                      יתרת פתיחה{sup.openingBalanceDate ? ` · ${sup.openingBalanceDate}` : ''}
                    </p>
                    <p className="font-black text-gray-800 mt-0.5" style={{ fontSize: isTablet ? '24px' : '22px' }}>
                      {formatILS(sup.balance)}
                    </p>
                  </div>

                </div>

                {/* Action buttons */}
                <div className="flex gap-2 px-5 pb-5">
                  <button
                    onClick={() => setViewId(sup.id)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all"
                    style={{
                      minHeight: '44px',
                      fontSize: isTablet ? '15px' : '14px',
                      background: '#7C3AED',
                      color: 'white',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    פרטים
                  </button>
                  <button
                    onClick={() => startEdit(sup)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all"
                    style={{
                      minHeight: '44px',
                      fontSize: isTablet ? '15px' : '14px',
                      background: '#FFF0EF',
                      color: '#E8645A',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FFE4E2')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#FFF0EF')}
                  >
                    <Pencil className="w-4 h-4" />
                    עריכה
                  </button>
                </div>
              </div>
            )
          })}

        </div>
      )}
    </div>
  )
}
