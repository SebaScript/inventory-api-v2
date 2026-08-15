import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), '.pgdata', 'jest');
const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 54432);
const USER = 'inventory_test';
const PASSWORD = 'inventory_test';
const DATABASE = 'inventory_test';

let instance: EmbeddedPostgres | undefined;

/**
 * Boots a real, throwaway PostgreSQL server for the test suite.
 *
 * Integration and E2E tests must run against genuine PostgreSQL — transactions,
 * row locks, CHECK constraints and functional indexes are precisely what they
 * assert, and none of that can be faked by an in-memory stand-in.
 *
 * `embedded-postgres` downloads real PostgreSQL binaries at install time, so
 * `npm test` works on any machine without Docker or a system-wide PostgreSQL.
 * In CI and inside Docker a server already exists, and `DATABASE_URL` is set;
 * this module then does nothing at all.
 */
export const startEmbeddedPostgres = async (): Promise<string> => {
  // A leftover data directory from a hard-killed previous run would make
  // `initialise()` fail, so always start from a clean slate.
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  instance = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
    onLog: () => {
      /* PostgreSQL's own startup chatter would drown out the test output. */
    },
    onError: () => {
      /* Connection errors surface through the failing assertions instead. */
    },
  });

  await instance.initialise();
  await instance.start();
  await instance.createDatabase(DATABASE);

  return `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`;
};

export const stopEmbeddedPostgres = async (): Promise<void> => {
  if (!instance) return;
  await instance.stop();
  instance = undefined;
  rmSync(DATA_DIR, { recursive: true, force: true });
};
