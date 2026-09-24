import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from '../entities/item.entity';
import { StorageModule } from '../storage/storage.module';
import { ExportsV2Controller } from './exports.controller';
import { ExportsService } from './exports.service';

// Item repository directly: the export needs the whole table, not a page.
@Module({
  imports: [TypeOrmModule.forFeature([Item]), StorageModule],
  controllers: [ExportsV2Controller],
  providers: [ExportsService],
})
export class ExportsModule {}
