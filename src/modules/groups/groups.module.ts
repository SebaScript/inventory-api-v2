import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from './entities/group.entity';
import { GroupsController } from './groups.controller';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([Group])],
  controllers: [GroupsController],
  providers: [GroupsService, GroupsRepository],
  // Exported so the items module can validate that a referenced group exists
  // without reaching into the groups tables itself.
  exports: [GroupsService, GroupsRepository],
})
export class GroupsModule {}
