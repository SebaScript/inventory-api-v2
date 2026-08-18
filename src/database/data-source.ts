import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Group } from '../entities/group.entity';
import { Item } from '../entities/item.entity';
import { Movement } from '../entities/movement.entity';

// The TypeORM CLI loads this file outside Nest, so it reads .env itself.
config({ quiet: true });

/**
 * One set of options for both the application and the migration CLI, so the
 * schema the app talks to is always the schema migrations were applied to.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Group, Item, Movement],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  // Never let TypeORM change the schema on its own: every change is a reviewed
  // migration, in every environment.
  synchronize: false,
  logging: ['error'],
};

export default new DataSource(dataSourceOptions);
