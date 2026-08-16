import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import { type EntityManager } from 'typeorm';
import { SortOrder } from '../../common/dto/pagination-query.dto';
import {
  InsufficientStockError,
  ItemNotFoundError,
  MovementNotFoundError,
} from '../../common/errors/domain.errors';
import { type Item } from '../items/entities/item.entity';
import { MovementSortField, QueryMovementsDto } from './dto/query-movements.dto';
import { type Movement, MovementType } from './entities/movement.entity';
import { MovementsRepository } from './movements.repository';
import { MovementsService, computeResultingStock } from './movements.service';

const buildItem = (overrides: Partial<Item> = {}): Item =>
  ({ id: 1, quantity: 50, minimumStock: 10, unitPrice: 10, groupId: 1, ...overrides }) as Item;

const buildQuery = (overrides: Partial<QueryMovementsDto> = {}): QueryMovementsDto =>
  Object.assign(new QueryMovementsDto(), {
    page: 1,
    pageSize: 20,
    sortBy: MovementSortField.CREATED_AT,
    sortOrder: SortOrder.DESC,
    ...overrides,
  });

/**
 * Fake EntityManager exposing only what the service touches.
 *
 * The transaction itself is exercised against real PostgreSQL in
 * `test/integration/inventory-transaction.int-spec.ts`; these unit tests pin
 * down the decision logic — what gets written, what gets rejected, in which
 * order — without paying for a database round trip.
 */
const buildManagerMock = (item: Item | null) => {
  const setLock = jest.fn().mockReturnThis();
  const where = jest.fn().mockReturnThis();
  const getOne = jest.fn().mockResolvedValue(item);

  return {
    createQueryBuilder: jest.fn(() => ({ setLock, where, getOne })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn((data: unknown) => Promise.resolve({ id: 99, ...(data as object) })),
    _spies: { setLock, where, getOne },
  };
};

describe('computeResultingStock', () => {
  it.each([
    [MovementType.IN, 50, 25, 75],
    [MovementType.IN, 0, 1, 1],
    [MovementType.OUT, 50, 25, 25],
    [MovementType.OUT, 50, 50, 0],
    // Negative results are produced here and rejected by the caller, which is
    // exactly the separation being tested.
    [MovementType.OUT, 5, 10, -5],
  ])('%s of %i from stock %i yields %i', (type, current, quantity, expected) => {
    expect(computeResultingStock(current, type, quantity)).toBe(expected);
  });
});

describe('MovementsService', () => {
  let service: MovementsService;
  let repository: jest.Mocked<MovementsRepository>;
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let manager: ReturnType<typeof buildManagerMock>;

  const givenItem = (item: Item | null): void => {
    manager = buildManagerMock(item);
    dataSource.transaction.mockImplementation(
      (runInTransaction: (m: EntityManager) => Promise<unknown>) =>
        runInTransaction(manager as unknown as EntityManager),
    );
  };

  beforeEach(async () => {
    dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn(() => ({ existsBy: jest.fn().mockResolvedValue(true) })),
    };

    const repositoryMock: Partial<jest.Mocked<MovementsRepository>> = {
      findById: jest.fn(),
      findMany: jest.fn(),
      countByItem: jest.fn(),
      netQuantityForItem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovementsService,
        { provide: MovementsRepository, useValue: repositoryMock },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(MovementsService);
    repository = module.get(MovementsRepository);
  });

  describe('create — IN movements', () => {
    it('increases stock and records the resulting level on the ledger entry', async () => {
      givenItem(buildItem({ quantity: 50 }));

      const movement = await service.create({
        itemId: 1,
        type: MovementType.IN,
        quantity: 25,
      });

      expect(manager.update).toHaveBeenCalledWith(expect.anything(), { id: 1 }, { quantity: 75 });
      expect(movement).toMatchObject({
        itemId: 1,
        type: MovementType.IN,
        quantity: 25,
        resultingStock: 75,
      });
    });

    it('works from zero stock', async () => {
      givenItem(buildItem({ quantity: 0 }));

      await service.create({ itemId: 1, type: MovementType.IN, quantity: 10 });

      expect(manager.update).toHaveBeenCalledWith(expect.anything(), { id: 1 }, { quantity: 10 });
    });
  });

  describe('create — OUT movements', () => {
    it('decreases stock when there is enough', async () => {
      givenItem(buildItem({ quantity: 50 }));

      const movement = await service.create({
        itemId: 1,
        type: MovementType.OUT,
        quantity: 20,
        reason: 'Sales order SO-1',
      });

      expect(manager.update).toHaveBeenCalledWith(expect.anything(), { id: 1 }, { quantity: 30 });
      expect(movement).toMatchObject({ resultingStock: 30, reason: 'Sales order SO-1' });
    });

    it('allows draining stock to exactly zero', async () => {
      givenItem(buildItem({ quantity: 15 }));

      const movement = await service.create({ itemId: 1, type: MovementType.OUT, quantity: 15 });

      expect(movement).toMatchObject({ resultingStock: 0 });
    });

    it('rejects an OUT that would drive stock negative, writing nothing at all', async () => {
      givenItem(buildItem({ quantity: 3 }));

      await expect(
        service.create({ itemId: 1, type: MovementType.OUT, quantity: 10 }),
      ).rejects.toBeInstanceOf(InsufficientStockError);

      // The critical assertion: neither side effect happened.
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('reports how much was available versus requested', async () => {
      givenItem(buildItem({ quantity: 3 }));

      await expect(
        service.create({ itemId: 1, type: MovementType.OUT, quantity: 10 }),
      ).rejects.toMatchObject({ itemId: 1, available: 3, requested: 10 });
    });

    it('rejects any OUT against zero stock', async () => {
      givenItem(buildItem({ quantity: 0 }));

      await expect(
        service.create({ itemId: 1, type: MovementType.OUT, quantity: 1 }),
      ).rejects.toBeInstanceOf(InsufficientStockError);
    });
  });

  describe('create — preconditions', () => {
    it('locks the item row for update before reading its stock', async () => {
      givenItem(buildItem());

      await service.create({ itemId: 1, type: MovementType.IN, quantity: 1 });

      // Without this lock, two concurrent OUTs could both read the same stock
      // and both commit, overselling the item.
      expect(manager._spies.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('runs the whole operation inside a single transaction', async () => {
      givenItem(buildItem());

      await service.create({ itemId: 1, type: MovementType.IN, quantity: 1 });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('throws ItemNotFoundError for an unknown item', async () => {
      givenItem(null);

      await expect(
        service.create({ itemId: 404, type: MovementType.IN, quantity: 1 }),
      ).rejects.toBeInstanceOf(ItemNotFoundError);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('stores a null reason when none is supplied', async () => {
      givenItem(buildItem());

      const movement = await service.create({ itemId: 1, type: MovementType.IN, quantity: 5 });

      expect(movement).toMatchObject({ reason: null });
    });
  });

  describe('findAll', () => {
    it('returns a paginated envelope', async () => {
      repository.findMany.mockResolvedValue({ rows: [{ id: 1 } as Movement], total: 1 });

      const result = await service.findAll(buildQuery());

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('returns the movement when it exists', async () => {
      repository.findById.mockResolvedValue({ id: 7 } as Movement);
      await expect(service.findOne(7)).resolves.toMatchObject({ id: 7 });
    });

    it('throws MovementNotFoundError otherwise', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.findOne(404)).rejects.toBeInstanceOf(MovementNotFoundError);
    });
  });

  describe('findByItem', () => {
    it('scopes the query to the item', async () => {
      repository.findMany.mockResolvedValue({ rows: [], total: 0 });

      await service.findByItem(5, buildQuery());

      expect(repository.findMany).toHaveBeenCalledWith(expect.objectContaining({ itemId: 5 }));
    });

    it('returns 404 semantics for an unknown item rather than an empty page', async () => {
      dataSource.getRepository.mockReturnValue({
        existsBy: jest.fn().mockResolvedValue(false),
      });

      await expect(service.findByItem(404, buildQuery())).rejects.toBeInstanceOf(ItemNotFoundError);
    });
  });
});
