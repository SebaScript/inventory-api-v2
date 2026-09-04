import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp, query, reset } from './app.factory';

describe('API v2', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(() => reset(dataSource));
  afterAll(() => app.close());

  it('serves every route of the unversioned API under /v2', async () => {
    await api.post('/v2/groups').send({ name: 'Electronics' }).expect(201);
    await api
      .post('/v2/items')
      .send({ groupId: 1, name: 'USB Cable', sku: 'C1', quantity: 10 })
      .expect(201);
    await api.post('/v2/movements').send({ itemId: 1, type: 'OUT', quantity: 4 }).expect(201);

    expect((await api.get('/v2/items/1').expect(200)).body).toMatchObject({
      sku: 'C1',
      quantity: 6,
    });
    expect((await api.get('/v2/movements').expect(200)).body.meta.total).toBe(2);
    expect((await api.get('/v2/groups').expect(200)).body.meta.total).toBe(1);

    await api.patch('/v2/items/1').send({ name: 'Renamed' }).expect(200);
    await api.delete('/v2/items/1').expect(204);
    expect((await api.get('/v2/items/1').expect(200)).body.status).toBe('DISCONTINUED');

    // The rules travel with the routes: the group still holds an item.
    expect((await api.delete('/v2/groups/1').expect(409)).body.code).toBe('GROUP_NOT_EMPTY');
    await api.get('/v2/items/999').expect(404);
  });

  it('reads and writes the same data as the unversioned API', async () => {
    await api.post('/groups').send({ name: 'Office' }).expect(201);
    await api.post('/v2/items').send({ groupId: 1, name: 'Paper', sku: 'P1' }).expect(201);

    const v1 = await api.get('/items/1').expect(200);
    expect((await api.get('/v2/items/1').expect(200)).body).toEqual(v1.body);
  });

  it('answers the QUERY verb under /v2 too, with its POST alias', async () => {
    await api.post('/groups').send({ name: 'Electronics' }).expect(201);
    await api.post('/items').send({ groupId: 1, name: 'USB Hub', sku: 'H1', unitPrice: 45 });
    await api.post('/items').send({ groupId: 1, name: 'Paper', sku: 'P1', unitPrice: 2 });

    const body = { text: 'usb', minPrice: 10 };
    const viaQuery = await query(app, '/v2/items/search').send(body).expect(200);
    expect(viaQuery.body.data.map((i: { sku: string }) => i.sku)).toEqual(['H1']);

    expect((await api.post('/v2/items/search').send(body).expect(200)).body).toEqual(viaQuery.body);
    expect((await query(app, '/items/search').send(body).expect(200)).body).toEqual(viaQuery.body);
    await query(app, '/v2/items/search').send({ nope: true }).expect(400);
  });

  it('documents each version under its own tag, and still not the QUERY verb', async () => {
    const { body } = await api.get('/docs-json').expect(200);

    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining(['/v2/groups', '/v2/items', '/v2/items/{id}', '/v2/movements']),
    );
    expect(body.paths['/items'].get.tags).toEqual(['Items']);
    expect(body.paths['/v2/items'].get.tags).toEqual(['Items v2']);
    expect(body.paths['/v2/items/search']).not.toHaveProperty('query');
  });
});
