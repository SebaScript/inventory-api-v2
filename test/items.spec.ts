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

  it('creates an item with an uppercased SKU and logs opening stock as an IN movement', async () => {
    const plain = await create({ name: 'USB Cable', sku: ' c1 ' }).expect(201);
    expect(plain.body).toMatchObject({ sku: 'C1', quantity: 0, unitPrice: 0, status: 'ACTIVE' });

    await create({ name: 'USB Hub', sku: 'H1', quantity: 40, unitPrice: 19.99 }).expect(201);

    const ledger = await api.get('/movements').expect(200);
    expect(ledger.body.meta.total).toBe(1);
    expect(ledger.body.data[0]).toMatchObject({ type: 'IN', quantity: 40, resultingStock: 40 });
  });

  it('rejects a duplicate SKU, an unknown group and an invalid body', async () => {
    await create({ name: 'Cable', sku: 'DUP' }).expect(201);
    expect((await create({ name: 'Other', sku: 'dup' }).expect(409)).body.code).toBe('SKU_TAKEN');

    const orphan = await api
      .post('/items')
      .send({ groupId: 999, name: 'Orphan', sku: 'S1' })
      .expect(404);
    expect(orphan.body.code).toBe('GROUP_NOT_FOUND');

    await create({ name: 'A', sku: 'S1' }).expect(400);
    await create({ name: 'Valid', sku: 'S1', unitPrice: 1.234 }).expect(400);
  });

  it('lists items with their group and filters by search, group and low stock', async () => {
    await create({ name: 'USB Cable', sku: 'C1', quantity: 100, minimumStock: 20 }).expect(201);
    await create({ name: 'USB Hub', sku: 'H1', quantity: 5, minimumStock: 10 }).expect(201);
    await api.post('/items').send({ groupId: 2, name: 'Paper', sku: 'P1' }).expect(201);

    const all = await api.get('/items').expect(200);
    expect(all.body.data[0].group.name).toBe('Electronics');

    expect((await api.get('/items?groupId=2').expect(200)).body.meta.total).toBe(1);
    expect((await api.get('/items?search=usb').expect(200)).body.meta.total).toBe(2);

    const low = await api.get('/items?lowStock=true').expect(200);
    expect(low.body.data.map((i: { sku: string }) => i.sku)).toEqual(['H1', 'P1']);
  });

  it('searches with the real QUERY verb, using a body a query string could not carry', async () => {
    await create({ name: 'USB Cable', sku: 'C1', unitPrice: 12.5 }).expect(201);
    await create({ name: 'USB Hub', sku: 'H1', unitPrice: 45 }).expect(201);
    await api.post('/items').send({ groupId: 2, name: 'Paper', sku: 'P1', unitPrice: 5.75 });

    expect((await query(app, '/items/search').send({}).expect(200)).body.meta.total).toBe(3);

    const filtered = await query(app, '/items/search')
      .send({ text: 'usb', groupIds: [1, 2], minPrice: 10, maxPrice: 50 })
      .expect(200);
    expect(filtered.body.data.map((i: { sku: string }) => i.sku)).toEqual(['C1', 'H1']);

    await query(app, '/items/search').send({ nope: true }).expect(400);
  });

  it('exposes POST /items/search as an identical alias, for clients without QUERY', async () => {
    await create({ name: 'USB Cable', sku: 'C1' }).expect(201);

    const body = { text: 'usb' };
    const viaQuery = await query(app, '/items/search').send(body).expect(200);
    const viaPost = await api.post('/items/search').send(body).expect(200);
    expect(viaPost.body).toEqual(viaQuery.body);
  });

  it('PATCH changes only what was sent, and never the stock', async () => {
    await create({ name: 'Cable', sku: 'C1', quantity: 50, minimumStock: 5 }).expect(201);

    const patched = await api.patch('/items/1').send({ name: 'New', unitPrice: 9.5 }).expect(200);
    expect(patched.body).toMatchObject({
      name: 'New',
      unitPrice: 9.5,
      minimumStock: 5,
      quantity: 50,
    });

    // Stock belongs to the ledger, so the field is not on the DTO at all.
    const rejected = await api.patch('/items/1').send({ quantity: 999 }).expect(400);
    expect(JSON.stringify(rejected.body.message)).toContain('quantity');

    // A field that is sent is validated as strictly as it is on creation.
    await api.patch('/items/1').send({ groupId: 999 }).expect(404);
    await create({ name: 'Other', sku: 'C2' }).expect(201);
    await api.patch('/items/2').send({ sku: 'c1' }).expect(409);
  });

  it('discontinues on DELETE, keeping the item and its whole history', async () => {
    await create({ name: 'Cable', sku: 'C1', quantity: 50 }).expect(201);
    await api.post('/movements').send({ itemId: 1, type: 'OUT', quantity: 10 }).expect(201);

    await api.delete('/items/1').expect(204);

    const item = await api.get('/items/1').expect(200);
    expect(item.body).toMatchObject({ status: 'DISCONTINUED', quantity: 40 });
    expect((await api.get('/movements?itemId=1').expect(200)).body.meta.total).toBe(2);

    // Gone from listings and from search, but still reachable on purpose.
    expect((await api.get('/items').expect(200)).body.meta.total).toBe(0);
    expect((await api.get('/items?status=ALL').expect(200)).body.meta.total).toBe(1);
    expect((await query(app, '/items/search').send({}).expect(200)).body.meta.total).toBe(0);
  });

  it('keeps a discontinued SKU reserved, refuses movements, and can bring it back', async () => {
    await create({ name: 'Cable', sku: 'C1', quantity: 50 }).expect(201);
    await api.delete('/items/1').expect(204);

    const move = await api
      .post('/movements')
      .send({ itemId: 1, type: 'IN', quantity: 5 })
      .expect(409);
    expect(move.body.code).toBe('ITEM_DISCONTINUED');

    await create({ name: 'Reused', sku: 'C1' }).expect(409);

    await api.patch('/items/1').send({ status: 'ACTIVE' }).expect(200);
    await api.post('/movements').send({ itemId: 1, type: 'IN', quantity: 5 }).expect(201);
  });

  it('returns 404 for an unknown item on every route', async () => {
    await api.get('/items/999').expect(404);
    await api.patch('/items/999').send({ name: 'Nope' }).expect(404);
    await api.delete('/items/999').expect(404);
  });
});
