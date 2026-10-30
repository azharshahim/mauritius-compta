import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const demoMode = process.env.VITE_DEMO_MODE === 'true';

export default defineConfig({
  // GitHub Pages serves the project under /<repository>/ ; the API build keeps '/'.
  base: demoMode ? '/mauritius-compta/' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The app is served behind a preview proxy: accept any Host header.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { outDir: 'dist', sourcemap: false },
});
