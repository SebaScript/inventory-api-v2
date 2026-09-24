import {
  ConsoleLogger,
  Logger,
  VERSION_NEUTRAL,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { apiAlias } from './common/api-alias';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { seed } from './database/seed';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  // JSON logs in production, so CloudWatch indexes fields. `json` and `colors` exclude each other.
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: isProduction, colors: !isProduction }),
  });

  const logger = new Logger('Bootstrap');

  // Before the router: `/api/v2/...` reaches the `/v2/...` handlers.
  app.use(apiAlias);

  // v1 keeps its bare paths; only versioned controllers get `/vN`.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(isProduction));
  app.enableCors();

  if (process.env.SEED === 'true' && !isProduction) {
    logger.log(await seed(app.get(DataSource)));
  }

  setupSwagger(app);

  // Lets the health drain and the cache client close cleanly on SIGTERM.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API on :${port}  ·  docs at /docs  ·  health at /health`);
}

void bootstrap();
