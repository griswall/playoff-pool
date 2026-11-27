module.exports = {
  content: ['./*.html', './scripts/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#00d084', dark: '#00a366' },
        surface: {
          100: '#1e293b',
          200: '#334155',
          300: '#475569',
          600: '#475569',
          700: '#334155',
          800: '#0f172a',
          900: '#020617',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'monospace'],
      },
    },
  },
};
