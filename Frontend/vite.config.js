import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` gives us a build that works under any GitHub Pages path
// (project-page, user-page, custom domain) without a per-repo rewrite step.
// Combined with the HashRouter in App.jsx, refreshes on deep links Just Work.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
