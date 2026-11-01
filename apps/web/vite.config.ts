import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const demoMode = process.env.VITE_DEMO_MODE === 'true';

function commit(): string {
  if (process.env.VITE_BUILD_COMMIT) return process.env.VITE_BUILD_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

const version = process.env.npm_package_version ?? '0.1.1';
const buildCommit = commit();
const buildDate = process.env.VITE_BUILD_DATE ?? new Date().toISOString();

export default defineConfig({
  // GitHub Pages serves the project under /<repository>/ ; the API build keeps '/'.
  base: demoMode ? '/mauritius-compta/' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_DATE__: JSON.stringify(buildDate),
    // Fictional demo credentials are injected only into the opt-in demo build.
    // The real bundle receives empty strings, so no credential is embedded.
    __DEMO_EMAIL__: JSON.stringify(demoMode ? 'demo@mauritius-compta.test' : ''),
    __DEMO_PASSWORD__: JSON.stringify(demoMode ? 'DemoPassw0rd2026' : ''),
  },
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
