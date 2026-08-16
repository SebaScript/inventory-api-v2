import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { clearInventory } from '../../src/database/seeds/seed';
import { setupSwagger } from '../../src/swagger';
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
export interface CreateTestAppOptions {
  /**
   * Mounts the OpenAPI document at `/docs`.
   *
   * Off by default because it costs a full document build on every boot, and
   * only the documentation spec needs it.
   */
  withSwagger?: boolean;
}

export const createTestApp = async (options: CreateTestAppOptions = {}): Promise<TestApp> => {
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

  // Swagger has to be mounted before init, exactly as in `main.ts`, or its
  // routes never reach the HTTP adapter.
  if (options.withSwagger) setupSwagger(app);

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
