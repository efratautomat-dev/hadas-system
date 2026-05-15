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
  try {
    const { data, error } = await supabase
      .from('allowed_users')
      .select('role')
      .eq('email', user.email)
      .maybeSingle()

    if (error) {
      console.error('[useAuth] fetchRole DB error:', error.message, error.code)
      return null
    }

    console.log('[useAuth] fetchRole result for', user.email, '→', data?.role ?? 'NOT FOUND')
    return (data?.role as Role) ?? null
  } catch (err) {
    console.error('[useAuth] fetchRole exception:', err)
    return null
  }
}

export function useAuth(): AuthState {
  const [user, setUser]                           = useState<User | null>(null)
  const [role, setRole]                           = useState<Role | null>(null)
  const [isLoading, setIsLoading]                 = useState(true)
  const [unauthorizedError, setUnauthorizedError] = useState(false)

  useEffect(() => {
    let mounted = true

    async function processUser(u: User | null) {
      console.log('[useAuth] processUser →', u?.email ?? 'null')

      if (!u) {
        if (mounted) {
          setUser(null)
          setRole(null)
          setIsLoading(false)
        }
        return
      }

      const r = await fetchRole(u)
      if (!mounted) return

      if (!r) {
        // Email not in allowed_users — show error and sign out.
        // signOut is deferred so it runs outside the auth-lock if we got here
        // via onAuthStateChange.
        console.warn('[useAuth] Unauthorized email, signing out:', u.email)
        if (mounted) {
          setUser(null)
          setRole(null)
          setUnauthorizedError(true)
          setIsLoading(false)
        }
        supabase.auth.signOut()
        return
      }

      if (mounted) {
        setUser(u)
        setRole(r)
        setUnauthorizedError(false)
        setIsLoading(false)
      }
    }

    // ── Initial session load ───────────────────────────────────────────────
    // getSession() safely reads whatever the client has at this moment,
    // including any magic-link tokens already exchanged from the URL hash.
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) console.error('[useAuth] getSession error:', error.message)
      console.log('[useAuth] getSession →', session?.user?.email ?? 'no session')
      if (mounted) processUser(session?.user ?? null)
    })

    // ── Future auth events ─────────────────────────────────────────────────
    // IMPORTANT: We use setTimeout(0) to defer the async DB work (fetchRole)
    // out of the Supabase auth-change callback. Calling supabase.from() directly
    // inside onAuthStateChange holds the client's internal lock and causes
    // the query to silently fail, which makes fetchRole return null and
    // triggers a bogus immediate sign-out.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[useAuth] onAuthStateChange event:', event, '| user:', session?.user?.email ?? 'null')
      setTimeout(() => {
        if (mounted) processUser(session?.user ?? null)
      }, 0)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = () => supabase.auth.signOut().then(() => undefined)

  return { user, role, isLoading, unauthorizedError, signOut }
}
