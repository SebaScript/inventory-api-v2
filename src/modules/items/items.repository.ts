import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { SortOrder } from '../../common/dto/pagination-query.dto';
import { type PaginatedRows } from '../groups/groups.repository';
import { ItemSortField, type QueryItemsDto } from './dto/query-items.dto';
import { type SearchItemsDto } from './dto/search-items.dto';
import { type GroupSummaryDto } from './dto/inventory-summary.dto';
import { Item } from './entities/item.entity';

/** Shape returned by the per-group aggregate query, before number coercion. */
interface RawGroupSummary {
  groupId: string;
  groupName: string;
  itemCount: string;
  totalUnits: string | null;
  totalValue: string | null;
  lowStockCount: string;
}

interface RawGlobalSummary {
  totalItems: string;
  totalUnits: string | null;
  totalValue: string | null;
  lowStockCount: string;
  outOfStockCount: string;
}

@Injectable()
export class ItemsRepository {
  constructor(
    @InjectRepository(Item)
    private readonly repository: Repository<Item>,
  ) {}

  /**
   * Items are always read with their group attached: every endpoint that
   * returns a single item includes it, so making it optional would only add a
   * branch nobody takes.
   *
   * Note there is no `create` here. Item creation happens inside the
   * transaction that also writes the opening movement, so it goes through the
   * transaction's EntityManager in `ItemsService` rather than this repository.
   */
  findById(id: number): Promise<Item | null> {
    return this.repository.findOne({ where: { id }, relations: { group: true } });
  }

  findBySku(sku: string, excludeId?: number): Promise<Item | null> {
    const qb = this.repository
      .createQueryBuilder('item')
      .where('item.sku = :sku', { sku: sku.toUpperCase() });

    if (excludeId !== undefined) {
      qb.andWhere('item.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  async findMany(query: QueryItemsDto): Promise<PaginatedRows<Item>> {
    const qb = this.repository.createQueryBuilder('item').leftJoinAndSelect('item.group', 'group');

    if (query.search) {
      qb.andWhere(
        '(item.name ILIKE :search OR item.sku ILIKE :search OR item.description ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.groupId !== undefined) {
      qb.andWhere('item.groupId = :groupId', { groupId: query.groupId });
    }
    if (query.minPrice !== undefined) {
      qb.andWhere('item.unitPrice >= :minPrice', { minPrice: query.minPrice });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('item.unitPrice <= :maxPrice', { maxPrice: query.maxPrice });
    }
    if (query.lowStock === true) {
      qb.andWhere('item.quantity <= item.minimumStock');
    } else if (query.lowStock === false) {
      qb.andWhere('item.quantity > item.minimumStock');
    }

    this.applyOrder(qb, [{ field: query.sortBy, order: query.sortOrder }]);

    const [rows, total] = await qb.skip(query.skip).take(query.pageSize).getManyAndCount();
    return { rows, total };
  }

  /**
   * Backing query for `QUERY /items/search`.
   *
   * Structurally the same builder as `findMany`, but driven by the richer
   * nested filter that the QUERY body can express: several groups at once, two
   * inclusive ranges and an ordered list of sort criteria.
   */
  async search(dto: SearchItemsDto): Promise<PaginatedRows<Item>> {
    const qb = this.repository.createQueryBuilder('item').leftJoinAndSelect('item.group', 'group');

    if (dto.text) {
      qb.andWhere(
        '(item.name ILIKE :text OR item.sku ILIKE :text OR item.description ILIKE :text)',
        { text: `%${dto.text}%` },
      );
    }
    if (dto.groupIds?.length) {
      qb.andWhere('item.groupId IN (:...groupIds)', { groupIds: dto.groupIds });
    }
    if (dto.price?.min !== undefined) {
      qb.andWhere('item.unitPrice >= :priceMin', { priceMin: dto.price.min });
    }
    if (dto.price?.max !== undefined) {
      qb.andWhere('item.unitPrice <= :priceMax', { priceMax: dto.price.max });
    }
    if (dto.stock?.min !== undefined) {
      qb.andWhere('item.quantity >= :stockMin', { stockMin: dto.stock.min });
    }
    if (dto.stock?.max !== undefined) {
      qb.andWhere('item.quantity <= :stockMax', { stockMax: dto.stock.max });
    }
    if (dto.lowStockOnly === true) {
      qb.andWhere('item.quantity <= item.minimumStock');
    }

    this.applyOrder(
      qb,
      dto.sort?.length
        ? dto.sort.map((criterion) => ({ field: criterion.field, order: criterion.order }))
        : [{ field: ItemSortField.ID, order: SortOrder.ASC }],
    );

    const [rows, total] = await qb.skip(dto.skip).take(dto.pageSize).getManyAndCount();
    return { rows, total };
  }

  async findLowStock(page: number, pageSize: number): Promise<PaginatedRows<Item>> {
    const [rows, total] = await this.repository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.group', 'group')
      // Matches the partial index idx_items_low_stock.
      .where('item.quantity <= item.minimumStock')
      // Most urgent first: the largest shortfall relative to the threshold.
      //
      // The shortfall is selected under an alias rather than written inline in
      // ORDER BY. Combining a join with skip/take makes TypeORM wrap the query
      // in a DISTINCT subquery, and a bare arithmetic expression does not
      // survive that rewrite — it gets quoted as if it were a column name.
      .addSelect('item.quantity - item.minimum_stock', 'shortfall')
      .orderBy('shortfall', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { rows, total };
  }

  async update(id: number, data: Partial<Item>): Promise<Item | null> {
    await this.repository.update({ id }, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.repository.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  /** Whole-inventory aggregates, computed in the database in a single pass. */
  async globalSummary(): Promise<Omit<RawGlobalSummary, never>> {
    const raw = await this.repository
      .createQueryBuilder('item')
      .select('COUNT(item.id)', 'totalItems')
      .addSelect('COALESCE(SUM(item.quantity), 0)', 'totalUnits')
      .addSelect('COALESCE(SUM(item.quantity * item.unit_price), 0)', 'totalValue')
      .addSelect('COUNT(*) FILTER (WHERE item.quantity <= item.minimum_stock)', 'lowStockCount')
      .addSelect('COUNT(*) FILTER (WHERE item.quantity = 0)', 'outOfStockCount')
      .getRawOne<RawGlobalSummary>();

    return (
      raw ?? {
        totalItems: '0',
        totalUnits: '0',
        totalValue: '0',
        lowStockCount: '0',
        outOfStockCount: '0',
      }
    );
  }

  /** Per-group aggregates. Groups with no items are included with zeroes. */
  async summaryByGroup(): Promise<GroupSummaryDto[]> {
    const rows = await this.repository.manager
      .createQueryBuilder()
      .select('g.id', 'groupId')
      .addSelect('g.name', 'groupName')
      .addSelect('COUNT(i.id)', 'itemCount')
      .addSelect('COALESCE(SUM(i.quantity), 0)', 'totalUnits')
      .addSelect('COALESCE(SUM(i.quantity * i.unit_price), 0)', 'totalValue')
      .addSelect('COUNT(i.id) FILTER (WHERE i.quantity <= i.minimum_stock)', 'lowStockCount')
      .from('groups', 'g')
      .leftJoin('items', 'i', 'i.group_id = g.id')
      .groupBy('g.id')
      .addGroupBy('g.name')
      .orderBy('g.id', 'ASC')
      .getRawMany<RawGroupSummary>();

    return rows.map((row) => ({
      groupId: Number(row.groupId),
      groupName: row.groupName,
      itemCount: Number(row.itemCount),
      totalUnits: Number(row.totalUnits ?? 0),
      totalValue: Number(row.totalValue ?? 0),
      lowStockCount: Number(row.lowStockCount),
    }));
  }

  /**
   * Applies an ordered list of sort criteria.
   *
   * Every field arrives as a validated `ItemSortField` enum member, so mapping
   * it to a column name cannot introduce injection. A trailing id tiebreaker
   * keeps pagination stable when the sort keys tie.
   */
  private applyOrder(
    qb: SelectQueryBuilder<Item>,
    criteria: Array<{ field: ItemSortField; order: SortOrder }>,
  ): void {
    criteria.forEach((criterion, index) => {
      const direction = criterion.order === SortOrder.DESC ? 'DESC' : 'ASC';
      const column = `item.${criterion.field}`;
      if (index === 0) qb.orderBy(column, direction);
      else qb.addOrderBy(column, direction);
    });

    if (!criteria.some((criterion) => criterion.field === ItemSortField.ID)) {
      qb.addOrderBy('item.id', 'ASC');
    }
  }
}
