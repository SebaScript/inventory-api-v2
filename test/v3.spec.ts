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

  it('serves every resource under /v3, so /api never loses a route when it moves to v3', async () => {
    await api.post('/api/items').send({ groupId: 1, name: 'Tape', sku: 'T1', quantity: 5 });
    await api.post('/api/movements').send({ itemId: 1, type: 'OUT', quantity: 2 }).expect(201);

    expect((await api.get('/api/items/1').expect(200)).body).toMatchObject({ quantity: 3 });
    await api.get('/api/groups').expect(200);
    await api.get('/api/v3/interop/random').expect(200);
    await api.get('/api/v2/items/1').expect(200);
  });

  it('documents v3 under its own tag', async () => {
    const { body } = await api.get('/docs-json').expect(200);

    expect(body.paths['/v3/items/{id}'].get.tags).toEqual(['Items v3']);
    expect(body.paths['/v3/groups'].get.tags).toEqual(['Groups v2, v3']);
  });
});
