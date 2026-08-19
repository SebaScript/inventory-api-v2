import type { Config } from 'jest';

const COVERAGE_MIN = Number(process.env.COVERAGE_MIN ?? 85);

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  maxWorkers: 1,
  testTimeout: 30_000,

  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
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
