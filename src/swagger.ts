import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Inventory API')
    // OpenAPI 3.0 has a closed list of methods that excludes `query`, so the
    // QUERY endpoint cannot be listed as an operation. This paragraph is the
    // only place the published documentation can mention it.
    .setDescription(
      'Inventory management over three entities: Group -> Item -> Movement.\n\n' +
        'Every resource is served twice: at its bare path, and under `/v2`, which ' +
        'starts as an exact mirror and is where new behaviour will land.\n\n' +
        '**QUERY /items/search** — advanced search over the HTTP QUERY verb, which is ' +
        'safe and idempotent like GET but carries a request body. Neither it nor its ' +
        '`/v2` twin can appear below, because OpenAPI 3.0 does not admit the method; ' +
        '`POST /items/search` is an identical alias for clients that cannot send it.',
    )
    .setVersion('1.0')
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
