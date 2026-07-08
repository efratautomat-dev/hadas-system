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
  appName:  string   // system name shown in UI (sidebar, login, greeting)
  tabTitle: string   // browser tab title
  logoPath: string   // default logo (public/ path or URL); DB app_logo_url overrides
  colors:   BrandColors
}

// ── DEFAULT CLIENT: Hadas ────────────────────────────────────────────────────
export const brand: Brand = {
  appName:  'הדס',
  tabTitle: 'מערכת הדס',
  logoPath: '/logo.png',
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

export default brand
