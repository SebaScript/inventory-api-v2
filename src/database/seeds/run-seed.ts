import { AppDataSource } from '../data-source';
import { runSeed } from './seed';

/**
 * Standalone seed entry point (`npm run seed`, `npm run seed -- --force`).
 *
 * Runs without booting the Nest application, so it can be used from a container
 * entrypoint, a CI step or a developer shell alike.
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  await AppDataSource.initialize();

  try {
    const result = await runSeed(AppDataSource, { force });
    console.log(result.message);
    if (result.skipped) {
      console.log('Tip: run `npm run seed -- --force` to wipe and repopulate.');
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
