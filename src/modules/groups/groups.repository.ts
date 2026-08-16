import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SortOrder } from '../../common/dto/pagination-query.dto';
import { Group } from './entities/group.entity';
import { GroupSortField, type QueryGroupsDto } from './dto/query-groups.dto';

export interface PaginatedRows<T> {
  rows: T[];
  total: number;
}

/**
 * Data-access layer for groups.
 *
 * Keeping query construction here means the service reads as business rules and
 * nothing else, and it gives the integration tests a single seam to exercise
 * SQL behaviour (indexes, case-insensitive matching) directly.
 */
@Injectable()
export class GroupsRepository {
  constructor(
    @InjectRepository(Group)
    private readonly repository: Repository<Group>,
  ) {}

  create(data: Partial<Group>): Promise<Group> {
    return this.repository.save(this.repository.create(data));
  }

  findById(id: number): Promise<Group | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Case-insensitive name lookup, mirroring the `ux_groups_name_lower` unique
   * index so the service can report a friendly conflict before the database
   * raises one.
   */
  findByName(name: string, excludeId?: number): Promise<Group | null> {
    const qb = this.repository
      .createQueryBuilder('group')
      .where('lower(group.name) = lower(:name)', { name });

    if (excludeId !== undefined) {
      qb.andWhere('group.id != :excludeId', { excludeId });
    }

    return qb.getOne();
  }

  async findMany(query: QueryGroupsDto): Promise<PaginatedRows<Group>> {
    const qb = this.repository.createQueryBuilder('group');

    if (query.search) {
      qb.andWhere('(group.name ILIKE :search OR group.description ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    // `sortBy` is constrained to a fixed enum by validation, so interpolating
    // it here cannot introduce injection.
    qb.orderBy(`group.${query.sortBy}`, query.sortOrder === SortOrder.DESC ? 'DESC' : 'ASC');

    // Stable tiebreaker: without it, rows with equal sort keys can shuffle
    // between pages and the client sees duplicates or gaps.
    if (query.sortBy !== GroupSortField.ID) {
      qb.addOrderBy('group.id', 'ASC');
    }

    const [rows, total] = await qb.skip(query.skip).take(query.pageSize).getManyAndCount();

    return { rows, total };
  }

  async update(id: number, data: Partial<Group>): Promise<Group | null> {
    await this.repository.update({ id }, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.repository.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  countItems(groupId: number): Promise<number> {
    return this.repository.manager.count('items', { where: { groupId } });
  }

  exists(id: number): Promise<boolean> {
    return this.repository.existsBy({ id });
  }
}
