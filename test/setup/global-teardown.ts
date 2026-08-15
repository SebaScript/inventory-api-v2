import { stopEmbeddedPostgres } from './embedded-postgres';

/**
 * Stops the ephemeral PostgreSQL started by `global-setup`, if any.
 *
 * When the database was provided externally (CI, Docker) this is a no-op —
 * tearing down infrastructure the test run does not own would be wrong.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.EMBEDDED_PG_STARTED === 'true') {
    await stopEmbeddedPostgres();
  }
}
