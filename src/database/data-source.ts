import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Group } from '../entities/group.entity';
import { Item } from '../entities/item.entity';
import { Movement } from '../entities/movement.entity';

// The TypeORM CLI loads this file outside Nest, so it reads .env itself.
config({ quiet: true });

/** Shared by the app and the migration CLI, so both see the same schema. */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Group, Item, Movement],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  // Never let TypeORM alter the schema: every change is a reviewed migration.
  synchronize: false,
  logging: ['error'],
};

export default new DataSource(dataSourceOptions);
