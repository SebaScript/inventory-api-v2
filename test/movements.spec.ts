import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp, reset } from './app.factory';

describe('Movements and the inventory rule', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(async () => {
    await reset(dataSource);
    await api.post('/groups').send({ name: 'Electronics' }).expect(201);
  });
  afterAll(() => app.close());

  const addItem = (quantity = 0) =>
    api.post('/items').send({ groupId: 1, name: 'Cable', sku: 'C1', quantity }).expect(201);

  const move = (body: object) => api.post('/movements').send(body);

  const stockOf = async (): Promise<number> =>
    (await api.get('/items/1').expect(200)).body.quantity;

  it('IN raises the stock and OUT lowers it, recording the resulting level', async () => {
    await addItem(0);

    const inbound = await move({ itemId: 1, type: 'IN', quantity: 50, reason: 'Delivery' });
    expect(inbound.status).toBe(201);
    expect(inbound.body).toMatchObject({ type: 'IN', quantity: 50, resultingStock: 50 });

    const outbound = await move({ itemId: 1, type: 'OUT', quantity: 50 }).expect(201);
    expect(outbound.body.resultingStock).toBe(0); // draining to exactly zero is allowed
    expect(await stockOf()).toBe(0);
  });

  it('refuses an OUT larger than the stock and writes nothing at all', async () => {
    await addItem(3);

    const res = await move({ itemId: 1, type: 'OUT', quantity: 10 }).expect(409);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 3, requested: 10 });

    expect(await stockOf()).toBe(3);
    expect((await api.get('/movements').expect(200)).body.meta.total).toBe(1);
  });

  it('serialises concurrent OUT movements so the item cannot be oversold', async () => {
    await addItem(100);

    const results = await Promise.all([
      move({ itemId: 1, type: 'OUT', quantity: 60 }),
      move({ itemId: 1, type: 'OUT', quantity: 60 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf()).toBe(40);
  });

  it('lets PostgreSQL reject negative stock even when the API is bypassed', async () => {
    await addItem(10);
    await expect(dataSource.query('UPDATE items SET quantity = -1 WHERE id = 1')).rejects.toThrow();
  });

  it('lists movements newest first, filters them, and gets one with its item', async () => {
    await addItem(100);
    await move({ itemId: 1, type: 'OUT', quantity: 10 }).expect(201);

    const all = await api.get('/movements').expect(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0].type).toBe('OUT');

    expect((await api.get('/movements?type=OUT').expect(200)).body.meta.total).toBe(1);
    expect((await api.get('/movements?itemId=1').expect(200)).body.meta.total).toBe(2);
    expect((await api.get('/movements/1').expect(200)).body.item.sku).toBe('C1');
  });

  it('rejects an unknown item, an invalid body, and any attempt to rewrite history', async () => {
    await addItem(10);

    expect((await move({ itemId: 999, type: 'IN', quantity: 1 }).expect(404)).body.code).toBe(
      'ITEM_NOT_FOUND',
    );
    expect((await api.get('/movements/999').expect(404)).body.code).toBe('MOVEMENT_NOT_FOUND');

    await move({ itemId: 1, type: 'IN', quantity: 0 }).expect(400);
    await move({ itemId: 1, type: 'ADJUST', quantity: 1 }).expect(400);
    await move({ itemId: 1, type: 'IN', quantity: 1, resultingStock: 999 }).expect(400);

    await api.patch('/movements/1').send({ quantity: 1 }).expect(404);
    await api.delete('/movements/1').expect(404);
  });
});
