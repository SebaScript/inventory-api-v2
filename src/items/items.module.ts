import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from '../entities/group.entity';
import { Item } from '../entities/item.entity';
import { InteropModule } from '../interop/interop.module';
import { ItemsController } from './items.controller';
import { ItemsV2Controller } from './items.v2.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [TypeOrmModule.forFeature([Item, Group]), InteropModule],
  controllers: [ItemsController, ItemsV2Controller],
  providers: [ItemsService],
})
export class ItemsModule {}
