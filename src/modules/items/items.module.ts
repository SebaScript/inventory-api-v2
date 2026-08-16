import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupsModule } from '../groups/groups.module';
import { Item } from './entities/item.entity';
import { GroupItemsController } from './group-items.controller';
import { ItemsController } from './items.controller';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';

@Module({
  // GroupsModule is imported to reuse GroupsRepository for referential checks,
  // so items never query the groups table directly.
  imports: [TypeOrmModule.forFeature([Item]), GroupsModule],
  controllers: [ItemsController, GroupItemsController],
  providers: [ItemsService, ItemsRepository],
  exports: [ItemsService, ItemsRepository],
})
export class ItemsModule {}
