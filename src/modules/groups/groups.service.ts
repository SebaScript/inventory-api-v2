import { Injectable } from '@nestjs/common';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  GroupNameAlreadyExistsError,
  GroupNotEmptyError,
  GroupNotFoundError,
} from '../../common/errors/domain.errors';
import { type CreateGroupDto } from './dto/create-group.dto';
import { type QueryGroupsDto } from './dto/query-groups.dto';
import { type ReplaceGroupDto, type UpdateGroupDto } from './dto/update-group.dto';
import { Group } from './entities/group.entity';
import { GroupsRepository } from './groups.repository';

/**
 * Business rules for groups.
 *
 * Throws framework-agnostic domain errors (never `HttpException`), so the rules
 * can be unit tested without NestJS and the mapping to status codes stays in
 * exactly one place: `GlobalExceptionFilter`.
 */
@Injectable()
export class GroupsService {
  constructor(private readonly groupsRepository: GroupsRepository) {}

  async create(dto: CreateGroupDto): Promise<Group> {
    await this.assertNameIsAvailable(dto.name);

    return this.groupsRepository.create({
      name: dto.name,
      description: dto.description ?? null,
    });
  }

  async findAll(query: QueryGroupsDto): Promise<PaginatedResponseDto<Group>> {
    const { rows, total } = await this.groupsRepository.findMany(query);
    return new PaginatedResponseDto(rows, total, query.page, query.pageSize);
  }

  async findOne(id: number): Promise<Group> {
    const group = await this.groupsRepository.findById(id);
    if (!group) throw new GroupNotFoundError(id);
    return group;
  }

  /**
   * `PUT` semantics: the stored resource is replaced by the payload, so an
   * omitted `description` is cleared rather than preserved.
   */
  async replace(id: number, dto: ReplaceGroupDto): Promise<Group> {
    await this.findOne(id);
    await this.assertNameIsAvailable(dto.name, id);

    return this.applyUpdate(id, {
      name: dto.name,
      description: dto.description ?? null,
    });
  }

  /** `PATCH` semantics: only the supplied fields are touched. */
  async update(id: number, dto: UpdateGroupDto): Promise<Group> {
    await this.findOne(id);

    if (dto.name !== undefined) {
      await this.assertNameIsAvailable(dto.name, id);
    }

    const changes: Partial<Group> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.description !== undefined) changes.description = dto.description ?? null;

    if (Object.keys(changes).length === 0) {
      return this.findOne(id);
    }

    return this.applyUpdate(id, changes);
  }

  /**
   * Refuses to delete a group that still holds items.
   *
   * The database enforces this too (`ON DELETE RESTRICT`), but checking here
   * turns an opaque foreign-key error into an actionable 409 that names the
   * problem.
   */
  async remove(id: number): Promise<void> {
    await this.findOne(id);

    const itemCount = await this.groupsRepository.countItems(id);
    if (itemCount > 0) throw new GroupNotEmptyError(id);

    await this.groupsRepository.delete(id);
  }

  private async assertNameIsAvailable(name: string, excludeId?: number): Promise<void> {
    const existing = await this.groupsRepository.findByName(name, excludeId);
    if (existing) throw new GroupNameAlreadyExistsError(name);
  }

  private async applyUpdate(id: number, changes: Partial<Group>): Promise<Group> {
    const updated = await this.groupsRepository.update(id, changes);
    // The row was read moments ago; a null here means it was deleted
    // concurrently, which is still a "not found" from the caller's perspective.
    if (!updated) throw new GroupNotFoundError(id);
    return updated;
  }
}
