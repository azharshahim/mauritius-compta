import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The web test suite runs the browser-only demo backend and the React screens
// in jsdom: it proves the GitHub Pages build works without any server.
process.env.VITE_DEMO_MODE = 'true';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_DEMO_MODE': JSON.stringify('true'),
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
    testTimeout: 20_000,
    setupFiles: ['./tests/setup.ts'],
    reporters: ['default'],
  },
});
