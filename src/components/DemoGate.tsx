import { useState } from 'react'
import { brand } from '../brand.config'
import { unlock, type DemoRole } from '../lib/demoGate'

// The door of the public demo build (incontrol.ctrlplusf.com). Rendered by App.tsx
// instead of the app itself while DEMO_STANDALONE is on and the session is locked.
// Styled after src/components/Login.tsx so the demo opens on a screen that already
// looks like the system, not like a bolted-on gate.

interface Props {
  onUnlock: () => void
}

const ROLES: { value: DemoRole; title: string; hint: string }[] = [
  { value: 'manager',  title: 'מנהלת', hint: 'המערכת המלאה — ספקים, חשבוניות, תשלומים, כרטסות' },
  { value: 'employee', title: 'עובדת', hint: 'המסך המצומצם — קליטת מסמכים ומשימות יומיות' },
]

export default function DemoGate({ onUnlock }: Props) {
  const [password, setPassword] = useState('')
  const [role, setRole]         = useState<DemoRole>('manager')
  const [error, setError]       = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (unlock(password, role)) {
      onUnlock()
      return
    }
    setError(true)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F4F5F7',
        direction: 'rtl',
        padding: '24px',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'white',
          borderRadius: '24px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          width: '100%',
          maxWidth: '420px',
          padding: '40px 32px',
        }}
      >
        {/* Logo + name, identical treatment to the real login screen */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--brand-primary-dark), #E8645A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px',
              boxShadow: '0 4px 12px rgba(140,23,51,0.25)',
            }}
          >
            <img src={brand.logoPath} alt={brand.appName} style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 900, color: '#1F2937', margin: 0 }}>{brand.appName}</h1>
          <p style={{ fontSize: '13px', color: '#9CA3AF', marginTop: '4px', marginBottom: 0 }}>מערכת הדגמה</p>
        </div>

        {/* Says plainly what this is, so nobody mistakes the numbers for real ones */}
        <div
          style={{
            background: '#F4F5F7',
            borderRadius: '12px',
            padding: '12px 16px',
            fontSize: '13px',
            color: '#6B7280',
            lineHeight: 1.6,
            marginBottom: '24px',
          }}
        >
          כל הספקים, החשבוניות והסכומים כאן <strong style={{ color: '#4B5563' }}>בדיוניים</strong>.
          המערכת אינה מחוברת לבסיס נתונים ואינה שומרת דבר.
        </div>

        <label
          htmlFor="demo-password"
          style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#4B5563', marginBottom: '8px' }}
        >
          סיסמת כניסה
        </label>
        <input
          id="demo-password"
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(false) }}
          autoFocus
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 16px',
            borderRadius: '12px',
            border: `1px solid ${error ? '#E8645A' : '#E2E4E9'}`,
            fontSize: '15px',
            fontFamily: 'inherit',
            outline: 'none',
            marginBottom: error ? '8px' : '24px',
          }}
        />

        {error && (
          <p style={{ color: '#E8645A', fontSize: '13px', margin: '0 0 20px' }}>
            סיסמה שגויה. נסו שוב.
          </p>
        )}

        <p style={{ fontSize: '13px', fontWeight: 600, color: '#4B5563', margin: '0 0 10px' }}>
          כניסה בתור
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '28px' }}>
          {ROLES.map((r) => {
            const selected = role === r.value
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                style={{
                  textAlign: 'right',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  border: `1.5px solid ${selected ? 'var(--brand-primary-dark)' : '#E2E4E9'}`,
                  background: selected ? 'var(--brand-active-bg, #FFF0EF)' : 'white',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
                aria-pressed={selected}
              >
                <span style={{ display: 'block', fontSize: '15px', fontWeight: 700, color: '#1F2937' }}>
                  {r.title}
                </span>
                <span style={{ display: 'block', fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>
                  {r.hint}
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="submit"
          style={{
            width: '100%',
            padding: '13px',
            borderRadius: '12px',
            border: 'none',
            background: 'var(--brand-primary-dark)',
            color: 'white',
            fontSize: '15px',
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          כניסה להדגמה
        </button>
      </form>
    </div>
  )
}
