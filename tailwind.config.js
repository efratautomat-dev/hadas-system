/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary:        '#D32F4A',
        'primary-dark': '#A8213B',
        'primary-soft': '#F4A5B0',
        accent:         '#F2C94C',
        background:     '#F8F8FA',
        surface:        '#FFFFFF',
        border:         '#EEEEF2',
        'border-input': '#DEDFE5',
        'active-bg':    '#FDF2F4',
        'text-primary': '#1A1A2E',
        'text-muted':   '#6B7280',
      },
      fontFamily: {
        rubik: ['Rubik', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
