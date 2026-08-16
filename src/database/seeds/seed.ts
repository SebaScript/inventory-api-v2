import { type DataSource, type EntityManager } from 'typeorm';
import { Group } from '../../modules/groups/entities/group.entity';
import { Item } from '../../modules/items/entities/item.entity';
import { Movement, MovementType } from '../../modules/movements/entities/movement.entity';
import { SEED_GROUPS, SEED_ITEMS, SEED_MOVEMENTS } from './seed-data';

export interface SeedResult {
  skipped: boolean;
  groups: number;
  items: number;
  movements: number;
  message: string;
}

export interface SeedOptions {
  /** Wipes existing inventory data before seeding. */
  force?: boolean;
}

/**
 * Populates the database with a coherent demo dataset.
 *
 * Two properties make this seed trustworthy rather than decorative:
 *
 *  1. **Stock is computed, never hard-coded.** Items are created with zero
 *     stock and every movement is applied with the same arithmetic the API
 *     uses, updating the running total as it goes. The dataset therefore cannot
 *     drift out of agreement with its own ledger — the invariant
 *     `item.quantity === sum(IN) - sum(OUT)` holds by construction, and the
 *     integration suite asserts it.
 *
 *  2. **It is idempotent.** Running it twice does nothing the second time,
 *     so a container restart never duplicates demo data.
 *
 * The whole thing runs in one transaction: a partially seeded database is never
 * left behind.
 */
export const runSeed = async (
  dataSource: DataSource,
  options: SeedOptions = {},
): Promise<SeedResult> => {
  return dataSource.transaction(async (manager) => {
    const existingGroups = await manager.count(Group);

    if (existingGroups > 0 && !options.force) {
      return {
        skipped: true,
        groups: 0,
        items: 0,
        movements: 0,
        message: `Seed skipped: database already contains ${existingGroups} group(s). Use --force to reset.`,
      };
    }

    if (options.force) {
      await clearInventory(manager);
    }

    // --- Groups ---------------------------------------------------------
    const groupsByName = new Map<string, Group>();
    for (const seedGroup of SEED_GROUPS) {
      const group = await manager.save(manager.create(Group, seedGroup));
      groupsByName.set(seedGroup.name, group);
    }

    // --- Items (always created empty) -----------------------------------
    const itemsBySku = new Map<string, Item>();
    for (const seedItem of SEED_ITEMS) {
      const group = groupsByName.get(seedItem.groupName);
      if (!group) throw new Error(`Seed data references unknown group "${seedItem.groupName}"`);

      const item = await manager.save(
        manager.create(Item, {
          groupId: group.id,
          name: seedItem.name,
          description: seedItem.description,
          sku: seedItem.sku,
          quantity: 0,
          minimumStock: seedItem.minimumStock,
          unitPrice: seedItem.unitPrice,
        }),
      );
      itemsBySku.set(seedItem.sku, item);
    }

    // --- Movements, applied in order ------------------------------------
    const runningStock = new Map<string, number>();
    for (const sku of itemsBySku.keys()) runningStock.set(sku, 0);

    for (const seedMovement of SEED_MOVEMENTS) {
      const item = itemsBySku.get(seedMovement.sku);
      if (!item) throw new Error(`Seed data references unknown SKU "${seedMovement.sku}"`);

      const current = runningStock.get(seedMovement.sku) ?? 0;
      const resultingStock =
        seedMovement.type === MovementType.IN
          ? current + seedMovement.quantity
          : current - seedMovement.quantity;

      // The same rule the API enforces. A seed that violated it would be a bug
      // in the demo data, and it must fail loudly rather than persist garbage.
      if (resultingStock < 0) {
        throw new Error(
          `Seed data is inconsistent: ${seedMovement.type} of ${seedMovement.quantity} ` +
            `on "${seedMovement.sku}" would leave stock at ${resultingStock}`,
        );
      }

      await manager.save(
        manager.create(Movement, {
          itemId: item.id,
          type: seedMovement.type,
          quantity: seedMovement.quantity,
          reason: seedMovement.reason,
          resultingStock,
        }),
      );

      runningStock.set(seedMovement.sku, resultingStock);
    }

    // --- Final stock, straight from the ledger --------------------------
    for (const [sku, stock] of runningStock) {
      const item = itemsBySku.get(sku);
      if (item) await manager.update(Item, { id: item.id }, { quantity: stock });
    }

    return {
      skipped: false,
      groups: SEED_GROUPS.length,
      items: SEED_ITEMS.length,
      movements: SEED_MOVEMENTS.length,
      message:
        `Seed complete: ${SEED_GROUPS.length} groups, ${SEED_ITEMS.length} items, ` +
        `${SEED_MOVEMENTS.length} movements`,
    };
  });
};

/**
 * Removes all inventory data, leaving the schema intact.
 *
 * `TRUNCATE ... RESTART IDENTITY CASCADE` resets the identity sequences too, so
 * a re-seed always produces the same ids — which is what keeps the documented
 * example requests valid after a reset.
 */
export const clearInventory = async (manager: EntityManager): Promise<void> => {
  await manager.query('TRUNCATE TABLE "movements", "items", "groups" RESTART IDENTITY CASCADE');
};
