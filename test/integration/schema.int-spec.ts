import { type INestApplication } from '@nestjs/common';
import { type DataSource } from 'typeorm';
import { Group } from '../../src/modules/groups/entities/group.entity';
import { Item } from '../../src/modules/items/entities/item.entity';
import { Movement, MovementType } from '../../src/modules/movements/entities/movement.entity';
import { createTestApp, resetDatabase } from '../setup/test-app.factory';

/**
 * Verifies that the migration produced the schema the domain relies on.
 *
 * Every assertion here bypasses the service layer and talks to PostgreSQL
 * directly, because the point is that the database enforces these rules by
 * itself — the application is a second line of defence, not the only one.
 */
describe('Database schema (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const seedGroup = (name = 'Electronics'): Promise<Group> =>
    dataSource.getRepository(Group).save({ name });

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  afterAll(async () => {
    await resetDatabase(dataSource);
    await app.close();
  });

  describe('constraints', () => {
    it('enforces case-insensitive uniqueness of group names', async () => {
      await seedGroup('Electronics');

      await expect(
        dataSource.query(`INSERT INTO groups (name) VALUES ('electronics')`),
      ).rejects.toMatchObject({ constraint: 'ux_groups_name_lower' });
    });

    it('rejects a group name shorter than two characters', async () => {
      await expect(
        dataSource.query(`INSERT INTO groups (name) VALUES ('E')`),
      ).rejects.toMatchObject({ constraint: 'chk_groups_name_length' });
    });

    it('rejects a whitespace-only group name', async () => {
      await expect(
        dataSource.query(`INSERT INTO groups (name) VALUES ('     ')`),
      ).rejects.toMatchObject({ constraint: 'chk_groups_name_length' });
    });

    it('enforces SKU uniqueness', async () => {
      const group = await seedGroup();
      await dataSource
        .getRepository(Item)
        .save({ groupId: group.id, name: 'Item A', sku: 'DUP-1' });

      await expect(
        dataSource.query(`INSERT INTO items (group_id, name, sku) VALUES ($1, 'Item B', 'DUP-1')`, [
          group.id,
        ]),
      ).rejects.toMatchObject({ constraint: 'ux_items_sku' });
    });

    it.each([
      ['quantity', 'chk_items_quantity'],
      ['minimum_stock', 'chk_items_minimum_stock'],
      ['unit_price', 'chk_items_unit_price'],
    ])('rejects a negative %s', async (column, constraint) => {
      const group = await seedGroup(`G-${column}`);

      await expect(
        dataSource.query(
          `INSERT INTO items (group_id, name, sku, ${column}) VALUES ($1, 'Item X', 'SKU-${column}', -1)`,
          [group.id],
        ),
      ).rejects.toMatchObject({ constraint });
    });

    it('rejects an item referencing a non-existent group', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO items (group_id, name, sku) VALUES (999999, 'Item X', 'ORPHAN')`,
        ),
      ).rejects.toMatchObject({ constraint: 'fk_items_group' });
    });

    it('rejects a movement type outside the enum', async () => {
      const group = await seedGroup();
      const item = await dataSource
        .getRepository(Item)
        .save({ groupId: group.id, name: 'Item A', sku: 'ENUM-1' });

      await expect(
        dataSource.query(
          `INSERT INTO movements (item_id, type, quantity, resulting_stock)
           VALUES ($1, 'ADJUST', 1, 1)`,
          [item.id],
        ),
      ).rejects.toThrow(/invalid input value for enum/i);
    });
  });

  describe('referential integrity', () => {
    it('restricts deleting a group that still holds items', async () => {
      const group = await seedGroup();
      await dataSource
        .getRepository(Item)
        .save({ groupId: group.id, name: 'Item A', sku: 'REST-1' });

      await expect(
        dataSource.query(`DELETE FROM groups WHERE id = $1`, [group.id]),
      ).rejects.toMatchObject({ constraint: 'fk_items_group' });
    });

    it('allows deleting an empty group', async () => {
      const group = await seedGroup('Empty Group');
      await dataSource.query(`DELETE FROM groups WHERE id = $1`, [group.id]);

      expect(await dataSource.getRepository(Group).countBy({ id: group.id })).toBe(0);
    });

    it('cascades movement deletion when an item is removed', async () => {
      const group = await seedGroup();
      const item = await dataSource
        .getRepository(Item)
        .save({ groupId: group.id, name: 'Item A', sku: 'CASC-1', quantity: 10 });
      await dataSource.getRepository(Movement).save({
        itemId: item.id,
        type: MovementType.IN,
        quantity: 10,
        resultingStock: 10,
      });

      await dataSource.getRepository(Item).delete({ id: item.id });

      // Orphan ledger rows pointing at a deleted item would be worse than none.
      expect(await dataSource.getRepository(Movement).countBy({ itemId: item.id })).toBe(0);
    });

    it('loads the Group -> Item -> Movement relationship graph', async () => {
      const group = await seedGroup();
      const item = await dataSource
        .getRepository(Item)
        .save({ groupId: group.id, name: 'Cable', sku: 'REL-1', quantity: 5 });
      await dataSource
        .getRepository(Movement)
        .save({ itemId: item.id, type: MovementType.IN, quantity: 5, resultingStock: 5 });

      const loaded = await dataSource.getRepository(Group).findOne({
        where: { id: group.id },
        relations: { items: { movements: true } },
      });

      expect(loaded?.items).toHaveLength(1);
      expect(loaded?.items?.[0].movements).toHaveLength(1);
      expect(loaded?.items?.[0].movements?.[0].type).toBe(MovementType.IN);
    });
  });

  describe('indexes and column behaviour', () => {
    it('created every index the query layer depends on', async () => {
      const rows = await dataSource.query<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const names = rows.map((row) => row.indexname);

      expect(names).toEqual(
        expect.arrayContaining([
          'ux_groups_name_lower',
          'ux_items_sku',
          'idx_items_group_id',
          'idx_items_name_trgm',
          'idx_items_sku_trgm',
          'idx_items_low_stock',
          'idx_movements_item_id_created_at',
          'idx_movements_type',
        ]),
      );
    });

    it('installed the pg_trgm extension the search relies on', async () => {
      const rows = await dataSource.query<Array<{ extname: string }>>(
        `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('returns unit_price as a number, not the string the driver produces', async () => {
      const group = await seedGroup();
      const saved = await dataSource
        .getRepository(Item)
        .save({ groupId: group.id, name: 'Item A', sku: 'NUM-1', unitPrice: 19.99 });

      const loaded = await dataSource.getRepository(Item).findOneByOrFail({ id: saved.id });

      expect(typeof loaded.unitPrice).toBe('number');
      expect(loaded.unitPrice).toBe(19.99);
    });

    it('refreshes updated_at on write via the database trigger', async () => {
      const group = await seedGroup();
      const original = group.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 15));
      // Raw SQL, so the new timestamp can only come from the trigger.
      await dataSource.query(`UPDATE groups SET description = 'changed' WHERE id = $1`, [group.id]);

      const reloaded = await dataSource.getRepository(Group).findOneByOrFail({ id: group.id });
      expect(reloaded.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });
  });

  describe('migrations', () => {
    it('records the initial migration as applied', async () => {
      const rows = await dataSource.query<Array<{ name: string }>>(
        `SELECT name FROM typeorm_migrations ORDER BY id`,
      );
      expect(rows.map((row) => row.name)).toContain('InitSchema1755300000000');
    });

    it('created exactly the three domain tables and nothing more', async () => {
      const rows = await dataSource.query<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      const tables = rows.map((row) => row.table_name);

      expect(tables).toEqual(['groups', 'items', 'movements', 'typeorm_migrations']);
    });
  });
});
