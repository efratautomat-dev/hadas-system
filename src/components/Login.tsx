import { useState } from 'react'
import { Mail, ArrowLeft } from 'lucide-react'

interface LoginProps {
  onLogin: (email: string) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      onLogin(email)
    }, 800)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #8B1A3A 0%, #D94F5C 55%, #E8645A 100%)' }}
    >
      {/* Decorative blobs */}
      <div
        className="absolute w-96 h-96 rounded-full opacity-10 blur-3xl"
        style={{ background: '#FFF8F7', top: '-80px', right: '-80px' }}
      />
      <div
        className="absolute w-80 h-80 rounded-full opacity-10 blur-3xl"
        style={{ background: '#E8A020', bottom: '-60px', left: '-60px' }}
      />
      <div
        className="absolute w-64 h-64 rounded-full opacity-5 blur-2xl"
        style={{ background: '#fff', top: '50%', left: '30%' }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Card header with gradient */}
          <div
            className="px-8 pt-10 pb-8 text-center"
            style={{ background: 'linear-gradient(135deg, #8B1A3A 0%, #E8645A 100%)' }}
          >
            {/* Logo mark */}
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white shadow-lg mb-5 mx-auto">
              <img src="/logo.png" alt="הדס לוגו" className="w-14 h-14 object-contain" />
            </div>

            <h1
              className="text-5xl font-black text-white tracking-widest mb-2"
              style={{ fontFamily: 'Heebo, sans-serif', letterSpacing: '0.15em' }}
            >
              הדס
            </h1>
            <p className="text-white/70 text-sm font-medium tracking-wide">
              מערכת ניהול ספקים
            </p>
          </div>

          {/* Card body */}
          <div className="px-8 py-8">
            <div className="mb-7">
              <h2 className="text-xl font-bold text-gray-800 mb-1">ברוכה הבאה</h2>
              <p className="text-gray-500 text-sm">הכניסי את כתובת המייל שלך להמשך</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  כתובת מייל
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="שם@חברה.co.il"
                    dir="ltr"
                    className="w-full px-4 py-3.5 pr-11 rounded-xl border-2 border-gray-200 text-gray-800 placeholder:text-gray-400 transition-all text-sm"
                    style={{ borderColor: email ? '#E8645A' : undefined }}
                    required
                  />
                  <Mail
                    className="absolute top-1/2 -translate-y-1/2 right-3.5 w-4 h-4 text-gray-400 pointer-events-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full py-3.5 rounded-xl font-bold text-white text-base transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: loading || !email.trim()
                    ? '#ccc'
                    : 'linear-gradient(135deg, #8B1A3A, #E8645A)',
                }}
              >
                {loading ? (
                  <span className="inline-block w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <ArrowLeft className="w-4 h-4" />
                    כניסה למערכת
                  </>
                )}
              </button>
            </form>

            <p className="text-center text-xs text-gray-400 mt-7">
              © {new Date().getFullYear()} הדס · כל הזכויות שמורות
            </p>
          </div>
        </div>

        {/* Floating badge */}
        <p className="text-center text-white/50 text-xs mt-4 tracking-wide">
          מערכת פנים-ארגונית · גישה מורשית בלבד
        </p>
      </div>
    </div>
  )
}
