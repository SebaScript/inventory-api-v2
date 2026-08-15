import * as Joi from 'joi';

/**
 * Supported runtime environments.
 *
 * `test` is used by the automated test suite, `development` by the local Docker
 * stack, and `production` by the production stack. Behaviour that must never
 * leak to end users (stack traces, verbose SQL logging) keys off this value.
 */
export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Schema every environment variable is validated against on boot.
 *
 * The application fails fast on an invalid or missing variable instead of
 * starting in a half-configured state and failing later on the first request.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENVS)
    .default('development'),

  PORT: Joi.number().port().default(3000),

  /**
   * Full PostgreSQL connection string. This is the single source of truth for
   * database connectivity so that every environment (local, Docker, CI) is
   * configured the exact same way.
   */
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  DB_SSL: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),

  /** Maximum number of connections held in the pool by a single API instance. */
  DB_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),

  /** Runs pending migrations automatically during bootstrap. */
  RUN_MIGRATIONS_ON_START: Joi.boolean().default(false),

  /** Populates demo data on boot. Must stay false in production. */
  SEED_ON_START: Joi.boolean().default(false),

  SWAGGER_ENABLED: Joi.boolean().default(true),

  /** Comma-separated list of allowed origins, or `*`. */
  CORS_ORIGIN: Joi.string().default('*'),

  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
});
