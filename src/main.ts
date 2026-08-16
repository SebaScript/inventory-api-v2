import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { type AppConfig, type DatabaseConfig } from './config/configuration';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { runSeed } from './database/seeds/seed';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');
  const databaseConfig = config.getOrThrow<DatabaseConfig>('database');

  app.useLogger(
    appConfig.isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  );

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip anything not declared on the DTO...
      whitelist: true,
      // ...and reject it loudly, so a typo'd field is a 400 rather than a
      // silently ignored update.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        // Conversions are declared explicitly with @Type(() => Number) instead.
        // Implicit conversion happily turns "abc" into NaN and "0" into false.
        enableImplicitConversion: false,
      },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter(appConfig.isProduction));

  app.enableCors({
    origin: appConfig.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'QUERY'],
  });

  // Graceful shutdown: lets Docker stop the container without severing
  // in-flight requests or leaving the connection pool open.
  app.enableShutdownHooks();

  if (databaseConfig.runMigrationsOnStart) {
    const dataSource = app.get(DataSource);
    const applied = await dataSource.runMigrations();
    logger.log(
      applied.length > 0
        ? `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`
        : 'Database schema is up to date',
    );
  }

  if (databaseConfig.seedOnStart) {
    if (appConfig.isProduction) {
      logger.warn('SEED_ON_START is ignored in production: demo data is never injected there');
    } else {
      const result = await runSeed(app.get(DataSource));
      logger.log(result.message);
    }
  }

  if (appConfig.swaggerEnabled) {
    setupSwagger(app);
  }

  await app.listen(appConfig.port, '0.0.0.0');

  logger.log(`Inventory API listening on port ${appConfig.port} [${appConfig.nodeEnv}]`);
  if (appConfig.swaggerEnabled) logger.log(`Swagger UI available at /docs`);
  logger.log(`Health check available at /health`);
}

void bootstrap();
