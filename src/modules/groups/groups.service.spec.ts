import { Test, type TestingModule } from '@nestjs/testing';
import {
  GroupNameAlreadyExistsError,
  GroupNotEmptyError,
  GroupNotFoundError,
} from '../../common/errors/domain.errors';
import { SortOrder } from '../../common/dto/pagination-query.dto';
import { GroupSortField, QueryGroupsDto } from './dto/query-groups.dto';
import { type Group } from './entities/group.entity';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';

const buildGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 1,
  name: 'Electronics',
  description: 'Consumer electronics',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const buildQuery = (overrides: Partial<QueryGroupsDto> = {}): QueryGroupsDto =>
  Object.assign(new QueryGroupsDto(), {
    page: 1,
    pageSize: 20,
    sortBy: GroupSortField.ID,
    sortOrder: SortOrder.ASC,
    ...overrides,
  });

describe('GroupsService', () => {
  let service: GroupsService;
  let repository: jest.Mocked<GroupsRepository>;

  beforeEach(async () => {
    const repositoryMock: Partial<jest.Mocked<GroupsRepository>> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countItems: jest.fn(),
      exists: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GroupsService, { provide: GroupsRepository, useValue: repositoryMock }],
    }).compile();

    service = module.get(GroupsService);
    repository = module.get(GroupsRepository);
  });

  describe('create', () => {
    it('persists the group and defaults a missing description to null', async () => {
      repository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(buildGroup({ description: null }));

      const result = await service.create({ name: 'Electronics' });

      expect(repository.create).toHaveBeenCalledWith({
        name: 'Electronics',
        description: null,
      });
      expect(result.id).toBe(1);
    });

    it('rejects a name that already exists, case-insensitively', async () => {
      repository.findByName.mockResolvedValue(buildGroup({ name: 'electronics' }));

      await expect(service.create({ name: 'ELECTRONICS' })).rejects.toBeInstanceOf(
        GroupNameAlreadyExistsError,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('wraps rows in a paginated envelope with correct navigation flags', async () => {
      repository.findMany.mockResolvedValue({ rows: [buildGroup()], total: 45 });

      const result = await service.findAll(buildQuery({ page: 2, pageSize: 20 }));

      expect(result.meta).toEqual({
        page: 2,
        pageSize: 20,
        total: 45,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
      expect(result.data).toHaveLength(1);
    });

    it('reports no next page on the last page', async () => {
      repository.findMany.mockResolvedValue({ rows: [], total: 10 });

      const result = await service.findAll(buildQuery({ page: 1, pageSize: 20 }));

      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });
  });

  describe('findOne', () => {
    it('returns the group when it exists', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      await expect(service.findOne(1)).resolves.toMatchObject({ id: 1 });
    });

    it('throws GroupNotFoundError when it does not', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.findOne(99)).rejects.toBeInstanceOf(GroupNotFoundError);
    });
  });

  describe('replace (PUT)', () => {
    it('clears description when it is omitted, honouring replace semantics', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(buildGroup({ description: null }));

      await service.replace(1, { name: 'Renamed' });

      expect(repository.update).toHaveBeenCalledWith(1, {
        name: 'Renamed',
        description: null,
      });
    });

    it('allows keeping the same name on the same record', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      // findByName excludes the record being updated, so it finds nothing.
      repository.findByName.mockResolvedValue(null);
      repository.update.mockResolvedValue(buildGroup());

      await expect(service.replace(1, { name: 'Electronics' })).resolves.toBeDefined();
      expect(repository.findByName).toHaveBeenCalledWith('Electronics', 1);
    });

    it('rejects renaming onto another group name', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.findByName.mockResolvedValue(buildGroup({ id: 2, name: 'Tools' }));

      await expect(service.replace(1, { name: 'Tools' })).rejects.toBeInstanceOf(
        GroupNameAlreadyExistsError,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws when the group does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.replace(99, { name: 'X' })).rejects.toBeInstanceOf(GroupNotFoundError);
    });
  });

  describe('update (PATCH)', () => {
    it('only writes the supplied fields', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.update.mockResolvedValue(buildGroup({ description: 'New' }));

      await service.update(1, { description: 'New' });

      expect(repository.update).toHaveBeenCalledWith(1, { description: 'New' });
      // No name supplied means no uniqueness check is needed.
      expect(repository.findByName).not.toHaveBeenCalled();
    });

    it('treats an explicit null description as a clear', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.update.mockResolvedValue(buildGroup({ description: null }));

      await service.update(1, { description: null });

      expect(repository.update).toHaveBeenCalledWith(1, { description: null });
    });

    it('is a no-op for an empty payload and does not hit the database', async () => {
      repository.findById.mockResolvedValue(buildGroup());

      const result = await service.update(1, {});

      expect(repository.update).not.toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('validates uniqueness when a name is supplied', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.findByName.mockResolvedValue(buildGroup({ id: 2 }));

      await expect(service.update(1, { name: 'Tools' })).rejects.toBeInstanceOf(
        GroupNameAlreadyExistsError,
      );
    });

    it('surfaces a concurrent deletion as not found', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.update.mockResolvedValue(null);

      await expect(service.update(1, { description: 'New' })).rejects.toBeInstanceOf(
        GroupNotFoundError,
      );
    });
  });

  describe('remove', () => {
    it('deletes an empty group', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.countItems.mockResolvedValue(0);
      repository.delete.mockResolvedValue(true);

      await service.remove(1);

      expect(repository.delete).toHaveBeenCalledWith(1);
    });

    it('refuses to delete a group that still holds items', async () => {
      repository.findById.mockResolvedValue(buildGroup());
      repository.countItems.mockResolvedValue(3);

      await expect(service.remove(1)).rejects.toBeInstanceOf(GroupNotEmptyError);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('throws when the group does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toBeInstanceOf(GroupNotFoundError);
      expect(repository.countItems).not.toHaveBeenCalled();
    });
  });
});
