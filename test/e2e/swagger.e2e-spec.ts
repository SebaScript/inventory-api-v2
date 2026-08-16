import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../setup/test-app.factory';
import { type TestServer } from '../setup/http-query';

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
  components: { schemas: Record<string, unknown> };
  tags: Array<{ name: string }>;
}

/**
 * Asserts the published API reference actually describes the API.
 *
 * Documentation that drifts from the implementation is worse than none, so
 * these tests compare the generated OpenAPI document against the real routes
 * rather than merely checking that `/docs` returns 200.
 */
describe('OpenAPI documentation (e2e)', () => {
  let app: INestApplication;
  let server: TestServer;
  let document: OpenApiDocument;

  beforeAll(async () => {
    const testApp = await createTestApp({ withSwagger: true });
    app = testApp.app;
    server = testApp.server;

    const response = await request(server).get('/docs-json').expect(200);
    document = response.body as OpenApiDocument;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the Swagger UI at /docs', async () => {
    const response = await request(server).get('/docs').expect(200);
    expect(response.text).toContain('swagger');
  });

  it('publishes a valid OpenAPI 3 document with the project metadata', () => {
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe('Inventory API');
    expect(document.info.version).toBe('1.0.0');
  });

  it('documents every REST route the API exposes', () => {
    const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        'POST /groups',
        'GET /groups',
        'GET /groups/{id}',
        'PUT /groups/{id}',
        'PATCH /groups/{id}',
        'DELETE /groups/{id}',
        'GET /groups/{groupId}/items',
        'POST /items',
        'GET /items',
        'GET /items/low-stock',
        'GET /items/summary',
        'POST /items/search',
        'GET /items/{id}',
        'PUT /items/{id}',
        'PATCH /items/{id}',
        'DELETE /items/{id}',
        'GET /items/{itemId}/movements',
        'POST /movements',
        'GET /movements',
        'GET /movements/{id}',
        'GET /health',
      ]),
    );
  });

  it('does not document write operations on the append-only ledger', () => {
    const movementById = document.paths['/movements/{id}'];
    expect(Object.keys(movementById)).toEqual(['get']);
  });

  /**
   * OpenAPI 3.0 defines a closed set of operations that excludes `query`, so
   * the QUERY endpoint provably cannot appear as an operation. This pins that
   * reality down and asserts the compensating documentation is in place.
   */
  it('documents the QUERY endpoint in prose, since OpenAPI cannot express it', () => {
    expect(document.paths['/items/search']).not.toHaveProperty('query');

    expect(document.info.description).toContain('QUERY /items/search');
    expect(document.info.description).toContain('safe and idempotent');
    expect(document.info.description).toContain('curl -X QUERY');
  });

  it('publishes the QUERY request schema even though its operation cannot be', () => {
    expect(document.components.schemas).toHaveProperty('SearchItemsDto');
    expect(document.components.schemas).toHaveProperty('RangeFilterDto');
    expect(document.components.schemas).toHaveProperty('SortCriterionDto');
  });

  it('labels the POST alias as an interoperability shim, not a second API', () => {
    const summary = document.paths['/items/search'].post.summary ?? '';
    expect(summary).toContain('interoperability alias');
  });

  it('documents the error contract, not just the happy paths', () => {
    expect(document.components.schemas).toHaveProperty('ErrorResponseDto');

    const createMovement = document.paths['/movements'].post as unknown as {
      responses: Record<string, unknown>;
    };
    expect(Object.keys(createMovement.responses)).toEqual(
      expect.arrayContaining(['201', '400', '404', '409', '500']),
    );
  });

  it('documents the paginated envelope for list endpoints', () => {
    expect(document.components.schemas).toHaveProperty('PaginationMeta');

    const listItems = document.paths['/items'].get as unknown as {
      responses: { '200': { content: Record<string, { schema: unknown }> } };
    };
    expect(JSON.stringify(listItems.responses['200'])).toContain('PaginationMeta');
  });

  it('groups every operation under a declared tag', () => {
    const declared = new Set(document.tags.map((tag) => tag.name));

    for (const methods of Object.values(document.paths)) {
      for (const operation of Object.values(methods)) {
        expect(operation.tags?.length ?? 0).toBeGreaterThan(0);
        for (const tag of operation.tags ?? []) {
          expect(declared).toContain(tag);
        }
      }
    }
  });
});
