import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { brand } from '../brand.config'

interface Props {
  unauthorizedError?: boolean
}

export default function Login({ unauthorizedError = false }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent]         = useState(false)
  const [busy, setBusy]         = useState<'otp' | 'password' | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    setBusy('otp')
    setError(null)

    // window.location.origin works for both prod (https://hadas-system.vercel.app)
    // and local dev (http://localhost:5173) without hardcoding.
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin },
    })

    setBusy(null)

    if (otpError) {
      setError('שגיאה בשליחת הקישור. אנא נסי שוב.')
      return
    }

    setSent(true)
  }

  // DEV/testing: email + password sign-in (Supabase user created in the dev project).
  // On success the session is set and the app's auth listener proceeds exactly as
  // after a magic-link login (role is still resolved from allowed_users).
  const handlePasswordLogin = async () => {
    if (!email.trim() || !password) return

    setBusy('password')
    setError(null)

    const { error: pwError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    setBusy(null)

    if (pwError) {
      setError('אימייל או סיסמה שגויים.')
      return
    }
    // success: onAuthStateChange picks up the session — no navigation needed here.
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
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '24px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          width: '100%',
          maxWidth: '400px',
          padding: '40px 32px',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
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
          <p style={{ fontSize: '13px', color: '#9CA3AF', marginTop: '4px', marginBottom: 0 }}>מערכת ניהול ספקים</p>
        </div>

        {/* Unauthorized error banner */}
        {unauthorizedError && !sent && (
          <div
            style={{
              background: '#FFF0EF',
              color: '#E8645A',
              borderRadius: '12px',
              padding: '12px 16px',
              fontSize: '14px',
              textAlign: 'center',
              marginBottom: '16px',
              lineHeight: 1.5,
            }}
          >
            המייל לא מורשה לגשת למערכת. פנו למנהלת.
          </div>
        )}

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '44px', marginBottom: '16px' }}>📩</div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', marginBottom: '10px' }}>
              קישור נשלח!
            </h2>
            <p style={{ color: '#6B7280', fontSize: '14px', lineHeight: 1.7, margin: 0 }}>
              שלחנו לך קישור למייל.<br />אנא בדקי את תיבת הדואר.
            </p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              style={{
                marginTop: '24px',
                background: 'none',
                border: 'none',
                color: 'var(--brand-primary-dark)',
                fontSize: '13px',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              שליחה מחדש
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label
              htmlFor="email"
              style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}
            >
              כתובת מייל
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              style={{
                width: '100%',
                borderRadius: '12px',
                border: '1.5px solid #E2E4E9',
                padding: '10px 14px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--brand-primary-dark)')}
              onBlur={e => (e.currentTarget.style.borderColor = '#E2E4E9')}
            />

            {/* DEV/testing: password sign-in. Optional — magic link above stays primary. */}
            <label
              htmlFor="password"
              style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#374151', margin: '16px 0 6px' }}
            >
              סיסמה <span style={{ color: '#9CA3AF', fontWeight: 400, fontSize: '12px' }}>(לפיתוח)</span>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              style={{
                width: '100%',
                borderRadius: '12px',
                border: '1.5px solid #E2E4E9',
                padding: '10px 14px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--brand-primary-dark)')}
              onBlur={e => (e.currentTarget.style.borderColor = '#E2E4E9')}
            />

            {error && (
              <p style={{ color: '#E8645A', fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={busy !== null || !email.trim()}
              style={{
                width: '100%',
                marginTop: '16px',
                padding: '12px',
                borderRadius: '12px',
                border: 'none',
                background:
                  busy !== null || !email.trim()
                    ? '#D1D5DB'
                    : 'linear-gradient(135deg, var(--brand-primary-dark), #E8645A)',
                color: 'white',
                fontSize: '14px',
                fontWeight: 700,
                cursor: busy !== null || !email.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {busy === 'otp' ? 'שולח...' : 'שלח קישור התחברות'}
            </button>

            {/* divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0' }}>
              <div style={{ flex: 1, height: '1px', background: '#E2E4E9' }} />
              <span style={{ fontSize: '12px', color: '#9CA3AF' }}>או</span>
              <div style={{ flex: 1, height: '1px', background: '#E2E4E9' }} />
            </div>

            <button
              type="button"
              onClick={handlePasswordLogin}
              disabled={busy !== null || !email.trim() || !password}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                background: 'white',
                border: `1.5px solid ${busy !== null || !email.trim() || !password ? '#E2E4E9' : 'var(--brand-primary-dark)'}`,
                color: busy !== null || !email.trim() || !password ? '#B4B8C0' : 'var(--brand-primary-dark)',
                fontSize: '14px',
                fontWeight: 700,
                cursor: busy !== null || !email.trim() || !password ? 'not-allowed' : 'pointer',
              }}
            >
              {busy === 'password' ? 'מתחבר...' : 'התחבר עם סיסמה'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
