import { type INestApplication } from '@nestjs/common';
import { type DataSource } from 'typeorm';
import { runSeed } from '../../src/database/seeds/seed';
import { SEED_GROUPS, SEED_ITEMS, SEED_MOVEMENTS } from '../../src/database/seeds/seed-data';
import { Group } from '../../src/modules/groups/entities/group.entity';
import { Item } from '../../src/modules/items/entities/item.entity';
import { Movement, MovementType } from '../../src/modules/movements/entities/movement.entity';
import { MovementsRepository } from '../../src/modules/movements/movements.repository';
import { createTestApp, resetDatabase } from '../setup/test-app.factory';

describe('Seed (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let movementsRepository: MovementsRepository;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
    movementsRepository = app.get(MovementsRepository);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  afterAll(async () => {
    await resetDatabase(dataSource);
    await app.close();
  });

  it('populates the documented dataset', async () => {
    const result = await runSeed(dataSource);

    expect(result.skipped).toBe(false);
    expect(await dataSource.getRepository(Group).count()).toBe(SEED_GROUPS.length);
    expect(await dataSource.getRepository(Item).count()).toBe(SEED_ITEMS.length);
    expect(await dataSource.getRepository(Movement).count()).toBe(SEED_MOVEMENTS.length);
  });

  /**
   * The property that makes the demo data trustworthy: stock is not written by
   * hand anywhere, it is produced by applying the movements. If the two ever
   * disagreed, the whole dataset would be lying about the system's core rule.
   */
  it('leaves every item’s stock exactly equal to the net of its ledger', async () => {
    await runSeed(dataSource);

    const items = await dataSource.getRepository(Item).find();
    expect(items).toHaveLength(SEED_ITEMS.length);

    for (const item of items) {
      const netFromLedger = await movementsRepository.netQuantityForItem(item.id);
      expect({ sku: item.sku, stock: item.quantity }).toEqual({
        sku: item.sku,
        stock: netFromLedger,
      });
    }
  });

  it('keeps every resulting_stock value consistent with the running total', async () => {
    await runSeed(dataSource);

    const items = await dataSource.getRepository(Item).find();

    for (const item of items) {
      const movements = await dataSource
        .getRepository(Movement)
        .find({ where: { itemId: item.id }, order: { id: 'ASC' } });

      let running = 0;
      for (const movement of movements) {
        running =
          movement.type === MovementType.IN
            ? running + movement.quantity
            : running - movement.quantity;
        expect(movement.resultingStock).toBe(running);
        expect(running).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('produces the scenarios the demo needs: low stock and out of stock', async () => {
    await runSeed(dataSource);

    const items = await dataSource.getRepository(Item).find();
    const lowStock = items.filter((item) => item.quantity <= item.minimumStock);
    const outOfStock = items.filter((item) => item.quantity === 0);
    const healthy = items.filter((item) => item.quantity > item.minimumStock);

    expect(lowStock.length).toBeGreaterThan(0);
    expect(outOfStock.length).toBeGreaterThan(0);
    expect(healthy.length).toBeGreaterThan(0);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await runSeed(dataSource);
    const second = await runSeed(dataSource);

    expect(second.skipped).toBe(true);
    expect(await dataSource.getRepository(Group).count()).toBe(SEED_GROUPS.length);
    expect(await dataSource.getRepository(Item).count()).toBe(SEED_ITEMS.length);
  });

  it('replaces the dataset when forced, resetting identity sequences', async () => {
    await runSeed(dataSource);
    const forced = await runSeed(dataSource, { force: true });

    expect(forced.skipped).toBe(false);
    expect(await dataSource.getRepository(Group).count()).toBe(SEED_GROUPS.length);

    // Ids restart at 1, which is what keeps the documented example requests valid.
    const firstGroup = await dataSource
      .getRepository(Group)
      .findOne({ where: {}, order: { id: 'ASC' } });
    expect(firstGroup?.id).toBe(1);
  });

  it('is deterministic: two forced runs produce identical stock levels', async () => {
    await runSeed(dataSource);
    const first = await dataSource
      .getRepository(Item)
      .find({ order: { sku: 'ASC' }, select: { sku: true, quantity: true } });

    await runSeed(dataSource, { force: true });
    const second = await dataSource
      .getRepository(Item)
      .find({ order: { sku: 'ASC' }, select: { sku: true, quantity: true } });

    expect(second).toEqual(first);
  });

  it('assigns every item to one of the seeded groups', async () => {
    await runSeed(dataSource);

    const groups = await dataSource.getRepository(Group).find({ relations: { items: true } });
    const totalAssigned = groups.reduce((sum, group) => sum + (group.items?.length ?? 0), 0);

    expect(totalAssigned).toBe(SEED_ITEMS.length);
    expect(groups.every((group) => (group.items?.length ?? 0) > 0)).toBe(true);
  });
});
