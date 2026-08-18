import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp, query, reset } from './app.factory';

describe('Items', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(async () => {
    await reset(dataSource);
    await api.post('/groups').send({ name: 'Electronics' }).expect(201);
    await api.post('/groups').send({ name: 'Office' }).expect(201);
  });
  afterAll(() => app.close());

  const create = (body: object) => api.post('/items').send({ groupId: 1, ...body });

  describe('POST /items', () => {
    it('creates an item with defaults', async () => {
      const res = await create({ name: 'USB Cable', sku: 'C1' }).expect(201);
      expect(res.body).toMatchObject({ sku: 'C1', quantity: 0, minimumStock: 0, unitPrice: 0 });
    });

    it('uppercases the SKU so uniqueness is meaningful', async () => {
      const res = await create({ name: 'Cable', sku: ' c-low ' }).expect(201);
      expect(res.body.sku).toBe('C-LOW');
    });

    it('returns unitPrice as a number, not a string', async () => {
      const res = await create({ name: 'Cable', sku: 'C1', unitPrice: 19.99 }).expect(201);
      expect(res.body.unitPrice).toBe(19.99);
    });

    it('records opening stock as an IN movement, so the ledger explains it', async () => {
      const res = await create({ name: 'Cable', sku: 'C1', quantity: 40 }).expect(201);
      expect(res.body.quantity).toBe(40);

      const ledger = await api.get('/movements?itemId=1').expect(200);
      expect(ledger.body.meta.total).toBe(1);
      expect(ledger.body.data[0]).toMatchObject({ type: 'IN', quantity: 40, resultingStock: 40 });
    });

    it('creates no movement when opening stock is zero', async () => {
      await create({ name: 'Cable', sku: 'C1' }).expect(201);
      const ledger = await api.get('/movements').expect(200);
      expect(ledger.body.meta.total).toBe(0);
    });

    it('rejects a duplicate SKU', async () => {
      await create({ name: 'Cable', sku: 'DUP' }).expect(201);
      const res = await create({ name: 'Other', sku: 'dup' }).expect(409);
      expect(res.body.code).toBe('SKU_TAKEN');
    });

    it('rejects an unknown group', async () => {
      const res = await api
        .post('/items')
        .send({ groupId: 999, name: 'Orphan', sku: 'S1' })
        .expect(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
    });

    it.each([
      [{ name: 'A', sku: 'S1' }],
      [{ name: 'Valid', sku: 'S1', quantity: -1 }],
      [{ name: 'Valid', sku: 'S1', unitPrice: -1 }],
      [{ name: 'Valid', sku: 'S1', unitPrice: 1.234 }],
      [{ sku: 'S1' }],
    ])('rejects invalid body %j', async (body) => {
      await create(body).expect(400);
    });
  });

  describe('GET /items', () => {
    beforeEach(async () => {
      await create({ name: 'USB Cable', sku: 'C1', quantity: 100, minimumStock: 20 }).expect(201);
      await create({ name: 'USB Hub', sku: 'H1', quantity: 5, minimumStock: 10 }).expect(201);
      await api
        .post('/items')
        .send({ groupId: 2, name: 'Paper', sku: 'P1', quantity: 300 })
        .expect(201);
    });

    it('embeds the group', async () => {
      const res = await api.get('/items').expect(200);
      expect(res.body.data[0].group.name).toBe('Electronics');
    });

    it('filters by group', async () => {
      const res = await api.get('/items?groupId=2').expect(200);
      expect(res.body.meta.total).toBe(1);
    });

    it('searches name and SKU', async () => {
      const res = await api.get('/items?search=usb').expect(200);
      expect(res.body.meta.total).toBe(2);
    });

    it('filters to low stock', async () => {
      const res = await api.get('/items?lowStock=true').expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].sku).toBe('H1');
    });
  });

  describe('QUERY /items/search', () => {
    beforeEach(async () => {
      await create({
        name: 'USB Cable',
        sku: 'C1',
        quantity: 100,
        minimumStock: 20,
        unitPrice: 12.5,
      }).expect(201);
      await create({
        name: 'USB Hub',
        sku: 'H1',
        quantity: 5,
        minimumStock: 10,
        unitPrice: 45,
      }).expect(201);
      await api
        .post('/items')
        .send({ groupId: 2, name: 'Paper', sku: 'P1', quantity: 300, unitPrice: 5.75 })
        .expect(201);
    });

    it('accepts the real QUERY verb and returns a paginated envelope', async () => {
      const res = await query(app, '/items/search').send({}).expect(200);
      expect(res.body.meta.total).toBe(3);
    });

    it('filters by text', async () => {
      const res = await query(app, '/items/search').send({ text: 'usb' }).expect(200);
      expect(res.body.meta.total).toBe(2);
    });

    it('filters by several groups at once, which a query string handles badly', async () => {
      const both = await query(app, '/items/search')
        .send({ groupIds: [1, 2] })
        .expect(200);
      expect(both.body.meta.total).toBe(3);

      const one = await query(app, '/items/search')
        .send({ groupIds: [2] })
        .expect(200);
      expect(one.body.meta.total).toBe(1);
    });

    it('filters by price range', async () => {
      const res = await query(app, '/items/search')
        .send({ minPrice: 10, maxPrice: 50 })
        .expect(200);
      expect(res.body.data.map((i: { sku: string }) => i.sku).sort()).toEqual(['C1', 'H1']);
    });

    it('filters to low stock only', async () => {
      const res = await query(app, '/items/search').send({ lowStockOnly: true }).expect(200);
      expect(res.body.data[0].sku).toBe('H1');
    });

    it('validates the body and rejects unknown fields', async () => {
      await query(app, '/items/search').send({ limit: 101 }).expect(400);
      await query(app, '/items/search').send({ nope: true }).expect(400);
    });

    it('POST /items/search returns exactly the same thing, for clients without QUERY', async () => {
      const body = { text: 'usb' };
      const viaQuery = await query(app, '/items/search').send(body).expect(200);
      const viaPost = await api.post('/items/search').send(body).expect(200);
      expect(viaPost.body).toEqual(viaQuery.body);
    });
  });

  describe('update and delete', () => {
    beforeEach(() =>
      create({ name: 'Cable', sku: 'C1', quantity: 50, description: 'Keep' }).expect(201),
    );

    it('PUT replaces client-owned fields but preserves stock', async () => {
      const res = await api
        .put('/items/1')
        .send({ groupId: 1, name: 'New', sku: 'C1' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'New', description: null, quantity: 50 });
    });

    it('PATCH changes only what is sent', async () => {
      const res = await api.patch('/items/1').send({ unitPrice: 9.5 }).expect(200);
      expect(res.body).toMatchObject({ description: 'Keep', unitPrice: 9.5 });
    });

    it.each(['put', 'patch'] as const)('%s rejects a client-supplied quantity', async (verb) => {
      const res = await api[verb]('/items/1')
        .send({ groupId: 1, name: 'Cable', sku: 'C1', quantity: 999 })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('quantity');
    });

    it('rejects moving an item to an unknown group', async () => {
      await api.patch('/items/1').send({ groupId: 999 }).expect(404);
    });

    it('rejects taking a SKU another item already uses', async () => {
      await create({ name: 'Other', sku: 'C2' }).expect(201);
      await api.patch('/items/2').send({ sku: 'c1' }).expect(409);
    });

    it('deletes the item and its ledger', async () => {
      await api.delete('/items/1').expect(204);
      await api.get('/items/1').expect(404);
      const ledger = await api.get('/movements').expect(200);
      expect(ledger.body.meta.total).toBe(0);
    });

    it('returns 404 for unknown ids', async () => {
      await api.get('/items/999').expect(404);
      await api.delete('/items/999').expect(404);
    });
  });
});
