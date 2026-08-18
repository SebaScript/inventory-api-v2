import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  InsufficientStockException,
  ItemNotFoundException,
  MovementNotFoundException,
} from '../common/exceptions';
import { Paginated } from '../common/pagination';
import { Item } from '../entities/item.entity';
import { Movement, MovementType } from '../entities/movement.entity';
import { CreateMovementDto, FindMovementsDto } from './movement.dto';

@Injectable()
export class MovementsService {
  constructor(
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The core operation of the system. Three things must hold at once:
   *
   * 1. Atomicity — the ledger entry and the new stock are written in one
   *    transaction, so one can never exist without the other.
   * 2. No negative stock — an OUT that would go below zero throws before
   *    anything is written, so nothing is persisted at all.
   * 3. Safe under concurrency — the item row is read with
   *    `SELECT ... FOR UPDATE` (pessimistic_write). Without that lock two
   *    simultaneous OUT requests would both read the same stock, both decide
   *    they fit, and both commit, overselling the item.
   */
  async create(dto: CreateMovementDto): Promise<Movement> {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager
        .createQueryBuilder(Item, 'item')
        .setLock('pessimistic_write')
        .where('item.id = :id', { id: dto.itemId })
        .getOne();

      if (!item) throw new ItemNotFoundException(dto.itemId);

      const resultingStock =
        dto.type === MovementType.IN ? item.quantity + dto.quantity : item.quantity - dto.quantity;

      if (resultingStock < 0) {
        throw new InsufficientStockException(item.id, item.quantity, dto.quantity);
      }

      await manager.update(Item, item.id, { quantity: resultingStock });
      return manager.save(manager.create(Movement, { ...dto, resultingStock }));
    });
  }

  async findAll(query: FindMovementsDto): Promise<Paginated<Movement>> {
    const [data, total] = await this.movements.findAndCount({
      where: {
        ...(query.itemId ? { itemId: query.itemId } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      order: { id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return new Paginated(data, total, query.page, query.limit);
  }

  async findOne(id: number): Promise<Movement> {
    const movement = await this.movements.findOne({ where: { id }, relations: { item: true } });
    if (!movement) throw new MovementNotFoundException(id);
    return movement;
  }
}
