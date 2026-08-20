import type { Config } from 'jest';

/**
 * The coverage bar comes from the environment, so the same command enforces 60%
 * in the Test pipeline and 85% in the Production one. Jest exits non-zero when
 * it is missed — that non-zero exit *is* the quality gate.
 */
const COVERAGE_MIN = Number(process.env.COVERAGE_MIN ?? 85);

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  // Tests share one database, so they must not race each other.
  maxWorkers: 1,
  testTimeout: 30_000,

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts', // process entry point: wires up and calls listen()
    '!src/**/*.module.ts', // declarative wiring; a mistake fails every test
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'json-summary', 'html'],
  coverageThreshold: {
    global: {
      lines: COVERAGE_MIN,
      statements: COVERAGE_MIN,
      functions: COVERAGE_MIN,
      branches: COVERAGE_MIN,
    },
  },
};

export default config;
