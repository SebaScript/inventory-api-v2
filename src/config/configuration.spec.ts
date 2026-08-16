import { configuration } from './configuration';

/**
 * `configuration()` is the only place in the codebase that reads `process.env`,
 * and it is called from two very different contexts: inside Nest, where Joi has
 * already validated and coerced everything, and from the standalone TypeORM CLI,
 * where it has not. These tests pin down the raw-string behaviour that the CLI
 * path depends on.
 */
describe('configuration', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  const withEnv = (env: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return configuration();
  };

  describe('defaults', () => {
    it('falls back to development when NODE_ENV is unset', () => {
      const config = withEnv({ NODE_ENV: undefined });

      expect(config.app.nodeEnv).toBe('development');
      expect(config.app.isProduction).toBe(false);
    });

    it('marks production explicitly', () => {
      expect(withEnv({ NODE_ENV: 'production' }).app.isProduction).toBe(true);
    });

    it('defaults the port to 3000', () => {
      expect(withEnv({ PORT: undefined }).app.port).toBe(3000);
    });

    it('falls back to the default port for a non-numeric value', () => {
      expect(withEnv({ PORT: 'not-a-port' }).app.port).toBe(3000);
    });

    it('treats an empty DATABASE_URL as absent rather than crashing', () => {
      expect(withEnv({ DATABASE_URL: undefined }).database.url).toBe('');
    });
  });

  describe('boolean parsing', () => {
    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
      ['anything-else', false],
    ])('parses %s as %s', (raw, expected) => {
      expect(withEnv({ DB_SSL: raw }).database.ssl).toBe(expected);
    });

    it('uses the declared default when the variable is empty', () => {
      // SWAGGER_ENABLED defaults to true, DB_SSL to false.
      const config = withEnv({ SWAGGER_ENABLED: '', DB_SSL: '' });
      expect(config.app.swaggerEnabled).toBe(true);
      expect(config.database.ssl).toBe(false);
    });
  });

  describe('CORS origins', () => {
    it('keeps the wildcard as a wildcard', () => {
      expect(withEnv({ CORS_ORIGIN: '*' }).app.corsOrigin).toBe('*');
    });

    it('falls back to the wildcard when unset', () => {
      expect(withEnv({ CORS_ORIGIN: undefined }).app.corsOrigin).toBe('*');
    });

    it('splits a comma-separated list and trims each entry', () => {
      const config = withEnv({ CORS_ORIGIN: 'https://a.example, https://b.example ' });

      expect(config.app.corsOrigin).toEqual(['https://a.example', 'https://b.example']);
    });

    it('handles a single explicit origin', () => {
      expect(withEnv({ CORS_ORIGIN: 'https://app.example' }).app.corsOrigin).toEqual([
        'https://app.example',
      ]);
    });
  });

  describe('database options', () => {
    it('reads the pool size and falls back to 10', () => {
      expect(withEnv({ DB_POOL_SIZE: '25' }).database.poolSize).toBe(25);
      expect(withEnv({ DB_POOL_SIZE: undefined }).database.poolSize).toBe(10);
    });

    it('never enables seeding by default', () => {
      expect(withEnv({ SEED_ON_START: undefined }).database.seedOnStart).toBe(false);
    });

    it('never runs migrations on boot by default', () => {
      expect(withEnv({ RUN_MIGRATIONS_ON_START: undefined }).database.runMigrationsOnStart).toBe(
        false,
      );
    });
  });
});
