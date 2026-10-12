import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.spec.ts', 'test/contract/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
  },
});
