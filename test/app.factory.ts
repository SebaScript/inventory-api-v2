import { INestApplication, VERSION_NEUTRAL, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { setupSwagger } from '../src/swagger';

export async function createApp(): Promise<{
  app: INestApplication;
  dataSource: DataSource;
  api: ReturnType<typeof request>;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
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
