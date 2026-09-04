import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movement } from '../entities/movement.entity';
import { MovementsController } from './movements.controller';
import { MovementsV2Controller } from './movements.v2.controller';
import { MovementsService } from './movements.service';

@Module({
  imports: [TypeOrmModule.forFeature([Movement])],
  controllers: [MovementsController, MovementsV2Controller],
  providers: [MovementsService],
})
export class MovementsModule {}
