import { DataSource } from 'typeorm';
import { Group } from '../entities/group.entity';
import { Item } from '../entities/item.entity';
import { Movement, MovementType } from '../entities/movement.entity';

const GROUPS = ['Electronics', 'Office Supplies', 'Warehouse Tools'];

/** [group, name, sku, minimumStock, unitPrice] */
const ITEMS: [string, string, string, number, number][] = [
  ['Electronics', 'USB-C Cable 2m', 'ELEC-USBC-2M', 20, 12.5],
  ['Electronics', 'Wireless Mouse', 'ELEC-MOUSE', 15, 24.99],
  ['Electronics', 'USB-C Hub', 'ELEC-HUB', 8, 45],
  ['Office Supplies', 'A4 Paper Ream', 'OFFI-PAPER', 50, 5.75],
  ['Office Supplies', 'Ballpoint Pens', 'OFFI-PENS', 12, 14.2],
  ['Warehouse Tools', 'Safety Gloves', 'WHSE-GLOVES', 40, 9.5],
];

const MOVEMENTS: [string, MovementType, number][] = [
  ['ELEC-USBC-2M', MovementType.IN, 150],
  ['ELEC-USBC-2M', MovementType.OUT, 65],
  ['ELEC-MOUSE', MovementType.IN, 80],
  ['ELEC-HUB', MovementType.IN, 25],
  ['ELEC-HUB', MovementType.OUT, 25],
  ['OFFI-PAPER', MovementType.IN, 400],
  ['OFFI-PENS', MovementType.IN, 30],
  ['OFFI-PENS', MovementType.OUT, 22],
  ['WHSE-GLOVES', MovementType.IN, 200],
  ['WHSE-GLOVES', MovementType.OUT, 110],
];

export async function seed(ds: DataSource): Promise<string> {
  const manager = ds.manager;

  if (await manager.count(Group)) return 'Seed skipped: data already present';

  const groupIds = new Map<string, number>();
  for (const name of GROUPS) {
    groupIds.set(name, (await manager.save(manager.create(Group, { name }))).id);
  }

  const itemIds = new Map<string, number>();
  for (const [group, name, sku, minimumStock, unitPrice] of ITEMS) {
    const item = await manager.save(
      manager.create(Item, { groupId: groupIds.get(group)!, name, sku, minimumStock, unitPrice }),
    );
    itemIds.set(sku, item.id);
  }

  const stock = new Map<string, number>();
  for (const [sku, type, quantity] of MOVEMENTS) {
    const current = stock.get(sku) ?? 0;
    const resultingStock = type === MovementType.IN ? current + quantity : current - quantity;

    await manager.save(
      manager.create(Movement, { itemId: itemIds.get(sku)!, type, quantity, resultingStock }),
    );
    stock.set(sku, resultingStock);
  }

  for (const [sku, quantity] of stock) {
    await manager.update(Item, itemIds.get(sku)!, { quantity });
  }

  return `Seed complete: ${GROUPS.length} groups, ${ITEMS.length} items, ${MOVEMENTS.length} movements`;
}
