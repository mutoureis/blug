import type {Config} from 'tailwindcss'

export default {
  content: ['./src/app/**/*.{js,jsx,ts,tsx}'],
  theme: {
    container: {
      padding: '1.5rem',
      screens: {
        sm: '100%',
        md: '100%',
        lg: '850px',
      },
    },
    borderWidth: {
      DEFAULT: '1px', // tanpa ini `border`, `border-t`, `border-b`, dst. tidak menghasilkan CSS
      0: '0',
      1: '1px',
      2: '2px',
      3: '3px',
      4: '4px',
    },
    colors: {
      0: '#09090b',
      50: '#18181b',
      100: '#1f1f23',
      200: '#27272a',
      300: '#3f3f46',
      400: '#52525b',
      500: '#71717a',
      600: '#60a5fa',
      700: '#3b82f6',
      800: '#2563eb',
      900: '#d4d4d8',
      950: '#fafafa',
      gray: '#ffffff',
      // theme.colors menimpa palet bawaan: tanpa 4 baris ini `bg-black/60`, `text-white/90`,
      // `hover:bg-white/5`, `shadow-black/50` (dipakai di kode) tidak menghasilkan CSS.
      white: '#ffffff',
      black: '#000000',
      transparent: 'transparent',
      current: 'currentColor',
    },
    extend: {
      // Consistent type scale (1.25 ratio) so new UI doesn't reach for random
      // arbitrary px values. Existing arbitrary sizes (e.g. text-[42px]) still
      // work untouched — this just gives new markup a disciplined default set.
      fontSize: {
        xs: ['0.64rem', {lineHeight: '1.5'}], // 10.2px — eyebrow/labels
        sm: ['0.8rem', {lineHeight: '1.5'}], // 12.8px — meta/caption
        base: ['1rem', {lineHeight: '1.7'}], // 16px — body
        md: ['1.25rem', {lineHeight: '1.5'}], // 20px — small subhead
        lg: ['1.563rem', {lineHeight: '1.3'}], // 25px — subhead
        xl: ['1.953rem', {lineHeight: '1.2'}], // 31px — small heading
        '2xl': ['2.441rem', {lineHeight: '1.1'}], // 39px — heading
        '3xl': ['3.052rem', {lineHeight: '1.05'}], // 49px — hero
      },
      fontFamily: {
        display: [
          'Literata',  // ✅ Ganti Recursive -> Literata untuk judul
          'Georgia',
          'ui-serif',
          'serif',
        ],
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'sans-serif',
        ],
        serif: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'Recursive',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
      maxWidth: {
        prose: '68ch',
      },
    },
  },
  plugins: [],
} satisfies Config
