import type { Config } from 'tailwindcss';

/**
 * Tokens visuales. La composición sigue el lenguaje de Viator (fondo blanco, grises neutros,
 * tarjetas compactas); el color de marca usa la paleta rosada del plan, ajustada para contraste AA.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#FFF9F7',
          100: '#FBE8E8',
          300: '#F4B183',
          400: '#E85A8A',
          500: '#C94D6B',
          600: '#B03F5C',
          700: '#8E3049',
        },
        ink: {
          DEFAULT: '#332326',
          soft: '#6B4D50',
          muted: '#6E6467',
        },
        line: '#E7E1E2',
        surface: '#F6F4F4',
        honey: '#D7A65C',
        success: '#3A7F64',
        danger: '#B93D4A',
        night: '#2A1B1D',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '20px',
        xl: '32px',
      },
      boxShadow: {
        card: '0 2px 12px rgba(51, 35, 38, 0.08)',
        raised: '0 8px 28px rgba(51, 35, 38, 0.14)',
      },
      maxWidth: { page: '1280px' },
    },
  },
  plugins: [],
} satisfies Config;
