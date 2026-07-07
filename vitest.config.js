import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/helpers/setupEnv.js'],
    globalSetup: ['tests/helpers/globalSetup.js'],
    // Integration/API tests share one Postgres test database; run files serially
    // so a reset in one file can't race another.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/routes/**', 'src/lib/**', 'src/jobs/**'],
      exclude: ['src/server.js', '**/queries.js'],
      reporter: ['text', 'html'],
    },
  },
});
