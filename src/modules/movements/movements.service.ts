import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  InsufficientStockError,
  ItemNotFoundError,
  MovementNotFoundError,
} from '../../common/errors/domain.errors';
import { Item } from '../items/entities/item.entity';
import { type CreateMovementDto } from './dto/create-movement.dto';
import { type QueryMovementsDto } from './dto/query-movements.dto';
import { Movement, MovementType } from './entities/movement.entity';
import { MovementsRepository } from './movements.repository';

/**
 * Computes the stock that results from applying a movement.
 *
 * Extracted as a pure function so the arithmetic rule can be tested exhaustively
 * on its own, with no database and no framework involved.
 */
export const computeResultingStock = (
  currentStock: number,
  type: MovementType,
  quantity: number,
): number => (type === MovementType.IN ? currentStock + quantity : currentStock - quantity);

@Injectable()
export class MovementsService {
  constructor(
    private readonly movementsRepository: MovementsRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Records a stock movement atomically.
   *
   * This is the central operation of the system, and it has to satisfy three
   * things at once:
   *
   *  1. **Atomicity.** The ledger entry and the new stock value are written in
   *     one transaction. There is no interleaving in which the movement exists
   *     but stock was not updated, or the other way round.
   *
   *  2. **No negative stock.** An OUT that would take stock below zero is
   *     rejected before anything is written, so the movement is not created and
   *     the item is left untouched. The `chk_items_quantity` CHECK constraint
   *     backs this up at the database level.
   *
   *  3. **Correctness under concurrency.** The item row is read with
   *     `SELECT ... FOR UPDATE` (`pessimistic_write`). Without that lock, two
   *     simultaneous OUT requests could both read the same stock, both decide
   *     they fit, and both commit — overselling the item. The lock serialises
   *     them: the second transaction blocks until the first commits, then reads
   *     the updated value and correctly rejects.
   */
  async create(dto: CreateMovementDto): Promise<Movement> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const item = await manager
        .createQueryBuilder(Item, 'item')
        .setLock('pessimistic_write')
        .where('item.id = :id', { id: dto.itemId })
        .getOne();

      if (!item) throw new ItemNotFoundError(dto.itemId);

      const resultingStock = computeResultingStock(item.quantity, dto.type, dto.quantity);

      if (resultingStock < 0) {
        // Throwing rolls the transaction back: nothing at all is persisted.
        throw new InsufficientStockError(item.id, item.quantity, dto.quantity);
      }

      await manager.update(Item, { id: item.id }, { quantity: resultingStock });

      return manager.save(
        manager.create(Movement, {
          itemId: item.id,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason ?? null,
          resultingStock,
        }),
      );
    });
  }

  async findAll(query: QueryMovementsDto): Promise<PaginatedResponseDto<Movement>> {
    const { rows, total } = await this.movementsRepository.findMany(query);
    return new PaginatedResponseDto(rows, total, query.page, query.pageSize);
  }

  async findOne(id: number): Promise<Movement> {
    const movement = await this.movementsRepository.findById(id);
    if (!movement) throw new MovementNotFoundError(id);
    return movement;
  }

  /** Ledger for a single item, newest first. */
  async findByItem(
    itemId: number,
    query: QueryMovementsDto,
  ): Promise<PaginatedResponseDto<Movement>> {
    const itemExists = await this.dataSource.getRepository(Item).existsBy({ id: itemId });
    if (!itemExists) throw new ItemNotFoundError(itemId);

    return this.findAll(Object.assign(query, { itemId }));
  }
}
