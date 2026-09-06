// ─────────────────────────────────────────────────────────────────────────────
// BRAND CONFIG — the ONE file to edit to reskin the whole app for a new client.
//
// Change appName, tabTitle, logoPath and the palette below and the WHOLE system
// reskins: header, sidebar, login, buttons, active states, inline-styled surfaces,
// the Tailwind `bg-primary` / `text-primary` utilities, the `.hds-*` component
// classes, and the PDF header all read from these values (applied to CSS variables
// at startup by src/lib/applyBrand.ts).
//
// This is the SWAPPABLE (brand) layer. The FIXED (functional) layer — status &
// alert colors: blue / yellow / green / orange / red — lives in src/theme/status.ts
// and must NOT be put here; those semantics never change per client.
// ─────────────────────────────────────────────────────────────────────────────

export interface BrandColors {
  primary:       string  // main buttons, active nav, headers
  primaryDark:   string  // hover / pressed
  secondary:     string  // secondary accents, highlights, tags (Hadas: coral)
  secondaryTint: string  // soft fills / hover backgrounds
  secondaryBg:   string  // light section backgrounds
  accent:        string  // small highlights / attention (Hadas: mustard)
  activeBg:      string  // selected-row / active pill background
  background:    string  // app canvas
  surface:       string  // cards / panels
  text:          string  // primary text
  textMuted:     string  // secondary text
  border:        string  // hairlines / card borders
}

export interface Brand {
  appName:      string   // system name — sidebar, login, tab, page headers
  greetingName: string   // who the dashboard says hello TO ("בוקר טוב ___")
  tabTitle:     string   // browser tab title
  logoPath:     string   // default logo (public/ path or URL); DB app_logo_url overrides
  faviconPath:  string   // browser tab icon; applied at startup over index.html's <link>
  colors:       BrandColors
}

// ── DEFAULT CLIENT: Hadas ────────────────────────────────────────────────────
const defaults: Brand = {
  appName:  'הדס',
  // The system is named after its owner here, so both are "הדס" — but they are
  // NOT the same thing. `appName` is the product; `greetingName` is the person
  // sitting in front of it. A demo of this system for someone else keeps its own
  // product name and greets a different person (see the standalone demo build).
  greetingName: 'הדס',
  tabTitle: 'מערכת הדס',
  logoPath: '/logo.png',
  // Same file index.html links, so the default build's tab icon never changes.
  faviconPath: '/favicon.png',
  colors: {
    primary:       '#A91D3A', // burgundy
    primaryDark:   '#8C1733',
    secondary:     '#F5847C', // coral
    secondaryTint: '#F9BAB5',
    secondaryBg:   '#FDEEEC',
    accent:        '#F3B335', // mustard
    activeBg:      '#FDF2F4',
    background:    '#F8F8FA',
    surface:       '#FFFFFF',
    text:          '#1F2125',
    textMuted:     '#6B6E73',
    border:        '#ECECEF',
  },
}

// ── Per-BUILD overrides ──────────────────────────────────────────────────────
// The palette and the defaults above stay the single source of truth. These five
// strings are the only ones a build may override, so one repo can produce both
// the client's system and a differently-named demo of it without a second copy
// of this file drifting away from the first.
//
// Only the text identity is overridable on purpose — colors are not. A build that
// wants a different palette is a different client, and that is what editing the
// block above is for.
//
// Set in `.env.demo` for the standalone demo (docs/08-DEMO-DEPLOYMENT.md); unset
// everywhere else, which is why the Vercel build is byte-for-byte unaffected.
const env = import.meta.env

export const brand: Brand = {
  ...defaults,
  appName:      env.VITE_BRAND_NAME     || defaults.appName,
  greetingName: env.VITE_BRAND_GREETING || defaults.greetingName,
  tabTitle:     env.VITE_BRAND_TAB_TITLE || defaults.tabTitle,
  logoPath:     env.VITE_BRAND_LOGO     || defaults.logoPath,
  faviconPath:  env.VITE_BRAND_FAVICON  || defaults.faviconPath,
}

export default brand
