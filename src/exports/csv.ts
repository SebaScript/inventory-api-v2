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

/** Characters a spreadsheet reads as the start of a formula rather than as text. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * RFC 4180: every field is quoted and interior quotes are doubled, because item
 * names and group descriptions are free text and may contain commas, quotes or
 * newlines.
 *
 * A field that starts with one of the formula characters is prefixed with an
 * apostrophe. Without that, an item named `=cmd|...` becomes a live formula
 * when the file is opened in a spreadsheet.
 */
function escape(value: unknown): string {
  if (value === null || value === undefined) return '""';

  let text = String(value);
  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) text = `'${text}`;

  return `"${text.replace(/"/g, '""')}"`;
}

/** Builds the whole snapshot in memory, which is fine for an inventory of this size. */
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
