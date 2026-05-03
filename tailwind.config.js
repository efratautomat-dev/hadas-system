/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#E8645A',
        'primary-dark': '#8B1A3A',
        'primary-mid': '#D94F5C',
        accent: '#E8A020',
        background: '#FFF8F7',
      },
      fontFamily: {
        heebo: ['Heebo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
