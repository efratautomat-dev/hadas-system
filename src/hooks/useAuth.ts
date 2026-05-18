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
    // Tracks whether INITIAL_SESSION has already resolved auth state so the
    // getSession() fallback below doesn't double-process.
    let initialSessionHandled = false

    console.log('[useAuth] mount — url hash present:', !!window.location.hash)

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

    // ── Auth state listener (MUST register before getSession) ─────────────────
    // In Supabase v2, onAuthStateChange replays INITIAL_SESSION immediately on
    // subscribe. INITIAL_SESSION fires only after detectSessionInUrl has finished
    // processing any magic-link hash, making it the authoritative first-session
    // signal. Registering after getSession() creates a race where getSession()
    // can resolve to null before the hash exchange completes, causing the Login
    // screen to flash (or stick) before the SIGNED_IN event arrives.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const hashPreview = window.location.hash.slice(0, 60) || '(none)'
      console.log('[useAuth] onAuthStateChange event:', event,
        '| user:', session?.user?.email ?? 'null',
        '| hash:', hashPreview)

      if (event === 'INITIAL_SESSION') {
        // This is the definitive first-session answer — fires after hash processing.
        initialSessionHandled = true
        // setTimeout(0) defers the async DB work (fetchRole) outside the
        // Supabase auth-change lock; calling supabase.from() inside the callback
        // directly causes the query to silently fail (lock held by the SDK).
        setTimeout(() => { if (mounted) processUser(session?.user ?? null) }, 0)

      } else if (event === 'SIGNED_IN') {
        console.log('[useAuth] SIGNED_IN — processing user')
        setTimeout(() => { if (mounted) processUser(session?.user ?? null) }, 0)

      } else if (event === 'SIGNED_OUT') {
        console.log('[useAuth] SIGNED_OUT')
        if (mounted) { setUser(null); setRole(null); setIsLoading(false) }

      } else if (event === 'TOKEN_REFRESHED') {
        console.log('[useAuth] TOKEN_REFRESHED — session still valid')

      } else if (event === 'PASSWORD_RECOVERY') {
        console.log('[useAuth] PASSWORD_RECOVERY event')

      } else {
        console.log('[useAuth] unhandled event:', event)
      }
    })

    // ── Diagnostic + safety-net ────────────────────────────────────────────────
    // getSession() reads the in-memory / localStorage session. It is NOT
    // authoritative for the magic-link case because detectSessionInUrl processes
    // the hash asynchronously — getSession() can return null before the exchange
    // completes. We call it here for logging and as a fallback if INITIAL_SESSION
    // somehow never fires (should not happen in v2.x).
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) console.error('[useAuth] getSession error:', error.message)
      console.log('[useAuth] getSession →', session?.user?.email ?? 'no session',
        '| initialSessionHandled:', initialSessionHandled)

      if (mounted && !initialSessionHandled) {
        console.warn('[useAuth] INITIAL_SESSION never fired — using getSession as fallback')
        processUser(session?.user ?? null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = () => supabase.auth.signOut().then(() => undefined)

  return { user, role, isLoading, unauthorizedError, signOut }
}
