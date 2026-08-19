import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { seed } from '../src/database/seed';
import { Group } from '../src/entities/group.entity';
import { Item } from '../src/entities/item.entity';
import { Movement, MovementType } from '../src/entities/movement.entity';
import { createApp, reset } from './app.factory';

describe('Application', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(() => reset(dataSource));
  afterAll(() => app.close());

  describe('health check', () => {
    it('queries the database and reports ok', async () => {
      const spy = jest.spyOn(dataSource, 'query');
      const res = await api.get('/health').expect(200);

      expect(res.body).toEqual({ status: 'ok', database: 'up' });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('returns 503 when the database is unreachable', async () => {
      const spy = jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('down'));
      const res = await api.get('/health').expect(503);

      expect(res.body.database).toBe('down');
      spy.mockRestore();
    });
  });

  describe('API documentation', () => {
    it('documents every REST route', async () => {
      await api.get('/docs').expect(200);
      const { body } = await api.get('/docs-json').expect(200);

      const routes = Object.entries(body.paths).flatMap(([path, methods]) =>
        Object.keys(methods as object).map((m) => `${m.toUpperCase()} ${path}`),
      );

      expect(routes).toEqual(
        expect.arrayContaining([
          'POST /groups',
          'GET /groups',
          'GET /groups/{id}',
          'PUT /groups/{id}',
          'PATCH /groups/{id}',
          'DELETE /groups/{id}',
          'POST /items',
          'GET /items',
          'POST /items/search',
          'GET /items/{id}',
          'PUT /items/{id}',
          'PATCH /items/{id}',
          'DELETE /items/{id}',
          'POST /movements',
          'GET /movements',
          'GET /movements/{id}',
          'GET /health',
        ]),
      );
    });

    it('cannot document the QUERY operation, and says so in the description', async () => {
      const { body } = await api.get('/docs-json').expect(200);

      // OpenAPI 3.0 has a closed list of methods that excludes `query`.
      expect(body.paths['/items/search']).not.toHaveProperty('query');
      expect(body.info.description).toContain('QUERY /items/search');
    });
  });

  describe('seed', () => {
    it('creates a coherent demo dataset', async () => {
      expect(await seed(dataSource)).toContain('Seed complete');

      expect(await dataSource.getRepository(Group).count()).toBe(3);
      expect(await dataSource.getRepository(Item).count()).toBe(10);
      expect(await dataSource.getRepository(Movement).count()).toBe(20);
    });

    /** The property that makes the demo data trustworthy. */
    it('leaves every stock equal to the sum of its own movements', async () => {
      await seed(dataSource);

      for (const item of await dataSource.getRepository(Item).find()) {
        const movements = await dataSource.getRepository(Movement).findBy({ itemId: item.id });
        const net = movements.reduce(
          (sum, m) => sum + (m.type === MovementType.IN ? m.quantity : -m.quantity),
          0,
        );
        expect({ sku: item.sku, stock: item.quantity }).toEqual({ sku: item.sku, stock: net });
      }
    });

    it('produces low-stock and out-of-stock items for the demo', async () => {
      await seed(dataSource);
      const items = await dataSource.getRepository(Item).find();

      expect(items.some((i) => i.quantity <= i.minimumStock)).toBe(true);
      expect(items.some((i) => i.quantity === 0)).toBe(true);
      expect(items.some((i) => i.quantity > i.minimumStock)).toBe(true);
    });

    it('is idempotent, so a container restart never duplicates data', async () => {
      await seed(dataSource);
      expect(await seed(dataSource)).toContain('skipped');
      expect(await dataSource.getRepository(Group).count()).toBe(3);
    });
  });
});
