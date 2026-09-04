import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from '../entities/group.entity';
import { Item } from '../entities/item.entity';
import { GroupsController } from './groups.controller';
import { GroupsV2Controller } from './groups.v2.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([Group, Item])],
  controllers: [GroupsController, GroupsV2Controller],
  providers: [GroupsService],
})
export class GroupsModule {}
