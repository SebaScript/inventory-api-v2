import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from '../entities/item.entity';
import { StorageModule } from '../storage/storage.module';
import { InteropV2Controller } from './interop.controller';
import { InteropService } from './interop.service';

// Uses the Item repository directly: no import cycle with ItemsModule.
@Module({
  imports: [TypeOrmModule.forFeature([Item]), StorageModule],
  controllers: [InteropV2Controller],
  providers: [InteropService],
  exports: [InteropService],
})
export class InteropModule {}
