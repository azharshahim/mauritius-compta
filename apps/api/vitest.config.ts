import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test file gets its own PGlite instance (embedded PostgreSQL).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['default'],
  },
});
