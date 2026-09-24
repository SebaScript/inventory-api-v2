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
      // RDS requires TLS. Never put `sslmode` in DATABASE_URL: it overrides this.
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      entities: [Group, Item, Movement],
      // Schema from the entities, instead of migrations. Off in the cluster:
      // two replicas building it at once would race.
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
    // Correlation first, so every log line carries the id.
    consumer.apply(CorrelationMiddleware, HttpMetricsMiddleware).forRoutes('*');
  }
}
