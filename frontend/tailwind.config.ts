import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        jungle: {
          950: '#030806',
          900: '#07140f',
          800: '#0d2118',
          700: '#103124',
        },
        heat: {
          drifter: '#3B82F6',
          observer: '#22C55E',
          resident: '#EAB308',
          builder: '#F97316',
          elder: '#EF4444',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', '"Inter"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34, 197, 94, 0.25), 0 12px 30px rgba(0, 0, 0, 0.35)',
      },
      backgroundImage: {
        canopy:
          'radial-gradient(circle at 15% 20%, rgba(34, 197, 94, 0.12), transparent 40%), radial-gradient(circle at 85% 10%, rgba(249, 115, 22, 0.1), transparent 35%), linear-gradient(145deg, #030806 0%, #07140f 50%, #0d2118 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
