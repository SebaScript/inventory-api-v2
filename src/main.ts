import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { seed } from './database/seed';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const isProduction = process.env.NODE_ENV === 'production';

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip anything not on the DTO
      forbidNonWhitelisted: true, // and reject it, so a typo is a loud 400
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(isProduction));
  app.enableCors();

  // Demo data must never reach production, whatever the variable says.
  if (process.env.SEED === 'true' && !isProduction) {
    logger.log(await seed(app.get(DataSource)));
  }

  setupSwagger(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API on :${port}  ·  docs at /docs  ·  health at /health`);
}

void bootstrap();
