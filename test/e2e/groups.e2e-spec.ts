import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type DataSource } from 'typeorm';
import { type TestApp, createTestApp, resetDatabase } from '../setup/test-app.factory';

describe('Groups CRUD (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: TestApp['server'];

  const createGroup = (body: Record<string, unknown>) => request(server).post('/groups').send(body);

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
    server = testApp.server;
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  afterAll(async () => {
    await resetDatabase(dataSource);
    await app.close();
  });

  describe('POST /groups', () => {
    it('creates a group and returns 201 with the full resource', async () => {
      const response = await createGroup({
        name: 'Electronics',
        description: 'Consumer electronics',
      }).expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(Number),
        name: 'Electronics',
        description: 'Consumer electronics',
      });
      expect(response.body.createdAt).toBeDefined();
    });

    it('defaults a missing description to null', async () => {
      const response = await createGroup({ name: 'Tools' }).expect(201);
      expect(response.body.description).toBeNull();
    });

    it('trims surrounding whitespace', async () => {
      const response = await createGroup({ name: '  Padded Name  ' }).expect(201);
      expect(response.body.name).toBe('Padded Name');
    });

    it('rejects a duplicate name case-insensitively with 409', async () => {
      await createGroup({ name: 'Electronics' }).expect(201);

      const response = await createGroup({ name: 'ELECTRONICS' }).expect(409);

      expect(response.body).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        code: 'GROUP_NAME_ALREADY_EXISTS',
      });
    });

    it.each([
      [{}, 'name'],
      [{ name: '' }, 'name'],
      [{ name: 'A' }, 'name'],
      [{ name: 'x'.repeat(81) }, 'name'],
      [{ name: 'Valid', description: 'x'.repeat(256) }, 'description'],
      [{ name: 123 }, 'name'],
    ])('rejects %j with 400', async (body, field) => {
      const response = await createGroup(body).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(response.body.details.validationErrors)).toContain(field);
    });

    it('rejects unknown properties rather than ignoring them', async () => {
      const response = await createGroup({ name: 'Valid', id: 99 }).expect(400);
      expect(JSON.stringify(response.body.details.validationErrors)).toContain('id');
    });
  });

  describe('GET /groups', () => {
    beforeEach(async () => {
      for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
        await createGroup({ name, description: `${name} description` }).expect(201);
      }
    });

    it('returns a paginated envelope', async () => {
      const response = await request(server).get('/groups').expect(200);

      expect(response.body.data).toHaveLength(4);
      expect(response.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 4, totalPages: 1 });
    });

    it('paginates', async () => {
      const response = await request(server).get('/groups?page=2&pageSize=2').expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toMatchObject({
        page: 2,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('sorts by a whitelisted field', async () => {
      const response = await request(server).get('/groups?sortBy=name&sortOrder=desc').expect(200);

      const names = response.body.data.map((group: { name: string }) => group.name);
      expect(names).toEqual(['Gamma', 'Delta', 'Beta', 'Alpha']);
    });

    it('searches name and description case-insensitively', async () => {
      const response = await request(server).get('/groups?search=alph').expect(200);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].name).toBe('Alpha');
    });

    it('rejects a sortBy outside the whitelist, closing the injection vector', async () => {
      const response = await request(server)
        .get('/groups?sortBy=name;DROP%20TABLE%20groups')
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a pageSize above the cap', async () => {
      await request(server).get('/groups?pageSize=101').expect(400);
    });
  });

  describe('GET /groups/:id', () => {
    it('returns the group', async () => {
      const created = await createGroup({ name: 'Electronics' }).expect(201);

      const response = await request(server).get(`/groups/${created.body.id}`).expect(200);
      expect(response.body.id).toBe(created.body.id);
    });

    it('returns 404 for an unknown id', async () => {
      const response = await request(server).get('/groups/999999').expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        code: 'GROUP_NOT_FOUND',
        details: { groupId: 999999 },
      });
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(server).get('/groups/not-a-number').expect(400);
    });
  });

  describe('PUT /groups/:id', () => {
    it('replaces the resource, clearing fields omitted from the payload', async () => {
      const created = await createGroup({
        name: 'Electronics',
        description: 'Original description',
      }).expect(201);

      const response = await request(server)
        .put(`/groups/${created.body.id}`)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(response.body).toMatchObject({ name: 'Renamed', description: null });
    });

    it('allows resubmitting the same name on the same record', async () => {
      const created = await createGroup({ name: 'Electronics' }).expect(201);

      await request(server)
        .put(`/groups/${created.body.id}`)
        .send({ name: 'Electronics', description: 'Updated' })
        .expect(200);
    });

    it('rejects renaming onto another group with 409', async () => {
      await createGroup({ name: 'Tools' }).expect(201);
      const created = await createGroup({ name: 'Electronics' }).expect(201);

      await request(server).put(`/groups/${created.body.id}`).send({ name: 'tools' }).expect(409);
    });

    it('returns 404 for an unknown id', async () => {
      await request(server).put('/groups/999999').send({ name: 'Nope' }).expect(404);
    });

    it('requires the mandatory fields, unlike PATCH', async () => {
      const created = await createGroup({ name: 'Electronics' }).expect(201);
      await request(server).put(`/groups/${created.body.id}`).send({}).expect(400);
    });
  });

  describe('PATCH /groups/:id', () => {
    it('updates only the supplied field', async () => {
      const created = await createGroup({
        name: 'Electronics',
        description: 'Original',
      }).expect(201);

      const response = await request(server)
        .patch(`/groups/${created.body.id}`)
        .send({ description: 'Updated' })
        .expect(200);

      // The name survives, which is the whole difference from PUT.
      expect(response.body).toMatchObject({ name: 'Electronics', description: 'Updated' });
    });

    it('accepts an empty payload as a no-op', async () => {
      const created = await createGroup({ name: 'Electronics' }).expect(201);

      const response = await request(server)
        .patch(`/groups/${created.body.id}`)
        .send({})
        .expect(200);

      expect(response.body.name).toBe('Electronics');
    });

    it('returns 404 for an unknown id', async () => {
      await request(server).patch('/groups/999999').send({ name: 'Nope' }).expect(404);
    });
  });

  describe('DELETE /groups/:id', () => {
    it('deletes an empty group and returns 204 with no body', async () => {
      const created = await createGroup({ name: 'Electronics' }).expect(201);

      const response = await request(server).delete(`/groups/${created.body.id}`).expect(204);

      expect(response.body).toEqual({});
      await request(server).get(`/groups/${created.body.id}`).expect(404);
    });

    it('refuses with 409 while the group still holds items', async () => {
      const group = await createGroup({ name: 'Electronics' }).expect(201);
      await request(server)
        .post('/items')
        .send({ groupId: group.body.id, name: 'Cable', sku: 'CBL-1' })
        .expect(201);

      const response = await request(server).delete(`/groups/${group.body.id}`).expect(409);

      expect(response.body.code).toBe('GROUP_NOT_EMPTY');
      // The group is still there: deleting a category must not destroy inventory.
      await request(server).get(`/groups/${group.body.id}`).expect(200);
    });

    it('returns 404 for an unknown id', async () => {
      await request(server).delete('/groups/999999').expect(404);
    });
  });

  describe('GET /groups/:groupId/items', () => {
    it('lists only the items of that group', async () => {
      const electronics = await createGroup({ name: 'Electronics' }).expect(201);
      const office = await createGroup({ name: 'Office' }).expect(201);

      await request(server)
        .post('/items')
        .send({ groupId: electronics.body.id, name: 'Cable', sku: 'CBL-1' })
        .expect(201);
      await request(server)
        .post('/items')
        .send({ groupId: office.body.id, name: 'Paper', sku: 'PPR-1' })
        .expect(201);

      const response = await request(server)
        .get(`/groups/${electronics.body.id}/items`)
        .expect(200);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].sku).toBe('CBL-1');
    });

    it('returns 404 for an unknown group rather than an empty page', async () => {
      await request(server).get('/groups/999999/items').expect(404);
    });
  });
});
