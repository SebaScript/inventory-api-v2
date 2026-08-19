import { DataSource } from 'typeorm';
import { Group } from '../entities/group.entity';
import { Item } from '../entities/item.entity';
import { Movement, MovementType } from '../entities/movement.entity';
import dataSource from './data-source';

/**
 * Fixed demo data, no randomness, so every run produces the same numbers.
 * Items start empty and their stock is built by applying the movements, so the
 * ledger explains it by construction.
 */
const GROUPS = [
  { name: 'Electronics', description: 'Computer accessories' },
  { name: 'Office Supplies', description: 'Everyday consumables' },
  { name: 'Warehouse Tools', description: 'Handling equipment' },
];

const ITEMS = [
  {
    group: 'Electronics',
    name: 'USB-C Cable 2m',
    sku: 'ELEC-USBC-2M',
    minimumStock: 20,
    unitPrice: 12.5,
  },
  {
    group: 'Electronics',
    name: 'Wireless Mouse',
    sku: 'ELEC-MOUSE',
    minimumStock: 15,
    unitPrice: 24.99,
  },
  {
    group: 'Electronics',
    name: 'Mechanical Keyboard',
    sku: 'ELEC-KBD',
    minimumStock: 10,
    unitPrice: 89.9,
  },
  { group: 'Electronics', name: 'USB-C Hub', sku: 'ELEC-HUB', minimumStock: 8, unitPrice: 45 },
  {
    group: 'Office Supplies',
    name: 'A4 Paper Ream',
    sku: 'OFFI-PAPER',
    minimumStock: 50,
    unitPrice: 5.75,
  },
  {
    group: 'Office Supplies',
    name: 'Ballpoint Pens',
    sku: 'OFFI-PENS',
    minimumStock: 12,
    unitPrice: 14.2,
  },
  {
    group: 'Office Supplies',
    name: 'Sticky Notes',
    sku: 'OFFI-NOTES',
    minimumStock: 25,
    unitPrice: 8.99,
  },
  {
    group: 'Warehouse Tools',
    name: 'Barcode Scanner',
    sku: 'WHSE-SCAN',
    minimumStock: 5,
    unitPrice: 129,
  },
  {
    group: 'Warehouse Tools',
    name: 'Pallet Truck',
    sku: 'WHSE-PALLET',
    minimumStock: 2,
    unitPrice: 349,
  },
  {
    group: 'Warehouse Tools',
    name: 'Safety Gloves',
    sku: 'WHSE-GLOVES',
    minimumStock: 40,
    unitPrice: 9.5,
  },
];

/** [sku, type, quantity, reason] — applied in order. */
const MOVEMENTS: [string, MovementType, number, string][] = [
  ['ELEC-USBC-2M', MovementType.IN, 150, 'Supplier delivery'],
  ['ELEC-USBC-2M', MovementType.OUT, 65, 'Sales order SO-1001'],
  ['ELEC-MOUSE', MovementType.IN, 80, 'Supplier delivery'],
  ['ELEC-MOUSE', MovementType.OUT, 12, 'Sales order SO-1002'],
  ['ELEC-KBD', MovementType.IN, 40, 'Supplier delivery'],
  ['ELEC-KBD', MovementType.OUT, 32, 'Bulk order SO-1010'], // leaves 8, below its minimum of 10
  ['ELEC-HUB', MovementType.IN, 25, 'Supplier delivery'],
  ['ELEC-HUB', MovementType.OUT, 25, 'Corporate order'], // drained to zero
  ['OFFI-PAPER', MovementType.IN, 400, 'Quarterly replenishment'],
  ['OFFI-PAPER', MovementType.OUT, 215, 'Internal consumption'],
  ['OFFI-PENS', MovementType.IN, 30, 'Supplier delivery'],
  ['OFFI-PENS', MovementType.OUT, 22, 'Branch distribution'], // leaves 8, below its minimum of 12
  ['OFFI-NOTES', MovementType.IN, 120, 'Supplier delivery'],
  ['OFFI-NOTES', MovementType.OUT, 18, 'Internal consumption'],
  ['WHSE-SCAN', MovementType.IN, 18, 'Equipment purchase'],
  ['WHSE-SCAN', MovementType.OUT, 6, 'Assigned to picking'],
  ['WHSE-PALLET', MovementType.IN, 6, 'Equipment purchase'],
  ['WHSE-PALLET', MovementType.OUT, 2, 'Moved to warehouse B'],
  ['WHSE-GLOVES', MovementType.IN, 200, 'Safety purchase'],
  ['WHSE-GLOVES', MovementType.OUT, 110, 'Distributed to staff'],
];

export async function seed(ds: DataSource): Promise<string> {
  const manager = ds.manager;

  // Idempotent: a container restart must not duplicate the demo data.
  if (await manager.count(Group)) return 'Seed skipped: data already present';

  const groupIds = new Map<string, number>();
  for (const g of GROUPS) {
    const saved = await manager.save(manager.create(Group, g));
    groupIds.set(g.name, saved.id);
  }

  const itemIds = new Map<string, number>();
  for (const { group, ...item } of ITEMS) {
    const saved = await manager.save(
      manager.create(Item, { ...item, groupId: groupIds.get(group)!, quantity: 0 }),
    );
    itemIds.set(item.sku, saved.id);
  }

  const stock = new Map<string, number>();
  for (const [sku, type, quantity, reason] of MOVEMENTS) {
    const current = stock.get(sku) ?? 0;
    const resultingStock = type === MovementType.IN ? current + quantity : current - quantity;

    // A seed that broke the core rule would be a bug in the demo data.
    if (resultingStock < 0)
      throw new Error(`Seed inconsistent: ${sku} would go to ${resultingStock}`);

    await manager.save(
      manager.create(Movement, {
        itemId: itemIds.get(sku)!,
        type,
        quantity,
        reason,
        resultingStock,
      }),
    );
    stock.set(sku, resultingStock);
  }

  for (const [sku, quantity] of stock) {
    await manager.update(Item, itemIds.get(sku)!, { quantity });
  }

  return `Seed complete: ${GROUPS.length} groups, ${ITEMS.length} items, ${MOVEMENTS.length} movements`;
}

/** Standalone entry point: `npm run seed`. */
if (require.main === module) {
  dataSource
    .initialize()
    .then(async (ds) => {
      console.log(await seed(ds));
      await ds.destroy();
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
