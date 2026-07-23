/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:    ['Roboto', 'sans-serif'],
      },
      colors: {
        canvas:      '#F8FAFC',
        surface:     '#FFFFFF',
        elevated:    '#F1F5F9',
        'table-row': '#F8FAFC',
      },
    },
  },
  plugins: [],
}
