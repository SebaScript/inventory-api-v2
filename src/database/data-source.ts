import { config as loadDotEnv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { configuration } from '../config/configuration';
import { Group } from '../modules/groups/entities/group.entity';
import { Item } from '../modules/items/entities/item.entity';
import { Movement } from '../modules/movements/entities/movement.entity';

// The TypeORM CLI boots this file directly, outside the Nest application, so it
// has to load the .env file itself. Inside Nest, ConfigModule has already done
// it and this call is a harmless no-op. `quiet` suppresses dotenv's startup
// banner, which would otherwise pollute test output and container logs.
loadDotEnv({ quiet: true });

/**
 * Builds the TypeORM options used by *both* the Nest application and the
 * standalone migration CLI.
 *
 * Keeping a single builder guarantees the schema the app talks to is the exact
 * schema migrations were applied to — the usual source of "works locally,
 * breaks in the container" bugs.
 */
export const buildDataSourceOptions = (): DataSourceOptions => {
  const { database } = configuration();

  return {
    type: 'postgres',
    url: database.url,
    ssl: database.ssl ? { rejectUnauthorized: false } : false,
    entities: [Group, Item, Movement],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    migrationsTableName: 'typeorm_migrations',
    // Never let TypeORM mutate the schema implicitly. Every structural change
    // goes through a reviewed migration, in every environment without exception.
    synchronize: false,
    logging: database.logging ? ['query', 'error', 'warn'] : ['error'],
    extra: {
      max: database.poolSize,
      // Fail fast instead of hanging forever when the database is unreachable.
      connectionTimeoutMillis: 10_000,
    },
  };
};

/**
 * Default export consumed by the TypeORM CLI (`npm run migration:run`).
 */
export const AppDataSource = new DataSource(buildDataSourceOptions());

export default AppDataSource;
