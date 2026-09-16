import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from '../entities/item.entity';
import { InteropV2Controller } from './interop.controller';
import { InteropService } from './interop.service';

// Takes the Item repository directly instead of ItemsService, so ItemsModule
// never has to export anything and there is no cycle: ItemsModule imports this
// one, not the other way round.
@Module({
  imports: [TypeOrmModule.forFeature([Item])],
  controllers: [InteropV2Controller],
  providers: [InteropService],
  exports: [InteropService],
})
export class InteropModule {}
