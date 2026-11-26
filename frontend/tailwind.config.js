/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        night: {
          DEFAULT: '#0B1026',
          50: '#1B2145',
          100: '#171C3D',
          200: '#141935',
          300: '#11152D',
          400: '#0E1226',
          500: '#0B1026',
          600: '#080B1C',
          700: '#060812',
          800: '#04050C',
          900: '#020306'
        },
        petal: {
          DEFAULT: '#F8FAFC',
          dim: '#CBD5E1'
        },
        sheuli: {
          DEFAULT: '#F97316',
          light: '#FDBA74',
          dark: '#C2410C',
          glow: 'rgba(249, 115, 22, 0.35)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        bengali: ['"Noto Sans Bengali"', 'ui-sans-serif', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 40px rgba(249, 115, 22, 0.25)',
        'glow-sm': '0 0 20px rgba(249, 115, 22, 0.18)'
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
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' }
        }
      },
      animation: {
        bloom: 'bloom 2.4s ease-in-out infinite',
        twinkle: 'twinkle 3s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
