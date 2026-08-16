import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { type EntityManager } from 'typeorm';
import { SortOrder } from '../../common/dto/pagination-query.dto';
import {
  GroupNotFoundError,
  ItemNotFoundError,
  SkuAlreadyExistsError,
} from '../../common/errors/domain.errors';
import { GroupsRepository } from '../groups/groups.repository';
import { MovementType } from '../movements/entities/movement.entity';
import { ItemSortField, QueryItemsDto } from './dto/query-items.dto';
import { SearchItemsDto } from './dto/search-items.dto';
import { type Item } from './entities/item.entity';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';

const buildItem = (overrides: Partial<Item> = {}): Item => ({
  id: 1,
  groupId: 1,
  name: 'USB-C Cable',
  description: null,
  sku: 'USB-C-1',
  quantity: 10,
  minimumStock: 5,
  unitPrice: 12.5,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const buildQuery = (overrides: Partial<QueryItemsDto> = {}): QueryItemsDto =>
  Object.assign(new QueryItemsDto(), {
    page: 1,
    pageSize: 20,
    sortBy: ItemSortField.ID,
    sortOrder: SortOrder.ASC,
    ...overrides,
  });

describe('ItemsService', () => {
  let service: ItemsService;
  let itemsRepository: jest.Mocked<ItemsRepository>;
  let groupsRepository: jest.Mocked<GroupsRepository>;
  let manager: {
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    manager = {
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn((data: unknown) => Promise.resolve({ id: 1, ...(data as object) })),
    };

    const dataSource = {
      transaction: jest.fn((runInTransaction: (m: EntityManager) => Promise<unknown>) =>
        runInTransaction(manager as unknown as EntityManager),
      ),
    };

    const itemsRepositoryMock: Partial<jest.Mocked<ItemsRepository>> = {
      findById: jest.fn(),
      findBySku: jest.fn(),
      findMany: jest.fn(),
      search: jest.fn(),
      findLowStock: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      globalSummary: jest.fn(),
      summaryByGroup: jest.fn(),
    };

    const groupsRepositoryMock: Partial<jest.Mocked<GroupsRepository>> = {
      exists: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: ItemsRepository, useValue: itemsRepositoryMock },
        { provide: GroupsRepository, useValue: groupsRepositoryMock },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(ItemsService);
    itemsRepository = module.get(ItemsRepository);
    groupsRepository = module.get(GroupsRepository);
  });

  describe('create', () => {
    it('normalises the SKU to uppercase', async () => {
      itemsRepository.findBySku.mockResolvedValue(null);

      await service.create({ groupId: 1, name: 'Cable', sku: 'usb-c-1' });

      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sku: 'USB-C-1' }),
      );
    });

    it('defaults quantity, minimumStock and unitPrice to zero', async () => {
      itemsRepository.findBySku.mockResolvedValue(null);

      await service.create({ groupId: 1, name: 'Cable', sku: 'C1' });

      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ quantity: 0, minimumStock: 0, unitPrice: 0 }),
      );
      // No opening stock means no opening movement.
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('records an opening IN movement when created with stock', async () => {
      itemsRepository.findBySku.mockResolvedValue(null);

      await service.create({ groupId: 1, name: 'Cable', sku: 'C1', quantity: 40 });

      expect(manager.save).toHaveBeenCalledTimes(2);
      expect(manager.create).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: MovementType.IN,
          quantity: 40,
          resultingStock: 40,
        }),
      );
    });

    it('rejects an unknown group before writing anything', async () => {
      groupsRepository.exists.mockResolvedValue(false);

      await expect(
        service.create({ groupId: 404, name: 'Cable', sku: 'C1' }),
      ).rejects.toBeInstanceOf(GroupNotFoundError);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rejects a duplicate SKU', async () => {
      itemsRepository.findBySku.mockResolvedValue(buildItem());

      await expect(
        service.create({ groupId: 1, name: 'Cable', sku: 'usb-c-1' }),
      ).rejects.toBeInstanceOf(SkuAlreadyExistsError);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the item with its group loaded', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());

      await service.findOne(1);

      expect(itemsRepository.findById).toHaveBeenCalledWith(1);
    });

    it('throws ItemNotFoundError for an unknown id', async () => {
      itemsRepository.findById.mockResolvedValue(null);
      await expect(service.findOne(404)).rejects.toBeInstanceOf(ItemNotFoundError);
    });
  });

  describe('replace (PUT)', () => {
    it('never touches quantity, because stock belongs to the ledger', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem({ quantity: 99 }));
      itemsRepository.findBySku.mockResolvedValue(null);
      itemsRepository.update.mockResolvedValue(buildItem());

      await service.replace(1, { groupId: 1, name: 'Renamed', sku: 'C1' });

      const changes = itemsRepository.update.mock.calls[0][1];
      expect(changes).not.toHaveProperty('quantity');
    });

    it('resets omitted optional fields, honouring replace semantics', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      itemsRepository.findBySku.mockResolvedValue(null);
      itemsRepository.update.mockResolvedValue(buildItem());

      await service.replace(1, { groupId: 1, name: 'Renamed', sku: 'C1' });

      expect(itemsRepository.update).toHaveBeenCalledWith(1, {
        groupId: 1,
        name: 'Renamed',
        description: null,
        sku: 'C1',
        minimumStock: 0,
        unitPrice: 0,
      });
    });

    it('validates the target group exists', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      groupsRepository.exists.mockResolvedValue(false);

      await expect(
        service.replace(1, { groupId: 404, name: 'X', sku: 'C1' }),
      ).rejects.toBeInstanceOf(GroupNotFoundError);
    });

    it('rejects a SKU already used by another item', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      itemsRepository.findBySku.mockResolvedValue(buildItem({ id: 2 }));

      await expect(
        service.replace(1, { groupId: 1, name: 'X', sku: 'TAKEN' }),
      ).rejects.toBeInstanceOf(SkuAlreadyExistsError);
    });
  });

  describe('update (PATCH)', () => {
    it('writes only the supplied fields', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      itemsRepository.update.mockResolvedValue(buildItem());

      await service.update(1, { unitPrice: 19.99 });

      expect(itemsRepository.update).toHaveBeenCalledWith(1, { unitPrice: 19.99 });
    });

    it('uppercases a patched SKU', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      itemsRepository.findBySku.mockResolvedValue(null);
      itemsRepository.update.mockResolvedValue(buildItem());

      await service.update(1, { sku: 'new-sku' });

      expect(itemsRepository.update).toHaveBeenCalledWith(1, { sku: 'NEW-SKU' });
    });

    it('accepts minimumStock of zero rather than treating it as absent', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      itemsRepository.update.mockResolvedValue(buildItem());

      await service.update(1, { minimumStock: 0 });

      expect(itemsRepository.update).toHaveBeenCalledWith(1, { minimumStock: 0 });
    });

    it('is a no-op for an empty payload', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());

      await service.update(1, {});

      expect(itemsRepository.update).not.toHaveBeenCalled();
    });

    it('surfaces a concurrent deletion as not found', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      itemsRepository.update.mockResolvedValue(null);

      await expect(service.update(1, { name: 'X' })).rejects.toBeInstanceOf(ItemNotFoundError);
    });
  });

  describe('remove', () => {
    it('deletes an existing item', async () => {
      itemsRepository.findById.mockResolvedValue(buildItem());
      itemsRepository.delete.mockResolvedValue(true);

      await service.remove(1);

      expect(itemsRepository.delete).toHaveBeenCalledWith(1);
    });

    it('throws for an unknown item', async () => {
      itemsRepository.findById.mockResolvedValue(null);
      await expect(service.remove(404)).rejects.toBeInstanceOf(ItemNotFoundError);
    });
  });

  describe('findByGroup', () => {
    it('scopes the query to the group', async () => {
      itemsRepository.findMany.mockResolvedValue({ rows: [], total: 0 });

      await service.findByGroup(7, buildQuery());

      expect(itemsRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 7 }),
      );
    });

    it('returns 404 semantics for an unknown group rather than an empty page', async () => {
      groupsRepository.exists.mockResolvedValue(false);

      await expect(service.findByGroup(404, buildQuery())).rejects.toBeInstanceOf(
        GroupNotFoundError,
      );
    });
  });

  describe('search', () => {
    it('paginates using the values from the QUERY body', async () => {
      itemsRepository.search.mockResolvedValue({ rows: [buildItem()], total: 31 });
      const dto = Object.assign(new SearchItemsDto(), { page: 2, pageSize: 10 });

      const result = await service.search(dto);

      expect(result.meta).toMatchObject({
        page: 2,
        pageSize: 10,
        total: 31,
        totalPages: 4,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });
  });

  describe('summary', () => {
    it('coerces the string aggregates PostgreSQL returns into numbers', async () => {
      itemsRepository.globalSummary.mockResolvedValue({
        totalItems: '10',
        totalUnits: '512',
        totalValue: '12345.67',
        lowStockCount: '2',
        outOfStockCount: '1',
      });
      itemsRepository.summaryByGroup.mockResolvedValue([
        {
          groupId: 1,
          groupName: 'Electronics',
          itemCount: 4,
          totalUnits: 210,
          totalValue: 4500.75,
          lowStockCount: 1,
        },
      ]);

      const result = await service.summary();

      expect(result).toEqual({
        totalGroups: 1,
        totalItems: 10,
        totalUnits: 512,
        totalValue: 12345.67,
        lowStockCount: 2,
        outOfStockCount: 1,
        byGroup: expect.any(Array),
      });
    });

    it('treats null aggregates from an empty inventory as zero', async () => {
      itemsRepository.globalSummary.mockResolvedValue({
        totalItems: '0',
        totalUnits: null,
        totalValue: null,
        lowStockCount: '0',
        outOfStockCount: '0',
      });
      itemsRepository.summaryByGroup.mockResolvedValue([]);

      const result = await service.summary();

      expect(result).toMatchObject({ totalUnits: 0, totalValue: 0, totalGroups: 0 });
    });
  });

  describe('findLowStock', () => {
    it('returns a paginated envelope', async () => {
      itemsRepository.findLowStock.mockResolvedValue({ rows: [buildItem()], total: 1 });

      const result = await service.findLowStock(1, 20);

      expect(itemsRepository.findLowStock).toHaveBeenCalledWith(1, 20);
      expect(result.meta.total).toBe(1);
    });
  });
});
