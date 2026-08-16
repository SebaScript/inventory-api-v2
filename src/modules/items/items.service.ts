import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  GroupNotFoundError,
  ItemNotFoundError,
  SkuAlreadyExistsError,
} from '../../common/errors/domain.errors';
import { GroupsRepository } from '../groups/groups.repository';
import { Movement, MovementType } from '../movements/entities/movement.entity';
import { type CreateItemDto } from './dto/create-item.dto';
import { type InventorySummaryDto } from './dto/inventory-summary.dto';
import { type QueryItemsDto } from './dto/query-items.dto';
import { type SearchItemsDto } from './dto/search-items.dto';
import { type ReplaceItemDto, type UpdateItemDto } from './dto/update-item.dto';
import { Item } from './entities/item.entity';
import { ItemsRepository } from './items.repository';

@Injectable()
export class ItemsService {
  constructor(
    private readonly itemsRepository: ItemsRepository,
    private readonly groupsRepository: GroupsRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates an item, optionally with opening stock.
   *
   * When `quantity > 0` an opening `IN` movement is written in the **same
   * transaction**. That keeps the system's central invariant true from the very
   * first moment: an item's stock is always exactly the sum of its movements,
   * with no unexplained starting balance.
   */
  async create(dto: CreateItemDto): Promise<Item> {
    await this.assertGroupExists(dto.groupId);
    await this.assertSkuIsAvailable(dto.sku);

    const openingQuantity = dto.quantity ?? 0;

    return this.dataSource.transaction(async (manager) => {
      const item = await manager.save(
        manager.create(Item, {
          groupId: dto.groupId,
          name: dto.name,
          description: dto.description ?? null,
          sku: dto.sku.toUpperCase(),
          quantity: openingQuantity,
          minimumStock: dto.minimumStock ?? 0,
          unitPrice: dto.unitPrice ?? 0,
        }),
      );

      if (openingQuantity > 0) {
        await manager.save(
          manager.create(Movement, {
            itemId: item.id,
            type: MovementType.IN,
            quantity: openingQuantity,
            reason: 'Opening stock recorded at item creation',
            resultingStock: openingQuantity,
          }),
        );
      }

      return item;
    });
  }

  async findAll(query: QueryItemsDto): Promise<PaginatedResponseDto<Item>> {
    const { rows, total } = await this.itemsRepository.findMany(query);
    return new PaginatedResponseDto(rows, total, query.page, query.pageSize);
  }

  /** Backing call for the `QUERY /items/search` endpoint. */
  async search(dto: SearchItemsDto): Promise<PaginatedResponseDto<Item>> {
    const { rows, total } = await this.itemsRepository.search(dto);
    return new PaginatedResponseDto(rows, total, dto.page, dto.pageSize);
  }

  async findOne(id: number): Promise<Item> {
    const item = await this.itemsRepository.findById(id);
    if (!item) throw new ItemNotFoundError(id);
    return item;
  }

  async findLowStock(page: number, pageSize: number): Promise<PaginatedResponseDto<Item>> {
    const { rows, total } = await this.itemsRepository.findLowStock(page, pageSize);
    return new PaginatedResponseDto(rows, total, page, pageSize);
  }

  async findByGroup(groupId: number, query: QueryItemsDto): Promise<PaginatedResponseDto<Item>> {
    await this.assertGroupExists(groupId);
    return this.findAll(Object.assign(query, { groupId }));
  }

  /**
   * `PUT` semantics: everything the client may set is replaced.
   *
   * `quantity` is not among those fields — it belongs to the movements ledger,
   * so it is preserved rather than reset.
   */
  async replace(id: number, dto: ReplaceItemDto): Promise<Item> {
    await this.findOne(id);
    await this.assertGroupExists(dto.groupId);
    await this.assertSkuIsAvailable(dto.sku, id);

    return this.applyUpdate(id, {
      groupId: dto.groupId,
      name: dto.name,
      description: dto.description ?? null,
      sku: dto.sku.toUpperCase(),
      minimumStock: dto.minimumStock ?? 0,
      unitPrice: dto.unitPrice ?? 0,
    });
  }

  /** `PATCH` semantics: only the supplied fields are modified. */
  async update(id: number, dto: UpdateItemDto): Promise<Item> {
    await this.findOne(id);

    if (dto.groupId !== undefined) await this.assertGroupExists(dto.groupId);
    if (dto.sku !== undefined) await this.assertSkuIsAvailable(dto.sku, id);

    const changes: Partial<Item> = {};
    if (dto.groupId !== undefined) changes.groupId = dto.groupId;
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.description !== undefined) changes.description = dto.description ?? null;
    if (dto.sku !== undefined) changes.sku = dto.sku.toUpperCase();
    if (dto.minimumStock !== undefined) changes.minimumStock = dto.minimumStock;
    if (dto.unitPrice !== undefined) changes.unitPrice = dto.unitPrice;

    if (Object.keys(changes).length === 0) return this.findOne(id);

    return this.applyUpdate(id, changes);
  }

  /**
   * Deletes an item together with its movement history.
   *
   * The cascade is intentional and enforced by the foreign key: keeping orphan
   * ledger rows that point at a deleted item would be worse than removing them.
   */
  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.itemsRepository.delete(id);
  }

  /** Aggregate view of the whole inventory, computed entirely in SQL. */
  async summary(): Promise<InventorySummaryDto> {
    const [global, byGroup] = await Promise.all([
      this.itemsRepository.globalSummary(),
      this.itemsRepository.summaryByGroup(),
    ]);

    return {
      totalGroups: byGroup.length,
      totalItems: Number(global.totalItems),
      totalUnits: Number(global.totalUnits ?? 0),
      totalValue: Number(global.totalValue ?? 0),
      lowStockCount: Number(global.lowStockCount),
      outOfStockCount: Number(global.outOfStockCount),
      byGroup,
    };
  }

  private async assertGroupExists(groupId: number): Promise<void> {
    const exists = await this.groupsRepository.exists(groupId);
    if (!exists) throw new GroupNotFoundError(groupId);
  }

  private async assertSkuIsAvailable(sku: string, excludeId?: number): Promise<void> {
    const existing = await this.itemsRepository.findBySku(sku, excludeId);
    if (existing) throw new SkuAlreadyExistsError(sku.toUpperCase());
  }

  private async applyUpdate(id: number, changes: Partial<Item>): Promise<Item> {
    const updated = await this.itemsRepository.update(id, changes);
    if (!updated) throw new ItemNotFoundError(id);
    return updated;
  }
}
