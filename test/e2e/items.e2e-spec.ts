import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type DataSource } from 'typeorm';
import { type TestApp, createTestApp, resetDatabase } from '../setup/test-app.factory';

describe('Items CRUD and reporting (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: TestApp['server'];
  let groupId: number;

  const createItem = (body: Record<string, unknown>) =>
    request(server)
      .post('/items')
      .send({ groupId, ...body });

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

  describe('POST /items', () => {
    it('creates an item with 201 and sensible defaults', async () => {
      const response = await createItem({ name: 'USB-C Cable', sku: 'CBL-1' }).expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(Number),
        groupId,
        name: 'USB-C Cable',
        sku: 'CBL-1',
        quantity: 0,
        minimumStock: 0,
        unitPrice: 0,
        description: null,
      });
    });

    it('normalises the SKU to uppercase', async () => {
      const response = await createItem({ name: 'Cable', sku: '  cbl-lower  ' }).expect(201);
      expect(response.body.sku).toBe('CBL-LOWER');
    });

    it('returns unitPrice as a number, not a string', async () => {
      const response = await createItem({
        name: 'Cable',
        sku: 'CBL-P',
        unitPrice: 19.99,
      }).expect(201);

      expect(response.body.unitPrice).toBe(19.99);
      expect(typeof response.body.unitPrice).toBe('number');
    });

    it('records an opening IN movement when created with stock', async () => {
      const created = await createItem({ name: 'Cable', sku: 'CBL-O', quantity: 40 }).expect(201);

      const ledger = await request(server).get(`/items/${created.body.id}/movements`).expect(200);

      expect(ledger.body.meta.total).toBe(1);
      expect(ledger.body.data[0]).toMatchObject({
        type: 'IN',
        quantity: 40,
        resultingStock: 40,
        reason: 'Opening stock recorded at item creation',
      });
    });

    it('rejects a duplicate SKU with 409, case-insensitively', async () => {
      await createItem({ name: 'Cable', sku: 'DUP-1' }).expect(201);

      const response = await createItem({ name: 'Other', sku: 'dup-1' }).expect(409);
      expect(response.body.code).toBe('SKU_ALREADY_EXISTS');
    });

    it('rejects an unknown group with 404', async () => {
      const response = await request(server)
        .post('/items')
        .send({ groupId: 999999, name: 'Cable', sku: 'ORPH-1' })
        .expect(404);

      expect(response.body.code).toBe('GROUP_NOT_FOUND');
    });

    it.each([
      [{ name: 'A', sku: 'X1' }, 'name'],
      [{ name: 'Valid', sku: 'A' }, 'sku'],
      [{ name: 'Valid', sku: 'V1', quantity: -1 }, 'quantity'],
      [{ name: 'Valid', sku: 'V2', minimumStock: -1 }, 'minimumStock'],
      [{ name: 'Valid', sku: 'V3', unitPrice: -0.01 }, 'unitPrice'],
      [{ name: 'Valid', sku: 'V4', unitPrice: 1.239 }, 'unitPrice'],
      [{ sku: 'V5' }, 'name'],
      [{ name: 'Valid' }, 'sku'],
    ])('rejects %j with 400', async (body, field) => {
      const response = await createItem(body).expect(400);
      expect(JSON.stringify(response.body.details.validationErrors)).toContain(field);
    });
  });

  describe('GET /items', () => {
    beforeEach(async () => {
      const office = await request(server).post('/groups').send({ name: 'Office' }).expect(201);

      await createItem({
        name: 'USB-C Cable',
        sku: 'CBL-1',
        quantity: 100,
        minimumStock: 20,
        unitPrice: 12.5,
      }).expect(201);
      await createItem({
        name: 'USB Hub',
        sku: 'HUB-1',
        quantity: 5,
        minimumStock: 10,
        unitPrice: 45,
      }).expect(201);
      await createItem({
        name: 'Keyboard',
        sku: 'KBD-1',
        quantity: 0,
        minimumStock: 5,
        unitPrice: 89.9,
      }).expect(201);
      await request(server)
        .post('/items')
        .send({
          groupId: office.body.id,
          name: 'A4 Paper',
          sku: 'PPR-1',
          quantity: 300,
          unitPrice: 5.75,
        })
        .expect(201);
    });

    it('returns a paginated envelope with the group embedded', async () => {
      const response = await request(server).get('/items').expect(200);

      expect(response.body.meta.total).toBe(4);
      expect(response.body.data[0].group).toMatchObject({ id: expect.any(Number) });
    });

    it('filters by group', async () => {
      const response = await request(server).get(`/items?groupId=${groupId}`).expect(200);
      expect(response.body.meta.total).toBe(3);
    });

    it('searches across name, SKU and description', async () => {
      const response = await request(server).get('/items?search=usb').expect(200);
      expect(response.body.meta.total).toBe(2);
    });

    it('filters by price range', async () => {
      const response = await request(server).get('/items?minPrice=10&maxPrice=50').expect(200);

      const prices = response.body.data.map((item: { unitPrice: number }) => item.unitPrice);
      expect(prices.every((price: number) => price >= 10 && price <= 50)).toBe(true);
      expect(prices).not.toContain(5.75);
    });

    it('filters to low stock only', async () => {
      const response = await request(server).get('/items?lowStock=true').expect(200);

      const skus = response.body.data.map((item: { sku: string }) => item.sku).sort();
      expect(skus).toEqual(['HUB-1', 'KBD-1']);
    });

    it('filters to healthy stock only, treating "false" as false', async () => {
      const response = await request(server).get('/items?lowStock=false').expect(200);

      const skus = response.body.data.map((item: { sku: string }) => item.sku).sort();
      expect(skus).toEqual(['CBL-1', 'PPR-1']);
    });

    it('sorts by a whitelisted field', async () => {
      const response = await request(server)
        .get('/items?sortBy=unitPrice&sortOrder=desc')
        .expect(200);

      const prices = response.body.data.map((item: { unitPrice: number }) => item.unitPrice);
      expect(prices).toEqual([...prices].sort((a, b) => b - a));
    });

    it('rejects an unknown sort field', async () => {
      await request(server).get('/items?sortBy=secret_column').expect(400);
    });
  });

  describe('GET /items/low-stock', () => {
    it('resolves before :id and lists items at or below their minimum', async () => {
      await createItem({ name: 'Healthy', sku: 'OK-1', quantity: 100, minimumStock: 10 }).expect(
        201,
      );
      await createItem({ name: 'Low', sku: 'LOW-1', quantity: 2, minimumStock: 10 }).expect(201);
      await createItem({ name: 'AtLimit', sku: 'LIM-1', quantity: 10, minimumStock: 10 }).expect(
        201,
      );

      const response = await request(server).get('/items/low-stock').expect(200);

      const skus = response.body.data.map((item: { sku: string }) => item.sku);
      expect(skus).toContain('LOW-1');
      // "at or below", so an item exactly at its minimum counts.
      expect(skus).toContain('LIM-1');
      expect(skus).not.toContain('OK-1');
    });

    it('orders by urgency, largest shortfall first', async () => {
      await createItem({ name: 'Slightly', sku: 'S-1', quantity: 9, minimumStock: 10 }).expect(201);
      await createItem({ name: 'Badly', sku: 'B-1', quantity: 1, minimumStock: 50 }).expect(201);

      const response = await request(server).get('/items/low-stock').expect(200);

      expect(response.body.data[0].sku).toBe('B-1');
    });
  });

  describe('GET /items/summary', () => {
    it('aggregates totals and breaks them down per group', async () => {
      const office = await request(server).post('/groups').send({ name: 'Office' }).expect(201);

      await createItem({ name: 'Cable', sku: 'C-1', quantity: 10, unitPrice: 10 }).expect(201);
      await createItem({
        name: 'Hub',
        sku: 'H-1',
        quantity: 2,
        minimumStock: 5,
        unitPrice: 20,
      }).expect(201);
      await createItem({ name: 'Gone', sku: 'G-1', quantity: 0, unitPrice: 5 }).expect(201);
      await request(server)
        .post('/items')
        .send({ groupId: office.body.id, name: 'Paper', sku: 'P-1', quantity: 100, unitPrice: 1.5 })
        .expect(201);

      const response = await request(server).get('/items/summary').expect(200);

      expect(response.body).toMatchObject({
        totalGroups: 2,
        totalItems: 4,
        // 10 + 2 + 0 + 100
        totalUnits: 112,
        // 100 + 40 + 0 + 150
        totalValue: 290,
        // Hub (2 <= 5) and Gone (0 <= 0)
        lowStockCount: 2,
        outOfStockCount: 1,
      });
      expect(response.body.byGroup).toHaveLength(2);
    });

    it('reports zeroes for an empty inventory', async () => {
      const response = await request(server).get('/items/summary').expect(200);

      expect(response.body).toMatchObject({
        totalItems: 0,
        totalUnits: 0,
        totalValue: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
      });
      // The empty group is still listed, with zeroes.
      expect(response.body.byGroup).toHaveLength(1);
      expect(response.body.byGroup[0]).toMatchObject({ itemCount: 0, totalUnits: 0 });
    });
  });

  describe('GET /items/:id', () => {
    it('returns the item with its group', async () => {
      const created = await createItem({ name: 'Cable', sku: 'ONE-1' }).expect(201);

      const response = await request(server).get(`/items/${created.body.id}`).expect(200);

      expect(response.body.id).toBe(created.body.id);
      expect(response.body.group.name).toBe('Electronics');
    });

    it('returns 404 for an unknown id', async () => {
      const response = await request(server).get('/items/999999').expect(404);
      expect(response.body.code).toBe('ITEM_NOT_FOUND');
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(server).get('/items/abc').expect(400);
    });
  });

  describe('PUT and PATCH /items/:id', () => {
    it('PUT replaces client-owned fields but preserves stock', async () => {
      const created = await createItem({
        name: 'Cable',
        sku: 'UPD-1',
        quantity: 75,
        description: 'Original',
        minimumStock: 10,
      }).expect(201);

      const response = await request(server)
        .put(`/items/${created.body.id}`)
        .send({ groupId, name: 'Renamed Cable', sku: 'UPD-1' })
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Renamed Cable',
        description: null,
        minimumStock: 0,
        // Untouched: stock belongs to the ledger, not to this endpoint.
        quantity: 75,
      });
    });

    it('PATCH updates only the supplied fields', async () => {
      const created = await createItem({
        name: 'Cable',
        sku: 'PCH-1',
        description: 'Keep me',
      }).expect(201);

      const response = await request(server)
        .patch(`/items/${created.body.id}`)
        .send({ unitPrice: 33.5 })
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Cable',
        description: 'Keep me',
        unitPrice: 33.5,
      });
    });

    it.each(['put', 'patch'] as const)(
      '%s rejects a client-supplied quantity, pointing at the ledger instead',
      async (verb) => {
        const created = await createItem({ name: 'Cable', sku: `Q-${verb}` }).expect(201);

        const response = await request(server)
          [verb](`/items/${created.body.id}`)
          .send({ groupId, name: 'Cable', sku: `Q-${verb}`, quantity: 999 })
          .expect(400);

        expect(JSON.stringify(response.body.details.validationErrors)).toContain('quantity');
      },
    );

    it('rejects moving an item to an unknown group', async () => {
      const created = await createItem({ name: 'Cable', sku: 'MOV-1' }).expect(201);

      await request(server)
        .patch(`/items/${created.body.id}`)
        .send({ groupId: 999999 })
        .expect(404);
    });

    it('rejects taking a SKU already used by another item', async () => {
      await createItem({ name: 'First', sku: 'TAKEN-1' }).expect(201);
      const second = await createItem({ name: 'Second', sku: 'FREE-1' }).expect(201);

      await request(server).patch(`/items/${second.body.id}`).send({ sku: 'taken-1' }).expect(409);
    });

    it('returns 404 when updating an unknown item', async () => {
      await request(server).patch('/items/999999').send({ name: 'Nope' }).expect(404);
    });
  });

  describe('DELETE /items/:id', () => {
    it('deletes the item and its ledger, returning 204', async () => {
      const created = await createItem({ name: 'Cable', sku: 'DEL-1', quantity: 10 }).expect(201);

      await request(server).delete(`/items/${created.body.id}`).expect(204);

      await request(server).get(`/items/${created.body.id}`).expect(404);
      const movements = await request(server).get('/movements').expect(200);
      expect(movements.body.meta.total).toBe(0);
    });

    it('frees the group for deletion once its last item is gone', async () => {
      const created = await createItem({ name: 'Cable', sku: 'DEL-2' }).expect(201);

      await request(server).delete(`/groups/${groupId}`).expect(409);
      await request(server).delete(`/items/${created.body.id}`).expect(204);
      await request(server).delete(`/groups/${groupId}`).expect(204);
    });

    it('returns 404 for an unknown id', async () => {
      await request(server).delete('/items/999999').expect(404);
    });
  });
});
