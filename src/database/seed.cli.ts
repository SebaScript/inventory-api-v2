import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { seed } from './seed';

/**
 * Seeds the demo data and exits. The application refuses to seed on boot when
 * NODE_ENV is production, which is deliberate: filling a database is an
 * explicit operation, not a side effect of starting a process. This is how it
 * is asked for explicitly, as a one-off job.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    console.log(await seed(app.get(DataSource)));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
