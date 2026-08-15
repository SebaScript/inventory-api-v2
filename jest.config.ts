import { type Config } from 'jest';

/**
 * Coverage quality gate.
 *
 * The threshold is supplied by the pipeline rather than hard-coded, because the
 * two environments demand different bars: 60% for Test, 85% for Production.
 * Jest exits non-zero when the bar is missed, which is what actually blocks the
 * deployment — there is no `|| true` anywhere in the pipelines.
 */
const COVERAGE_MIN = Number(process.env.COVERAGE_MIN ?? 85);

const tsPreset = {
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};

const config: Config = {
  rootDir: '.',

  // Boots (and tears down) a real PostgreSQL once for the entire run.
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',

  projects: [
    {
      displayName: 'unit',
      ...tsPreset,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      displayName: 'integration',
      ...tsPreset,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      // Integration tests share one database and assert on row locks, so they
      // must not race each other.
      maxWorkers: 1,
    },
    {
      displayName: 'e2e',
      ...tsPreset,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      maxWorkers: 1,
    },
  ],

  collectCoverageFrom: [
    'src/**/*.ts',
    // Bootstrap wiring: exercised by starting the process, not by a unit test.
    '!src/main.ts',
    // Nest modules are declarative wiring with no branches to cover; they are
    // validated implicitly because the E2E suite fails to boot if they are wrong.
    '!src/**/*.module.ts',
    // Migrations are verified by every integration test: none of them could run
    // without the schema these produce.
    '!src/database/migrations/**',
    '!src/**/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'html'],
  coverageThreshold: {
    global: {
      lines: COVERAGE_MIN,
      statements: COVERAGE_MIN,
      functions: COVERAGE_MIN,
      branches: COVERAGE_MIN,
    },
  },

  testTimeout: 30_000,
  clearMocks: true,
  verbose: false,
};

export default config;
