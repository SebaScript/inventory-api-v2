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
    it('creates a group', async () => {
      const res = await create({ name: 'Electronics', description: 'Gadgets' }).expect(201);
      expect(res.body).toMatchObject({ id: 1, name: 'Electronics', description: 'Gadgets' });
    });

    it('trims whitespace and defaults description to null', async () => {
      const res = await create({ name: '  Tools  ' }).expect(201);
      expect(res.body).toMatchObject({ name: 'Tools', description: null });
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

    it('returns a paginated envelope', async () => {
      const res = await api.get('/groups').expect(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3, pages: 1 });
    });

    it('paginates', async () => {
      const res = await api.get('/groups?page=2&limit=2').expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.pages).toBe(2);
    });

    it('searches by name, case-insensitively', async () => {
      const res = await api.get('/groups?search=alp').expect(200);
      expect(res.body.meta.total).toBe(1);
    });

    it('caps the page size so the whole table cannot be requested', async () => {
      await api.get('/groups?limit=101').expect(400);
    });
  });

  describe('GET /groups/:id', () => {
    it('returns the group', async () => {
      await create({ name: 'Electronics' }).expect(201);
      await api.get('/groups/1').expect(200);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await api.get('/groups/999').expect(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
    });

    it('returns 400 for a non-numeric id', async () => {
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

    it('allows keeping the same name on the same record', async () => {
      await api.put('/groups/1').send({ name: 'Electronics' }).expect(200);
    });

    it('rejects renaming onto another group', async () => {
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

    it('returns 404 for an unknown id', async () => {
      await api.delete('/groups/999').expect(404);
    });
  });
});
