import { useState, useEffect } from 'react'
import { Users, Plus, Search, Pencil, ChevronLeft, X } from 'lucide-react'
import { mockSuppliers } from '../data/mockData'
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

const categoryColors: Record<string, { bg: string; color: string }> = {
  'מוצרי חלב': { bg: '#EFF6FF', color: '#1D4ED8' },
  'משקאות':    { bg: '#F0FDF4', color: '#16A34A' },
  'מזון יבש':  { bg: '#FFF7ED', color: '#C2410C' },
  'ממתקים':    { bg: '#FDF4FF', color: '#9333EA' },
  'שתייה חמה': { bg: '#FEF3C7', color: '#92400E' },
  'מאפים':     { bg: '#FFF1F2', color: '#BE123C' },
}

function formatILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

// ─── Form types ────────────────────────────────────────────────────────────

type EditFormState = {
  name: string
  contact: string
  phone: string
  category: string
  paymentTerms: string
  status: 'פעיל' | 'לא פעיל'
}

const emptyForm: EditFormState = {
  name: '', contact: '', phone: '',
  category: 'מוצרי חלב', paymentTerms: 'שוטף+30', status: 'פעיל',
}

const inputBase: React.CSSProperties = {
  height: '44px', padding: '0 14px', fontSize: '16px',
  outline: 'none', border: '1px solid #F0E8E7', borderRadius: '12px',
  background: 'white', width: '100%', color: '#1F2937',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-right text-gray-400 mb-1" style={{ fontSize: '12px' }}>{label}</p>
      {children}
    </div>
  )
}

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  (e.target as HTMLElement).style.borderColor = '#E8645A'
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  (e.target as HTMLElement).style.borderColor = '#F0E8E7'
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
  const categories = Object.keys(categoryColors)
  const canSave = form.name.trim().length > 0

  return (
    <div className="bg-white rounded-2xl flex flex-col" style={{ border: '2px solid #E8645A' }}>
      <div className="p-5 flex flex-col gap-3">
        {/* Card header */}
        <div className="flex items-center justify-between">
          <button onClick={onCancel} className="text-gray-400 transition-colors rounded-lg p-1"
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '')}>
            <X className="w-4 h-4" />
          </button>
          <h3 className="font-black text-gray-800 text-right" style={{ fontSize: '16px' }}>{title}</h3>
        </div>

        {/* שם ספק */}
        <FormField label="שם ספק *">
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

        {/* איש קשר + טלפון */}
        <div className="grid grid-cols-2 gap-2">
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
          <FormField label="איש קשר">
            <input
              value={form.contact}
              onChange={(e) => onChange({ ...form, contact: e.target.value })}
              placeholder="שם"
              className="text-right placeholder-gray-300"
              style={inputBase}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </FormField>
        </div>

        {/* קטגוריה + תנאי תשלום */}
        <div className="grid grid-cols-2 gap-2">
          <FormField label="תנאי תשלום">
            <input
              value={form.paymentTerms}
              onChange={(e) => onChange({ ...form, paymentTerms: e.target.value })}
              placeholder="שוטף+30"
              className="text-right placeholder-gray-300"
              style={inputBase}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </FormField>
          <FormField label="קטגוריה">
            <select
              value={form.category}
              onChange={(e) => onChange({ ...form, category: e.target.value })}
              style={{ ...inputBase, direction: 'rtl' }}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </FormField>
        </div>

        {/* סטטוס */}
        <FormField label="סטטוס">
          <div className="flex gap-2">
            {(['פעיל', 'לא פעיל'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...form, status: s })}
                className="flex-1 rounded-xl font-medium transition-all"
                style={{
                  minHeight: '40px', fontSize: '14px',
                  background: form.status === s ? '#8B1A3A' : '#F3F4F6',
                  color: form.status === s ? 'white' : '#6B7280',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </FormField>
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
            background: canSave ? 'linear-gradient(135deg, #8B1A3A, #E8645A)' : '#E5E7EB',
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

// ─── Main component ─────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'פעיל' | 'לא פעיל'

export default function Suppliers() {
  const isTablet = useIsTablet()

  const [suppliers, setSuppliers]   = useState<Supplier[]>(() => [...mockSuppliers] as Supplier[])
  const [viewId,     setViewId]      = useState<string | null>(null)
  const [editingId,  setEditingId]   = useState<string | null>(null)
  const [editForm,   setEditForm]    = useState<EditFormState | null>(null)
  const [showAdd,    setShowAdd]     = useState(false)
  const [addForm,    setAddForm]     = useState<EditFormState>({ ...emptyForm })
  const [search,     setSearch]      = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // ── Detail view ──────────────────────────────────────────────────────────
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
          setEditForm({
            name: sup.name, contact: sup.contact, phone: sup.phone,
            category: sup.category, paymentTerms: sup.paymentTerms,
            status: sup.status as 'פעיל' | 'לא פעיל',
          })
        }}
      />
    )
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  const startEdit = (sup: Supplier) => {
    setEditingId(sup.id)
    setEditForm({
      name: sup.name, contact: sup.contact, phone: sup.phone,
      category: sup.category, paymentTerms: sup.paymentTerms,
      status: sup.status as 'פעיל' | 'לא פעיל',
    })
  }

  const saveEdit = () => {
    if (!editForm || !editingId) return
    setSuppliers((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...editForm } : s)))
    setEditingId(null)
    setEditForm(null)
  }

  const saveAdd = () => {
    if (!addForm.name.trim()) return
    const newId = `SUP-${String(suppliers.length + 1).padStart(3, '0')}`
    setSuppliers((prev) => [...prev, { id: newId, ...addForm, lastOrderDate: '', balance: 0 }])
    setShowAdd(false)
    setAddForm({ ...emptyForm })
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const filtered = suppliers.filter((s) => {
    const matchSearch =
      s.name.includes(search) || s.contact.includes(search) || s.category.includes(search)
    const matchStatus = statusFilter === 'all' || s.status === statusFilter
    return matchSearch && matchStatus
  })

  const activeCount  = suppliers.filter((s) => s.status === 'פעיל').length
  const totalBalance = suppliers.reduce((sum, s) => sum + s.balance, 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        {/* RIGHT in RTL = first in DOM = "הוסף ספק" button */}
        <button
          onClick={() => { setShowAdd(true); setAddForm({ ...emptyForm }) }}
          className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #8B1A3A, #E8645A)',
            padding: isTablet ? '12px 20px' : '10px 18px',
            minHeight: '44px',
            fontSize: isTablet ? '16px' : '14px',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          הוסף ספק
        </button>
        <div className="text-right">
          <h1 className="text-2xl font-black text-gray-800">ספקים</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: isTablet ? '16px' : '14px' }}>
            {suppliers.length} ספקים במערכת
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'סה"כ ספקים',   value: String(suppliers.length), color: '#1F2937' },
          { label: 'ספקים פעילים', value: String(activeCount),       color: '#16A34A' },
          { label: 'יתרה כוללת',   value: formatILS(totalBalance),   color: '#1F2937' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm border text-center" style={{ borderColor: '#F0E8E7' }}>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: isTablet ? '15px' : '13px' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-white rounded-xl border p-1 flex-shrink-0" style={{ borderColor: '#F0E8E7' }}>
          {(['all', 'פעיל', 'לא פעיל'] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
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
        <div className="flex items-center gap-2 flex-1 bg-white rounded-xl border px-4" style={{ borderColor: '#F0E8E7', minHeight: '44px' }}>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* ── Add form card ── */}
          {showAdd && (
            <SupplierFormCard
              title="ספק חדש"
              form={addForm}
              onChange={setAddForm}
              onSave={saveAdd}
              onCancel={() => setShowAdd(false)}
            />
          )}

          {/* ── Supplier cards ── */}
          {filtered.map((sup) => {
            // Editing state → show form card instead
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
                style={{ borderColor: '#F0E8E7' }}
              >
                <div className="p-5 flex-1 flex flex-col gap-4">

                  {/* Top: status (right) | category (left) */}
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg font-semibold"
                      style={{ fontSize: '12px', padding: '4px 12px', background: isActive ? '#DCFCE7' : '#F3F4F6', color: isActive ? '#16A34A' : '#6B7280' }}>
                      {sup.status}
                    </span>
                    <span className="rounded-lg font-medium"
                      style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: catStyle.bg, color: catStyle.color }}>
                      {sup.category}
                    </span>
                  </div>

                  {/* Name + contact */}
                  <div className="text-right">
                    <h3 className="font-black text-gray-800" style={{ fontSize: isTablet ? '20px' : '18px' }}>
                      {sup.name}
                    </h3>
                    <p className="text-gray-500 mt-1" style={{ fontSize: isTablet ? '15px' : '13px' }}>
                      {sup.contact} · {sup.phone}
                    </p>
                  </div>

                  {/* Balance box */}
                  <div className="rounded-xl p-3 text-right" style={{ background: '#FFF8F7' }}>
                    <p style={{ fontSize: '11px', color: '#9CA3AF' }}>יתרה פתוחה · {sup.paymentTerms}</p>
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
                    style={{ minHeight: '44px', fontSize: isTablet ? '15px' : '14px', background: 'linear-gradient(135deg, #8B1A3A, #E8645A)', color: 'white' }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    פרטים
                  </button>
                  <button
                    onClick={() => startEdit(sup)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all"
                    style={{ minHeight: '44px', fontSize: isTablet ? '15px' : '14px', background: '#FFF0EF', color: '#E8645A' }}
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
