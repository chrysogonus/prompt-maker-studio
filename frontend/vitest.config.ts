import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/test/**',
        'src/types/**', // interfaces only; no runtime code to execute
        'src/**/*.d.ts',
      ],
      // The backend has enforced 90% since it existed; the frontend enforced
      // nothing, so component coverage could regress silently while
      // CONTRIBUTING.md implied both stacks were held to a bar. These floors
      // are the measured level when they were introduced, rounded down — a
      // ratchet to stop backsliding, not a target, and deliberately not the
      // backend's 90%, which this suite does not currently reach. Raise them
      // as coverage improves; do not lower them to make a red run green.
      //
      // The gap is concentrated rather than spread out: src/lib/api.ts (a thin
      // fetch wrapper, ~8%) and the page shells under src/app/ that tests
      // reach only through their components. Those are where raising the floor
      // starts.
      thresholds: {
        statements: 74,
        branches: 67,
        functions: 79,
        lines: 75,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
