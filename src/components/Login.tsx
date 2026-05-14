import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  unauthorizedError?: boolean
}

const PROD_URL = 'https://hadas-system.vercel.app'

export default function Login({ unauthorizedError = false }: Props) {
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    setLoading(true)
    setError(null)

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: PROD_URL },
    })

    setLoading(false)

    if (otpError) {
      setError('שגיאה בשליחת הקישור. אנא נסי שוב.')
      return
    }

    setSent(true)
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
              background: 'linear-gradient(135deg, #8B1A3A, #E8645A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px',
              boxShadow: '0 4px 12px rgba(139,26,58,0.25)',
            }}
          >
            <img src="/logo.png" alt="הדס" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 900, color: '#1F2937', margin: 0 }}>הדס</h1>
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
                color: '#8B1A3A',
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
              onFocus={e => (e.currentTarget.style.borderColor = '#8B1A3A')}
              onBlur={e => (e.currentTarget.style.borderColor = '#E2E4E9')}
            />

            {error && (
              <p style={{ color: '#E8645A', fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              style={{
                width: '100%',
                marginTop: '16px',
                padding: '12px',
                borderRadius: '12px',
                border: 'none',
                background:
                  loading || !email.trim()
                    ? '#D1D5DB'
                    : 'linear-gradient(135deg, #8B1A3A, #E8645A)',
                color: 'white',
                fontSize: '14px',
                fontWeight: 700,
                cursor: loading || !email.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'שולח...' : 'שלח קישור התחברות'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
