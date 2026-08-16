import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SearchItemsDto } from './modules/items/dto/search-items.dto';
import { ErrorResponseDto } from './common/dto/error-response.dto';

/**
 * Documentation for the QUERY endpoint.
 *
 * OpenAPI 3.0 defines a **closed** set of operations (get, put, post, delete,
 * options, head, patch, trace). `query` is not among them, so no amount of
 * decorator configuration can make Swagger UI render it. Rather than pretend
 * the endpoint does not exist, its full contract is published here — and the
 * request/response schemas are registered as extra models so they still appear
 * under "Schemas".
 */
const QUERY_ENDPOINT_DOCS = `
## The \`QUERY /items/search\` endpoint

This API implements the HTTP **QUERY** method
([draft-ietf-httpbis-safe-method-w-body](https://datatracker.ietf.org/doc/draft-ietf-httpbis-safe-method-w-body/)),
a method that is **safe and idempotent like GET, but carries a request body**.

**Why this endpoint uses it.** Advanced inventory search filters on several
groups at once, on two inclusive ranges (price and stock) and on an ordered list
of sort criteria. That is a nested structure: expressing it in a query string
means inventing an encoding for arrays and objects, and it hits URL length
limits as soon as a caller filters on many groups. \`POST\` would carry the body
fine, but it would tell every cache, proxy and reader that the request changes
state — which is false. QUERY is the method designed for exactly this case.

It is supported natively by NestJS 11 (\`@QueryMethod\`), by Express 5 and by
Node's HTTP parser. No custom routing, middleware or method-override hack is
involved.

**Swagger UI cannot send this request** (OpenAPI 3.0 has no \`query\` operation),
so \`POST /items/search\` is exposed as an interoperability alias with an
identical body, response and handler. Prefer QUERY wherever your client
supports it.

### Request

\`\`\`http
QUERY /items/search HTTP/1.1
Content-Type: application/json
\`\`\`

\`\`\`json
{
  "text": "usb",
  "groupIds": [1, 3],
  "price": { "min": 5, "max": 200 },
  "stock": { "min": 0, "max": 100 },
  "lowStockOnly": false,
  "sort": [
    { "field": "quantity", "order": "asc" },
    { "field": "name", "order": "asc" }
  ],
  "page": 1,
  "pageSize": 20
}
\`\`\`

Every field is optional; an empty body \`{}\` returns the first page of all items.
See the **SearchItemsDto** schema below for the full field reference.

### Response \`200 OK\`

\`\`\`json
{
  "data": [
    {
      "id": 1,
      "groupId": 1,
      "name": "USB-C Cable 2m",
      "sku": "ELEC-USBC-2M",
      "quantity": 42,
      "minimumStock": 10,
      "unitPrice": 12.5,
      "createdAt": "2026-08-16T10:00:00.000Z",
      "updatedAt": "2026-08-16T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1,
    "hasNextPage": false, "hasPreviousPage": false
  }
}
\`\`\`

Validation failures return \`400\` in the standard error shape
(**ErrorResponseDto**), with the offending fields listed in
\`details.validationErrors\`.

### How to test it

\`\`\`bash
curl -X QUERY http://localhost:3000/items/search \\
  -H 'Content-Type: application/json' \\
  -d '{"text":"usb","sort":[{"field":"quantity","order":"desc"}]}'
\`\`\`

\`\`\`bash
# Equivalent through the interoperability alias
curl -X POST http://localhost:3000/items/search \\
  -H 'Content-Type: application/json' \\
  -d '{"text":"usb","sort":[{"field":"quantity","order":"desc"}]}'
\`\`\`

> \`curl\` sends any method verbatim with \`-X\`, so no special build is needed.
> The automated suite covers the real verb in \`test/e2e/items-query.e2e-spec.ts\`.
`;

const DESCRIPTION = `
REST API for inventory management, built with NestJS, TypeScript and PostgreSQL.

The domain is three entities: **Group → Item → Movement**.

- **Groups** categorise items. Names are unique case-insensitively.
- **Items** are stock keeping units. \`quantity\` is **read-only** through the item
  endpoints — it changes exclusively through movements, so it is always exactly
  the sum of the item's ledger.
- **Movements** are an append-only ledger (\`IN\` / \`OUT\`). Creating one updates
  stock in the same transaction with the item row locked, so concurrent requests
  cannot oversell. An \`OUT\` that would drive stock below zero is rejected with
  \`409\` and nothing is written.

### Errors

Every failure returns the same shape — see **ErrorResponseDto**. Branch on the
machine-readable \`code\` field rather than parsing \`message\`. Stack traces are
never included in production responses; the \`requestId\` correlates a response
with the server log.

### Pagination

All list endpoints return \`{ data, meta }\` and accept \`page\`, \`pageSize\`,
\`sortBy\` and \`sortOrder\`. \`pageSize\` is capped at **100**.

${QUERY_ENDPOINT_DOCS}
`;

/**
 * Mounts the OpenAPI document at `/docs`.
 */
export const setupSwagger = (app: INestApplication): void => {
  const config = new DocumentBuilder()
    .setTitle('Inventory API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0.0')
    .addTag('Groups', 'Item categories')
    .addTag('Items', 'Stock keeping units and inventory reporting')
    .addTag('Movements', 'Append-only stock ledger')
    .addTag('Health', 'Service and database availability')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    // Registered explicitly so the QUERY endpoint's schemas are published even
    // though its operation cannot be expressed in OpenAPI 3.0.
    extraModels: [SearchItemsDto, ErrorResponseDto],
  });

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Inventory API — Reference',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      tagsSorter: 'alpha',
    },
  });
};
