import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Role } from '../hooks/useAuth'
import WaitingScreen from './WaitingScreen'

interface Props {
  children: ReactNode
  requiredRole?: Role
  user: User | null
  role: Role | null
  userEmail: string
  onSignOut: () => Promise<void>
}

export default function ProtectedRoute({ children, requiredRole, user, role, userEmail, onSignOut }: Props) {
  if (!user) return null

  if (requiredRole === 'manager' && role === 'employee') {
    return <WaitingScreen userEmail={userEmail} onSignOut={onSignOut} />
  }

  if (requiredRole && role !== requiredRole) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          direction: 'rtl',
        }}
      >
        <p style={{ color: '#E8645A', fontSize: '16px' }}>אין הרשאה לגשת לדף זה.</p>
      </div>
    )
  }

  return <>{children}</>
}
