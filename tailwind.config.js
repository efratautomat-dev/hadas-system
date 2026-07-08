/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand palette → CSS vars (set from src/brand.config.ts at runtime).
        //    Editing brand.config.ts reskins every `bg-primary`/`text-primary`/… utility.
        primary:        'var(--brand-primary)',      // primary buttons, active nav, headers
        'primary-dark': 'var(--brand-primary-dark)', // hover / pressed
        'primary-soft': 'var(--brand-coral-tint)',
        coral:          'var(--brand-coral)',        // secondary accents, highlights, tags
        'coral-tint':   'var(--brand-coral-tint)',   // soft fills, hover backgrounds
        'coral-bg':     'var(--brand-coral-bg)',     // light section backgrounds
        mustard:        'var(--brand-mustard)',      // small highlights / attention
        accent:         'var(--brand-mustard)',
        background:     'var(--brand-bg)',
        surface:        'var(--brand-surface)',
        border:         'var(--brand-border)',
        'border-input': '#DEDFE5',                   // functional input hairline (not brand)
        'active-bg':    'var(--brand-active-bg)',
        'text-primary': 'var(--brand-text)',
        'text-muted':   'var(--brand-text-muted)',
      },
      fontFamily: {
        heebo: ['Heebo', 'system-ui', 'sans-serif'],
        sans:  ['Heebo', 'system-ui', 'sans-serif'],
      },
      // ── Approved type scale (spec/04-DESIGN.md · design-preview) ──
      fontSize: {
        page:    ['28px', { lineHeight: '36px', fontWeight: '700' }],
        section: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'card-title': ['16px', { lineHeight: '24px', fontWeight: '600' }],
        body:    ['15px', { lineHeight: '24px', fontWeight: '400' }],
        label:   ['13px', { lineHeight: '18px', fontWeight: '500' }],
        btn:     ['15px', { lineHeight: '20px', fontWeight: '600' }],
      },
      borderRadius: {
        card: '12px',
        btn:  '10px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.06)',
      },
    },
  },
  plugins: [],
}
