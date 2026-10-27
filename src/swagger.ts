import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Inventory API')
    // OpenAPI 3.0 cannot list the QUERY method: this is the only place it is documented.
    .setDescription(
      'Inventory management over three entities: Group -> Item -> Movement.\n\n' +
        'Every resource is served at its bare path, under `/v2` and under `/v3`. ' +
        'v3 adds the bin `location` of each item, which v1 and v2 never show. ' +
        '`/api/...` without a version serves the newest one.\n\n' +
        '**QUERY /items/search**: advanced search over the HTTP QUERY verb, which is ' +
        'safe and idempotent like GET but carries a request body. Neither it nor its ' +
        '`/v2` twin can appear below, because OpenAPI 3.0 does not admit the method; ' +
        '`POST /items/search` is an identical alias for clients that cannot send it.',
    )
    .setVersion('1.0')
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
