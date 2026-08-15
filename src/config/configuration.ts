import { type NodeEnv } from './env.validation';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  isProduction: boolean;
  swaggerEnabled: boolean;
  corsOrigin: string | string[];
  logLevel: string;
}

export interface DatabaseConfig {
  url: string;
  ssl: boolean;
  logging: boolean;
  poolSize: number;
  runMigrationsOnStart: boolean;
  seedOnStart: boolean;
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
}

/**
 * Joi coerces `"true"`/`"false"` strings, but `configuration()` is also called
 * from the standalone TypeORM CLI where Joi has not run. Parsing defensively
 * keeps both entry points consistent.
 */
const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
};

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== '' ? parsed : fallback;
};

const toCorsOrigin = (value: string | undefined): string | string[] => {
  if (!value || value === '*') return '*';
  return value.split(',').map((origin) => origin.trim());
};

/**
 * Builds the typed configuration tree consumed through `ConfigService`.
 *
 * Every environment-dependent value lives here; nothing else in the codebase
 * reads `process.env` directly, which keeps configuration testable and makes
 * the full set of knobs discoverable in one place.
 */
export const configuration = (): Configuration => {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as NodeEnv;

  return {
    app: {
      nodeEnv,
      port: toNumber(process.env.PORT, 3000),
      isProduction: nodeEnv === 'production',
      swaggerEnabled: toBoolean(process.env.SWAGGER_ENABLED, true),
      corsOrigin: toCorsOrigin(process.env.CORS_ORIGIN),
      logLevel: process.env.LOG_LEVEL ?? 'log',
    },
    database: {
      url: process.env.DATABASE_URL ?? '',
      ssl: toBoolean(process.env.DB_SSL, false),
      logging: toBoolean(process.env.DB_LOGGING, false),
      poolSize: toNumber(process.env.DB_POOL_SIZE, 10),
      runMigrationsOnStart: toBoolean(process.env.RUN_MIGRATIONS_ON_START, false),
      seedOnStart: toBoolean(process.env.SEED_ON_START, false),
    },
  };
};
