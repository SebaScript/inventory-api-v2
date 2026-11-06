import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp, reset } from './app.factory';

describe('API v3', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(async () => {
    await reset(dataSource);
    await api.post('/groups').send({ name: 'Warehouse' }).expect(201);
  });
  afterAll(() => app.close());

  /** The items table as 3.1.0 built it: v3 must run on it unchanged. */
  const V2_ITEM_COLUMNS = [
    'created_at',
    'group_id',
    'id',
    'minimum_stock',
    'name',
    'quantity',
    'sku',
    'status',
    'unit_price',
    'updated_at',
  ];
  const gloves = { groupId: 1, name: 'Gloves', sku: 'G1', quantity: 4, unitPrice: 2.5 };

  it('shows what the stock of each item is worth, and keeps it current', async () => {
    expect((await api.post('/v3/items').send(gloves).expect(201)).body.stockValue).toBe(10);
    expect((await api.get('/v3/items/1').expect(200)).body.stockValue).toBe(10);
    expect((await api.get('/v3/items').expect(200)).body.data[0].stockValue).toBe(10);

    await api.post('/v3/movements').send({ itemId: 1, type: 'IN', quantity: 6 }).expect(201);
    expect((await api.get('/v3/items/1').expect(200)).body.stockValue).toBe(25);

    const repriced = await api.patch('/v3/items/1').send({ unitPrice: 3.3 }).expect(200);
    expect(repriced.body.stockValue).toBe(33);
  });

  it('computes the value, so nobody can write it', async () => {
    await api
      .post('/v3/items')
      .send({ ...gloves, stockValue: 99 })
      .expect(400);
    await api.post('/v3/items').send(gloves).expect(201);
    await api.patch('/v3/items/1').send({ stockValue: 99 }).expect(400);
  });

  it('leaves v1 and v2 exactly as they were', async () => {
    const created = await api.post('/v2/items').send(gloves).expect(201);
    expect(created.body).not.toHaveProperty('stockValue');

    for (const path of ['/items/1', '/v2/items/1', '/api/v2/items/1', '/movements?itemId=1']) {
      expect(JSON.stringify((await api.get(path).expect(200)).body)).not.toContain('stockValue');
    }
    expect((await api.get('/v2/items').expect(200)).body.data[0]).not.toHaveProperty('stockValue');
  });

  it('stores nothing new: v2 tables, read and written the same by both versions', async () => {
    await api.post('/v3/items').send(gloves).expect(201);
    await api.patch('/v3/items/1').send({ unitPrice: 4 }).expect(200);

    expect((await api.get('/v2/items/1').expect(200)).body.unitPrice).toBe(4);
    await api.patch('/v2/items/1').send({ unitPrice: 5 }).expect(200);
    expect((await api.get('/v3/items/1').expect(200)).body.stockValue).toBe(20);

    const columns = await dataSource.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'items'`,
    );
    expect(columns.map((c) => c.column_name).sort()).toEqual(V2_ITEM_COLUMNS);
  });

  it('serves every resource under /v3, so /api never loses a route when it moves to v3', async () => {
    await api.post('/api/items').send(gloves);
    await api.post('/api/movements').send({ itemId: 1, type: 'OUT', quantity: 2 }).expect(201);

    expect((await api.get('/api/items/1').expect(200)).body).toMatchObject({
      quantity: 2,
      stockValue: 5,
    });
    await api.get('/api/groups').expect(200);
    await api.get('/api/v3/interop/random').expect(200);
    await api.get('/api/v2/items/1').expect(200);
  });

  it('documents the stock value under v3 only', async () => {
    const { body } = await api.get('/docs-json').expect(200);

    expect(body.paths['/v3/items/{id}'].get.tags).toEqual(['Items v3']);
    expect(body.paths['/v3/groups'].get.tags).toEqual(['Groups v2, v3']);
    expect(body.components.schemas.Item.properties).not.toHaveProperty('stockValue');
    expect(body.components.schemas.ItemV3.properties).toHaveProperty('stockValue');
  });
});
