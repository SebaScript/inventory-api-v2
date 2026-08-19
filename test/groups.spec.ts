import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp, reset } from './app.factory';

describe('Groups', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(() => reset(dataSource));
  afterAll(() => app.close());

  const create = (body: object) => api.post('/groups').send(body);

  it('creates a group, trimming the name, and rejects a duplicate in any case', async () => {
    const created = await create({ name: '  Electronics  ', description: 'Gadgets' }).expect(201);
    expect(created.body).toMatchObject({ id: 1, name: 'Electronics', description: 'Gadgets' });

    const clash = await create({ name: 'ELECTRONICS' }).expect(409);
    expect(clash.body.code).toBe('GROUP_NAME_TAKEN');
  });

  it('rejects an invalid or unknown field with a 400', async () => {
    await create({}).expect(400);
    await create({ name: 'A' }).expect(400);
    const res = await create({ name: 'Valid', extra: 1 }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('lists groups paginated, searches by name and caps the page size', async () => {
    for (const name of ['Alpha', 'Beta', 'Gamma']) await create({ name }).expect(201);

    const all = await api.get('/groups').expect(200);
    expect(all.body.data).toHaveLength(3);
    expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 3, pages: 1 });

    expect((await api.get('/groups?page=2&limit=2').expect(200)).body.data).toHaveLength(1);
    expect((await api.get('/groups?search=alp').expect(200)).body.meta.total).toBe(1);
    await api.get('/groups?limit=101').expect(400);
  });

  it('PATCH changes only the fields that were sent', async () => {
    await create({ name: 'Electronics', description: 'Original' }).expect(201);

    const renamed = await api.patch('/groups/1').send({ name: 'Renamed' }).expect(200);
    expect(renamed.body).toMatchObject({ name: 'Renamed', description: 'Original' });

    // Omitting the name leaves it alone rather than clearing it.
    const described = await api.patch('/groups/1').send({ description: 'Only this' }).expect(200);
    expect(described.body).toMatchObject({ name: 'Renamed', description: 'Only this' });

    // Renaming onto another group's name is still a conflict.
    await create({ name: 'Tools' }).expect(201);
    await api.patch('/groups/1').send({ name: 'tools' }).expect(409);
  });

  it('deletes an empty group but refuses one that still has items', async () => {
    await create({ name: 'Electronics' }).expect(201);
    await api.post('/items').send({ groupId: 1, name: 'Cable', sku: 'C1' }).expect(201);

    const blocked = await api.delete('/groups/1').expect(409);
    expect(blocked.body.code).toBe('GROUP_NOT_EMPTY');

    await create({ name: 'Empty' }).expect(201);
    await api.delete('/groups/2').expect(204);
    await api.get('/groups/2').expect(404);
  });

  it('returns 404 for an unknown group and 400 for a non-numeric id', async () => {
    const res = await api.get('/groups/999').expect(404);
    expect(res.body.code).toBe('GROUP_NOT_FOUND');

    await api.patch('/groups/999').send({ name: 'Nope' }).expect(404);
    await api.delete('/groups/999').expect(404);
    await api.get('/groups/abc').expect(400);
  });
});
