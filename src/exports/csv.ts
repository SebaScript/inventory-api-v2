import { Item } from '../entities/item.entity';

const COLUMNS = [
  'id',
  'sku',
  'name',
  'group',
  'quantity',
  'minimumStock',
  'unitPrice',
  'status',
  'updatedAt',
] as const;

/** A spreadsheet reads these as the start of a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * RFC 4180 quoting. Formula characters get an apostrophe, or an item named
 * `=cmd|...` would run when the file is opened (CSV injection).
 */
function escape(value: unknown): string {
  if (value === null || value === undefined) return '""';

  let text = String(value);
  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) text = `'${text}`;

  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(items: Item[]): string {
  const rows = items.map((item) =>
    [
      item.id,
      item.sku,
      item.name,
      item.group?.name ?? '',
      item.quantity,
      item.minimumStock,
      item.unitPrice,
      item.status,
      item.updatedAt?.toISOString() ?? '',
    ]
      .map(escape)
      .join(','),
  );

  return [COLUMNS.map(escape).join(','), ...rows].join('\r\n') + '\r\n';
}
