import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

export type Role = 'manager' | 'employee'

export interface AuthState {
  user: User | null
  role: Role | null
  isLoading: boolean
  unauthorizedError: boolean
  signOut: () => Promise<void>
}

async function fetchRole(user: User): Promise<Role | null> {
  const { data } = await supabase
    .from('allowed_users')
    .select('role')
    .eq('email', user.email)
    .maybeSingle()
  return (data?.role as Role) ?? null
}

export function useAuth(): AuthState {
  const [user, setUser]                     = useState<User | null>(null)
  const [role, setRole]                     = useState<Role | null>(null)
  const [isLoading, setIsLoading]           = useState(true)
  const [unauthorizedError, setUnauthorizedError] = useState(false)

  useEffect(() => {
    let mounted = true

    async function handleUser(u: User | null) {
      if (!u) {
        if (mounted) { setUser(null); setRole(null); setIsLoading(false) }
        return
      }

      const r = await fetchRole(u)
      if (!mounted) return

      if (!r) {
        await supabase.auth.signOut()
        if (mounted) {
          setUser(null)
          setRole(null)
          setUnauthorizedError(true)
          setIsLoading(false)
        }
        return
      }

      if (mounted) {
        setUser(u)
        setRole(r)
        setUnauthorizedError(false)
        setIsLoading(false)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUser(session?.user ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = () => supabase.auth.signOut().then(() => undefined)

  return { user, role, isLoading, unauthorizedError, signOut }
}
