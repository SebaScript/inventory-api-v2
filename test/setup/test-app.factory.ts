import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { clearInventory } from '../../src/database/seeds/seed';
import { type TestServer } from './http-query';

export interface TestApp {
  app: INestApplication;
  dataSource: DataSource;
  /** The raw Node HTTP server, which is what supertest drives. */
  server: TestServer;
}

/**
 * Boots the real application against the test database.
 *
 * The pipes and filters are configured exactly as in `main.ts`, because a
 * validation rule or an error shape that only holds in production is not
 * actually tested. Keeping them in step is the point of this factory.
 */
export const createTestApp = async (): Promise<TestApp> => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  // `false` = non-production, so failures surface with their stack during tests.
  app.useGlobalFilters(new GlobalExceptionFilter(false));

  await app.init();

  return {
    app,
    dataSource: app.get(DataSource),
    server: app.getHttpServer() as TestServer,
  };
};

/** Empties all inventory tables and resets identity sequences. */
export const resetDatabase = async (dataSource: DataSource): Promise<void> => {
  await clearInventory(dataSource.manager);
};
