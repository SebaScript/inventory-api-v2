import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type DataSource } from 'typeorm';
import { queryRequest } from '../setup/http-query';
import { type TestApp, createTestApp, resetDatabase } from '../setup/test-app.factory';

/**
 * End-to-end coverage for the HTTP QUERY endpoint.
 *
 * These tests drive the **real verb** over a real socket. `supertest` derives
 * its method list from `http.METHODS`, which includes `QUERY` on Node 22+, so
 * `queryRequest(server, path)` issues a genuine `QUERY /items/search` request —
 * not a POST in disguise.
 */
describe('QUERY /items/search (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: TestApp['server'];

  const seedCatalogue = async (): Promise<void> => {
    const electronics = await request(server)
      .post('/groups')
      .send({ name: 'Electronics' })
      .expect(201);
    const office = await request(server)
      .post('/groups')
      .send({ name: 'Office Supplies' })
      .expect(201);
    const tools = await request(server).post('/groups').send({ name: 'Tools' }).expect(201);

    const catalogue = [
      {
        groupId: electronics.body.id,
        name: 'USB-C Cable',
        sku: 'USB-C-1',
        quantity: 100,
        minimumStock: 20,
        unitPrice: 12.5,
      },
      {
        groupId: electronics.body.id,
        name: 'USB Hub',
        sku: 'USB-HUB-1',
        quantity: 5,
        minimumStock: 10,
        unitPrice: 45.0,
      },
      {
        groupId: electronics.body.id,
        name: 'Wireless Mouse',
        sku: 'MOUSE-1',
        quantity: 60,
        minimumStock: 15,
        unitPrice: 24.99,
      },
      {
        groupId: office.body.id,
        name: 'A4 Paper',
        sku: 'PAPER-A4',
        quantity: 300,
        minimumStock: 50,
        unitPrice: 5.75,
      },
      {
        groupId: office.body.id,
        name: 'USB Memory Stick',
        sku: 'OFFI-USB-32',
        quantity: 12,
        minimumStock: 30,
        unitPrice: 8.0,
      },
      {
        groupId: tools.body.id,
        name: 'Pallet Truck',
        sku: 'PALLET-1',
        quantity: 4,
        minimumStock: 2,
        unitPrice: 349.0,
      },
    ];

    for (const item of catalogue) {
      await request(server).post('/items').send(item).expect(201);
    }
  };

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
    server = testApp.server;
    await resetDatabase(dataSource);
    await seedCatalogue();
  });

  afterAll(async () => {
    await resetDatabase(dataSource);
    await app.close();
  });

  it('accepts the QUERY verb and returns a paginated envelope', async () => {
    const response = await queryRequest(server, '/items/search').send({}).expect(200);

    expect(response.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 6 });
    expect(response.body.data).toHaveLength(6);
  });

  it('filters by free text across name and SKU', async () => {
    const response = await queryRequest(server, '/items/search').send({ text: 'usb' }).expect(200);

    const names = response.body.data.map((item: { name: string }) => item.name).sort();
    // Matches "USB-C Cable" and "USB Hub" by name, "USB Memory Stick" by both.
    expect(names).toEqual(['USB Hub', 'USB Memory Stick', 'USB-C Cable']);
  });

  it('filters by several groups at once — the case a query string handles badly', async () => {
    const groups = await request(server).get('/groups?sortBy=name').expect(200);
    const ids = groups.body.data
      .filter((group: { name: string }) => group.name !== 'Tools')
      .map((group: { id: number }) => group.id);

    const response = await queryRequest(server, '/items/search')
      .send({ groupIds: ids })
      .expect(200);

    expect(response.body.meta.total).toBe(5);
    expect(
      response.body.data.every((item: { groupId: number }) => ids.includes(item.groupId)),
    ).toBe(true);
  });

  it('applies an inclusive price range', async () => {
    const response = await queryRequest(server, '/items/search')
      .send({ price: { min: 8, max: 45 } })
      .expect(200);

    const prices = response.body.data.map((item: { unitPrice: number }) => item.unitPrice);
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((price: number) => price >= 8 && price <= 45)).toBe(true);
    // 5.75 and 349.00 fall outside the range.
    expect(prices).not.toContain(5.75);
    expect(prices).not.toContain(349);
  });

  it('applies an inclusive stock range', async () => {
    const response = await queryRequest(server, '/items/search')
      .send({ stock: { min: 0, max: 12 } })
      .expect(200);

    const quantities = response.body.data.map((item: { quantity: number }) => item.quantity);
    expect(quantities.every((quantity: number) => quantity <= 12)).toBe(true);
    expect(quantities).toContain(5);
    expect(quantities).toContain(4);
  });

  it('restricts to low-stock items', async () => {
    const response = await queryRequest(server, '/items/search')
      .send({ lowStockOnly: true })
      .expect(200);

    const skus = response.body.data.map((item: { sku: string }) => item.sku).sort();
    // USB-HUB-1 (5 <= 10) and OFFI-USB-32 (12 <= 30).
    expect(skus).toEqual(['OFFI-USB-32', 'USB-HUB-1']);
  });

  it('honours multi-field ordering, applied left to right', async () => {
    const response = await queryRequest(server, '/items/search')
      .send({ sort: [{ field: 'quantity', order: 'desc' }] })
      .expect(200);

    const quantities = response.body.data.map((item: { quantity: number }) => item.quantity);
    expect(quantities).toEqual([...quantities].sort((a, b) => b - a));
    expect(quantities[0]).toBe(300);
  });

  it('combines every filter in a single request', async () => {
    const response = await queryRequest(server, '/items/search')
      .send({
        text: 'usb',
        price: { min: 5, max: 50 },
        stock: { min: 0, max: 200 },
        lowStockOnly: false,
        sort: [
          { field: 'unitPrice', order: 'asc' },
          { field: 'name', order: 'asc' },
        ],
        page: 1,
        pageSize: 2,
      })
      .expect(200);

    expect(response.body.meta).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(response.body.data).toHaveLength(2);
    const prices = response.body.data.map((item: { unitPrice: number }) => item.unitPrice);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('paginates and caps pageSize at 100', async () => {
    await queryRequest(server, '/items/search').send({ pageSize: 101 }).expect(400);

    const page2 = await queryRequest(server, '/items/search')
      .send({ page: 2, pageSize: 4 })
      .expect(200);

    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.meta).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
  });

  it('rejects an unknown sort field with a validation error', async () => {
    const response = await queryRequest(server, '/items/search')
      .send({ sort: [{ field: 'unitPrice; DROP TABLE items', order: 'asc' }] })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.body.details.validationErrors)).toContain('sort.field must be');
  });

  it('rejects unknown properties instead of silently ignoring them', async () => {
    const response = await queryRequest(server, '/items/search')
      .send({ notAField: true })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('exposes an identical POST alias for clients that cannot emit QUERY', async () => {
    const body = { text: 'usb', sort: [{ field: 'name', order: 'asc' }] };

    const viaQuery = await queryRequest(server, '/items/search').send(body).expect(200);
    const viaPost = await request(server).post('/items/search').send(body).expect(200);

    expect(viaPost.body).toEqual(viaQuery.body);
  });

  it('does not answer the search path with GET, which would imply a different contract', async () => {
    await request(server).get('/items/search').expect(400);
  });
});
