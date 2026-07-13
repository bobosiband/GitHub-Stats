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
        // GitHub dark palette anchors — matches CSS custom properties in
        // styles.css so we can mix the existing GitHub-Primer components with
        // Tailwind utilities without a colour clash.
        ghbg: '#0d1117',
        ghsurface: '#161b22',
        ghinset: '#010409',
        ghborder: '#30363d',
        ghfg: '#e6edf3',
        ghmuted: '#8b949e',
        // The GitHub contribution-graph greens — used for the heatmap and
        // as the primary "positive" accent throughout the Duolingo layer.
        contrib: {
          0: '#161b22',
          1: '#0e4429',
          2: '#006d32',
          3: '#26a641',
          4: '#39d353',
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
