import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEMO_MODE } from './demo'
import { createDemoClient } from './demoClient'

function createRealClient(): SupabaseClient {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
}

// In demo mode the client is fully stubbed (no network, fictitious data only).
// Real auth + data flow are completely unaffected when demo mode is OFF.
export const supabase: SupabaseClient = DEMO_MODE
  ? (createDemoClient() as unknown as SupabaseClient)
  : createRealClient()

if (DEMO_MODE) {
  console.warn('[DEMO MODE] Supabase is stubbed — fictitious data, zero network calls.')
}
