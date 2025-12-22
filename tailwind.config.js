/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: '#FAF8F6',
        taupe: '#8B7E74',
        'taupe-light': '#B5A99A',
        charcoal: '#2C2C2C',
        gray: '#666666',
        'gray-light': '#E5E5E5'
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        sans: ['Manrope', 'sans-serif']
      }
    },
  },
  plugins: [],
}

