import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SortOrder } from '../../common/dto/pagination-query.dto';
import { type PaginatedRows } from '../groups/groups.repository';
import { MovementSortField, type QueryMovementsDto } from './dto/query-movements.dto';
import { Movement } from './entities/movement.entity';

/**
 * Read-side data access for the movements ledger.
 *
 * Writes deliberately do **not** live here: creating a movement must happen
 * inside the same transaction that locks and updates the item, so that logic
 * belongs to `MovementsService` where the transaction boundary is visible.
 */
@Injectable()
export class MovementsRepository {
  constructor(
    @InjectRepository(Movement)
    private readonly repository: Repository<Movement>,
  ) {}

  findById(id: number): Promise<Movement | null> {
    return this.repository.findOne({ where: { id }, relations: { item: true } });
  }

  async findMany(query: QueryMovementsDto): Promise<PaginatedRows<Movement>> {
    const qb = this.repository
      .createQueryBuilder('movement')
      .leftJoinAndSelect('movement.item', 'item');

    if (query.itemId !== undefined) {
      qb.andWhere('movement.itemId = :itemId', { itemId: query.itemId });
    }
    if (query.type !== undefined) {
      qb.andWhere('movement.type = :type', { type: query.type });
    }
    if (query.from) {
      qb.andWhere('movement.createdAt >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('movement.createdAt <= :to', { to: new Date(query.to) });
    }

    // `sortBy` is constrained to a fixed enum by validation.
    qb.orderBy(`movement.${query.sortBy}`, query.sortOrder === SortOrder.DESC ? 'DESC' : 'ASC');
    if (query.sortBy !== MovementSortField.ID) {
      // Ledger entries recorded in the same millisecond would otherwise be
      // ordered arbitrarily and shuffle between pages.
      qb.addOrderBy('movement.id', 'DESC');
    }

    const [rows, total] = await qb.skip(query.skip).take(query.pageSize).getManyAndCount();
    return { rows, total };
  }

  countByItem(itemId: number): Promise<number> {
    return this.repository.countBy({ itemId });
  }

  /**
   * Net stock implied by the ledger for an item.
   *
   * Used by the integration suite to assert the system's central invariant:
   * `item.quantity` must always equal `sum(IN) - sum(OUT)`.
   */
  async netQuantityForItem(itemId: number): Promise<number> {
    const raw = await this.repository
      .createQueryBuilder('movement')
      .select(
        `COALESCE(SUM(CASE WHEN movement.type = 'IN' THEN movement.quantity ELSE -movement.quantity END), 0)`,
        'net',
      )
      .where('movement.itemId = :itemId', { itemId })
      .getRawOne<{ net: string }>();

    return Number(raw?.net ?? 0);
  }
}
