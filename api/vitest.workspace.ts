import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['test/unit/**/*.test.ts'],
      setupFiles: ['test/helpers/setup-env.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['test/integration/**/*.test.ts'],
      setupFiles: ['test/helpers/setup-env.ts'],
      globalSetup: ['test/helpers/global-setup.ts'],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  },
]);
