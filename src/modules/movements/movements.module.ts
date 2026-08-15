import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movement } from './entities/movement.entity';
import { ItemMovementsController } from './item-movements.controller';
import { MovementsController } from './movements.controller';
import { MovementsRepository } from './movements.repository';
import { MovementsService } from './movements.service';

@Module({
  imports: [TypeOrmModule.forFeature([Movement])],
  controllers: [MovementsController, ItemMovementsController],
  providers: [MovementsService, MovementsRepository],
  exports: [MovementsService, MovementsRepository],
})
export class MovementsModule {}
