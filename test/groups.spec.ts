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

  describe('POST /groups', () => {
    it('creates a group, trimming whitespace', async () => {
      const res = await create({ name: '  Electronics  ', description: 'Gadgets' }).expect(201);
      expect(res.body).toMatchObject({ id: 1, name: 'Electronics', description: 'Gadgets' });
    });

    it('defaults description to null', async () => {
      const res = await create({ name: 'Tools' }).expect(201);
      expect(res.body.description).toBeNull();
    });

    it('rejects a duplicate name regardless of case', async () => {
      await create({ name: 'Electronics' }).expect(201);
      const res = await create({ name: 'ELECTRONICS' }).expect(409);
      expect(res.body.code).toBe('GROUP_NAME_TAKEN');
    });

    it.each([[{}], [{ name: 'A' }], [{ name: 'x'.repeat(81) }], [{ name: 'Ok', extra: 1 }]])(
      'rejects invalid body %j',
      async (body) => {
        const res = await create(body).expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('GET /groups', () => {
    beforeEach(async () => {
      for (const name of ['Alpha', 'Beta', 'Gamma']) await create({ name }).expect(201);
    });

    it('returns a paginated envelope and paginates', async () => {
      const all = await api.get('/groups').expect(200);
      expect(all.body.data).toHaveLength(3);
      expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 3, pages: 1 });

      const page2 = await api.get('/groups?page=2&limit=2').expect(200);
      expect(page2.body.data).toHaveLength(1);
    });

    it('searches by name, case-insensitively', async () => {
      expect((await api.get('/groups?search=alp').expect(200)).body.meta.total).toBe(1);
    });

    it('caps the page size so the whole table cannot be requested', async () => {
      await api.get('/groups?limit=101').expect(400);
    });
  });

  describe('GET /groups/:id', () => {
    it('returns the group, 404 for unknown, 400 for a non-numeric id', async () => {
      await create({ name: 'Electronics' }).expect(201);
      await api.get('/groups/1').expect(200);

      const missing = await api.get('/groups/999').expect(404);
      expect(missing.body.code).toBe('GROUP_NOT_FOUND');

      await api.get('/groups/abc').expect(400);
    });
  });

  describe('PUT vs PATCH', () => {
    beforeEach(() => create({ name: 'Electronics', description: 'Original' }).expect(201));

    it('PUT replaces, so an omitted description is cleared', async () => {
      const res = await api.put('/groups/1').send({ name: 'Renamed' }).expect(200);
      expect(res.body).toMatchObject({ name: 'Renamed', description: null });
    });

    it('PATCH merges, so an omitted description is kept', async () => {
      const res = await api.patch('/groups/1').send({ name: 'Renamed' }).expect(200);
      expect(res.body).toMatchObject({ name: 'Renamed', description: 'Original' });
    });

    it('allows keeping the same name but rejects taking another one', async () => {
      await api.put('/groups/1').send({ name: 'Electronics' }).expect(200);

      await create({ name: 'Tools' }).expect(201);
      await api.patch('/groups/1').send({ name: 'tools' }).expect(409);
    });

    it('returns 404 when the group does not exist', async () => {
      await api.patch('/groups/999').send({ name: 'Nope' }).expect(404);
      await api.put('/groups/999').send({ name: 'Nope' }).expect(404);
    });
  });

  describe('DELETE /groups/:id', () => {
    it('deletes an empty group', async () => {
      await create({ name: 'Electronics' }).expect(201);
      await api.delete('/groups/1').expect(204);
      await api.get('/groups/1').expect(404);
    });

    it('refuses while the group still has items, so inventory is never lost', async () => {
      await create({ name: 'Electronics' }).expect(201);
      await api.post('/items').send({ groupId: 1, name: 'Cable', sku: 'C1' }).expect(201);

      const res = await api.delete('/groups/1').expect(409);
      expect(res.body.code).toBe('GROUP_NOT_EMPTY');
      await api.get('/groups/1').expect(200);
    });

    it('still refuses when its items are only discontinued, since their history remains', async () => {
      await create({ name: 'Electronics' }).expect(201);
      await api.post('/items').send({ groupId: 1, name: 'Cable', sku: 'C1' }).expect(201);
      await api.delete('/items/1').expect(204);

      await api.delete('/groups/1').expect(409);
    });

    it('returns 404 for an unknown id', async () => {
      await api.delete('/groups/999').expect(404);
    });
  });
});
