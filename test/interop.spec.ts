import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheRead, CacheService } from '../src/cache/cache.service';
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
/** Same shape as the real service, minus the network. Not a Proxy: a proxy that
 * answers every property also answers `then`, which hangs the suite silently. */
class FakeCache {
  private readonly store = new Map<string, { e: string; d: unknown }>();
  private readonly epochs = new Map<string, number>();

  enabled = true;

  read<T>(namespace: string, key: string): Promise<CacheRead<T>> {
    const epoch = String(this.epochs.get(namespace) ?? 0);
    const entry = this.store.get(`${namespace}:${key}`);

    if (entry && entry.e === epoch) return Promise.resolve({ value: entry.d as T, epoch });
    return Promise.resolve({ epoch });
  }

  write(namespace: string, key: string, epoch: string, value: unknown): Promise<void> {
    this.store.set(`${namespace}:${key}`, { e: epoch, d: JSON.parse(JSON.stringify(value)) });
    return Promise.resolve();
  }

  bump(namespace: string): Promise<void> {
    this.epochs.set(namespace, (this.epochs.get(namespace) ?? 0) + 1);
    return Promise.resolve();
  }
}

describe('Caching what the partner returns', () => {
  const realFetch = global.fetch;
  const record = {
    source: 'orders-api',
    kind: 'order',
    id: '7',
    label: 'Orden SO-0007',
    attributes: { status: 'RECEIVED' },
    retrievedAt: '2026-09-20T00:00:00.000Z',
  };

  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];
  let calls = 0;

  const answerWith = (status: number, body: unknown) => {
    global.fetch = ((): Promise<Response> => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
  };

  beforeAll(async () => {
    process.env.ORCHESTRATOR_URL = 'http://orchestrator.test';
    process.env.PARTNER_KEY = 'orders';
    ({ app, dataSource, api } = await createApp(new FakeCache() as unknown as CacheService));
  });

  afterAll(async () => {
    delete process.env.ORCHESTRATOR_URL;
    delete process.env.PARTNER_KEY;
    global.fetch = realFetch;
    await app.close();
  });

  beforeEach(async () => {
    await reset(dataSource);
    await api.post('/groups').send({ name: 'Electronics' }).expect(201);
    await api.post('/items').send({ groupId: 1, name: 'Cable', sku: 'C1' }).expect(201);
    await api.delete('/v2/interop/cache').expect(200);
    calls = 0;
    answerWith(200, record);
  });

  it('crosses the clouds once and serves the rest from the cache', async () => {
    const first = await api.get('/v2/items/1').expect(200);
    expect(first.body.partner).toEqual({ status: 'ok', record });

    await api.get('/v2/items/1').expect(200);
    await api.get('/v2/items/1').expect(200);

    expect(calls).toBe(1);
  });

  it('crosses them again once the cache is invalidated', async () => {
    await api.get('/v2/items/1').expect(200);
    expect((await api.delete('/v2/interop/cache').expect(200)).body).toEqual({ invalidated: true });
    await api.get('/v2/items/1').expect(200);

    expect(calls).toBe(2);
  });

  it('never caches a failure, so an outage does not outlive itself', async () => {
    answerWith(503, {});

    expect((await api.get('/v2/items/1').expect(200)).body.partner.status).toBe('unavailable');
    await api.get('/v2/items/1').expect(200);

    expect(calls).toBe(2);
  });
});
