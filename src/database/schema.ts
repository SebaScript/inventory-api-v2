import { DataSource } from 'typeorm';

/**
 * Builds the schema on an empty database only. An existing one is never synchronized:
 * an older build would drop the columns a newer one added, and rollback would lose data.
 */
export async function ensureSchema(dataSource: DataSource): Promise<string> {
  const [{ exists }] = await dataSource.query<{ exists: boolean }[]>(
    `SELECT to_regclass('public.items') IS NOT NULL AS exists`,
  );
  if (exists) return 'Schema kept: tables already present';

  await dataSource.synchronize();
  return 'Schema created';
}
