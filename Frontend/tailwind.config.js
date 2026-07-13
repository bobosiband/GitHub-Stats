/**
 * Tailwind — GitHub's dark developer palette layered with Duolingo's playful,
 * bouncy accent. Kept intentionally narrow: extends colors, keyframes, and
 * transition timing so components can compose without a wall of arbitrary
 * values.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The gh* tokens read from CSS custom properties (see styles.css) so
        // the light/dark theme toggle in the header propagates into every
        // Tailwind-classed component too — earlier these were hardcoded to
        // dark-mode hex values and light mode only styled the app shell.
        ghbg: 'var(--duo-bg)',
        ghsurface: 'var(--duo-surface)',
        ghinset: 'var(--duo-inset)',
        ghborder: 'var(--duo-border)',
        ghfg: 'var(--duo-fg)',
        ghmuted: 'var(--duo-muted)',
        // The GitHub contribution-graph greens — used for the heatmap and
        // as the primary "positive" accent throughout the Duolingo layer.
        contrib: {
          0: 'var(--duo-contrib-0)',
          1: 'var(--duo-contrib-1)',
          2: 'var(--duo-contrib-2)',
          3: 'var(--duo-contrib-3)',
          4: 'var(--duo-contrib-4)',
        },
        // Duolingo-flavoured accents.
        duo: {
          green: '#58cc02',
          greenDeep: '#43a302',
          orange: '#ff9600',
          red: '#ff4b4b',
          gold: '#ffc800',
          blue: '#1cb0f6',
          purple: '#ce82ff',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"Noto Sans"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        // Chunky Duolingo "pressable" edge.
        chunky: '0 3px 0 rgba(0, 0, 0, 0.35)',
        chunkyGreen: '0 3px 0 #2f7a02',
        chunkyOrange: '0 3px 0 #b96b00',
      },
      keyframes: {
        // Duolingo squish for the XP badge on hover.
        pop: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.08)' },
        },
        // Flame flicker.
        flicker: {
          '0%, 100%': { transform: 'rotate(-1deg) scale(1)' },
          '50%': { transform: 'rotate(1.5deg) scale(1.06)' },
        },
        // Heatmap first-render wave — subtle diagonal reveal.
        wave: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        pop: 'pop 320ms ease-out',
        flicker: 'flicker 1.6s ease-in-out infinite',
        wave: 'wave 380ms ease-out both',
      },
    },
  },
  plugins: [],
};
