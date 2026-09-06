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

function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F4F5F7',
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
