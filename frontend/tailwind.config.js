// Colours are CSS variables (see src/index.css) so one set of class names serves
// both the light theme and the black dark theme.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: token('page'),
        card: token('card'),
        soft: token('soft'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        brand: token('brand'),
        accent: {
          DEFAULT: token('accent'),
          strong: token('accent-strong'),
          hover: token('accent-hover')
        }
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Noto Sans Bengali"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        bengali: ['"Noto Sans Bengali"', 'ui-sans-serif', 'sans-serif']
      },
      boxShadow: {
        card: '0 8px 30px rgb(var(--shadow) / 0.07)',
        glow: '0 10px 28px rgb(var(--accent) / 0.30)',
        'glow-sm': '0 6px 16px rgb(var(--accent) / 0.20)'
      },
      keyframes: {
        bloom: {
          '0%': { transform: 'scale(0.85)', opacity: '0.6' },
          '50%': { transform: 'scale(1.05)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        twinkle: {
          '0%, 100%': { opacity: '0.2' },
          '50%': { opacity: '1' }
        }
      },
      animation: {
        bloom: 'bloom 2.4s ease-in-out infinite',
        twinkle: 'twinkle 3s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
