import { useEffect, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import Login from './components/Login'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import EmployeeDashboard from './components/employee/EmployeeDashboard'
import DemoGate from './components/DemoGate'
import DemoRoleSwitcher from './components/DemoRoleSwitcher'
import { NotesTargetProvider } from './lib/notesTarget'
import { DEMO_STANDALONE } from './lib/demo'
import { isUnlocked } from './lib/demoGate'

// A spinner that never stops is as useless as a blank page — and on a tablet the
// two look identical. Sign-in needs one call to Supabase before anything can be
// drawn, so when that call hangs the whole system is a white rectangle with a
// wheel on it, and nobody can tell whether it is loading, broken or offline.
//
// This happened for real: the app rendered the spinner forever on a tablet whose
// browser opened the very same site without trouble. Chrome and an app are two
// different network clients — a device-management filter can allow one and block
// the other — and there was no way to see that from the screen.
//
// So after eight seconds the screen says what it is waiting for, and checks
// whether the data server answers at all.
const STALL_MS = 8000

function LoadingScreen() {
  const [stalled, setStalled] = useState(false)
  const [reach, setReach] = useState<'checking' | 'ok' | 'blocked'>('checking')

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALL_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!stalled) return
    // /auth/v1/health needs no key and no session: it answers whether this client
    // can reach the data server at all, which is the one fact worth knowing here.
    // Resolved through a promise even when the URL is missing, so the state is
    // never set synchronously inside the effect.
    const base = import.meta.env.VITE_SUPABASE_URL
    const probe: Promise<boolean> = base
      ? fetch(`${base}/auth/v1/health`, { cache: 'no-store' }).then((r) => r.ok)
      : Promise.resolve(false)
    probe.then((ok) => setReach(ok ? 'ok' : 'blocked')).catch(() => setReach('blocked'))
  }, [stalled])

  const engine = typeof navigator !== 'undefined'
    ? (navigator.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] ?? 'unknown')
    : 'unknown'

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '18px',
        padding: '24px',
        backgroundColor: '#F4F5F7',
        direction: 'rtl',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: '3px solid #E2E4E9',
          borderTopColor: 'var(--brand-primary-dark)',
          animation: 'spin 0.8s linear infinite',
        }}
      />

      {stalled && (
        <div style={{ maxWidth: '380px', fontFamily: 'system-ui, Arial, sans-serif' }}>
          <p style={{ fontSize: '15px', fontWeight: 700, color: '#1F2937', margin: '0 0 6px' }}>
            {reach === 'blocked' ? 'אין גישה לשרת הנתונים' : 'הטעינה נמשכת יותר מהרגיל'}
          </p>
          <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, lineHeight: 1.7 }}>
            {reach === 'blocked'
              ? 'המכשיר לא מצליח להגיע לשרת של המערכת. אם יש סינון אינטרנט על המכשיר, ייתכן שהוא חוסם את האפליקציה.'
              : 'בודקים חיבור לשרת…'}
          </p>
          <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '14px 0 0', direction: 'ltr' }}>
            engine: Chrome {engine} · server: {reach}
          </p>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function App() {
  // useAuth is called unconditionally, ABOVE the demo gate, so the hook order never
  // changes between the gated and the open render. In the standalone demo build it
  // resolves against the stubbed client — no network either way.
  const { user, role, isLoading, unauthorizedError, signOut } = useAuth()

  // The public demo build (incontrol.ctrlplusf.com) opens on a password door.
  // Unlocking reloads rather than re-rendering: the visitor's chosen role is read
  // once per session by useAuth, so it has to be in place before the app mounts.
  if (DEMO_STANDALONE && !isUnlocked()) {
    return <DemoGate onUnlock={() => window.location.reload()} />
  }

  if (isLoading) return <LoadingScreen />
  if (!user) return <Login unauthorizedError={unauthorizedError} />

  // Employees get a dedicated, restricted dashboard. Everyone else (managers) keeps
  // the full app. RLS enforces the same boundary at the DB level (defense in depth).
  if (role === 'employee') {
    return (
      <>
        <EmployeeDashboard userEmail={user.email ?? ''} onLogout={signOut} />
        {DEMO_STANDALONE && <DemoRoleSwitcher />}
      </>
    )
  }

  return (
    <ProtectedRoute
      requiredRole="manager"
      user={user}
      role={role}
      userEmail={user.email ?? ''}
      onSignOut={signOut}
    >
      {/* The notes target lives ABOVE Layout: Layout itself has to read which
          supplier is in focus, because that decides whether the page is shifted
          to make room for the notes panel. */}
      <NotesTargetProvider>
        <Layout userEmail={user.email ?? ''} onLogout={signOut} />
      </NotesTargetProvider>
      {DEMO_STANDALONE && <DemoRoleSwitcher />}
    </ProtectedRoute>
  )
}
