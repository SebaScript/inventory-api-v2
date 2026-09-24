import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheRead, CacheService, ITEMS_NAMESPACE } from '../src/cache/cache.service';
import { FindItemsDto, StatusFilter } from '../src/items/item.dto';
import { ItemsService } from '../src/items/items.service';
import { itemsListKey } from '../src/items/items.v2.controller';
import { createApp, reset } from './app.factory';

const dto = (over: Partial<FindItemsDto> = {}): FindItemsDto =>
  ({ page: 1, limit: 20, ...over }) as FindItemsDto;

/** Not a Proxy: a proxy also answers `then` and silently hangs the suite. */
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
    // Through JSON, like the real client.
    this.store.set(`${namespace}:${key}`, { e: epoch, d: JSON.parse(JSON.stringify(value)) });
    return Promise.resolve();
  }

  bump(namespace: string): Promise<void> {
    this.epochs.set(namespace, (this.epochs.get(namespace) ?? 0) + 1);
    return Promise.resolve();
  }
}

describe('Cache keys', () => {
  it('treats an absent status and ACTIVE as the same query', () => {
    expect(itemsListKey(dto())).toBe(itemsListKey(dto({ status: StatusFilter.ACTIVE })));
    expect(itemsListKey(dto())).not.toBe(itemsListKey(dto({ status: StatusFilter.ALL })));
  });

  it('ignores the case of the search, because the query is ILIKE', () => {
    expect(itemsListKey(dto({ search: 'USB' }))).toBe(itemsListKey(dto({ search: 'usb' })));
  });

  it('separates every filter that changes the result', () => {
    const keys = [
      itemsListKey(dto()),
      itemsListKey(dto({ page: 2 })),
      itemsListKey(dto({ limit: 50 })),
      itemsListKey(dto({ groupId: 1 })),
      itemsListKey(dto({ lowStock: true })),
      itemsListKey(dto({ search: 'usb' })),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays short no matter how long the search is', () => {
    // `search` has no maximum length in the DTO, so the key has to be hashed.
    expect(itemsListKey(dto({ search: 'x'.repeat(10_000) })).length).toBeLessThan(40);
  });
});

describe('Cache service without a server', () => {
  it('is disabled and answers every call as a miss', async () => {
    const service = new CacheService();

    expect(service.enabled).toBe(false);
    expect(await service.read(ITEMS_NAMESPACE, 'k')).toEqual({ epoch: '0' });
    await expect(service.write(ITEMS_NAMESPACE, 'k', '0', { a: 1 }, 30)).resolves.toBeUndefined();
    await expect(service.bump(ITEMS_NAMESPACE)).resolves.toBeUndefined();
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });
});

describe('Cached v2 listing', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp(new FakeCache() as unknown as CacheService));
  });
  beforeEach(async () => {
    await reset(dataSource);
    await api.post('/groups').send({ name: 'Electronics' }).expect(201);
  });
  afterAll(() => app.close());

  it('serves a repeated listing without touching the database again', async () => {
    await api.post('/items').send({ groupId: 1, name: 'Cable', sku: 'C1' }).expect(201);

    const spy = jest.spyOn(ItemsService.prototype, 'findAll');
    const first = await api.get('/v2/items').expect(200);
    const second = await api.get('/v2/items').expect(200);

    expect(second.body).toEqual(first.body);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('invalidates on a write, including one made through the unversioned API', async () => {
    await api.get('/v2/items').expect(200);

    // The write goes through /items, and both versions share one service.
    await api.post('/items').send({ groupId: 1, name: 'Cable', sku: 'C1' }).expect(201);
    expect((await api.get('/v2/items').expect(200)).body.meta.total).toBe(1);

    await api.post('/movements').send({ itemId: 1, type: 'IN', quantity: 5 }).expect(201);
    expect((await api.get('/v2/items').expect(200)).body.data[0].quantity).toBe(5);

    // A rename matters because the cached item embeds its joined group.
    await api.patch('/groups/1').send({ name: 'Renamed' }).expect(200);
    expect((await api.get('/v2/items').expect(200)).body.data[0].group.name).toBe('Renamed');
  });
});
