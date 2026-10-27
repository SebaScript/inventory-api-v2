import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ensureSchema } from '../src/database/schema';
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

  it('stores and returns the bin location of each item', async () => {
    const created = await api
      .post('/v3/items')
      .send({ groupId: 1, name: 'Gloves', sku: 'G1', location: 'a-03-2' })
      .expect(201);
    expect(created.body.location).toBe('A-03-2');

    await api.patch('/v3/items/1').send({ location: 'B-01-1' }).expect(200);
    expect((await api.get('/v3/items/1').expect(200)).body.location).toBe('B-01-1');
    expect((await api.get('/v3/items').expect(200)).body.data[0].location).toBe('B-01-1');
  });

  it('never shows the location to v1 or v2, which keep their exact shape', async () => {
    await api.post('/v3/items').send({ groupId: 1, name: 'Gloves', sku: 'G1', location: 'A-1' });
    const created = await api.post('/v2/items').send({ groupId: 1, name: 'Tape', sku: 'T1' });

    expect(created.body).not.toHaveProperty('location');
    for (const path of ['/items/1', '/v2/items/1', '/movements?itemId=1']) {
      expect(JSON.stringify((await api.get(path).expect(200)).body)).not.toContain('location');
    }
    expect((await api.get('/v2/items').expect(200)).body.data[0]).not.toHaveProperty('location');
    await api.patch('/v2/items/1').send({ location: 'B-2' }).expect(400);
  });

  it('keeps what v3 wrote when v2 updates the same item', async () => {
    await api.post('/v3/items').send({ groupId: 1, name: 'Gloves', sku: 'G1', location: 'A-1' });
    await api.patch('/v2/items/1').send({ name: 'Safety gloves' }).expect(200);

    expect((await api.get('/v3/items/1').expect(200)).body).toMatchObject({
      name: 'Safety gloves',
      location: 'A-1',
    });
  });

  it('expands a database an older build created, without touching its rows', async () => {
    await api.post('/v2/items').send({ groupId: 1, name: 'Tape', sku: 'T1' }).expect(201);
    await dataSource.query('ALTER TABLE items DROP COLUMN location');

    expect(await ensureSchema(dataSource)).toContain('expanded');
    expect(await ensureSchema(dataSource)).toContain('expanded');
    expect((await api.get('/v3/items/1').expect(200)).body).toMatchObject({
      sku: 'T1',
      location: null,
    });
  });

  it('serves every resource under /v3, so /api never loses a route when it moves to v3', async () => {
    await api.post('/api/items').send({ groupId: 1, name: 'Tape', sku: 'T1', quantity: 5 });
    await api.post('/api/movements').send({ itemId: 1, type: 'OUT', quantity: 2 }).expect(201);

    expect((await api.get('/api/items/1').expect(200)).body).toMatchObject({
      quantity: 3,
      location: null,
    });
    await api.get('/api/groups').expect(200);
    await api.get('/api/v3/interop/random').expect(200);
    expect((await api.get('/api/v2/items/1').expect(200)).body).not.toHaveProperty('location');
  });

  it('documents the location under v3 only', async () => {
    const { body } = await api.get('/docs-json').expect(200);

    expect(body.paths['/v3/items/{id}'].get.tags).toEqual(['Items v3']);
    expect(body.paths['/v3/groups'].get.tags).toEqual(['Groups v2, v3']);
    expect(body.components.schemas.Item.properties).not.toHaveProperty('location');
    expect(body.components.schemas.ItemV3.properties).toHaveProperty('location');
  });
});
