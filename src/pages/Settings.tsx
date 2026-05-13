import { useState, useRef } from 'react'
import { User, Settings2, Bell, Download, Upload, Camera } from 'lucide-react'

function useIsTablet() {
  const [v] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth <= 1024
  )
  return v
}

type Tab = 'profile' | 'preferences' | 'notifications' | 'backup'

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
  { id: 'backup',        label: 'גיבוי וייצוא',  Icon: Download },
]

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY']
const COLOR_PRESETS = ['#E8645A', '#8B1A3A', '#E8A020', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6']

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

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border" style={{ borderColor: '#E2E4E9' }}>
      {title && (
        <div className="px-6 py-4 border-b" style={{ borderColor: '#E2E4E9' }}>
          <h3 className="font-bold text-gray-700 text-base">{title}</h3>
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-gray-600 mb-1.5">{children}</label>
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-xl border text-sm text-gray-800 outline-none transition-all"
      style={{
        borderColor: '#E2E4E9',
        padding: '10px 14px',
        background: disabled ? '#F8F9FA' : 'white',
        color: disabled ? '#9CA3AF' : undefined,
      }}
      onFocus={e => { if (!disabled) (e.target as HTMLInputElement).style.borderColor = '#E8645A' }}
      onBlur={e => { (e.target as HTMLInputElement).style.borderColor = '#E2E4E9' }}
    />
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

  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const tabContent = {
    profile: (
      <div className="space-y-5">
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
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all"
                style={{ borderColor: '#E8645A', color: '#E8645A' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF0EF' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <Upload className="w-4 h-4" />
                העלה לוגו
              </button>
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
      </div>
    ),

    preferences: (
      <div className="space-y-5">
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
      </div>
    ),

    notifications: (
      <div className="space-y-5">
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
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: '#22C55E' }}
            />
            <div>
              <p className="text-sm font-semibold text-gray-700">התראות בתוך המערכת</p>
              <p className="text-xs text-gray-400 mt-0.5">התראות מוצגות בפעמון בסרגל העליון</p>
            </div>
          </div>
          <div
            className="flex items-center gap-3 p-4 rounded-xl mt-2 border border-dashed"
            style={{ borderColor: '#E2E4E9' }}
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: '#D1D5DB' }}
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-400">התראות במייל</p>
              <p className="text-xs text-gray-400 mt-0.5">יהיה זמין בקרוב</p>
            </div>
            <span
              className="text-xs px-2 py-1 rounded-lg font-bold"
              style={{ background: '#F3F4F6', color: '#9CA3AF' }}
            >
              בפיתוח
            </span>
          </div>
        </SectionCard>
      </div>
    ),

    backup: (
      <div className="space-y-5">
        <SectionCard title="ייצוא נתונים">
          <div className="space-y-4">
            <div
              className="flex items-center justify-between p-4 rounded-xl border"
              style={{ borderColor: '#E2E4E9' }}
            >
              <button
                onClick={handleExportAll}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                style={{ background: '#E8645A' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#8B1A3A' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#E8645A' }}
              >
                <Download className="w-4 h-4" />
                ייצא הכל ל-Excel
              </button>
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
                <span
                  className="text-xs px-2 py-1 rounded-lg font-bold"
                  style={{ background: '#FEF9C3', color: '#A16207' }}
                >
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
              <span
                className="text-xs px-2 py-1 rounded-lg font-bold"
                style={{ background: '#FEF9C3', color: '#A16207' }}
              >
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
      </div>
    ),
  }

  return (
    <div className="space-y-6" style={{ direction: 'rtl' }}>
      <div>
        <h1 className="text-2xl font-black text-gray-800">הגדרות</h1>
        <p className="text-gray-500 text-sm mt-0.5">ניהול פרופיל, העדפות והתראות המערכת</p>
      </div>

      {/* Tab bar */}
      <div
        className="flex bg-white rounded-2xl shadow-sm border overflow-hidden"
        style={{ borderColor: '#E2E4E9' }}
      >
        {TABS.map(({ id, label, Icon }) => (
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
