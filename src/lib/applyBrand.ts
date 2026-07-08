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
}
