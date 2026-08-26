import { brand } from '../brand.config'

// Applies the brand config (src/brand.config.ts) to the document at startup:
//   • writes each brand color to its --brand-* CSS variable on :root, so every
//     consumer — Tailwind `bg-primary`/`text-primary` utilities (aliased to the
//     vars), the .hds-* component classes, and inline `var(--brand-*)` styles —
//     reskins from the one config file.
//   • sets the browser tab title and the theme-color meta.
// Called once from main.tsx BEFORE render. The :root defaults in index.css are
// only a pre-JS fallback; the values set here win.
export function applyBrand(): void {
  const root = document.documentElement
  const c = brand.colors
  const vars: Record<string, string> = {
    '--brand-primary':      c.primary,
    '--brand-primary-dark': c.primaryDark,
    '--brand-coral':        c.secondary,
    '--brand-coral-tint':   c.secondaryTint,
    '--brand-coral-bg':     c.secondaryBg,
    '--brand-mustard':      c.accent,
    '--brand-active-bg':    c.activeBg,
    '--brand-bg':           c.background,
    '--brand-surface':      c.surface,
    '--brand-text':         c.text,
    '--brand-text-muted':   c.textMuted,
    '--brand-border':       c.border,
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)

  document.title = brand.tabTitle
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.primary)

  // index.html carries one hard-coded <link rel="icon"> and is shared by every
  // build, so a build that renames itself would still fly the default client's
  // tab icon. Point it at the brand's own file instead; the type has to move with
  // it, since the markup declares image/png and the override may be an SVG.
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    link.href = brand.faviconPath
    if (brand.faviconPath.endsWith('.svg')) link.type = 'image/svg+xml'
  }
}
