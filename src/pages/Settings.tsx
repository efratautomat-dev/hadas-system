import { useState, useRef, useEffect, useCallback } from 'react'
import { User, Settings2, Bell, Download, Upload, Camera, Users, Plus, Pencil, Trash2, RefreshCw, Tag, GitMerge, X, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useEmployees } from '../hooks/useEmployees'
import type { Employee } from '../hooks/useEmployees'
import { useCategories } from '../hooks/useCategories'
import { supabase } from '../lib/supabase'
import { tierAllowsIntegrations } from '../lib/tiers'
import { useAppLogo } from '../hooks/useAppLogo'
import { Button } from '../components/ui/Button'
// Shared with the supplier form so the two screens stay visually identical.
import { SectionCard, FieldLabel, TextInput } from '../components/ui/form'
import { inspectTemplateFile, TEMPLATE_BUCKET, TEMPLATE_PATH, BUNDLED_TEMPLATE_URL, loadBizboxTemplate } from '../lib/bizboxTemplate'

function useIsTablet() {
  const [v] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth <= 1024
  )
  return v
}

type Tab = 'profile' | 'preferences' | 'notifications' | 'backup' | 'employees' | 'categories' | 'bizbox'

interface ProfileState {
  businessName: string
  contactName: string
  phone: string
  email: string
  companyNumber: string
  address: string
  logoUrl: string | null
}

interface PreferencesState {
  dateFormat: string
  primaryColor: string
}

interface NotificationsState {
  duplicates: boolean
  mismatches: boolean
  futurePayments: boolean
  pendingDeliveries: boolean
}

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'profile',       label: 'פרופיל',       Icon: User },
  { id: 'preferences',   label: 'העדפות',        Icon: Settings2 },
  { id: 'notifications', label: 'התראות',        Icon: Bell },
  { id: 'backup',        label: 'גיבוי',          Icon: Download },
  { id: 'employees',     label: 'עובדים',         Icon: Users },
  { id: 'categories',    label: 'קטגוריות',       Icon: Tag },
  { id: 'bizbox',        label: 'ייצוא לביזיבוקס', Icon: FileSpreadsheet },
]

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY']
const COLOR_PRESETS = ['#E8645A', 'var(--brand-primary-dark)', '#E8A020', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6']

function SaveToast({ visible }: { visible: boolean }) {
  return (
    <div
      className="fixed bottom-6 left-1/2 transition-all duration-300"
      style={{
        transform: `translateX(-50%) translateY(${visible ? '0' : '20px'})`,
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      <div
        className="flex items-center gap-2 px-5 py-3 rounded-2xl text-white font-bold shadow-lg"
        style={{ background: '#22C55E', fontSize: '15px' }}
      >
        נשמר ✓
      </div>
    </div>
  )
}

// Non-persisting settings (profile / preferences prefs / notifications / backup
// export) show this "not available yet" state instead of controls that silently
// fail to save. The original panels are kept in the file behind `SHOW_LEGACY`
// (never rendered) so no handler/state is deleted — flip to true to restore them.
const SHOW_LEGACY = false

function NotAvailable() {
  return (
    <div
      className="bg-white rounded-2xl shadow-sm border flex flex-col items-center justify-center text-center"
      style={{ borderColor: '#EEEEF2', padding: '48px 24px', direction: 'rtl' }}
    >
      <div className="rounded-2xl flex items-center justify-center mb-4" style={{ width: '56px', height: '56px', background: 'var(--brand-active-bg)' }}>
        <Settings2 className="w-7 h-7" style={{ color: 'var(--brand-primary)' }} />
      </div>
      <p className="font-semibold text-gray-700" style={{ fontSize: '16px' }}>אפשרות זו אינה זמינה כרגע</p>
      <p className="text-gray-400 mt-1" style={{ fontSize: '14px' }}>התכונה תתווסף בהמשך</p>
    </div>
  )
}

// SectionCard / FieldLabel / TextInput moved to ../components/ui/form so the
// supplier form uses the SAME components, not a look-alike copy.

// Pull a human message off anything thrown. Supabase rejects with a PostgrestError
// — a plain object carrying `message`, NOT an Error instance — so an
// `instanceof Error` check alone silently drops the real reason.
function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return fallback
}


// ── Bizibox export template (Settings → ייצוא לביזיבוקס) ─────────────────────
// Bizibox revises its import template, and a stale template stops importing rows
// — checks landed while bank transfers were silently dropped, and the very same
// rows pasted into a freshly downloaded template imported fine. The export now
// FILLS the real template, so the template itself must be replaceable without a
// deploy. Uploaded here → Storage → picked up by the next export.
function BizboxTemplateManager() {
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [info, setInfo]   = useState<{ headers: string[]; source: 'uploaded' | 'bundled' } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const flash = (type: 'ok' | 'err', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 6000) }

  // useCallback so the mount effect can list it as a dependency honestly instead
  // of silencing the lint rule — `flash` is stable enough (it only sets state).
  const refresh = useCallback(async () => {
    try {
      const t = await loadBizboxTemplate()
      setInfo({ headers: t.headers, source: t.source })
    } catch (e) {
      setInfo(null)
      setMsg({ type: 'err', text: errMessage(e, 'לא ניתן לקרוא את הטמפליט') })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!/\.xlsx$/i.test(file.name)) { flash('err', 'יש להעלות קובץ xlsx שהורד מביזיבוקס'); return }

    setBusy(true)
    try {
      // Validate BEFORE replacing: an unreadable template would break the export
      // at the worst possible moment — the day the payments have to go out.
      const { headers, sheetName } = await inspectTemplateFile(file)

      const { error } = await supabase.storage
        .from(TEMPLATE_BUCKET)
        .upload(TEMPLATE_PATH, file, { upsert: true, contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      if (error) throw error

      await refresh()
      flash('ok', `הטמפליט עודכן — גיליון "${sheetName}", ${headers.length} עמודות`)
    } catch (err) {
      flash('err', errMessage(err, 'העלאת הטמפליט נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    setBusy(true)
    try {
      const { error } = await supabase.storage.from(TEMPLATE_BUCKET).remove([TEMPLATE_PATH])
      if (error) throw error
      await refresh()
      flash('ok', 'חזרנו לטמפליט המובנה')
    } catch (err) {
      flash('err', errMessage(err, 'האיפוס נכשל'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 mx-auto" style={{ maxWidth: '640px', direction: 'rtl' }}>
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: msg.type === 'ok' ? '#DCFCE7' : '#FEE2E2', color: msg.type === 'ok' ? '#166534' : '#DC2626' }}>
          {msg.text}
        </div>
      )}

      <SectionCard title="טמפליט הייצוא">
        <p className="text-sm text-gray-500 leading-relaxed mb-4">
          הייצוא לביזיבוקס <strong className="text-gray-700">ממלא את קובץ הטמפליט של ביזיבוקס</strong> במקום לבנות
          קובץ דומה. כשביזיבוקס מעדכנים את הטמפליט — הורידי אצלם את החדש והעלי אותו כאן,
          והייצוא הבא כבר ישתמש בו. אין צורך בשינוי בקוד.
        </p>

        <div className="rounded-xl p-4 mb-4" style={{ background: '#F8F9FA' }}>
          <div className="flex items-center gap-2 mb-2">
            {info?.source === 'uploaded'
              ? <CheckCircle2 className="w-4 h-4" style={{ color: '#16A34A' }} />
              : <AlertTriangle className="w-4 h-4" style={{ color: '#A16207' }} />}
            <span className="text-sm font-semibold text-gray-700">
              {info?.source === 'uploaded' ? 'בשימוש: הטמפליט שהעלית' : 'בשימוש: הטמפליט המובנה'}
            </span>
          </div>
          {info?.headers?.length
            ? (
              <p className="text-xs text-gray-500">
                עמודות שזוהו: {info.headers.join(' · ')}
              </p>
            )
            : <p className="text-xs text-gray-400">טוען…</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsx" onChange={handleUpload} style={{ display: 'none' }} />
          <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="w-4 h-4" />
            העלאת טמפליט חדש
          </Button>
          <a
            href={BUNDLED_TEMPLATE_URL}
            download
            className="inline-flex items-center gap-1.5 rounded-xl font-semibold"
            style={{ border: '1px solid #E2E4E9', padding: '10px 16px', fontSize: '14px', color: '#6B7280', background: 'white' }}
          >
            <Download className="w-4 h-4" />
            הורדת הטמפליט הנוכחי
          </a>
          {info?.source === 'uploaded' && (
            <Button variant="ghost" onClick={handleReset} disabled={busy}>
              <RefreshCw className="w-4 h-4" />
              חזרה למובנה
            </Button>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

function Toggle({ value, onChange, label, sub }: { value: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-4 border-b last:border-b-0" style={{ borderColor: '#F3F4F6' }}>
      <button
        onClick={() => onChange(!value)}
        className="relative flex-shrink-0 rounded-full transition-all duration-200"
        style={{
          width: '48px',
          height: '26px',
          background: value ? '#E8645A' : '#D1D5DB',
        }}
      >
        <span
          className="absolute top-1 rounded-full bg-white shadow transition-all duration-200"
          style={{
            width: '18px',
            height: '18px',
            right: value ? '4px' : 'calc(100% - 22px)',
          }}
        />
      </button>
      <div className="text-right flex-1 mr-4">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Category management (Settings → categories, MANAGER-only screen) ──────────
// Add / rename / delete / merge. Rename & merge re-point every tagged record via
// hadas-api; delete of an in-use category prompts for reassignment (never orphans).
function CategoriesManager() {
  const { data: categories, loading, error, create, rename, remove, merge } = useCategories()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [mergeFrom, setMergeFrom] = useState('')
  const [mergeInto, setMergeInto] = useState('')
  const [reassign, setReassign] = useState<{ id: string; name: string } | null>(null)
  const [reassignTo, setReassignTo] = useState('')

  const A = 'var(--brand-primary)'
  const flash = (type: 'ok' | 'err', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500) }
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    try { await fn(); flash('ok', ok) } catch (e) { flash('err', errText(e)); throw e } finally { setBusy(false) }
  }

  async function handleAdd() {
    const n = newName.trim(); if (!n) return
    try { await run(() => create(n), 'הקטגוריה נוספה'); setNewName('') } catch { /* flashed */ }
  }
  async function handleRename(id: string) {
    const n = editName.trim(); if (!n) return
    try { await run(() => rename(id, n), 'השם עודכן'); setEditingId(null) } catch { /* flashed */ }
  }
  async function handleDelete(cat: { id: string; name: string; usage_count: number }) {
    if (cat.usage_count > 0) { setReassign({ id: cat.id, name: cat.name }); setReassignTo(''); return }
    try { await run(() => remove(cat.id), 'הקטגוריה נמחקה') }
    catch (e) { if (/in use/i.test(errText(e))) { setReassign({ id: cat.id, name: cat.name }); setReassignTo('') } }
  }
  async function confirmReassign() {
    if (!reassign || !reassignTo) return
    try { await run(() => remove(reassign.id, reassignTo), 'הרשומות שויכו מחדש והקטגוריה נמחקה'); setReassign(null) } catch { /* flashed */ }
  }
  async function handleMerge() {
    if (!mergeFrom || !mergeInto || mergeFrom === mergeInto) return
    try { await run(() => merge(mergeFrom, mergeInto), 'הקטגוריות מוזגו'); setMergeFrom(''); setMergeInto('') } catch { /* flashed */ }
  }

  const selectStyle: React.CSSProperties = { padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E4E9', background: 'white', fontSize: '14px', color: '#1F2937', outline: 'none', cursor: 'pointer' }

  return (
    <div className="space-y-5 mx-auto" style={{ maxWidth: '640px', direction: 'rtl' }}>
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: msg.type === 'ok' ? '#DCFCE7' : '#FEE2E2', color: msg.type === 'ok' ? '#166534' : '#DC2626' }}>
          {msg.text}
        </div>
      )}

      {/* Add */}
      <SectionCard title="הוספת קטגוריה">
        <div className="flex items-end gap-3">
          <div className="flex-1"><FieldLabel>שם קטגוריה</FieldLabel><TextInput value={newName} onChange={setNewName} placeholder="לדוגמה: ספקים ביגוד" /></div>
          <Button variant="primary" onClick={handleAdd} disabled={busy || !newName.trim()}>
            <Plus className="w-4 h-4" /> הוסף
          </Button>
        </div>
      </SectionCard>

      {/* Merge */}
      <SectionCard title="מיזוג קטגוריות">
        <p className="text-xs text-gray-400 mb-3">מיזוג ישייך מחדש את כל הרשומות מהקטגוריה הראשונה לשנייה, וימחק את הראשונה.</p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={mergeFrom} onChange={e => setMergeFrom(e.target.value)} style={selectStyle}>
            <option value="">מזג מ…</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="text-gray-400">←</span>
          <select value={mergeInto} onChange={e => setMergeInto(e.target.value)} style={selectStyle}>
            <option value="">אל…</option>
            {categories.filter(c => c.id !== mergeFrom).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button variant="primary" onClick={handleMerge} disabled={busy || !mergeFrom || !mergeInto}>
            <GitMerge className="w-4 h-4" /> מזג
          </Button>
        </div>
      </SectionCard>

      {/* List */}
      <SectionCard title={`קטגוריות${categories.length ? ` (${categories.length})` : ''}`}>
        {loading ? (
          <div className="py-10 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 mx-auto" style={{ borderColor: A }} /></div>
        ) : error ? (
          <p className="py-8 text-center text-sm" style={{ color: '#DC2626' }}>שגיאה בטעינת קטגוריות: {error}</p>
        ) : categories.length === 0 ? (
          <div className="py-10 text-center"><Tag className="w-10 h-10 mx-auto mb-2 text-gray-200" /><p className="text-gray-400 text-sm">אין קטגוריות — הוסף קטגוריה ראשונה</p></div>
        ) : (
          <div className="space-y-2">
            {categories.map(cat => (
              <div key={cat.id} className="flex items-center justify-between p-3.5 rounded-xl border" style={{ borderColor: '#E2E4E9' }}>
                {editingId === cat.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex-1"><TextInput value={editName} onChange={setEditName} /></div>
                    <Button variant="primary" size="sm" onClick={() => handleRename(cat.id)} disabled={busy}>שמור</Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>ביטול</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-right">
                      <span className="text-sm font-semibold text-gray-800">{cat.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: '#F3F4F6', color: '#6B7280' }} title="שימושים">{cat.usage_count}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => { setEditingId(cat.id); setEditName(cat.name) }} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#F3F4F6', color: '#6B7280' }} title="שנה שם"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete(cat)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#FEE2E2', color: '#DC2626' }} title="מחק"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Reassign-on-delete modal */}
      {reassign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={e => { if (e.target === e.currentTarget) setReassign(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full p-6" style={{ maxWidth: '440px', direction: 'rtl' }}>
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setReassign(null)} className="text-gray-400"><X className="w-5 h-5" /></button>
              <h3 className="font-bold text-gray-800">מחיקת "{reassign.name}"</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4 text-right">לקטגוריה זו יש רשומות משויכות. בחרי קטגוריה שאליה ישויכו הרשומות לפני המחיקה (לא ניתן להשאיר רשומות ללא קטגוריה).</p>
            <select value={reassignTo} onChange={e => setReassignTo(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
              <option value="">שייך רשומות אל…</option>
              {categories.filter(c => c.id !== reassign.id).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <div className="flex justify-end gap-3 mt-5">
              <Button variant="outline" onClick={() => setReassign(null)}>ביטול</Button>
              <Button variant="danger" onClick={confirmReassign} disabled={busy || !reassignTo}>שייך ומחק</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const isTablet = useIsTablet()
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [profile, setProfile] = useState<ProfileState>({
    businessName: 'הדס ניהול ספקים',
    contactName: 'הדס כהן',
    phone: '052-0000000',
    email: 'hadas@example.com',
    companyNumber: '515000000',
    address: 'רחוב הרצל 1, תל אביב',
    logoUrl: null,
  })

  const [prefs, setPrefs] = useState<PreferencesState>({
    dateFormat: 'DD/MM/YYYY',
    primaryColor: '#E8645A',
  })

  const [notifs, setNotifs] = useState<NotificationsState>({
    duplicates: true,
    mismatches: true,
    futurePayments: false,
    pendingDeliveries: true,
  })

  // ── Employees state ──────────────────────────────────────────────────────────
  const { data: employees, loading: empLoading, create: createEmp, update: updateEmp, remove: removeEmp } = useEmployees()
  const [showEmpForm, setShowEmpForm] = useState(false)
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null)
  const [empForm, setEmpForm] = useState({ name: '', role: '', phone: '', active: true })
  const [deletingEmpId, setDeletingEmpId] = useState<string | null>(null)

  const sysLogoInputRef = useRef<HTMLInputElement>(null)
  const { logoUrl: sysLogoUrl, refresh: refreshLogo } = useAppLogo()
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoMsg, setLogoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function showLogoMsg(type: 'success' | 'error', text: string) {
    setLogoMsg({ type, text })
    setTimeout(() => setLogoMsg(null), 3000)
  }

  async function handleSystemLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    console.log('[logo] file selected:', file.name, file.type, file.size)

    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      showLogoMsg('error', 'יש להעלות קובץ PNG, JPG או SVG בלבד')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showLogoMsg('error', 'הקובץ גדול מ-2MB')
      return
    }

    setLogoUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'png'
      const storagePath = `logo.${ext}`
      console.log('[logo] uploading to branding/', storagePath)

      const { error: uploadErr } = await supabase.storage
        .from('branding')
        .upload(storagePath, file, { upsert: true, contentType: file.type })
      if (uploadErr) {
        console.error('[logo] storage upload error:', uploadErr)
        throw uploadErr
      }
      console.log('[logo] storage upload OK')

      const { data: { publicUrl } } = supabase.storage.from('branding').getPublicUrl(storagePath)
      console.log('[logo] public URL:', publicUrl)

      const { error: dbErr } = await supabase
        .from('app_settings')
        .upsert(
          { key: 'app_logo_url', value: publicUrl, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
      if (dbErr) {
        console.error('[logo] app_settings upsert error:', dbErr)
        throw dbErr
      }
      console.log('[logo] app_settings upserted OK')

      refreshLogo()
      showLogoMsg('success', 'הלוגו עודכן בהצלחה ✓')
    } catch (err) {
      console.error('[logo] upload failed:', err)
      const msg = errMessage(err, 'שגיאה בהעלאה — נסי שוב')
      showLogoMsg('error', msg)
    } finally {
      setLogoUploading(false)
    }
  }

  async function handleResetSystemLogo() {
    setLogoUploading(true)
    try {
      console.log('[logo] resetting to default')
      const { error } = await supabase.from('app_settings').delete().eq('key', 'app_logo_url')
      if (error) {
        console.error('[logo] reset error:', error)
        throw error
      }
      console.log('[logo] reset OK')
      refreshLogo()
      showLogoMsg('success', 'הלוגו אופס לברירת המחדל ✓')
    } catch (err) {
      console.error('[logo] reset failed:', err)
      const msg = errMessage(err, 'שגיאה — נסי שוב')
      showLogoMsg('error', msg)
    } finally {
      setLogoUploading(false)
    }
  }

  function showToast() {
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2200)
  }

  function updateProfile(key: keyof ProfileState, value: string | null) {
    setProfile(p => ({ ...p, [key]: value }))
    showToast()
  }

  function updatePref(key: keyof PreferencesState, value: string) {
    setPrefs(p => ({ ...p, [key]: value }))
    showToast()
  }

  function updateNotif(key: keyof NotificationsState, value: boolean) {
    setNotifs(p => ({ ...p, [key]: value }))
    showToast()
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      updateProfile('logoUrl', ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  function handleExportAll() {
    import('xlsx').then(XLSX => {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['גיבוי מלא', new Date().toLocaleDateString('he-IL')]]), 'גיבוי')
      XLSX.writeFile(wb, `hadas_backup_${new Date().toISOString().slice(0, 10)}.xlsx`)
    })
  }

  // ── Employee handlers ────────────────────────────────────────────────────────

  function openEmpAdd() {
    setEditingEmpId(null)
    setEmpForm({ name: '', role: '', phone: '', active: true })
    setShowEmpForm(true)
    setDeletingEmpId(null)
  }

  function openEmpEdit(emp: Employee) {
    setEditingEmpId(emp.id)
    setEmpForm({ name: emp.name, role: emp.role, phone: emp.phone, active: emp.active })
    setShowEmpForm(true)
    setDeletingEmpId(null)
  }

  async function saveEmp() {
    if (!empForm.name.trim()) return
    try {
      if (editingEmpId) {
        await updateEmp(editingEmpId, empForm)
      } else {
        await createEmp(empForm)
      }
      setShowEmpForm(false)
      setEditingEmpId(null)
      showToast()
    } catch {
      // hook sets error state
    }
  }

  async function confirmDeleteEmp(id: string) {
    try {
      await removeEmp(id)
      setDeletingEmpId(null)
      showToast()
    } catch {
      // hook sets error state
    }
  }

  // ── Invoice approval threshold ───────────────────────────────────────────────
  // The pre-VAT amount above which an incoming invoice waits for the owner's
  // decision instead of being filed silently. Stored in app_settings (same
  // key/value table as the logo) so it can be changed without a deploy — ingest
  // reads it at the start of every run.
  //
  // EMPTY = NO GATE, and the UI says so in as many words. That has to be a
  // deliberate, visible choice: a blank field that quietly meant "₪20,000" would
  // stop invoices nobody asked to stop.
  const [threshold, setThreshold]           = useState('')
  const [thresholdSaved, setThresholdSaved] = useState('')
  const [thresholdBusy, setThresholdBusy]   = useState(false)
  const [thresholdMsg, setThresholdMsg]     = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await supabase
        .from('app_settings').select('value').eq('key', 'invoice_approval_threshold').maybeSingle()
      if (!alive) return
      const v = (data?.value ?? '').trim()
      setThreshold(v)
      setThresholdSaved(v)
    })()
    return () => { alive = false }
  }, [])

  async function handleSaveThreshold() {
    const raw = threshold.trim()
    // Only a positive number or a deliberate blank. "20,000" and "20000 ש\"ח"
    // are rejected rather than coerced: a threshold that silently became 20 is
    // the kind of mistake nobody notices until every invoice is held.
    if (raw && (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0)) {
      setThresholdMsg({ type: 'error', text: 'יש להזין מספר חיובי בלבד, בלי פסיקים ובלי ₪' })
      return
    }
    setThresholdBusy(true)
    try {
      const { error } = await supabase.from('app_settings').upsert(
        { key: 'invoice_approval_threshold', value: raw, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
      if (error) throw error
      setThresholdSaved(raw)
      setThresholdMsg({ type: 'success', text: raw ? 'הסף נשמר ✓' : 'השער כובה — כל החשבוניות ייכנסו כרגיל ✓' })
    } catch (err) {
      setThresholdMsg({ type: 'error', text: errMessage(err, 'השמירה נכשלה — נסי שוב') })
    } finally {
      setThresholdBusy(false)
    }
  }

  // ── Tab content ──────────────────────────────────────────────────────────────

  const tabContent: Record<Tab, React.ReactNode> = {
    profile: (
      <div className="space-y-5">
        <NotAvailable />
        {SHOW_LEGACY && (<>
        <SectionCard title="לוגו עסקי">
          <div className="flex items-center gap-5" style={{ flexDirection: 'row-reverse' }}>
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden border-2"
              style={{ borderColor: '#E2E4E9', background: '#F8F9FA' }}
            >
              {profile.logoUrl ? (
                <img src={profile.logoUrl} alt="לוגו" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-8 h-8 text-gray-300" />
              )}
            </div>
            <div>
              <label
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all cursor-pointer"
                style={{ borderColor: '#E8645A', color: '#E8645A' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF0EF' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <Upload className="w-4 h-4" />
                העלה לוגו
              </label>
              <p className="text-xs text-gray-400 mt-2">PNG, JPG עד 2MB</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="פרטי העסק">
          <div className="grid grid-cols-1 gap-4" style={{ gridTemplateColumns: isTablet ? '1fr' : '1fr 1fr' }}>
            <div>
              <FieldLabel>שם העסק</FieldLabel>
              <TextInput value={profile.businessName} onChange={v => updateProfile('businessName', v)} placeholder="שם העסק" />
            </div>
            <div>
              <FieldLabel>מספר חברה (ח.פ)</FieldLabel>
              <TextInput value={profile.companyNumber} onChange={v => updateProfile('companyNumber', v)} placeholder="515000000" />
            </div>
            <div>
              <FieldLabel>איש קשר</FieldLabel>
              <TextInput value={profile.contactName} onChange={v => updateProfile('contactName', v)} placeholder="שם מלא" />
            </div>
            <div>
              <FieldLabel>טלפון</FieldLabel>
              <TextInput value={profile.phone} onChange={v => updateProfile('phone', v)} placeholder="052-0000000" type="tel" />
            </div>
            <div>
              <FieldLabel>אימייל</FieldLabel>
              <TextInput value={profile.email} onChange={v => updateProfile('email', v)} placeholder="email@example.com" type="email" />
            </div>
            <div>
              <FieldLabel>כתובת</FieldLabel>
              <TextInput value={profile.address} onChange={v => updateProfile('address', v)} placeholder="רחוב, עיר" />
            </div>
          </div>
        </SectionCard>
        </>)}
      </div>
    ),

    preferences: (
      <div className="space-y-5">
        <SectionCard title="סף אישור לחשבונית גדולה">
          <p className="text-sm text-gray-500 mb-3">
            חשבונית שסכומה <b>לפני מע״מ</b> עובר את הסף לא תאושר אוטומטית: היא נכנסת
            למערכת ונספרת ביתרת הספק, מסומנת ככזו שממתינה, ונפתחת התראה עם כל הפרטים —
            לאישור או לדחייה.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div style={{ minWidth: '190px' }}>
              <FieldLabel>סף בשקלים, לפני מע״מ</FieldLabel>
              <TextInput
                value={threshold}
                onChange={v => { setThreshold(v); setThresholdMsg(null) }}
                placeholder="20000"
                dir="ltr"
              />
            </div>
            <Button onClick={handleSaveThreshold} disabled={thresholdBusy || threshold.trim() === thresholdSaved}>
              {thresholdBusy ? 'שומר…' : 'שמירה'}
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {thresholdSaved
              ? `כרגע פעיל: כל חשבונית מעל ₪${Number(thresholdSaved).toLocaleString('he-IL')} לפני מע״מ תמתין לאישור.`
              : 'כרגע כבוי — שדה ריק פירושו שאין שער, וכל החשבוניות נכנסות כרגיל.'}
          </p>
          {thresholdMsg && (
            <p className="text-xs mt-2 font-semibold" style={{ color: thresholdMsg.type === 'error' ? '#DC2626' : '#16A34A' }}>
              {thresholdMsg.text}
            </p>
          )}
        </SectionCard>

        <SectionCard title="לוגו המערכת">
          <div className="flex items-start gap-5" style={{ flexDirection: 'row-reverse' }}>
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden border"
              style={{ borderColor: '#EEEEF2', background: '#F8F8FA' }}
            >
              <img
                src={sysLogoUrl}
                alt="לוגו המערכת"
                className="w-full h-full object-contain p-1"
                onError={e => { (e.target as HTMLImageElement).src = '/favicon.png' }}
              />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-500 mb-3">לוגו זה מוצג בסרגל הצד, בדוחות ובמסמכי PDF</p>
              <input
                ref={sysLogoInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg"
                className="hidden"
                onChange={handleSystemLogoUpload}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => sysLogoInputRef.current?.click()}
                  disabled={logoUploading}
                >
                  {logoUploading ? (
                    <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--brand-primary)', borderTopColor: 'transparent' }} />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  העלאת לוגו חדש
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleResetSystemLogo}
                  disabled={logoUploading}
                >
                  <RefreshCw className="w-4 h-4" />
                  איפוס ללוגו ברירת מחדל
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-2">PNG, JPG, SVG עד 2MB</p>
              {logoMsg && (
                <p className="text-xs mt-2 font-semibold" style={{ color: logoMsg.type === 'error' ? '#DC2626' : '#16A34A' }}>
                  {logoMsg.text}
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        <NotAvailable />
        {SHOW_LEGACY && (<>
        <SectionCard title="שפה ומטבע">
          <div className="grid grid-cols-1 gap-4" style={{ gridTemplateColumns: isTablet ? '1fr' : '1fr 1fr' }}>
            <div>
              <FieldLabel>שפת ממשק</FieldLabel>
              <TextInput value="עברית" disabled />
              <p className="text-xs text-gray-400 mt-1.5">רק עברית נתמכת כרגע</p>
            </div>
            <div>
              <FieldLabel>מטבע</FieldLabel>
              <TextInput value="שקל חדש (₪)" disabled />
              <p className="text-xs text-gray-400 mt-1.5">רק ₪ נתמך כרגע</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="פורמט תאריך">
          <FieldLabel>בחר פורמט</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {DATE_FORMATS.map(fmt => (
              <button
                key={fmt}
                onClick={() => updatePref('dateFormat', fmt)}
                className="px-4 py-2 rounded-xl text-sm font-semibold border transition-all"
                style={{
                  borderColor: prefs.dateFormat === fmt ? '#E8645A' : '#E2E4E9',
                  background: prefs.dateFormat === fmt ? '#FFF0EF' : 'white',
                  color: prefs.dateFormat === fmt ? '#E8645A' : '#6B7280',
                }}
              >
                {fmt}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            דוגמה: {new Date().toLocaleDateString('he-IL')} → {
              prefs.dateFormat === 'DD/MM/YYYY' ? new Date().toLocaleDateString('he-IL') :
              prefs.dateFormat === 'MM/DD/YYYY' ? `${(new Date().getMonth()+1).toString().padStart(2,'0')}/${new Date().getDate().toString().padStart(2,'0')}/${new Date().getFullYear()}` :
              prefs.dateFormat === 'YYYY-MM-DD' ? new Date().toISOString().slice(0,10) :
              `${new Date().getDate().toString().padStart(2,'0')}.${(new Date().getMonth()+1).toString().padStart(2,'0')}.${new Date().getFullYear()}`
            }
          </p>
        </SectionCard>

        <SectionCard title="צבע ראשי">
          <FieldLabel>בחר צבע</FieldLabel>
          <div className="flex flex-wrap gap-3 mt-1">
            {COLOR_PRESETS.map(color => (
              <button
                key={color}
                onClick={() => updatePref('primaryColor', color)}
                className="w-10 h-10 rounded-xl transition-all"
                style={{
                  background: color,
                  outline: prefs.primaryColor === color ? `3px solid ${color}` : 'none',
                  outlineOffset: '2px',
                  boxShadow: prefs.primaryColor === color ? '0 0 0 1px white inset' : 'none',
                }}
                title={color}
              />
            ))}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={prefs.primaryColor}
                onChange={e => updatePref('primaryColor', e.target.value)}
                className="w-10 h-10 rounded-xl border cursor-pointer"
                style={{ borderColor: '#E2E4E9', padding: '2px' }}
                title="צבע מותאם אישית"
              />
              <span className="text-xs text-gray-400">מותאם אישית</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-gray-500">תצוגה מקדימה:</span>
            <div
              className="px-4 py-2 rounded-xl text-white text-sm font-bold"
              style={{ background: prefs.primaryColor }}
            >
              כפתור לדוגמה
            </div>
            <div
              className="px-3 py-2 rounded-xl text-sm font-bold border"
              style={{ borderColor: prefs.primaryColor, color: prefs.primaryColor }}
            >
              גבול לדוגמה
            </div>
          </div>
        </SectionCard>
        </>)}
      </div>
    ),

    notifications: (
      <div className="space-y-5">
        <NotAvailable />
        {SHOW_LEGACY && (<>
        <SectionCard title="סוגי התראות">
          <Toggle
            value={notifs.duplicates}
            onChange={v => updateNotif('duplicates', v)}
            label="חשבוניות כפולות"
            sub="התראה כאשר מתגלות חשבוניות עם מספר זהה"
          />
          <Toggle
            value={notifs.mismatches}
            onChange={v => updateNotif('mismatches', v)}
            label="אי-התאמות בכרטסות"
            sub="התראה כאשר יש פערים בין הכרטסת לדף החשבון"
          />
          <Toggle
            value={notifs.futurePayments}
            onChange={v => updateNotif('futurePayments', v)}
            label="תשלומים קרובים"
            sub="תזכורת 3 ימים לפני מועד פירעון"
          />
          <Toggle
            value={notifs.pendingDeliveries}
            onChange={v => updateNotif('pendingDeliveries', v)}
            label="תעודות משלוח ממתינות"
            sub="התראה על תעודות שלא שויכו לחשבונית"
          />
        </SectionCard>

        <SectionCard title="ערוצי התראה">
          <div
            className="flex items-center gap-3 p-4 rounded-xl"
            style={{ background: '#F8F9FA' }}
          >
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#22C55E' }} />
            <div>
              <p className="text-sm font-semibold text-gray-700">התראות בתוך המערכת</p>
              <p className="text-xs text-gray-400 mt-0.5">התראות מוצגות בפעמון בסרגל העליון</p>
            </div>
          </div>
          <div
            className="flex items-center gap-3 p-4 rounded-xl mt-2 border border-dashed"
            style={{ borderColor: '#E2E4E9' }}
          >
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#D1D5DB' }} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-400">התראות במייל</p>
              <p className="text-xs text-gray-400 mt-0.5">יהיה זמין בקרוב</p>
            </div>
            <span className="text-xs px-2 py-1 rounded-lg font-bold" style={{ background: '#F3F4F6', color: '#9CA3AF' }}>
              בפיתוח
            </span>
          </div>
        </SectionCard>
        </>)}
      </div>
    ),

    backup: (
      <div className="space-y-5">
        <NotAvailable />
        {SHOW_LEGACY && (<>
        <SectionCard title="ייצוא נתונים">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl border" style={{ borderColor: '#E2E4E9' }}>
              <Button variant="primary" onClick={handleExportAll}>
                <Download className="w-4 h-4" />
                ייצא הכל ל-Excel
              </Button>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-700">גיבוי מלא</p>
                <p className="text-xs text-gray-400 mt-0.5">ספקים, חשבוניות, תשלומים, תעודות</p>
              </div>
            </div>

            <div
              className="flex items-center justify-between p-4 rounded-xl border border-dashed"
              style={{ borderColor: '#E2E4E9' }}
            >
              <div className="flex items-center gap-2">
                <button
                  disabled
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: '#F3F4F6', color: '#9CA3AF', cursor: 'not-allowed' }}
                >
                  <Upload className="w-4 h-4" />
                  גיבוי לדרייב
                </button>
                <span className="text-xs px-2 py-1 rounded-lg font-bold" style={{ background: '#FEF9C3', color: '#A16207' }}>
                  בקרוב
                </span>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-400">Google Drive</p>
                <p className="text-xs text-gray-400 mt-0.5">גיבוי אוטומטי לענן</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="ייבוא נתונים">
          <div
            className="flex items-center justify-between p-4 rounded-xl border border-dashed"
            style={{ borderColor: '#E2E4E9' }}
          >
            <div className="flex items-center gap-2">
              <button
                disabled
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: '#F3F4F6', color: '#9CA3AF', cursor: 'not-allowed' }}
              >
                <Upload className="w-4 h-4" />
                ייבא מ-Excel
              </button>
              <span className="text-xs px-2 py-1 rounded-lg font-bold" style={{ background: '#FEF9C3', color: '#A16207' }}>
                בקרוב
              </span>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-400">ייבוא נתונים</p>
              <p className="text-xs text-gray-400 mt-0.5">ייבוא ספקים וחשבוניות מקובץ Excel</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="מידע על המערכת">
          <div className="space-y-2">
            {[
              ['גרסה', 'v1.0.0'],
              ['סביבה', 'Production'],
              ['עדכון אחרון', new Date().toLocaleDateString('he-IL')],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: '#F3F4F6' }}>
                <span className="text-sm text-gray-500 font-mono">{value}</span>
                <span className="text-sm font-semibold text-gray-700">{label}</span>
              </div>
            ))}
          </div>
        </SectionCard>
        </>)}
      </div>
    ),

    employees: (
      <div className="space-y-5">
        {/* Add / Edit form */}
        {showEmpForm && (
          <SectionCard title={editingEmpId ? 'עריכת עובד' : 'הוספת עובד חדש'}>
            <div className="grid grid-cols-1 gap-4" style={{ gridTemplateColumns: isTablet ? '1fr' : '1fr 1fr' }}>
              <div>
                <FieldLabel>שם מלא *</FieldLabel>
                <TextInput
                  value={empForm.name}
                  onChange={v => setEmpForm(f => ({ ...f, name: v }))}
                  placeholder="שם מלא"
                />
              </div>
              <div>
                <FieldLabel>תפקיד</FieldLabel>
                <TextInput
                  value={empForm.role}
                  onChange={v => setEmpForm(f => ({ ...f, role: v }))}
                  placeholder="רכזת, מנהלת חשבונות..."
                />
              </div>
              <div>
                <FieldLabel>טלפון</FieldLabel>
                <TextInput
                  value={empForm.phone}
                  onChange={v => setEmpForm(f => ({ ...f, phone: v }))}
                  placeholder="050-0000000"
                  type="tel"
                />
              </div>
              <div>
                <Toggle
                  value={empForm.active}
                  onChange={v => setEmpForm(f => ({ ...f, active: v }))}
                  label="עובד/ת פעיל/ה"
                />
              </div>
            </div>
            <div
              className="flex justify-end gap-3 mt-5 pt-4 border-t"
              style={{ borderColor: '#F3F4F6' }}
            >
              <Button
                variant="outline"
                onClick={() => { setShowEmpForm(false); setEditingEmpId(null) }}
              >
                ביטול
              </Button>
              <Button
                variant="primary"
                onClick={saveEmp}
                disabled={!empForm.name.trim()}
              >
                {editingEmpId ? 'שמור שינויים' : 'הוסף עובד'}
              </Button>
            </div>
          </SectionCard>
        )}

        {/* Employee list */}
        <SectionCard>
          <div className="flex items-center justify-between mb-5">
            <Button variant="primary" onClick={openEmpAdd}>
              <Plus className="w-4 h-4" />
              הוסף עובד
            </Button>
            <h3 className="font-bold text-gray-700 text-base">
              רשימת עובדים {employees.length > 0 && `(${employees.length})`}
            </h3>
          </div>

          {empLoading ? (
            <div className="py-10 text-center">
              <div
                className="animate-spin rounded-full h-6 w-6 border-b-2 mx-auto"
                style={{ borderColor: '#E8645A' }}
              />
            </div>
          ) : employees.length === 0 ? (
            <div className="py-10 text-center">
              <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-gray-400 text-sm">אין עובדים — הוסף עובד ראשון</p>
            </div>
          ) : (
            <div className="space-y-2">
              {employees.map(emp => (
                <div
                  key={emp.id}
                  className="flex items-center justify-between p-3.5 rounded-xl border transition-colors"
                  style={{
                    borderColor: deletingEmpId === emp.id ? '#FECACA' : '#E2E4E9',
                    background: deletingEmpId === emp.id ? '#FFF5F5' : 'white',
                  }}
                >
                  {/* Info (right side in RTL) */}
                  <div className="text-right flex-1 min-w-0 mr-3">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{emp.name}</span>
                      {emp.role && <span className="text-sm text-gray-400">· {emp.role}</span>}
                      {emp.phone && (
                        <span className="text-xs text-gray-400" dir="ltr">{emp.phone}</span>
                      )}
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{
                          background: emp.active ? '#DCFCE7' : '#F3F4F6',
                          color: emp.active ? '#166534' : '#9CA3AF',
                        }}
                      >
                        {emp.active ? 'פעיל' : 'לא פעיל'}
                      </span>
                    </div>
                  </div>

                  {/* Actions (left side in RTL) */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {deletingEmpId === emp.id ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeletingEmpId(null)}
                        >
                          ביטול
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => confirmDeleteEmp(emp.id)}
                        >
                          מחק
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => openEmpEdit(emp)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: '#F3F4F6', color: '#6B7280' }}
                          title="עריכה"
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#E5E7EB' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#F3F4F6' }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingEmpId(emp.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: '#FEE2E2', color: '#DC2626' }}
                          title="מחק"
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FECACA' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#FEE2E2' }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    ),

    categories: <CategoriesManager />,
    bizbox:     <BizboxTemplateManager />,
  }

  return (
    <div className="space-y-6" style={{ direction: 'rtl' }}>
      <div>
        <p className="text-gray-500 text-sm mt-0.5">ניהול פרופיל, העדפות והתראות המערכת</p>
      </div>

      {/* Tab bar */}
      <div
        className="flex bg-white rounded-2xl shadow-sm border overflow-hidden"
        style={{ borderColor: '#E2E4E9' }}
      >
        {/* Bizibox export is one of the integrations the top tier sells, so the
            tab follows the same catalogue as the rest of the app. */}
        {TABS.filter(({ id }) => id !== 'bizbox' || tierAllowsIntegrations()).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex-1 flex flex-col items-center gap-1.5 py-4 transition-all relative"
            style={{
              background: activeTab === id ? '#FFF0EF' : 'white',
              color: activeTab === id ? '#E8645A' : '#9CA3AF',
              borderBottom: activeTab === id ? '2px solid #E8645A' : '2px solid transparent',
            }}
          >
            <Icon className="w-5 h-5" />
            <span className="text-xs font-bold">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tabContent[activeTab]}

      <SaveToast visible={toastVisible} />
    </div>
  )
}
