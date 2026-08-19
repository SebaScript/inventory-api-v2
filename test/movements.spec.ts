import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Item } from '../src/entities/item.entity';
import { createApp, reset } from './app.factory';

/**
 * The inventory rule is the heart of the project, so it is tested against a
 * real PostgreSQL: atomicity, the refusal to go negative, behaviour under
 * concurrency, and the CHECK constraint that backs it all up.
 */
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

  const addItem = (quantity = 0, sku = 'C1') =>
    api
      .post('/items')
      .send({ groupId: 1, name: `Item ${sku}`, sku, quantity })
      .expect(201);

  const move = (body: object) => api.post('/movements').send(body);

  const stockOf = async (id = 1): Promise<number> =>
    (await api.get(`/items/${id}`).expect(200)).body.quantity;

  describe('IN', () => {
    it('increases stock and records the resulting level', async () => {
      await addItem(0);
      const res = await move({ itemId: 1, type: 'IN', quantity: 50, reason: 'Delivery' }).expect(
        201,
      );

      expect(res.body).toMatchObject({ type: 'IN', quantity: 50, resultingStock: 50 });
      expect(await stockOf()).toBe(50);
    });

    it('accumulates across movements', async () => {
      await addItem(0);
      await move({ itemId: 1, type: 'IN', quantity: 30 }).expect(201);
      await move({ itemId: 1, type: 'IN', quantity: 20 }).expect(201);
      expect(await stockOf()).toBe(50);
    });
  });

  describe('OUT', () => {
    it('decreases stock when there is enough', async () => {
      await addItem(100);
      const res = await move({ itemId: 1, type: 'OUT', quantity: 40 }).expect(201);

      expect(res.body.resultingStock).toBe(60);
      expect(await stockOf()).toBe(60);
    });

    it('allows draining to exactly zero', async () => {
      await addItem(25);
      const res = await move({ itemId: 1, type: 'OUT', quantity: 25 }).expect(201);
      expect(res.body.resultingStock).toBe(0);
    });
  });

  describe('insufficient stock', () => {
    it('returns 409 and reports what was available', async () => {
      await addItem(3);
      const res = await move({ itemId: 1, type: 'OUT', quantity: 10 }).expect(409);

      expect(res.body).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        available: 3,
        requested: 10,
      });
    });

    it('writes nothing at all: stock unchanged and no movement created', async () => {
      await addItem(3);
      const before = (await api.get('/movements').expect(200)).body.meta.total;

      await move({ itemId: 1, type: 'OUT', quantity: 10 }).expect(409);

      expect(await stockOf()).toBe(3);
      const after = (await api.get('/movements').expect(200)).body.meta.total;
      expect(after).toBe(before);
    });

    it('rejects any OUT against zero stock', async () => {
      await addItem(0);
      await move({ itemId: 1, type: 'OUT', quantity: 1 }).expect(409);
    });
  });

  describe('concurrency', () => {
    /**
     * The test that justifies `SELECT ... FOR UPDATE`.
     *
     * Two OUT movements of 60 against stock of 100: only one can succeed.
     * Without the row lock both would read 100, both would conclude 40 remains,
     * and both would commit — 120 units leaving a warehouse that held 100.
     */
    it('serialises concurrent OUT movements so the item cannot be oversold', async () => {
      await addItem(100);

      const results = await Promise.all([
        move({ itemId: 1, type: 'OUT', quantity: 60 }),
        move({ itemId: 1, type: 'OUT', quantity: 60 }),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(await stockOf()).toBe(40);
    });

    it('keeps stock correct under many interleaved movements', async () => {
      await addItem(100);

      await Promise.all([
        ...Array.from({ length: 10 }, () => move({ itemId: 1, type: 'OUT', quantity: 5 })),
        ...Array.from({ length: 10 }, () => move({ itemId: 1, type: 'IN', quantity: 3 })),
      ]);

      // 100 - 50 + 30
      expect(await stockOf()).toBe(80);
    });
  });

  describe('the database is the last line of defence', () => {
    it('rejects negative stock even when the application is bypassed', async () => {
      await addItem(10);
      await expect(
        dataSource.getRepository(Item).query('UPDATE items SET quantity = -1 WHERE id = 1'),
      ).rejects.toThrow();
    });
  });

  describe('validation and listing', () => {
    beforeEach(async () => {
      await addItem(100, 'C1');
      await move({ itemId: 1, type: 'OUT', quantity: 10 }).expect(201);
    });

    it('returns 404 for an unknown item', async () => {
      const res = await move({ itemId: 999, type: 'IN', quantity: 1 }).expect(404);
      expect(res.body.code).toBe('ITEM_NOT_FOUND');
    });

    it.each([
      [{ quantity: 0 }],
      [{ quantity: -5 }],
      [{ type: 'ADJUST' }],
      [{ type: 'in' }],
      [{ resultingStock: 999 }],
    ])('rejects invalid body %j', async (override) => {
      await move({ itemId: 1, type: 'IN', quantity: 1, ...override }).expect(400);
    });

    it('lists movements and filters by item and type', async () => {
      const all = await api.get('/movements').expect(200);
      // The opening IN plus the explicit OUT.
      expect(all.body.meta.total).toBe(2);

      const outs = await api.get('/movements?type=OUT').expect(200);
      expect(outs.body.meta.total).toBe(1);

      const byItem = await api.get('/movements?itemId=1').expect(200);
      expect(byItem.body.meta.total).toBe(2);
    });

    it('gets one movement with its item', async () => {
      const res = await api.get('/movements/1').expect(200);
      expect(res.body.item.sku).toBe('C1');
    });

    it('returns 404 for an unknown movement', async () => {
      const res = await api.get('/movements/999').expect(404);
      expect(res.body.code).toBe('MOVEMENT_NOT_FOUND');
    });

    it.each(['put', 'patch', 'delete'] as const)(
      'does not expose %s: the ledger is append-only',
      async (verb) => {
        await api[verb]('/movements/1').send({ quantity: 1 }).expect(404);
      },
    );

    it('keeps the history when the item is discontinued', async () => {
      const before = (await api.get('/movements?itemId=1').expect(200)).body.meta.total;

      await api.delete('/items/1').expect(204);

      const after = await api.get('/movements?itemId=1').expect(200);
      expect(after.body.meta.total).toBe(before);
      expect((await api.get('/items/1').expect(200)).body.status).toBe('DISCONTINUED');
    });
  });
});
