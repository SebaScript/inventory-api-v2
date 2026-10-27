import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { ensureSchema } from './schema';
import { seed } from './seed';

/** Seeds and exits: in production, seeding is an explicit one-off job, never a side effect of boot. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);
  // Both tracks boot at once on a new database: one builds and seeds, the other waits.
  const lock = dataSource.createQueryRunner();

  try {
    await lock.query('SELECT pg_advisory_lock(1)');
    console.log(await ensureSchema(dataSource));
    console.log(await seed(dataSource));
  } finally {
    await lock.release();
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
