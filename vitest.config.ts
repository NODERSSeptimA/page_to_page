import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'test-fixtures/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
