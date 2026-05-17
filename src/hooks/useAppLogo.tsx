import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'

const DEFAULT_LOGO = '/favicon.png'

interface AppLogoCtx {
  logoUrl: string
  refresh: () => void
}

const AppLogoContext = createContext<AppLogoCtx>({ logoUrl: DEFAULT_LOGO, refresh: () => {} })

export function AppLogoProvider({ children }: { children: ReactNode }) {
  const [logoUrl, setLogoUrl] = useState(DEFAULT_LOGO)

  const load = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'app_logo_url')
        .single()
      setLogoUrl(data?.value || DEFAULT_LOGO)
    } catch {
      setLogoUrl(DEFAULT_LOGO)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <AppLogoContext.Provider value={{ logoUrl, refresh: load }}>
      {children}
    </AppLogoContext.Provider>
  )
}

export function useAppLogo() {
  return useContext(AppLogoContext)
}
