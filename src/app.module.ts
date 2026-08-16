import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { buildDataSourceOptions } from './database/data-source';
import { HealthModule } from './health/health.module';
import { GroupsModule } from './modules/groups/groups.module';
import { ItemsModule } from './modules/items/items.module';
import { MovementsModule } from './modules/movements/movements.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        // Report every invalid variable at once instead of one per restart.
        abortEarly: false,
      },
      // `.env` is optional: Docker and CI inject variables directly.
      envFilePath: ['.env'],
      cache: true,
    }),

    TypeOrmModule.forRootAsync({
      // Depending on ConfigService guarantees the environment has been
      // validated before a connection is attempted.
      inject: [ConfigService],
      useFactory: () => ({
        ...buildDataSourceOptions(),
        autoLoadEntities: false,
      }),
    }),

    GroupsModule,
    ItemsModule,
    MovementsModule,
    HealthModule,
  ],
})
export class AppModule {}
