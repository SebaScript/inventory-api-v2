import { startEmbeddedPostgres } from './embedded-postgres';

/**
 * Runs once before the whole Jest run.
 *
 * Two supported modes:
 *  - `DATABASE_URL` already set (CI service container, Docker): use it as-is.
 *  - Nothing set (a developer machine): boot an ephemeral PostgreSQL.
 *
 * Either way the schema is created by running the real migrations, not by
 * letting an ORM synchronise entities — so the tests exercise the exact schema
 * that production will run on.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.SKIP_DB === 'true') return;

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = await startEmbeddedPostgres();
    process.env.EMBEDDED_PG_STARTED = 'true';
  }

  // Imported lazily: the DataSource reads DATABASE_URL at module load time.
  const { AppDataSource } = await import('../../src/database/data-source');

  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
}
