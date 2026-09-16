import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from 'dotenv';
import { CacheModule } from './cache/cache.module';
import { CorrelationMiddleware } from './common/correlation';
import { ExportsModule } from './exports/exports.module';
import { GroupsModule } from './groups/groups.module';
import { HealthController } from './health.controller';
import { InteropModule } from './interop/interop.module';
import { ItemsModule } from './items/items.module';
import { MetricsController } from './metrics/metrics.controller';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { MovementsModule } from './movements/movements.module';
import { Group } from './entities/group.entity';
import { Item } from './entities/item.entity';
import { Movement } from './entities/movement.entity';

config({ quiet: true });

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      // Managed PostgreSQL refuses plaintext connections; a local one has no
      // certificate at all. Never put `sslmode` in DATABASE_URL: node-postgres
      // merges the connection string over this option, so the string would win
      // and this setting would be silently ignored.
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      entities: [Group, Item, Movement],
      // Building the schema from the entities is this project's substitute for
      // migrations. Two replicas doing it at once race each other, so the
      // deployment turns it off once the schema exists.
      synchronize: process.env.DB_SYNC !== 'false',
      logging: ['error'],
    }),
    CacheModule,
    GroupsModule,
    ItemsModule,
    MovementsModule,
    ExportsModule,
    InteropModule,
  ],
  controllers: [HealthController, MetricsController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation runs first, so the access log and the error log can both
    // quote the same id.
    consumer.apply(CorrelationMiddleware, HttpMetricsMiddleware).forRoutes('*');
  }
}
