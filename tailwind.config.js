/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/**/*.html', './public/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' }
      }
    }
  },
  plugins: []
};
