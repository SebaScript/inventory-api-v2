import { type INestApplication } from '@nestjs/common';
import { type DataSource } from 'typeorm';
import { InsufficientStockError } from '../../src/common/errors/domain.errors';
import { Group } from '../../src/modules/groups/entities/group.entity';
import { Item } from '../../src/modules/items/entities/item.entity';
import { ItemsService } from '../../src/modules/items/items.service';
import { Movement, MovementType } from '../../src/modules/movements/entities/movement.entity';
import { MovementsRepository } from '../../src/modules/movements/movements.repository';
import { MovementsService } from '../../src/modules/movements/movements.service';
import { createTestApp, resetDatabase } from '../setup/test-app.factory';

/**
 * Integration coverage for the transactional core, against real PostgreSQL.
 *
 * The unit tests pin down the decision logic with mocks. These tests verify the
 * things only a real database can prove: that the transaction genuinely rolls
 * back, that `SELECT ... FOR UPDATE` actually serialises concurrent writers, and
 * that the CHECK constraints hold when the service layer is bypassed entirely.
 */
describe('Inventory transaction (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let movementsService: MovementsService;
  let movementsRepository: MovementsRepository;
  let itemsService: ItemsService;

  const createItem = async (quantity: number, sku = 'TX-1'): Promise<Item> => {
    const group = await dataSource.getRepository(Group).save({ name: `G-${sku}` });
    return itemsService.create({ groupId: group.id, name: `Item ${sku}`, sku, quantity });
  };

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
    movementsService = app.get(MovementsService);
    movementsRepository = app.get(MovementsRepository);
    itemsService = app.get(ItemsService);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  afterAll(async () => {
    await resetDatabase(dataSource);
    await app.close();
  });

  describe('atomicity', () => {
    it('commits the ledger entry and the new stock together', async () => {
      const item = await createItem(50);

      await movementsService.create({ itemId: item.id, type: MovementType.OUT, quantity: 20 });

      const stored = await dataSource.getRepository(Item).findOneByOrFail({ id: item.id });
      const movements = await dataSource
        .getRepository(Movement)
        .find({ where: { itemId: item.id }, order: { id: 'ASC' } });

      expect(stored.quantity).toBe(30);
      // Opening movement plus the OUT.
      expect(movements).toHaveLength(2);
      expect(movements[1]).toMatchObject({ type: MovementType.OUT, resultingStock: 30 });
    });

    it('rolls back completely when stock is insufficient', async () => {
      const item = await createItem(5);
      const movementsBefore = await movementsRepository.countByItem(item.id);

      await expect(
        movementsService.create({ itemId: item.id, type: MovementType.OUT, quantity: 10 }),
      ).rejects.toBeInstanceOf(InsufficientStockError);

      const stored = await dataSource.getRepository(Item).findOneByOrFail({ id: item.id });
      const movementsAfter = await movementsRepository.countByItem(item.id);

      // Neither side effect survived: this is the requirement that a failed
      // movement leaves absolutely no trace.
      expect(stored.quantity).toBe(5);
      expect(movementsAfter).toBe(movementsBefore);
    });

    it('writes nothing when the item does not exist', async () => {
      await expect(
        movementsService.create({ itemId: 999_999, type: MovementType.IN, quantity: 1 }),
      ).rejects.toThrow();

      expect(await dataSource.getRepository(Movement).count()).toBe(0);
    });
  });

  describe('concurrency', () => {
    /**
     * The test that justifies the row lock.
     *
     * Two OUT movements of 60 are issued simultaneously against stock of 100.
     * Only one can succeed. Without `SELECT ... FOR UPDATE` both transactions
     * would read 100, both would conclude 40 remains, and both would commit —
     * leaving stock at 40 while 120 units left the warehouse.
     */
    it('serialises concurrent OUT movements so the item cannot be oversold', async () => {
      const item = await createItem(100, 'RACE-1');

      const results = await Promise.allSettled([
        movementsService.create({ itemId: item.id, type: MovementType.OUT, quantity: 60 }),
        movementsService.create({ itemId: item.id, type: MovementType.OUT, quantity: 60 }),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(InsufficientStockError);

      const stored = await dataSource.getRepository(Item).findOneByOrFail({ id: item.id });
      expect(stored.quantity).toBe(40);
    });

    it('keeps stock consistent under many interleaved movements', async () => {
      const item = await createItem(100, 'RACE-2');

      // 10 concurrent OUTs of 5 and 10 concurrent INs of 3.
      await Promise.all([
        ...Array.from({ length: 10 }, () =>
          movementsService.create({ itemId: item.id, type: MovementType.OUT, quantity: 5 }),
        ),
        ...Array.from({ length: 10 }, () =>
          movementsService.create({ itemId: item.id, type: MovementType.IN, quantity: 3 }),
        ),
      ]);

      const stored = await dataSource.getRepository(Item).findOneByOrFail({ id: item.id });
      const netFromLedger = await movementsRepository.netQuantityForItem(item.id);

      // 100 - 50 + 30 = 80, and the ledger must agree with the cached value.
      expect(stored.quantity).toBe(80);
      expect(netFromLedger).toBe(80);
    });
  });

  describe('the central invariant', () => {
    it('keeps item.quantity equal to the net of its ledger after mixed activity', async () => {
      const item = await createItem(0, 'INV-1');

      for (const movement of [
        { type: MovementType.IN, quantity: 100 },
        { type: MovementType.OUT, quantity: 30 },
        { type: MovementType.IN, quantity: 15 },
        { type: MovementType.OUT, quantity: 45 },
      ]) {
        await movementsService.create({ itemId: item.id, ...movement });
      }

      const stored = await dataSource.getRepository(Item).findOneByOrFail({ id: item.id });
      expect(stored.quantity).toBe(40);
      expect(await movementsRepository.netQuantityForItem(item.id)).toBe(40);
    });

    it('records an opening IN movement so stock created with an item is explained', async () => {
      const item = await createItem(40, 'OPEN-1');

      const movements = await dataSource.getRepository(Movement).findBy({ itemId: item.id });

      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: MovementType.IN,
        quantity: 40,
        resultingStock: 40,
      });
      expect(await movementsRepository.netQuantityForItem(item.id)).toBe(40);
    });

    it('creates no movement for an item opened with zero stock', async () => {
      const item = await createItem(0, 'OPEN-0');
      expect(await movementsRepository.countByItem(item.id)).toBe(0);
    });
  });

  describe('database-level defence', () => {
    /**
     * Bypasses the service entirely and writes raw SQL.
     *
     * If the application layer were the only thing preventing negative stock, a
     * bug or a manual UPDATE could corrupt the inventory. The CHECK constraint
     * is what makes that impossible.
     */
    it('rejects negative stock even when the service layer is bypassed', async () => {
      const item = await createItem(10, 'CHK-1');

      await expect(
        dataSource.query('UPDATE items SET quantity = -1 WHERE id = $1', [item.id]),
      ).rejects.toMatchObject({ constraint: 'chk_items_quantity' });
    });

    it('rejects a movement with non-positive quantity written directly', async () => {
      const item = await createItem(10, 'CHK-2');

      await expect(
        dataSource.query(
          `INSERT INTO movements (item_id, type, quantity, resulting_stock)
           VALUES ($1, 'OUT', 0, 10)`,
          [item.id],
        ),
      ).rejects.toMatchObject({ constraint: 'chk_movements_quantity' });
    });

    it('rejects a ledger entry claiming negative resulting stock', async () => {
      const item = await createItem(10, 'CHK-3');

      await expect(
        dataSource.query(
          `INSERT INTO movements (item_id, type, quantity, resulting_stock)
           VALUES ($1, 'OUT', 5, -5)`,
          [item.id],
        ),
      ).rejects.toMatchObject({ constraint: 'chk_movements_resulting_stock' });
    });
  });
});
