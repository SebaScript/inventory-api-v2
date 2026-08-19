import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from 'dotenv';
import { GroupsModule } from './groups/groups.module';
import { HealthController } from './health.controller';
import { ItemsModule } from './items/items.module';
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
      entities: [Group, Item, Movement],
      synchronize: true,
      logging: ['error'],
    }),
    GroupsModule,
    ItemsModule,
    MovementsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
