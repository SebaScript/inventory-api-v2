import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { seed } from '../src/database/seed';
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

  it('reports health by querying the database, and 503 when it is unreachable', async () => {
    const body = (await api.get('/health').expect(200)).body;
    expect(body).toMatchObject({ status: 'ok', database: 'up' });
    expect(body.revision).toBeTruthy();

    const spy = jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('down'));
    expect((await api.get('/health').expect(503)).body.database).toBe('down');
    spy.mockRestore();
  });

  it('serves an OpenAPI document that cannot include the QUERY verb', async () => {
    await api.get('/docs').expect(200);
    const { body } = await api.get('/docs-json').expect(200);

    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining(['/groups', '/items', '/items/{id}', '/movements', '/health']),
    );

    expect(body.paths['/items/search']).not.toHaveProperty('query');
    expect(body.info.description).toContain('QUERY /items/search');
  });

  it('seeds demo data where every stock equals the sum of its own movements', async () => {
    expect(await seed(dataSource)).toContain('Seed complete');
    expect(await seed(dataSource)).toContain('skipped');

    for (const item of await dataSource.getRepository(Item).find()) {
      const movements = await dataSource.getRepository(Movement).findBy({ itemId: item.id });
      const net = movements.reduce(
        (sum, m) => sum + (m.type === MovementType.IN ? m.quantity : -m.quantity),
        0,
      );
      expect({ sku: item.sku, stock: item.quantity }).toEqual({ sku: item.sku, stock: net });
    }
  });
});
