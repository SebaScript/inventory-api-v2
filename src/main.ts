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

  // One JSON object per line, so a log collector indexes the fields instead of
  // storing the whole line as text. `colors` has to stay off when `json` is on:
  // together they fall back to a pretty-printed form that is not valid JSON.
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: isProduction, colors: !isProduction }),
  });

  const logger = new Logger('Bootstrap');

  // Before the router, so `/api/v2/...` reaches the same handlers as `/v2/...`.
  app.use(apiAlias);

  // The original API keeps its bare paths, so nothing that already calls it
  // breaks; only the controllers that declare a version get a `/vN` prefix.
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

  // Lets the drain in HealthController and the cache client close cleanly on
  // SIGTERM, instead of the process dying with requests still in flight.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API on :${port}  ·  docs at /docs  ·  health at /health`);
}

void bootstrap();
