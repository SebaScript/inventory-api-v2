import { INestApplication, VERSION_NEUTRAL, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CacheService } from '../src/cache/cache.service';
import { apiAlias } from '../src/common/api-alias';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { ObjectStorageService } from '../src/storage/object-storage.service';
import { setupSwagger } from '../src/swagger';

export async function createApp(
  cache?: CacheService,
  storage?: ObjectStorageService,
): Promise<{
  app: INestApplication;
  dataSource: DataSource;
  api: ReturnType<typeof request>;
}> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  // No override: real services with no REDIS_URL or S3_BUCKET, their offline paths.
  if (cache) builder.overrideProvider(CacheService).useValue(cache);
  if (storage) builder.overrideProvider(ObjectStorageService).useValue(storage);

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.use(apiAlias);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(false));

  setupSwagger(app);
  await app.init();

  return { app, dataSource: app.get(DataSource), api: request(app.getHttpServer()) };
}

export async function reset(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE movements, items, groups RESTART IDENTITY CASCADE');
}

export function query(app: INestApplication, path: string): request.Test {
  const agent = request(app.getHttpServer()) as unknown as Record<
    string,
    (p: string) => request.Test
  >;
  return agent.query(path);
}
