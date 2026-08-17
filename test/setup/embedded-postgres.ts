import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
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
/** Resolves true when something is already listening on the given port. */
const isPortInUse = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const settle = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });

export const startEmbeddedPostgres = async (): Promise<string> => {
  // A run that was killed mid-flight leaves its postmaster alive, and the next
  // `initialise()` then dies with "pre-existing shared memory block is still in
  // use" — accurate, but nobody guesses the fix from it. Detecting the occupied
  // port turns a confusing failure into a one-line instruction.
  if (await isPortInUse(PORT)) {
    throw new Error(
      `Port ${PORT} is already in use, so the test PostgreSQL cannot start.\n` +
        `This is usually a server left behind by a test run that was interrupted.\n\n` +
        `  Windows:  Get-Process postgres | Stop-Process -Force\n` +
        `  macOS/Linux:  pkill -f "postgres.*${PORT}"\n\n` +
        `Or point the suite at another port with EMBEDDED_PG_PORT, or at an\n` +
        `existing server with DATABASE_URL.`,
    );
  }

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
  removeDataDir();
};

/**
 * Deletes the data directory, tolerating Windows file locking.
 *
 * Windows can keep handles on the data files for a moment after the postmaster
 * exits, so an immediate delete throws EBUSY. A leftover directory is harmless
 * — the next run wipes it before initialising — so failing the whole test run
 * over cleanup would be the wrong trade.
 */
const removeDataDir = (): void => {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Left for the next run's clean slate.
  }
};
