/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        background: '#0f172a',
        foreground: '#f8fafc',
        card: '#1e293b',
        border: '#334155',
        primary: '#3b82f6',
        muted: '#64748b',
        destructive: '#ef4444',
        accent: '#1d4ed8'
      }
    }
  },
  plugins: []
}
