import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Not, Repository } from 'typeorm';
import {
  DuplicateNameException,
  GroupNotEmptyException,
  GroupNotFoundException,
} from '../common/exceptions';
import { Paginated } from '../common/pagination';
import { Group } from '../entities/group.entity';
import { Item } from '../entities/item.entity';
import { CreateGroupDto, FindGroupsDto, UpdateGroupDto } from './group.dto';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
  ) {}

  async create(dto: CreateGroupDto): Promise<Group> {
    await this.assertNameIsFree(dto.name);
    return this.groups.save(this.groups.create(dto));
  }

  async findAll(query: FindGroupsDto): Promise<Paginated<Group>> {
    const [data, total] = await this.groups.findAndCount({
      where: query.search ? { name: ILike(`%${query.search}%`) } : {},
      order: { id: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return new Paginated(data, total, query.page, query.limit);
  }

  async findOne(id: number): Promise<Group> {
    const group = await this.groups.findOneBy({ id });
    if (!group) throw new GroupNotFoundException(id);
    return group;
  }

  /** Only the fields present in the body change. */
  async update(id: number, dto: UpdateGroupDto): Promise<Group> {
    await this.findOne(id);
    if (dto.name) await this.assertNameIsFree(dto.name, id);
    await this.groups.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    // Checked here so the client gets an explanation instead of the raw
    // foreign-key error the database would otherwise raise.
    if (await this.items.countBy({ groupId: id })) throw new GroupNotEmptyException(id);
    await this.groups.delete(id);
  }

  /** Names are unique case-insensitively: "Tools" and "tools" collide. */
  private async assertNameIsFree(name: string, exceptId?: number): Promise<void> {
    const clash = await this.groups.findOneBy({
      name: ILike(name),
      ...(exceptId ? { id: Not(exceptId) } : {}),
    });
    if (clash) throw new DuplicateNameException(name);
  }
}
