import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp, reset } from './app.factory';

describe('Interop with the other cloud', () => {
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

  const addItem = (sku: string, name = 'Cable') =>
    api.post('/items').send({ groupId: 1, name, sku, quantity: 5 }).expect(201);

  describe('what the partner reads from us', () => {
    it('answers with the shape both clouds agreed on', async () => {
      await addItem('C1', 'USB Hub');

      const { body } = await api.get('/v2/interop/random').expect(200);

      expect(body).toMatchObject({
        source: 'inventory-api',
        kind: 'item',
        id: '1',
        label: 'USB Hub',
        attributes: { sku: 'C1', quantity: 5, group: 'Electronics' },
      });
      // A timestamp the other side can use to know how fresh this is.
      expect(new Date(body.retrievedAt).toISOString()).toBe(body.retrievedAt);
    });

    it('says so clearly when there is nothing to share', async () => {
      const { body } = await api.get('/v2/interop/random').expect(404);
      expect(body.code).toBe('NO_RECORDS');
    });

    it('never offers a discontinued item', async () => {
      await addItem('C1');
      await addItem('C2', 'Retired');
      await api.delete('/items/2').expect(204);

      // Ten draws: if discontinued items were reachable, this would catch it.
      for (let i = 0; i < 10; i += 1) {
        expect((await api.get('/v2/interop/random').expect(200)).body.id).toBe('1');
      }
    });

    it('does not always return the same record', async () => {
      for (const sku of ['SK-A', 'SK-B', 'SK-C', 'SK-D', 'SK-E']) await addItem(sku, `Item ${sku}`);

      const seen = new Set<string>();
      for (let i = 0; i < 25; i += 1) {
        seen.add((await api.get('/v2/interop/random').expect(200)).body.id);
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  describe('what we read from the partner', () => {
    it('reports the lookup as disabled when no orchestrator is configured', async () => {
      await addItem('C1');

      const { body } = await api.get('/v2/items/1').expect(200);
      // Disabled, not unavailable: nothing was even attempted.
      expect(body.partner).toEqual({ status: 'disabled', record: null });
      // And the local read is untouched.
      expect(body).toMatchObject({ sku: 'C1', quantity: 5 });
    });

    it('still 404s on an unknown item without calling the other cloud', async () => {
      await api.get('/v2/items/999').expect(404);
    });

    it('keeps the unversioned API out of it', async () => {
      await addItem('C1');
      expect((await api.get('/items/1').expect(200)).body).not.toHaveProperty('partner');
    });
  });

  it('documents both halves of the contract', async () => {
    const { body } = await api.get('/docs-json').expect(200);

    expect(body.paths['/v2/interop/random'].get.tags).toEqual(['Interop v2']);
    expect(body.paths['/v2/items/{id}'].get.summary).toContain('other cloud');
  });
});
