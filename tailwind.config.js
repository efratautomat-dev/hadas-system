/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Hadas brand palette (spec/04-DESIGN.md) ──
        primary:        '#A91D3A',   // burgundy — primary buttons, active nav, headers
        'primary-dark': '#8C1733',   // hover / pressed
        'primary-soft': '#F9BAB5',   // = coral-tint
        coral:          '#F5847C',   // secondary accents, highlights, tags
        'coral-tint':   '#F9BAB5',   // soft fills, hover backgrounds
        'coral-bg':     '#FDEEEC',   // light section backgrounds
        mustard:        '#F3B335',   // small highlights / attention
        accent:         '#F3B335',   // = mustard
        background:     '#F8F8FA',
        surface:        '#FFFFFF',
        border:         '#ECECEF',
        'border-input': '#DEDFE5',
        'active-bg':    '#FDF2F4',
        'text-primary': '#1F2125',
        'text-muted':   '#6B6E73',
      },
      fontFamily: {
        rubik: ['Rubik', 'system-ui', 'sans-serif'],
        sans:  ['Rubik', 'system-ui', 'sans-serif'],
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
