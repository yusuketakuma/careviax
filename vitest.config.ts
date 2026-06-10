import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tools/infra/websocket/**/*.test.ts',
      'tools/scripts/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/app/api/**/*.ts', 'src/server/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**'],
      thresholds: {
        statements: 80,
        // Current enforced baseline is 66.4%; raise this as core API branch coverage improves.
        branches: 66,
        lines: 80,
        functions: 75,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
