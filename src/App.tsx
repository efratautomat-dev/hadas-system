import { useAuth } from './hooks/useAuth'
import Login from './components/Login'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import EmployeeDashboard from './components/employee/EmployeeDashboard'

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
          borderTopColor: '#8C1733',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function App() {
  const { user, role, isLoading, unauthorizedError, signOut } = useAuth()

  if (isLoading) return <LoadingScreen />
  if (!user) return <Login unauthorizedError={unauthorizedError} />

  // Employees get a dedicated, restricted dashboard. Everyone else (managers) keeps
  // the full app. RLS enforces the same boundary at the DB level (defense in depth).
  if (role === 'employee') {
    return <EmployeeDashboard userEmail={user.email ?? ''} onLogout={signOut} />
  }

  return (
    <ProtectedRoute
      requiredRole="manager"
      user={user}
      role={role}
      userEmail={user.email ?? ''}
      onSignOut={signOut}
    >
      <Layout userEmail={user.email ?? ''} onLogout={signOut} />
    </ProtectedRoute>
  )
}
