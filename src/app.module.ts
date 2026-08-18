import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as Joi from 'joi';
import { dataSourceOptions } from './database/data-source';
import { GroupsModule } from './groups/groups.module';
import { HealthController } from './health.controller';
import { ItemsModule } from './items/items.module';
import { MovementsModule } from './movements/movements.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Validated at boot, so a missing DATABASE_URL fails immediately with a
      // clear message instead of surfacing on the first request.
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
        PORT: Joi.number().port().default(3000),
        DATABASE_URL: Joi.string().required(),
        RUN_MIGRATIONS: Joi.boolean().default(false),
        SEED: Joi.boolean().default(false),
      }),
    }),
    TypeOrmModule.forRoot(dataSourceOptions),
    GroupsModule,
    ItemsModule,
    MovementsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
