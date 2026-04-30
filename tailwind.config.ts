import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif']
      },
      colors: {
        panel: 'rgba(14, 25, 41, 0.78)',
        panelStrong: 'rgba(13, 24, 39, 0.92)',
        stroke: 'rgba(111, 139, 174, 0.22)',
        ink: '#eef6ff',
        muted: '#8ea0b9',
        cpu: '#2f81ff',
        gpu: '#64e45e',
        ram: '#8b5cf6',
        disk: '#74d14c',
        net: '#31d0ff',
        thermal: '#ff8a3d',
        warn: '#ffcc45'
      },
      boxShadow: {
        glass: '0 18px 60px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        glowBlue: '0 0 34px rgba(47, 129, 255, 0.18)',
        glowGreen: '0 0 34px rgba(100, 228, 94, 0.16)'
      },
      backgroundImage: {
        app: 'radial-gradient(circle at 10% 0%, rgba(47,129,255,0.16), transparent 34%), radial-gradient(circle at 92% 8%, rgba(139,92,246,0.12), transparent 30%), linear-gradient(180deg, #050b16 0%, #08111d 42%, #070d16 100%)'
      }
    }
  },
  plugins: []
} satisfies Config;
