import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Mounts the API reference at /docs.
 *
 * Shared by main.ts and the test factory, so the documentation the tests check
 * is the documentation that actually ships.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Inventory API')
    .setDescription(
      'Inventory management over three entities: Group -> Item -> Movement.\n\n' +
        'Stock is never edited directly: it changes only through movements, written ' +
        'in a transaction that locks the item row so concurrent requests cannot ' +
        'oversell an item.\n\n' +
        '**QUERY /items/search** — advanced search over the HTTP QUERY verb, which is ' +
        'safe and idempotent like GET but carries a request body. OpenAPI 3.0 has a ' +
        'closed list of methods that does not include `query`, so the operation cannot ' +
        'appear below; `POST /items/search` is an identical alias for tooling that ' +
        'cannot send QUERY. See the README.',
    )
    .setVersion('1.0')
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
