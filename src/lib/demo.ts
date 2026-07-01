// ─── DEMO MODE flag ──────────────────────────────────────────────────────────
// Self-contained demo mode for recording a marketing walkthrough. When ON the
// whole app runs on 100% fictitious data from demo-seed.json and NEVER touches
// the real Supabase project — auth is bypassed and every DB read/write is stubbed.
//
// Activation (development only):
//   • VITE_DEMO_MODE=true   — build/env flag
//   • ?demo=1               — URL query param
//
// SAFETY: demo mode is hard-disabled in any production build. `import.meta.env.PROD`
// is true for `vite build` (the Vercel deploy), so neither the env flag nor the URL
// param can ever switch it on in prod. It only works against the local dev server.

const allowedInThisBuild = !import.meta.env.PROD

const envFlag = import.meta.env.VITE_DEMO_MODE === 'true'

const urlFlag =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === '1'

export const DEMO_MODE = allowedInThisBuild && (envFlag || urlFlag)
