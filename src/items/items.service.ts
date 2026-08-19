import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import {
  DuplicateSkuException,
  GroupNotFoundException,
  ItemNotFoundException,
} from '../common/exceptions';
import { Paginated } from '../common/pagination';
import { Group } from '../entities/group.entity';
import { Item, ItemStatus } from '../entities/item.entity';
import { Movement, MovementType } from '../entities/movement.entity';
import {
  CreateItemDto,
  FindItemsDto,
  ReplaceItemDto,
  SearchItemsDto,
  StatusFilter,
  UpdateItemDto,
} from './item.dto';

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    private readonly dataSource: DataSource,
  ) {}

  /** Opening stock becomes an IN movement, so the ledger explains every unit. */
  async create(dto: CreateItemDto): Promise<Item> {
    await this.assertGroupExists(dto.groupId);
    await this.assertSkuIsFree(dto.sku);

    const opening = dto.quantity ?? 0;

    return this.dataSource.transaction(async (manager) => {
      const item = await manager.save(manager.create(Item, { ...dto, quantity: opening }));

      if (opening > 0) {
        await manager.save(
          manager.create(Movement, {
            itemId: item.id,
            type: MovementType.IN,
            quantity: opening,
            reason: 'Opening stock',
            resultingStock: opening,
          }),
        );
      }
      return item;
    });
  }

  async findAll(query: FindItemsDto): Promise<Paginated<Item>> {
    const qb = this.items.createQueryBuilder('item').leftJoinAndSelect('item.group', 'group');

    // Listings show active items unless asked otherwise.
    const status = query.status ?? StatusFilter.ACTIVE;
    if (status !== StatusFilter.ALL) qb.andWhere('item.status = :status', { status });

    if (query.search) {
      qb.andWhere('(item.name ILIKE :s OR item.sku ILIKE :s)', { s: `%${query.search}%` });
    }
    if (query.groupId) qb.andWhere('item.groupId = :g', { g: query.groupId });
    if (query.lowStock) qb.andWhere('item.quantity <= item.minimumStock');

    return this.paginate(qb, query.page, query.limit);
  }

  /** Backing query for `QUERY /items/search`. */
  async search(dto: SearchItemsDto): Promise<Paginated<Item>> {
    const qb = this.items
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.group', 'group')
      .where('item.status = :status', { status: ItemStatus.ACTIVE });

    if (dto.text) {
      qb.andWhere('(item.name ILIKE :t OR item.sku ILIKE :t)', { t: `%${dto.text}%` });
    }
    if (dto.groupIds?.length) qb.andWhere({ groupId: In(dto.groupIds) });
    if (dto.minPrice !== undefined) qb.andWhere('item.unitPrice >= :min', { min: dto.minPrice });
    if (dto.maxPrice !== undefined) qb.andWhere('item.unitPrice <= :max', { max: dto.maxPrice });

    return this.paginate(qb, dto.page, dto.limit);
  }

  /** Discontinued items are still readable, so their history stays auditable. */
  async findOne(id: number): Promise<Item> {
    const item = await this.items.findOne({ where: { id }, relations: { group: true } });
    if (!item) throw new ItemNotFoundException(id);
    return item;
  }

  /** PUT replaces every client-owned field; stock and status are not among them. */
  async replace(id: number, dto: ReplaceItemDto): Promise<Item> {
    await this.findOne(id);
    await this.assertGroupExists(dto.groupId);
    await this.assertSkuIsFree(dto.sku, id);

    await this.items.update(id, {
      ...dto,
      minimumStock: dto.minimumStock ?? 0,
      unitPrice: dto.unitPrice ?? 0,
    });
    return this.findOne(id);
  }

  async update(id: number, dto: UpdateItemDto): Promise<Item> {
    await this.findOne(id);
    if (dto.groupId) await this.assertGroupExists(dto.groupId);
    if (dto.sku) await this.assertSkuIsFree(dto.sku, id);

    await this.items.update(id, dto);
    return this.findOne(id);
  }

  /** DELETE means "withdrawn from service", not "erased". History is kept. */
  async discontinue(id: number): Promise<void> {
    await this.findOne(id);
    await this.items.update(id, { status: ItemStatus.DISCONTINUED });
  }

  private async paginate(
    qb: SelectQueryBuilder<Item>,
    page: number,
    limit: number,
  ): Promise<Paginated<Item>> {
    const [data, total] = await qb
      .orderBy('item.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return new Paginated(data, total, page, limit);
  }

  private async assertGroupExists(groupId: number): Promise<void> {
    if (!(await this.groups.existsBy({ id: groupId }))) throw new GroupNotFoundException(groupId);
  }

  /** A discontinued item keeps its SKU reserved, so its history stays unambiguous. */
  private async assertSkuIsFree(sku: string, exceptId?: number): Promise<void> {
    const clash = await this.items.findOneBy({
      sku: sku.toUpperCase(),
      ...(exceptId ? { id: Not(exceptId) } : {}),
    });
    if (clash) throw new DuplicateSkuException(sku.toUpperCase());
  }
}
