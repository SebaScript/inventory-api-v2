import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { setupSwagger } from '../src/swagger';

/**
 * Boots the real application against the test database.
 *
 * Pipes and filters are configured exactly as in main.ts — a validation rule
 * that only holds in production is not actually tested.
 *
 * DATABASE_URL comes from the environment: `docker compose` locally, a service
 * container in CI. There is no in-memory stand-in, because the tests assert on
 * transactions, row locks and CHECK constraints, which cannot be faked.
 */
export async function createApp(): Promise<{
  app: INestApplication;
  dataSource: DataSource;
  api: ReturnType<typeof request>;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(false));
  // Before init, as in main.ts, or the /docs routes never reach the adapter.
  setupSwagger(app);
  await app.init();

  const dataSource = app.get(DataSource);
  await dataSource.runMigrations();

  return { app, dataSource, api: request(app.getHttpServer()) };
}

/** Empties the tables and restarts the id sequences between test files. */
export async function reset(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE movements, items, groups RESTART IDENTITY CASCADE');
}

/**
 * supertest builds one method per entry of Node's `http.METHODS`, which
 * includes QUERY on Node 22+, so this really does send `QUERY /items/search`.
 * Its published types predate the verb, hence the single cast here.
 */
export function query(app: INestApplication, path: string): request.Test {
  const agent = request(app.getHttpServer()) as unknown as Record<
    string,
    (p: string) => request.Test
  >;
  return agent.query(path);
}
