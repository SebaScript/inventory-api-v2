import { DataSource } from 'typeorm';

/**
 * Expand: additive, idempotent changes for a database an older build created. None
 * removes or renames anything, so every older build keeps working on the result.
 */
const EXPAND = ['ALTER TABLE items ADD COLUMN IF NOT EXISTS location varchar(40)'];

/**
 * Builds the schema on an empty database only. An existing one is never synchronized:
 * an older build would drop the columns a newer one added, and rollback would lose data.
 */
export async function ensureSchema(dataSource: DataSource): Promise<string> {
  const [{ exists }] = await dataSource.query<{ exists: boolean }[]>(
    `SELECT to_regclass('public.items') IS NOT NULL AS exists`,
  );
  if (exists) {
    for (const statement of EXPAND) await dataSource.query(statement);
    return `Schema kept, expanded with ${EXPAND.length} additive change(s)`;
  }

  await dataSource.synchronize();
  return 'Schema created';
}
