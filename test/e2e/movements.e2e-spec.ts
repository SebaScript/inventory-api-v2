import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type DataSource } from 'typeorm';
import { MovementType } from '../../src/modules/movements/entities/movement.entity';
import { type TestApp, createTestApp, resetDatabase } from '../setup/test-app.factory';

describe('Movements and inventory rules (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: TestApp['server'];
  let groupId: number;

  const createItem = async (sku: string, quantity = 0, minimumStock = 0): Promise<number> => {
    const response = await request(server)
      .post('/items')
      .send({ groupId, name: `Item ${sku}`, sku, quantity, minimumStock })
      .expect(201);
    return response.body.id as number;
  };

  const move = (body: Record<string, unknown>) => request(server).post('/movements').send(body);

  const stockOf = async (itemId: number): Promise<number> => {
    const response = await request(server).get(`/items/${itemId}`).expect(200);
    return response.body.quantity as number;
  };

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
    server = testApp.server;
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    const group = await request(server).post('/groups').send({ name: 'Electronics' }).expect(201);
    groupId = group.body.id as number;
  });

  afterAll(async () => {
    await resetDatabase(dataSource);
    await app.close();
  });

  describe('IN movements', () => {
    it('increases stock and returns 201 with the resulting level', async () => {
      const itemId = await createItem('IN-1');

      const response = await move({
        itemId,
        type: MovementType.IN,
        quantity: 50,
        reason: 'Supplier delivery #1',
      }).expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(Number),
        itemId,
        type: 'IN',
        quantity: 50,
        reason: 'Supplier delivery #1',
        resultingStock: 50,
      });
      expect(await stockOf(itemId)).toBe(50);
    });

    it('accumulates across successive movements', async () => {
      const itemId = await createItem('IN-2');

      await move({ itemId, type: MovementType.IN, quantity: 30 }).expect(201);
      await move({ itemId, type: MovementType.IN, quantity: 20 }).expect(201);

      expect(await stockOf(itemId)).toBe(50);
    });
  });

  describe('OUT movements', () => {
    it('decreases stock when there is enough', async () => {
      const itemId = await createItem('OUT-1', 100);

      const response = await move({ itemId, type: MovementType.OUT, quantity: 40 }).expect(201);

      expect(response.body.resultingStock).toBe(60);
      expect(await stockOf(itemId)).toBe(60);
    });

    it('allows draining stock to exactly zero', async () => {
      const itemId = await createItem('OUT-2', 25);

      const response = await move({ itemId, type: MovementType.OUT, quantity: 25 }).expect(201);

      expect(response.body.resultingStock).toBe(0);
      expect(await stockOf(itemId)).toBe(0);
    });
  });

  describe('insufficient stock', () => {
    it('rejects with 409 and reports what was available', async () => {
      const itemId = await createItem('LOW-1', 3);

      const response = await move({ itemId, type: MovementType.OUT, quantity: 10 }).expect(409);

      expect(response.body).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        code: 'INSUFFICIENT_STOCK',
        details: { itemId, available: 3, requested: 10 },
      });
    });

    it('leaves the item untouched and creates no movement', async () => {
      const itemId = await createItem('LOW-2', 3);
      const before = await request(server).get(`/items/${itemId}/movements`).expect(200);

      await move({ itemId, type: MovementType.OUT, quantity: 10 }).expect(409);

      expect(await stockOf(itemId)).toBe(3);
      const after = await request(server).get(`/items/${itemId}/movements`).expect(200);
      expect(after.body.meta.total).toBe(before.body.meta.total);
    });

    it('rejects any OUT against zero stock', async () => {
      const itemId = await createItem('LOW-3', 0);
      await move({ itemId, type: MovementType.OUT, quantity: 1 }).expect(409);
    });
  });

  describe('validation', () => {
    it('returns 404 for an unknown item', async () => {
      const response = await move({
        itemId: 999999,
        type: MovementType.IN,
        quantity: 1,
      }).expect(404);

      expect(response.body.code).toBe('ITEM_NOT_FOUND');
    });

    it.each([
      [{ quantity: 0 }, 'quantity'],
      [{ quantity: -5 }, 'quantity'],
      [{ quantity: 1.5 }, 'quantity'],
      [{ type: 'ADJUST' }, 'type'],
      [{ type: 'in' }, 'type'],
    ])('rejects %j with 400', async (override, field) => {
      const itemId = await createItem(`VAL-${field}-${JSON.stringify(override).length}`);

      const response = await move({
        itemId,
        type: MovementType.IN,
        quantity: 1,
        ...override,
      }).expect(400);

      expect(JSON.stringify(response.body.details.validationErrors)).toContain(field);
    });

    it('rejects a client-supplied resultingStock, which the server owns', async () => {
      const itemId = await createItem('VAL-RS');

      const response = await move({
        itemId,
        type: MovementType.IN,
        quantity: 1,
        resultingStock: 9999,
      }).expect(400);

      expect(JSON.stringify(response.body.details.validationErrors)).toContain('resultingStock');
    });
  });

  describe('the ledger is append-only', () => {
    it.each(['put', 'patch', 'delete'] as const)(
      'does not expose %s /movements/:id',
      async (verb) => {
        const itemId = await createItem('IMM-1', 10);
        const created = await move({ itemId, type: MovementType.IN, quantity: 5 }).expect(201);

        // 404 because the route does not exist: rewriting history would break the
        // guarantee that stock equals the sum of its movements.
        await request(server)
          [verb](`/movements/${created.body.id}`)
          .send({ quantity: 1 })
          .expect(404);
      },
    );
  });

  describe('GET /movements', () => {
    beforeEach(async () => {
      const itemId = await createItem('LIST-1', 100);
      const otherId = await createItem('LIST-2', 100);
      await move({ itemId, type: MovementType.OUT, quantity: 10 }).expect(201);
      await move({ itemId, type: MovementType.IN, quantity: 5 }).expect(201);
      await move({ itemId: otherId, type: MovementType.OUT, quantity: 3 }).expect(201);
    });

    it('lists every movement, including the opening entries', async () => {
      const response = await request(server).get('/movements').expect(200);
      // Two opening IN movements plus the three explicit ones.
      expect(response.body.meta.total).toBe(5);
    });

    it('filters by type', async () => {
      const response = await request(server).get('/movements?type=OUT').expect(200);

      expect(response.body.meta.total).toBe(2);
      expect(
        response.body.data.every((movement: { type: string }) => movement.type === 'OUT'),
      ).toBe(true);
    });

    it('filters by item', async () => {
      const items = await request(server).get('/items?sortBy=sku').expect(200);
      const firstItemId = items.body.data[0].id;

      const response = await request(server).get(`/movements?itemId=${firstItemId}`).expect(200);

      expect(
        response.body.data.every((movement: { itemId: number }) => movement.itemId === firstItemId),
      ).toBe(true);
    });

    it('filters by date range', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const empty = await request(server).get(`/movements?from=${future}`).expect(200);
      expect(empty.body.meta.total).toBe(0);

      const past = new Date(Date.now() - 86_400_000).toISOString();
      const all = await request(server).get(`/movements?from=${past}`).expect(200);
      expect(all.body.meta.total).toBe(5);
    });

    it('filters by an upper date bound', async () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const empty = await request(server).get(`/movements?to=${past}`).expect(200);
      expect(empty.body.meta.total).toBe(0);

      const future = new Date(Date.now() + 86_400_000).toISOString();
      const all = await request(server).get(`/movements?to=${future}`).expect(200);
      expect(all.body.meta.total).toBe(5);
    });

    it('combines both date bounds into a window', async () => {
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();

      const response = await request(server).get(`/movements?from=${from}&to=${to}`).expect(200);

      expect(response.body.meta.total).toBe(5);
    });

    it('sorts ascending as well as descending', async () => {
      const ascending = await request(server).get('/movements?sortBy=id&sortOrder=asc').expect(200);
      const descending = await request(server)
        .get('/movements?sortBy=id&sortOrder=desc')
        .expect(200);

      const ids = ascending.body.data.map((movement: { id: number }) => movement.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(descending.body.data[0].id).toBe(ids[ids.length - 1]);
    });

    it.each(['from', 'to'])('rejects a malformed %s date', async (field) => {
      await request(server).get(`/movements?${field}=not-a-date`).expect(400);
    });

    it('rejects an unknown type filter', async () => {
      await request(server).get('/movements?type=SIDEWAYS').expect(400);
    });
  });

  describe('GET /movements/:id', () => {
    it('returns the movement with its item', async () => {
      const itemId = await createItem('ONE-1', 10);
      const created = await move({ itemId, type: MovementType.OUT, quantity: 4 }).expect(201);

      const response = await request(server).get(`/movements/${created.body.id}`).expect(200);

      expect(response.body).toMatchObject({ id: created.body.id, resultingStock: 6 });
      expect(response.body.item.sku).toBe('ONE-1');
    });

    it('returns 404 for an unknown id', async () => {
      const response = await request(server).get('/movements/999999').expect(404);
      expect(response.body.code).toBe('MOVEMENT_NOT_FOUND');
    });
  });

  describe('GET /items/:itemId/movements', () => {
    it('returns the item ledger with a reconstructable stock history', async () => {
      const itemId = await createItem('HIST-1', 0);
      await move({ itemId, type: MovementType.IN, quantity: 100 }).expect(201);
      await move({ itemId, type: MovementType.OUT, quantity: 30 }).expect(201);
      await move({ itemId, type: MovementType.IN, quantity: 5 }).expect(201);

      const response = await request(server)
        .get(`/items/${itemId}/movements?sortBy=id&sortOrder=asc`)
        .expect(200);

      expect(
        response.body.data.map((movement: { resultingStock: number }) => movement.resultingStock),
      ).toEqual([100, 70, 75]);
    });

    it('returns 404 for an unknown item', async () => {
      await request(server).get('/items/999999/movements').expect(404);
    });
  });
});
