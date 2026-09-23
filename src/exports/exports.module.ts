import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from '../entities/item.entity';
import { StorageModule } from '../storage/storage.module';
import { ExportsV2Controller } from './exports.controller';
import { ExportsService } from './exports.service';

// Takes the Item repository directly rather than ItemsService: the snapshot is
// the whole table, and ItemsService only returns pages capped at MAX_LIMIT.
@Module({
  imports: [TypeOrmModule.forFeature([Item]), StorageModule],
  controllers: [ExportsV2Controller],
  providers: [ExportsService],
})
export class ExportsModule {}
