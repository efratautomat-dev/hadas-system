// ─── DEMO MODE flag ──────────────────────────────────────────────────────────
// Self-contained demo mode. When ON the whole app runs on 100% fictitious data
// from demo-seed.json and NEVER touches the real Supabase project — auth is
// bypassed and every DB read/write is stubbed.
//
// There are TWO ways it turns on, and they are deliberately different:
//
//   1. LOCAL (dev server only) — `VITE_DEMO_MODE=true` or `?demo=1`.
//      Used for recording the marketing walkthrough and for the Playwright E2E.
//      Goes straight into the app, no password.
//
//   2. STANDALONE (the public demo build) — `VITE_DEMO_STANDALONE=true`, set at
//      BUILD time by `.env.demo` via `npm run build:demo`. This is the build that
//      is served at https://incontrol.ctrlplusf.com. It is a production build, so
//      it needs its own key to get past the PROD guard below — and it additionally
//      turns on the password gate and the role switcher (src/lib/demoGate.ts).
//
// SAFETY: `import.meta.env.PROD` is true for every `vite build`, so the Vercel
// production deploy can never be switched into demo mode by the env flag or the
// URL param. The ONLY thing that opens a production build is VITE_DEMO_STANDALONE,
// a variable that exists solely in `.env.demo` and that Vercel never sets. Adding
// it to the Vercel project would point the real system at fictitious data — don't.
// See docs/08-DEMO-DEPLOYMENT.md.

const standaloneDemoBuild = import.meta.env.VITE_DEMO_STANDALONE === 'true'

const allowedInThisBuild = !import.meta.env.PROD || standaloneDemoBuild

const envFlag = import.meta.env.VITE_DEMO_MODE === 'true'

const urlFlag =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === '1'

export const DEMO_MODE = allowedInThisBuild && (standaloneDemoBuild || envFlag || urlFlag)

// True ONLY in the public standalone demo build. Gates the password screen and the
// role switcher, so neither ever shows up on the dev server or in the E2E run.
export const DEMO_STANDALONE = DEMO_MODE && standaloneDemoBuild
