import { type DataSource, type EntityManager } from 'typeorm';
import { type Group } from '../../modules/groups/entities/group.entity';
import { Item } from '../../modules/items/entities/item.entity';
import { MovementType } from '../../modules/movements/entities/movement.entity';
import { runSeed } from './seed';
import { SEED_GROUPS, SEED_ITEMS, SEED_MOVEMENTS } from './seed-data';

/**
 * Guard rails around the demo data.
 *
 * The seed running successfully against a real database is covered in
 * `test/integration/seed.int-spec.ts`. What is verified here is the opposite:
 * that inconsistent seed data fails loudly instead of silently persisting an
 * inventory whose stock disagrees with its own ledger.
 */
describe('runSeed guards', () => {
  interface FakeManager {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    query: jest.Mock;
  }

  let manager: FakeManager;
  let dataSource: DataSource;
  let nextId: number;

  beforeEach(() => {
    nextId = 1;
    manager = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn((data: object) => Promise.resolve({ id: nextId++, ...data })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      query: jest.fn().mockResolvedValue(undefined),
    };

    dataSource = {
      transaction: (runInTransaction: (m: EntityManager) => Promise<unknown>) =>
        runInTransaction(manager as unknown as EntityManager),
    } as unknown as DataSource;
  });

  it('seeds the documented dataset when the database is empty', async () => {
    const result = await runSeed(dataSource);

    expect(result).toMatchObject({
      skipped: false,
      groups: SEED_GROUPS.length,
      items: SEED_ITEMS.length,
      movements: SEED_MOVEMENTS.length,
    });
  });

  it('skips silently when data already exists', async () => {
    manager.count.mockResolvedValue(3);

    const result = await runSeed(dataSource);

    expect(result.skipped).toBe(true);
    expect(result.message).toContain('already contains 3 group(s)');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('truncates before reseeding when forced', async () => {
    manager.count.mockResolvedValue(3);

    const result = await runSeed(dataSource, { force: true });

    expect(result.skipped).toBe(false);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('TRUNCATE TABLE'));
  });

  it('writes the final stock back to every item', async () => {
    await runSeed(dataSource);

    const itemUpdates = manager.update.mock.calls.filter((call) => call[0] === Item);
    expect(itemUpdates).toHaveLength(SEED_ITEMS.length);
    expect(itemUpdates.every((call) => typeof call[2].quantity === 'number')).toBe(true);
  });

  it('never records a movement leaving negative stock', async () => {
    await runSeed(dataSource);

    const movements = manager.create.mock.calls
      .map((call) => call[1] as { resultingStock?: number })
      .filter((data) => data.resultingStock !== undefined);

    expect(movements.length).toBe(SEED_MOVEMENTS.length);
    expect(movements.every((movement) => (movement.resultingStock ?? 0) >= 0)).toBe(true);
  });

  it('creates every item with zero stock, so the ledger explains all of it', async () => {
    await runSeed(dataSource);

    const items = manager.create.mock.calls
      .filter((call) => call[0] === Item)
      .map((call) => call[1] as { quantity: number });

    expect(items).toHaveLength(SEED_ITEMS.length);
    expect(items.every((item) => item.quantity === 0)).toBe(true);
  });

  describe('inconsistent data fails loudly', () => {
    it('rejects an item pointing at a group that was never seeded', async () => {
      // Simulate a group failing to come back from the database.
      manager.save.mockImplementation((data: object) =>
        Promise.resolve(
          'name' in data && SEED_GROUPS.some((g) => g.name === (data as Group).name)
            ? undefined
            : { id: nextId++, ...data },
        ),
      );

      await expect(runSeed(dataSource)).rejects.toThrow(/unknown group/);
    });

    it('rejects a movement whose SKU has no matching item', async () => {
      manager.save.mockImplementation((data: object) =>
        Promise.resolve('sku' in data ? undefined : { id: nextId++, ...data }),
      );

      await expect(runSeed(dataSource)).rejects.toThrow(/unknown SKU|unknown group/);
    });

    it('rejects seed data that would drive stock below zero', async () => {
      const original = SEED_MOVEMENTS.slice();
      // Prepend an OUT with no preceding IN, which is exactly the kind of
      // mistake this guard exists to catch.
      SEED_MOVEMENTS.unshift({
        sku: SEED_ITEMS[0].sku,
        type: MovementType.OUT,
        quantity: 1,
        reason: 'Deliberately inconsistent',
      });

      try {
        await expect(runSeed(dataSource)).rejects.toThrow(/Seed data is inconsistent/);
      } finally {
        SEED_MOVEMENTS.length = 0;
        SEED_MOVEMENTS.push(...original);
      }
    });
  });
});
