import { MovementType } from '../../modules/movements/entities/movement.entity';

export interface SeedGroup {
  name: string;
  description: string;
}

export interface SeedItem {
  groupName: string;
  name: string;
  description: string;
  sku: string;
  minimumStock: number;
  unitPrice: number;
}

export interface SeedMovement {
  sku: string;
  type: MovementType;
  quantity: number;
  reason: string;
}

/**
 * Fixed demo dataset — no randomness anywhere.
 *
 * Determinism is the point: the same `docker compose up` always produces the
 * same stock numbers, so the README examples, the smoke tests and a live
 * demonstration all agree with each other.
 */
export const SEED_GROUPS: SeedGroup[] = [
  { name: 'Electronics', description: 'Consumer electronics and computer accessories' },
  { name: 'Office Supplies', description: 'Stationery and everyday office consumables' },
  { name: 'Warehouse Tools', description: 'Handling equipment and warehouse hardware' },
];

export const SEED_ITEMS: SeedItem[] = [
  // --- Electronics -------------------------------------------------------
  {
    groupName: 'Electronics',
    name: 'USB-C Cable 2m',
    description: 'Braided USB-C to USB-C cable, 100W power delivery',
    sku: 'ELEC-USBC-2M',
    minimumStock: 20,
    unitPrice: 12.5,
  },
  {
    groupName: 'Electronics',
    name: 'Wireless Mouse',
    description: 'Ergonomic 2.4GHz wireless mouse with silent switches',
    sku: 'ELEC-MOUSE-WL',
    minimumStock: 15,
    unitPrice: 24.99,
  },
  {
    groupName: 'Electronics',
    name: 'Mechanical Keyboard',
    description: '87-key tenkeyless mechanical keyboard, brown switches',
    sku: 'ELEC-KBD-TKL',
    minimumStock: 10,
    unitPrice: 89.9,
  },
  {
    groupName: 'Electronics',
    name: 'USB-C Hub 7-in-1',
    description: 'HDMI, ethernet, SD card reader and three USB-A ports',
    sku: 'ELEC-HUB-7IN1',
    minimumStock: 8,
    unitPrice: 45.0,
  },
  // --- Office Supplies ---------------------------------------------------
  {
    groupName: 'Office Supplies',
    name: 'A4 Paper Ream',
    description: '500 sheets, 80gsm, white',
    sku: 'OFFI-PAPER-A4',
    minimumStock: 50,
    unitPrice: 5.75,
  },
  {
    groupName: 'Office Supplies',
    name: 'Ballpoint Pen Box',
    description: 'Box of 50 blue ballpoint pens',
    sku: 'OFFI-PEN-BLUE50',
    minimumStock: 12,
    unitPrice: 14.2,
  },
  {
    groupName: 'Office Supplies',
    name: 'Sticky Notes Pack',
    description: 'Pack of 12 pads, 76x76mm, assorted colours',
    sku: 'OFFI-NOTES-76',
    minimumStock: 25,
    unitPrice: 8.99,
  },
  // --- Warehouse Tools ---------------------------------------------------
  {
    groupName: 'Warehouse Tools',
    name: 'Barcode Scanner',
    description: 'Handheld 1D/2D wired barcode scanner',
    sku: 'WHSE-SCAN-2D',
    minimumStock: 5,
    unitPrice: 129.0,
  },
  {
    groupName: 'Warehouse Tools',
    name: 'Pallet Truck',
    description: 'Manual hydraulic pallet truck, 2500kg capacity',
    sku: 'WHSE-PALLET-2500',
    minimumStock: 2,
    unitPrice: 349.0,
  },
  {
    groupName: 'Warehouse Tools',
    name: 'Safety Gloves Pair',
    description: 'Cut-resistant level 5 handling gloves',
    sku: 'WHSE-GLOVES-L5',
    minimumStock: 40,
    unitPrice: 9.5,
  },
];

/**
 * Movements are applied in order through the real transactional service logic,
 * so the resulting stock is computed by the system rather than hard-coded.
 *
 * The set is designed to exercise every demo scenario:
 *  - items comfortably in stock,
 *  - items at or below their minimum (low-stock report),
 *  - one item drained to exactly zero (out-of-stock),
 *  - items with a mixed IN/OUT history.
 */
export const SEED_MOVEMENTS: SeedMovement[] = [
  // Electronics
  {
    sku: 'ELEC-USBC-2M',
    type: MovementType.IN,
    quantity: 150,
    reason: 'Initial supplier delivery #4471',
  },
  { sku: 'ELEC-USBC-2M', type: MovementType.OUT, quantity: 40, reason: 'Sales order SO-1001' },
  { sku: 'ELEC-USBC-2M', type: MovementType.OUT, quantity: 25, reason: 'Sales order SO-1007' },

  { sku: 'ELEC-MOUSE-WL', type: MovementType.IN, quantity: 80, reason: 'Supplier delivery #4472' },
  { sku: 'ELEC-MOUSE-WL', type: MovementType.OUT, quantity: 12, reason: 'Sales order SO-1002' },

  { sku: 'ELEC-KBD-TKL', type: MovementType.IN, quantity: 40, reason: 'Supplier delivery #4473' },
  { sku: 'ELEC-KBD-TKL', type: MovementType.OUT, quantity: 32, reason: 'Bulk order SO-1010' },
  // Leaves 8, below its minimum of 10 -> appears in the low-stock report.

  { sku: 'ELEC-HUB-7IN1', type: MovementType.IN, quantity: 25, reason: 'Supplier delivery #4474' },
  { sku: 'ELEC-HUB-7IN1', type: MovementType.OUT, quantity: 25, reason: 'Corporate order SO-1015' },
  // Drained to exactly 0 -> exercises the out-of-stock counter.

  // Office Supplies
  {
    sku: 'OFFI-PAPER-A4',
    type: MovementType.IN,
    quantity: 400,
    reason: 'Quarterly stock replenishment',
  },
  {
    sku: 'OFFI-PAPER-A4',
    type: MovementType.OUT,
    quantity: 120,
    reason: 'Internal consumption Q1',
  },
  { sku: 'OFFI-PAPER-A4', type: MovementType.OUT, quantity: 95, reason: 'Internal consumption Q2' },

  {
    sku: 'OFFI-PEN-BLUE50',
    type: MovementType.IN,
    quantity: 30,
    reason: 'Supplier delivery #4480',
  },
  { sku: 'OFFI-PEN-BLUE50', type: MovementType.OUT, quantity: 22, reason: 'Branch distribution' },
  // Leaves 8, below its minimum of 12 -> low stock.

  { sku: 'OFFI-NOTES-76', type: MovementType.IN, quantity: 120, reason: 'Supplier delivery #4481' },
  { sku: 'OFFI-NOTES-76', type: MovementType.OUT, quantity: 18, reason: 'Internal consumption' },

  // Warehouse Tools
  { sku: 'WHSE-SCAN-2D', type: MovementType.IN, quantity: 18, reason: 'Equipment purchase PO-220' },
  {
    sku: 'WHSE-SCAN-2D',
    type: MovementType.OUT,
    quantity: 6,
    reason: 'Assigned to picking stations',
  },

  {
    sku: 'WHSE-PALLET-2500',
    type: MovementType.IN,
    quantity: 6,
    reason: 'Equipment purchase PO-221',
  },
  {
    sku: 'WHSE-PALLET-2500',
    type: MovementType.OUT,
    quantity: 2,
    reason: 'Transferred to warehouse B',
  },

  {
    sku: 'WHSE-GLOVES-L5',
    type: MovementType.IN,
    quantity: 200,
    reason: 'Safety equipment purchase PO-222',
  },
  {
    sku: 'WHSE-GLOVES-L5',
    type: MovementType.OUT,
    quantity: 65,
    reason: 'Distributed to warehouse staff',
  },
  {
    sku: 'WHSE-GLOVES-L5',
    type: MovementType.OUT,
    quantity: 45,
    reason: 'Distributed to seasonal staff',
  },
];
